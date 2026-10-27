// WorkBuddy 粘贴登录 —— 在社区插件的登录方式后面追加一个，不替换它。
//
// magpie 一个供应商只能由一个插件服务（serving），而且「其他登录方式」里
// 能看到的，就是那个插件给出的全部方式。所以想要四种方式同时在，不能各
// 自注册一个插件，也不能接管之后只给一个 —— 只能由同一个插件把它们一起
// 交出去。
//
// 这里做的就是这个：加载社区插件，拿它原样返回的 config / provider /
// auth，只在 auth.methods 末尾追加「粘贴凭据登录」。
//
// 社区插件在 magpie 的插件目录里，跟着 magpie 更新；这里按模块名解析，
// 不写死路径。装过社区插件之后它就在 ~/.config/magpie/plugins/node_modules。

import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const COMMUNITY = "@magpie-community/opencode-workbuddy-auth";

const LABEL = "粘贴凭据登录";

/** Where magpie installs community plugins. */
function communityDir() {
  const base = process.env.MAGPIE_CONFIG_DIR || join(homedir(), ".config", "magpie");
  return join(base, "plugins", "node_modules", COMMUNITY, "index.mjs");
}

/**
 * The community plugin's factory.
 *
 * Tried by name first (a shared node_modules), then from magpie's own plugin
 * folder, which is where `magpie plugin add` puts it. No path is assumed: the
 * folder follows MAGPIE_CONFIG_DIR, so another install is another path.
 */
async function community() {
  const tries = [COMMUNITY, pathToFileURL(communityDir()).href];
  let mod;
  for (const spec of tries) {
    try {
      mod = await import(spec);
      break;
    } catch {}
  }

  if (!mod) {
    throw new Error(
      [
        `找不到社区插件 ${COMMUNITY}。`,
        "",
        "先装它，本插件是挂在它上面的：",
        `  magpie plugin add ${COMMUNITY}`,
        "",
        "装好之后再 magpie plugin add 本插件。",
      ].join("\n")
    );
  }

  const make = mod.WorkBuddyAuthPlugin;
  if (typeof make !== "function") throw new Error(`${COMMUNITY} 没有导出 WorkBuddyAuthPlugin，版本可能变了。`);
  return make;
}

export const WorkBuddyPasteLogin = async (ctx) => {
  const make = await community();
  const hooks = await make(ctx);

  // Nothing is replaced: the browser, desktop and API-key methods stay exactly
  // as the community plugin built them.
  const { authorize } = await import("./paste.mjs");

  return {
    ...hooks,
    auth: {
      ...hooks.auth,
      methods: [
        ...(hooks.auth?.methods ?? []),
        {
          type: "oauth",
          label: LABEL,
          // What magpie asks before authorize() runs. Without this the method
          // starts the moment it is clicked and there is nowhere to put the
          // credential — the field is the whole point.
          prompts: [
            {
              type: "text",
              key: "credential",
              message: "把凭据 JSON 粘到这里",
              placeholder: '{"account":{…},"auth":{"accessToken":"…","refreshToken":"…"}}',
            },
          ],
          authorize,
        },
      ],
    },
  };
};

export default WorkBuddyPasteLogin;
