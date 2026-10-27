// 「粘贴凭据登录」这一个方式：读剪贴板 / 文件，把凭据交给 magpie 保存。
//
// 和别的登录方式一样，它最后要交回 magpie 一个凭据对象，magpie 自己写进
// 账号列表 —— 所以导入的账号和浏览器登录的账号在同一个列表、同一张卡片。
//
// 区别在于入口不是浏览器：凭据已经在手上了，直接读剪贴板就行。插件的
// authorize() 跑在 magpie 宿主进程里，读得到剪贴板。

import { existsSync, readFileSync } from "node:fs";
import { parsePayload, readClipboard, renew, decodeJwt, knownUids, displayName } from "./auth-store.js";

/** Text the person is most likely to mean, in the order worth trying. */
function credentialText() {
  // A path, for scripts: WPT_FILE=cred.json magpie plugin login workbuddy
  const p = process.env.WPT_FILE;
  if (p && existsSync(p)) return { source: p, text: readFileSync(p, "utf8") };

  // Otherwise the clipboard, which is where a pasted credential lands.
  const clip = readClipboard();
  if (clip) return { source: "剪贴板", text: clip };

  throw new Error(
    [
      "没读到剪贴板里有什么内容。",
      "",
      "  1. 把凭据 JSON 全文复制到剪贴板，再点一次「粘贴凭据登录」",
      "  2. 或者指定文件：",
      '       Windows        set "WPT_FILE=D:\\cred.json"',
      "       PowerShell     $env:WPT_FILE='D:\\cred.json'",
      "       macOS / Linux  WPT_FILE=/cred.json magpie plugin login workbuddy",
      "",
      "支持 workbuddy-<uid>.json、cockpit-<uid>.json、workbuddy-desktop.info。",
    ].join("\n")
  );
}

/**
 * magpie's sign-in contract: authorize() hands back what to show plus a
 * callback() that finishes. Everything is done in authorize() because magpie
 * only reports a method as failed when authorize() rejects — a failing
 * callback would still print a tick.
 */
export async function authorize() {
  const { source, text } = await credentialText();
  const parsed = parsePayload(text);
  if (parsed.error) {
    const hint =
      source === "剪贴板"
        ? "\n\n剪贴板里现在不是一份凭据。先把凭据 JSON 全文复制，再点一次；或者用 WPT_FILE 指向文件：\n  set \"WPT_FILE=D:\\cred.json\""
        : "";
    throw new Error(`读不出凭据（${source}）：${parsed.error}${hint}`);
  }

  const rec = parsed.accounts[0];
  if (!rec.refresh) {
    throw new Error("这份凭据里没有 refresh token，登录会立刻过期。请换一份完整的凭据。");
  }

  const uid = rec.uid || decodeJwt(rec.access)?.sub || "";

  // Refuse a second copy of an account that is already here. magpie appends
  // whatever a method returns without checking, so pasting the same file twice
  // would list the account twice — and the newer copy's refresh token would
  // already have been spent by the older one.
  if (uid && knownUids().has(uid)) {
    throw new Error(`这个账号已经在 magpie 里了（${uid.slice(0, 8)}…），不用再导入。`);
  }

  // Prove it works before reporting success, and take the fresh tokens.
  const live = await renew(rec);
  const access = live.accessToken || rec.access;
  const claims = decodeJwt(access) || {};

  const finalUid = uid || claims.sub || "";
  // Never blank: magpie renders an empty accountId as the words "Signed in".
  const who = displayName({ ...rec, uid: finalUid }, claims);

  return {
    url: "about:blank",
    instructions: `已登录 ${who}`,
    method: "auto",
    async callback() {
      return {
        type: "success",
        access,
        refresh: live.refreshToken || rec.refresh,
        expires: Date.now() + (Number(live.expiresIn) > 0 ? Number(live.expiresIn) * 1000 : 3600 * 1000),
        refreshExpiresAt: Date.now() + (Number(live.refreshExpiresIn) > 0 ? Number(live.refreshExpiresIn) * 1000 : 0),
        tokenType: live.tokenType || rec.tokenType || "Bearer",
        accountId: who,
        uid: finalUid,
        domain: live.domain || rec.domain,
        ...(rec.enterpriseId ? { enterpriseId: rec.enterpriseId } : {}),
      };
    },
  };
}
