# magpie-wpt · 自用 wb 导入

给 magpie 的 wb 登录方式补一个「粘贴凭据登录」——
你手上已经有一份凭据 JSON 时，不用走浏览器，直接粘进去就能登录。

> **仅供学习与交流。** 本项目只做本地凭据格式转换与登录，不含任何绕过、代理、共享或转售能力。
> 请只用于你自己的账号。使用产生的一切后果由使用者自负。

## 它做什么

magpie 里 wb 的登录原本要开浏览器走一次 OAuth。这个插件加的是同一个 provider 下的**第二种登录方式**：

```
magpie plugin login workbuddy
  → 选「粘贴凭据登录」
  → 读剪贴板 / 读 WPT_FILE 指定的文件
  → 解析凭据
  → 调用一次 token refresh 证明凭据是活的
  → 交给 magpie 保存
```

登录完成的账号出现在 **wb 自己的账号列表里**，和浏览器登录进去的账号同一个位置、同一张卡片。
插件不会注册新的 provider，不会出现在模型路由里，也不会单独列一个厂商。

## 安装

需要 magpie 已安装（`magpie` 在 PATH 里）。

```bash
git clone https://github.com/fenyan5312/magpie-wpt.git
cd magpie-wpt
magpie plugin add ./plugin
```

或者直接指路径：

```bash
magpie plugin add /path/to/magpie-wpt/plugin
```

装好后 `magpie plugin list` 能看到这一项。

## 使用

**方式一：剪贴板（最常用）**

1. 把凭据 JSON 全文复制到剪贴板
2. 运行 `magpie plugin login workbuddy`
3. 选「粘贴凭据登录」

**方式二：指定文件**

```bash
# Windows
set "WPT_FILE=D:\cred.json"
magpie plugin login workbuddy

# macOS / Linux
WPT_FILE=/path/cred.json magpie plugin login workbuddy
```

## 支持的凭据格式

| 来源 | 形态 |
|---|---|
| `workbuddy-<uid>.json` | `{"account": {...}, "auth": {"accessToken", "refreshToken", ...}}` |
| `cockpit-<uid>.json` | 数组或 `{"accounts": [...]}`，sub2api 风格 |
| `workbuddy-desktop.info` | 桌面端导出，字段为驼峰 |
| 裸对象 | 顶层的 `accessToken` / `access_token` + `refreshToken` / `refresh_token` |

字段缺失时会从 JWT 里补 `uid`（`sub`）和 `domain`（`iss`）。

账号在列表里显示的名字按这个顺序取：`nickname` → 打码后的手机号（`176****1852`）→ uid 前 8 位。
一定不会是空的——magpie 把空的 `accountId` 显示成字面量 `Signed in`，看着像没登录成功。

## 行为约定

- **必须带 refresh token。** 只有 access token 的凭据会被拒绝——它一小时就死了。
- **登录前会真的刷新一次。** 凭据失效在这里就报错，不会存进去一个坏账号。
- **重复账号会被拒绝。** magpie 本身不去重，同一个文件粘两次会列出两个账号，而且第二份的 refresh token 已经被第一份花掉了。插件会读 `plugin-auth.json` 检查 uid，已有的直接拒绝。
- **refresh token 是一次性的。** 每次登录都会轮换。不要把同一个账号的同一份凭据同时喂给两个程序。

## 网络

插件只发一个请求：

```
POST https://copilot.tencent.com/v2/plugin/auth/token/refresh
```

没有遥测，没有回传，凭据不出本机。

## 卸载

```bash
magpie plugin rm ./plugin
```

已登录的账号还在 magpie 的账号列表里，不受影响。

## 许可

MIT，见 [LICENSE](LICENSE)。
