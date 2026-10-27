# magpie-wpt · 自用 wb 导入

把一份 wb 凭据 JSON 导入 magpie 的账号列表。

> **仅供学习与交流。** 本项目只做本地凭据格式转换与写入，不含任何绕过、代理、共享或转售能力。
> 请只用于你自己的账号。使用产生的一切后果由使用者自负。

## 为什么不是一个插件

最初做成了 magpie 插件，行不通，原因是 magpie 的机制：

**一个供应商只能由一个插件提供服务（serving），而「其他登录方式」里能看到的，就是那个插件提供的全部方式。**

插件要加登录方式，就必须接管 `workbuddy`。接管之后，社区插件原有的 browser / desktop / API key 三个登录方式会**整个从界面上消失**（实测：`WorkBuddy has no sign-in method "WorkBuddy account (browser)"`）；不接管，自己的方式又调不出来。两者无法共存。

导入账号本来就不是一种「登录方式」，所以现在改成直接写 magpie 的账号库：

- 不注册插件，不占用供应商
- 不增加、不替换任何登录方式
- 只是往账号列表里加一条，和浏览器登录进来的账号在同一个列表、同一张卡片

## 用法

需要 Node 18+ 和已装好的 magpie。

```bash
git clone https://github.com/fenyan5312/magpie-wpt.git
cd magpie-wpt
npm link          # 之后可以直接用 magpie-wpt 命令
```

**方式一：剪贴板（最常用）**

1. 把凭据 JSON 全文复制到剪贴板
2. 运行 `magpie-wpt`

**方式二：文件**

```bash
magpie-wpt D:\cred.json
```

**只检查不写入**

```bash
magpie-wpt D:\cred.json --dry-run
```

不用 `npm link` 也行，直接跑：

```bash
node bin/magpie-wpt.js D:\cred.json
```

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
- **导入前会真的刷新一次。** 凭据失效在这里就报错，不会写进去一个连不上的账号。
- **重复账号会被拒绝。** magpie 本身不去重，同一个文件导两次会列出两个账号，而且第二份的 refresh token 已经被第一份花掉了。导入前会检查 uid，已有的直接拒绝。
- **写之前先备份。** `plugin-auth.json` 是保存所有登录记录的文件，每次写入前都会在同目录留一份 `plugin-auth.json.bak-import-<时间戳>`。
- **refresh token 是一次性的。** 每次导入都会轮换。不要把同一个账号的同一份凭据同时喂给两个程序。

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

这个工具不改 magpie 的插件配置，删掉目录就行。

想删掉导入的账号：在 magpie 里 WorkBuddy 的账号列表中点「移除」。

## 许可

MIT，见 [LICENSE](LICENSE)。
