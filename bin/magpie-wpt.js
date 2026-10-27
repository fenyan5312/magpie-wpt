#!/usr/bin/env node
// Import a WorkBuddy credential into magpie — nothing else.
//
//   magpie-wpt                 paste (clipboard) or a file given as an argument
//   magpie-wpt cred.json       a file
//   magpie-wpt --dry-run       say what would be imported, write nothing
//
// No plugin is registered and no sign-in method is added: magpie lets one
// plugin serve a provider, so a plugin here would take over `workbuddy` and
// hide the browser / desktop / API-key sign-ins the community plugin already
// offers. This writes magpie's account list directly instead, so those stay.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  addAccount,
  decodeJwt,
  displayName,
  knownUids,
  parsePayload,
  readClipboard,
  renew,
} from "../src/auth-store.js";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run") || argv.includes("-n");
const help = argv.includes("--help") || argv.includes("-h");
const fileArg = argv.find((a) => !a.startsWith("-"));

const USAGE = `用法：
  magpie-wpt [凭据文件] [--dry-run]

  不带文件时读剪贴板：把凭据 JSON 全文复制，然后运行 magpie-wpt
  --dry-run   只检查、不写入

只做导入：不注册插件，不增加登录方式，不影响 magpie 里原有的登录入口。`;

if (help) {
  console.log(USAGE);
  process.exit(0);
}

function credentialText() {
  if (fileArg) {
    const p = resolve(fileArg);
    if (!existsSync(p)) {
      console.error(`找不到文件：${p}`);
      process.exit(1);
    }
    return { source: p, text: readFileSync(p, "utf8") };
  }
  const clip = readClipboard();
  if (clip) return { source: "剪贴板", text: clip };
  console.error(
    [
      "没读到凭据。",
      "",
      "  1. 把凭据 JSON 全文复制到剪贴板，再运行一次 magpie-wpt",
      "  2. 或者把文件路径当参数：magpie-wpt D:\\cred.json",
      "",
      "支持 workbuddy-<uid>.json、cockpit-<uid>.json、workbuddy-desktop.info。",
    ].join("\n")
  );
  process.exit(1);
}

async function main() {
  const { source, text } = credentialText();
  const parsed = parsePayload(text);

  if (parsed.error) {
    const hint =
      source === "剪贴板"
        ? "\n\n剪贴板里现在不是一份凭据。先把凭据 JSON 全文复制再运行，或者用文件：magpie-wpt D:\\cred.json"
        : "";
    console.error(`读不出凭据（${source}）：${parsed.error}${hint}`);
    process.exit(1);
  }

  const rec = parsed.accounts[0];
  if (parsed.accounts.length > 1) {
    console.log(`这份凭据里有 ${parsed.accounts.length} 个账号，只导入第一个。`);
  }

  if (!rec.refresh) {
    console.error("这份凭据里没有 refresh token，登录会立刻过期。请换一份完整的凭据。");
    process.exit(1);
  }

  const uid = rec.uid || decodeJwt(rec.access)?.sub || "";
  const who = displayName({ ...rec, uid }, decodeJwt(rec.access) || {});

  if (uid && knownUids().has(uid)) {
    console.error(`这个账号已经在 magpie 里了（${uid.slice(0, 8)}…），不用再导入。`);
    process.exit(1);
  }

  if (dryRun) {
    console.log(`检查通过：${who}（uid ${uid.slice(0, 8)}…，${rec.domain}）`);
    console.log("--dry-run：没有写入。");
    return;
  }

  // Spend the refresh token once, up front: a dead credential fails here
  // rather than landing in the list as an account that cannot answer.
  let live;
  try {
    live = await renew(rec);
  } catch (e) {
    console.error(`凭据被拒绝：${e.message}`);
    process.exitCode = 1;
    return;
  }

  const access = live.accessToken || rec.access;
  const claims = decodeJwt(access) || {};
  const finalUid = uid || claims.sub || "";
  const name = displayName({ ...rec, uid: finalUid }, claims);

  const { key, backup } = addAccount({
    access,
    refresh: live.refreshToken || rec.refresh,
    expires: Date.now() + (Number(live.expiresIn) > 0 ? Number(live.expiresIn) * 1000 : 3600 * 1000),
    refreshExpiresAt: Date.now() + (Number(live.refreshExpiresIn) > 0 ? Number(live.refreshExpiresIn) * 1000 : 0),
    tokenType: live.tokenType || rec.tokenType || "Bearer",
    accountId: name,
    uid: finalUid,
    domain: live.domain || rec.domain,
    enterpriseId: rec.enterpriseId,
  });

  console.log(`已导入：${name}（uid ${finalUid.slice(0, 8)}…，${live.domain || rec.domain}）`);
  console.log(`写入条目：${key}`);
  if (backup) console.log(`原文件备份：${backup}`);
  console.log("\n打开 magpie 就能在 WorkBuddy 的账号列表里看到它。原有的登录方式不受影响。");
}

main();
