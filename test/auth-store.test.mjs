import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePayload, looksLikeApiKey, knownUids, knownKeys } from "../plugin/auth-store.js";

const jwt = (payload) => "h." + Buffer.from(JSON.stringify(payload)).toString("base64url") + ".s";
const access = jwt({ sub: "uid-123", exp: 1795501652, iss: "https://www.codebuddy.cn" });
const refresh = jwt({ sub: "uid-123", exp: 1795509999 });
const key = "ck_" + "TESTKEY0000000000";

const one = (raw) => {
  const r = parsePayload(raw);
  assert.equal(r.error, null, r.error);
  assert.equal(r.accounts.length, 1);
  return r.accounts[0];
};

test("nested credential JSON", () => {
  const a = one(JSON.stringify({ account: { uid: "uid-123" }, auth: { accessToken: access, refreshToken: refresh, domain: "www.codebuddy.cn" } }));
  assert.equal(a.uid, "uid-123");
  assert.equal(a.refresh, refresh);
  assert.equal(a.domain, "www.codebuddy.cn");
});

test("flat array with snake_case fields", () => {
  const a = one(JSON.stringify([{ uid: "uid-123", expires_at: 1795501652000, access_token: access, refresh_token: refresh }]));
  assert.equal(a.uid, "uid-123");
  assert.equal(a.expires, 1795501652000);
});

test("magpie store entry using access/refresh/expires", () => {
  const a = one(JSON.stringify({ workbuddy: { access, refresh, expires: 1795501652000, uid: "uid-123" } }));
  assert.equal(a.refresh, refresh);
  assert.equal(a.expires, 1795501652000);
});

test("cookie-style k=v text", () => {
  const a = one(`access_token=${access}; refresh_token=${refresh}; uid=uid-123`);
  assert.equal(a.uid, "uid-123");
  assert.equal(a.refresh, refresh);
});

test("Cookie: header", () => {
  const a = one(`Cookie: access_token=${access}; refresh_token=${refresh}`);
  assert.equal(a.refresh, refresh);
});

test("header block", () => {
  const a = one(`authorization: Bearer ${access}\nx-refresh-token: ${refresh}`);
  assert.equal(a.access, access);
  assert.equal(a.refresh, refresh);
});

test("query string", () => {
  const a = one(`access_token=${encodeURIComponent(access)}&refresh_token=${encodeURIComponent(refresh)}`);
  assert.equal(a.access, access);
  assert.equal(a.refresh, refresh);
});

test("browser cookie-array export", () => {
  const a = one(JSON.stringify([{ name: "access_token", value: access }, { name: "refresh_token", value: refresh }]));
  assert.equal(a.refresh, refresh);
});

test("bare API key is an api sign-in, not a credential", () => {
  const a = one(key);
  assert.equal(a.kind, "key");
  assert.equal(a.key, key);
  assert.equal(a.refresh, "");
  assert.equal(a.uid, "anonymous_" + key.slice(-8));
});

test("JSON spellings of an API key", () => {
  for (const raw of [JSON.stringify({ key }), JSON.stringify({ apiKey: key }), JSON.stringify({ type: "api", key }), JSON.stringify({ ck: key })]) {
    const a = one(raw);
    assert.equal(a.kind, "key", raw);
    assert.equal(a.key, key);
  }
});

test("x-api-key header and curl", () => {
  assert.equal(one(`X-API-Key: ${key}`).key, key);
  assert.equal(one(`curl 'https://example' -H 'X-API-Key: ${key}'`).key, key);
  assert.equal(one(`Authorization: Bearer ${key}`).key, key);
  assert.equal(one(`API key: ${key}`).key, key);
  assert.equal(one(`Bearer ${key}`).key, key);
});

test("a JSON ck field holding a Cookie is read as that Cookie", () => {
  const a = one(JSON.stringify({ ck: `access_token=${access}; refresh_token=${refresh}` }));
  assert.equal(a.refresh, refresh);
});

test("access token alone has no refresh", () => {
  const a = one(access);
  assert.equal(a.refresh, "");
  assert.equal(a.uid, "uid-123");
});

test("session-only Cookie says why it cannot be used", () => {
  const r = parsePayload("sessionid=abc123; uid=uid-123");
  assert.equal(r.accounts.length, 0);
  assert.match(r.error, /Cookie/);
});

test("encrypted desktop tokens are refused with the real reason", () => {
  const r = parsePayload(JSON.stringify({ account: { uid: "u" }, auth: { accessToken: { $wbEncrypted: 1, envelope: "x" }, refreshToken: { $wbEncrypted: 1, envelope: "x" } } }));
  assert.equal(r.accounts.length, 0);
  assert.match(r.error, /加密/);
});

test("a JWT is never mistaken for an API key", () => {
  assert.equal(looksLikeApiKey(access), false);
});

test("a short value in a key field is not taken as an API key", () => {
  assert.equal(parsePayload(JSON.stringify({ key: "abc" })).accounts.length, 0);
  assert.equal(parsePayload("key=abc").accounts.length, 0);
});

test("duplicate checks only read workbuddy entries", () => {
  const dir = mkdtempSync(join(tmpdir(), "wpt-"));
  const prev = process.env.MAGPIE_CONFIG_DIR;
  process.env.MAGPIE_CONFIG_DIR = dir;
  try {
    writeFileSync(
      join(dir, "plugin-auth.json"),
      JSON.stringify({
        workbuddy: { type: "oauth", uid: "u1" },
        "workbuddy#abc": { type: "api", key: "ck_" + "DUPLICATE000000" },
        "workbuddy-ai": { type: "oauth", uid: "u2" },
        other: { type: "api", key: "ck_" + "OTHERKEY0000000000" },
      })
    );
    assert.deepEqual([...knownUids()], ["u1"]);
    assert.deepEqual([...knownKeys()], ["ck_" + "DUPLICATE000000"]);
  } finally {
    if (prev === undefined) delete process.env.MAGPIE_CONFIG_DIR;
    else process.env.MAGPIE_CONFIG_DIR = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
