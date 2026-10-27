// What a pasted credential is, and how to put it into magpie's account list.
//
// This writes magpie's own store directly and registers no plugin. A plugin
// would have to take over the `workbuddy` provider to add a sign-in method,
// and magpie lets only one plugin serve a provider — taking over would hide
// the browser / desktop / API-key sign-ins the community plugin already
// offers. Importing an account is not a sign-in method, so it stays out of
// that contest entirely.

import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where magpie keeps its sign-ins. */
export function configDir() {
  if (process.env.MAGPIE_CONFIG_DIR) return process.env.MAGPIE_CONFIG_DIR;
  return join(homedir(), ".config", "magpie");
}

const REFRESH_ENDPOINT = "https://copilot.tencent.com/v2/plugin/auth/token/refresh";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" && v.trim() ? v.trim() : "");

export function decodeJwt(token) {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  let p = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  while (p.length % 4) p += "=";
  try {
    return JSON.parse(Buffer.from(p, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

/**
 * What to call an account in magpie's list.
 *
 * Never empty. magpie shows the blank `accountId` as the literal "Signed in",
 * so a credential whose JWT carries no nickname (a phone-login token) would
 * otherwise appear in the list as a row that names nothing.
 */
export function displayName(rec, claims) {
  const nick = str(rec?.nickname) || str(claims?.nickname);
  if (nick) return nick;

  const pu = str(claims?.preferred_username) || str(rec?.preferred_username);
  if (pu) return maskHandle(pu);

  const uid = str(rec?.uid) || str(claims?.sub);
  return uid ? uid.slice(0, 8) : "WorkBuddy 账号";
}

/** A phone number as an account name: 176****1852. */
function maskHandle(v) {
  if (/^\d{7,15}$/.test(v)) return `${v.slice(0, 3)}****${v.slice(-4)}`;
  return v;
}

function toMs(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/** One credential out of one object, or null when it holds no token. */
function fromObject(o) {
  if (!isObj(o)) return null;
  const auth = isObj(o.auth) ? o.auth : isObj(o.credential) ? o.credential : o;
  const account = isObj(o.account) ? o.account : isObj(o.user) ? o.user : {};

  const access = str(auth.accessToken) || str(auth.access_token) || str(o.accessToken) || "";
  const refresh = str(auth.refreshToken) || str(auth.refresh_token) || str(o.refreshToken) || str(o.refresh_token) || "";
  if (!access && !refresh) return null;

  const ac = decodeJwt(access);
  const rc = decodeJwt(refresh);

  const uid = str(account.uid) || str(auth.uid) || str(o.uid) || str(ac?.sub) || str(rc?.sub) || "";
  let domain = str(auth.domain) || str(o.domain) || "";
  if (!domain) {
    const iss = str(ac?.iss) || str(rc?.iss);
    try {
      if (iss) domain = new URL(iss).host;
    } catch {}
  }

  return {
    access,
    refresh,
    uid,
    domain: domain || "www.codebuddy.cn",
    tokenType: str(auth.tokenType) || str(o.tokenType) || "Bearer",
    nickname: str(account.nickname) || str(ac?.preferred_username) || "",
    enterpriseId: str(account.enterpriseId) || str(auth.enterpriseId) || str(o.enterpriseId) || str(ac?.enterprise_id) || "",
    expires: toMs(auth.expiresAt) || toMs(o.expiresAt) || (ac?.exp ? toMs(ac.exp) : 0),
    refreshExpiresAt: toMs(auth.refreshExpiresAt) || toMs(o.refreshExpiresAt) || (rc?.exp ? toMs(rc.exp) : 0),
  };
}

/** Any accepted payload (nested, flat array, desktop .info) into credentials. */
export function parsePayload(raw) {
  let data = raw;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return { accounts: [], error: "内容是空的" };
    try {
      data = JSON.parse(t);
    } catch {
      return { accounts: [], error: "不是合法的 JSON" };
    }
  }

  const out = [];
  const push = (o) => {
    const r = fromObject(o);
    if (r) out.push(r);
  };

  if (Array.isArray(data)) data.forEach(push);
  else if (isObj(data)) {
    push(data);
    if (Array.isArray(data.accounts)) data.accounts.forEach(push);
    for (const k of ["data", "list", "items"]) if (Array.isArray(data[k])) data[k].forEach(push);
  }

  const seen = new Set();
  const uniq = [];
  for (const r of out) {
    const k = `${r.uid}|${r.refresh.slice(0, 32)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(r);
  }

  return { accounts: uniq, error: uniq.length ? null : "没找到 WorkBuddy 凭据字段（accessToken / refreshToken）" };
}

/** Spend the refresh token once, so a dead credential fails here and now. */
export async function renew(rec, { fetchImpl = fetch, timeoutMs = 20000 } = {}) {
  if (!rec.refresh) throw new Error("没有 refresh token");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(REFRESH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Refresh-Token": rec.refresh,
        "X-Auth-Refresh-Source": "plugin",
        "X-Domain": rec.domain || "www.codebuddy.cn",
      },
      body: "{}",
      signal: ctl.signal,
    });
    const text = await res.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {}

    if (!res.ok || !body || body.code !== 0) {
      const reason = body?.msg || body?.error_description || body?.error || text.slice(0, 160) || "被拒绝";
      throw new Error(reason);
    }
    return body.data;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Uids magpie already holds a WorkBuddy sign-in for.
 *
 * magpie appends whatever it is handed; it does not check whether the account
 * is already in the list. Without this, importing a credential for an account
 * that is already there shows it twice — and the second copy holds a refresh
 * token the first one has already spent.
 *
 * Only this provider's entries are read (`workbuddy`, `workbuddy#xxxxxx`):
 * other providers keep their accounts in the same file, and a uid belongs to
 * the realm it came from.
 */
export function knownUids() {
  const out = new Set();
  for (const v of Object.values(readStore())) {
    if (v && typeof v === "object" && v.uid) out.add(v.uid);
  }
  return out;
}

/** magpie's sign-in store, as it is on disk. */
export function readStore() {
  const f = join(configDir(), "plugin-auth.json");
  try {
    if (!existsSync(f)) return {};
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return {};
  }
}

/**
 * Put one account into magpie's list.
 *
 * magpie keys the first account by the provider id and every one after it by
 * `workbuddy#<6 random>`. The file is backed up next to itself before it is
 * touched, because this is the file that holds every sign-in on the machine.
 */
export function addAccount(rec) {
  const dir = configDir();
  const f = join(dir, "plugin-auth.json");
  const store = readStore();

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (existsSync(f)) copyFileSync(f, join(dir, `plugin-auth.json.bak-import-${stamp}`));

  let key;
  if (!store.workbuddy) key = "workbuddy";
  else {
    do {
      key = "workbuddy#" + Math.random().toString(36).slice(2, 8).padEnd(6, "0");
    } while (store[key]);
  }

  store[key] = {
    type: "oauth",
    refresh: rec.refresh,
    access: rec.access,
    expires: rec.expires,
    accountId: rec.accountId,
    uid: rec.uid,
    domain: rec.domain,
    refreshExpiresAt: rec.refreshExpiresAt,
    tokenType: rec.tokenType || "Bearer",
    ...(rec.enterpriseId ? { enterpriseId: rec.enterpriseId } : {}),
  };

  writeFileSync(f, JSON.stringify(store, null, 2));
  return { key, backup: existsSync(join(dir, `plugin-auth.json.bak-import-${stamp}`)) ? `plugin-auth.json.bak-import-${stamp}` : null };
}

/** The clipboard, which is where a pasted credential lands. */
export function readClipboard() {
  const tries =
    process.platform === "win32"
      ? [["powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-Clipboard -Raw"]]]
      : process.platform === "darwin"
      ? [["pbpaste", []]]
      : [
          ["xclip", ["-selection", "clipboard", "-o"]],
          ["xsel", ["--clipboard", "--output"]],
          ["wl-paste", ["--no-newline"]],
        ];

  for (const [cmd, args] of tries) {
    try {
      const out = execFileSync(cmd, args, { encoding: "utf8", timeout: 4000, windowsHide: true });
      if (out && out.trim()) return out;
    } catch {}
  }
  return null;
}
