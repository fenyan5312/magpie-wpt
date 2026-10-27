// 「粘贴凭据登录」这一个方式：把凭据交回 magpie 保存。
//
// 和别的登录方式一样，它最后要交回 magpie 一个凭据对象，magpie 自己写进
// 账号列表 —— 所以导入的账号和浏览器登录的账号在同一个列表、同一张卡片。
//
// 入口不是浏览器，是输入框：这个方式声明了 prompts，magpie 会先弹一个
// 多行框让人把凭据粘进去，再调用 authorize()。框留空的话才去看剪贴板和
// WPT_FILE，方便脚本直接用。

import { existsSync, readFileSync } from "node:fs";
import { parsePayload, readClipboard, renew, decodeJwt, knownUids, displayName } from "./auth-store.js";

/** Text the person is most likely to mean, in the order worth trying. */
function credentialText(inputs) {
  // What was typed or pasted into the field magpie showed.
  const typed = typeof inputs?.credential === "string" ? inputs.credential.trim() : "";
  if (typed) return { source: "输入框", text: typed };

  // A path, for scripts: WPT_FILE=cred.json magpie plugin login workbuddy
  const p = process.env.WPT_FILE;
  if (p && existsSync(p)) return { source: p, text: readFileSync(p, "utf8") };

  // Left empty, the clipboard is the next place a credential lands.
  const clip = readClipboard();
  if (clip && clip.trim()) return { source: "剪贴板", text: clip };

  throw new Error(
    [
      "没有内容可以读。",
      "",
      "  把凭据 JSON 粘到框里再点「登录」。",
      "  框留空时会去读剪贴板；也可以指定文件：",
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
 *
 * `inputs` is what the method's `prompts` were answered with. The credential
 * is one of those answers: a sign-in method that reads only the clipboard
 * starts by itself the moment it is clicked, which gives the person nowhere
 * to put anything. Asking first is a field they can paste into.
 */
export async function authorize(inputs) {
  const { source, text } = credentialText(inputs);
  const parsed = parsePayload(text);
  if (parsed.error) {
    const hint =
      source === "输入框"
        ? "\n\n框里的内容不是一份凭据。粘完整的 JSON，或者复制到剪贴板后留空再点。"
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
