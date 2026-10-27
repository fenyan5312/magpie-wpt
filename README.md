# magpie-wpt · 自用 wb 导入

在 WorkBuddy 的登录方式里加一个「粘贴凭据登录」——凭据已经在手上时，不走浏览器，直接粘贴进去。

> **仅供学习与交流。** 本项目只做本地凭据格式转换与登录，不含任何绕过、代理、共享或转售能力。
> 请只用于你自己的账号。使用产生的一切后果由使用者自负。

## 入口在哪

magpie → **供应商** → **WorkBuddy** → 「**添加另一个 WorkBuddy (CodeBuddy) 账号**」→「**其他登录方式**」，列表里第四个就是。

```
用哪种方式登录 WorkBuddy (CodeBuddy)？
  WorkBuddy account (browser)
  WorkBuddy desktop's sign-in
  WorkBuddy API key
  粘贴凭据登录          ← 这个
```

命令行同一个入口：

```bash
magpie plugin login workbuddy 粘贴凭据登录
```

## 它怎么做到的（为什么不是自己注册一个插件）

magpie **一个供应商只能由一个插件提供服务（serving）**，而「其他登录方式」里列出来的，就是这个插件给出的全部方式。所以：

- 自己注册一个插件、接管 `workbuddy` → 社区插件原有的 browser / desktop / API key 三个方式**会整个消失**
- 不接管 → 自己的方式**调不出来**

两条路都是错的。所以这里不另起一个插件，而是**包在社区插件外面**：

```js
const hooks = await WorkBuddyAuthPlugin(ctx);        // 社区插件的 config / provider / auth
return {
  ...hooks,
  auth: { ...hooks.auth,
    methods: [...hooks.auth.methods, 粘贴凭据登录] }, // 在它后面追加，不替换
};
```

社区插件的三个方式原样保留，第四个追加在后面。两者是同一个插件交出去的，所以都在。

依赖：`@magpie-community/opencode-workbuddy-auth`（wb 的登录本来就要装它）。没装的话插件会明确报出来，并给出安装命令。

## 安装

```bash
git clone https://github.com/fenyan5312/magpie-wpt.git
cd magpie-wpt
magpie plugin add ./plugin
magpie plugin use ./plugin workbuddy
```

`plugin use` 那一步是必须的：它让这个包装插件来服务 `workbuddy`（从而把四种方式一起交出去）。已经装过社区插件的话，它仍然会被加载，只是不再由它来服务。

装好后 `magpie plugin list` 能看到，四种方式都在。

## 用法

**方式一：剪贴板（最常用）**

1. 把凭据 JSON 全文复制到剪贴板
2. magpie → WorkBuddy → 添加账号 → 其他登录方式 → **粘贴凭据登录**

**方式二：指定文件**（给脚本用，设了环境变量后点同一个按钮）

```bash
# Windows
set "WPT_FILE=D:\cred.json"

# PowerShell
$env:WPT_FILE='D:\cred.json'

# macOS / Linux
WPT_FILE=/path/cred.json
```

设了 `WPT_FILE` 就优先读文件，否则读剪贴板。

## 支持的凭据格式

| 来源 | 形态 |
|---|---|
| `workbuddy-<uid>.json` | `{"account": {...}, "auth": {"accessToken", "refreshToken", ...}}` |
| `cockpit-<uid>.json` | 数组或 `{"accounts": [...]}`，sub2api 风格 |
| `workbuddy-desktop.info` | 桌面端导出，字段为驼峰 |
| 裸对象 | 顶层的 `accessToken` / `access_token` + `refreshToken` / `refresh_token` |

字段缺失时会从 JWT 里补 `uid`（`sub`）和 `domain`（`iss`）。
一份凭据里含多个账号时只导入第一个。

## 行为约定

- **必须带 refresh token。** 只有 access token 的凭据会被拒绝——它一小时就死了。
- **登录前会真的刷新一次。** 凭据失效在这里就报错，不会存进去一个连不上的账号。
- **重复账号会被拒绝。** magpie 本身不去重，同一个文件粘两次会列出两个账号，而且第二份的 refresh token 已经被第一份花掉了。登录前会检查 uid，已有的直接拒绝。
- **refresh token 是一次性的。** 每次登录都会轮换。不要把同一个账号的同一份凭据同时喂给两个程序。

## 账号名字

按这个顺序取：`nickname` → 打码后的手机号（`176****1852`）→ uid 前 8 位。

一定不会是空的——magpie 把空的 `accountId` 显示成字面量 `Signed in`，看着像没登录成功。

## 网络

只发一个请求：

```
POST https://copilot.tencent.com/v2/plugin/auth/token/refresh
```

没有遥测，没有回传，凭据不出本机。

## 卸载

```bash
magpie plugin rm ./plugin
```

如果想让社区插件重新服务 `workbuddy`：

```bash
magpie plugin use @magpie-community/opencode-workbuddy-auth@latest workbuddy
```

已登录的账号都还在，不受影响。

## 许可

MIT，见 [LICENSE](LICENSE)。
