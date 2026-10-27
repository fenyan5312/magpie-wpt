// WorkBuddy 粘贴登录 — a sign-in method for magpie's existing `workbuddy`
// provider, not a provider of its own.
//
// You already have the credential as text. This adds a method that takes it,
// so the account lands in the same place, in the same list, as one signed in
// through the browser:
//
//   magpie plugin login workbuddy
//
// A plugin's authorize() runs in the host process, so it can read the
// clipboard. Nothing leaves the machine except the one refresh call that
// proves the credential is live.
//
// Deliberately registering `workbuddy` (not a new id): a separate provider id
// would show up as a second vendor in magpie with its own account list, which
// is not what an import should look like.

import { readFileSync, existsSync } from "node:fs";
import { parsePayload, readClipboard, renew, decodeJwt, knownUids, displayName } from "./auth-store.js";

const LABEL = "粘贴凭据登录";

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
      "没读到凭据。",
      "",
      "  1. 把凭据 JSON 复制到剪贴板，再运行一次 magpie plugin login workbuddy",
      "  2. 或者指定文件：",
      "       Windows        set \"WPT_FILE=D:\\cred.json\"",
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
async function authorize() {
  const { source, text } = await credentialText();
  const parsed = parsePayload(text);
  if (parsed.error) {
    const hint =
      source === "剪贴板"
        ? "\n\n剪贴板里现在不是一份凭据。先把凭据 JSON 全文复制，再运行一次；或者用 WPT_FILE 指向文件：\n  set \"WPT_FILE=D:\\cred.json\"\n  magpie plugin login workbuddy"
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

/**
 * magpie calls a plugin with ({client}) and takes the hooks it returns.
 * Only `auth` is offered: no models, no routing, no provider of its own.
 */
export const WorkBuddyPasteLogin = async () => ({
  auth: {
    provider: "workbuddy",
    methods: [
      {
        type: "oauth",
        label: LABEL,
        authorize,
      },
    ],
  },
});

export default WorkBuddyPasteLogin;
