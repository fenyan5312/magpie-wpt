# magpie-wpt-import

在 magpie 的 WorkBuddy 登录方式里追加一个「粘贴凭据登录」，同时保留社区插件原有的
browser / desktop / API key 三种方式。

> **仅供交流学习与逆向研究使用。** 本项目只做本地凭据格式转换与登录，不含任何绕过、
> 代理、共享或转售能力。请只用于你自己的账号，使用产生的一切后果由使用者自负。

## 安装

```bash
# 依赖：社区插件（WorkBuddy 的登录本来就来自它）
magpie plugin add @magpie-community/opencode-workbuddy-auth@latest

# 本插件，并让它服务 workbuddy
magpie plugin add ./plugin
magpie plugin use ./plugin workbuddy
```

`magpie plugin use` 是必须的：只有服务 `workbuddy` 的插件才能把四种登录方式一起交出去。

## 支持的输入

粘贴窗口接受下列任一形态，不再只认 JSON：

| 形态 | 例子 |
|---|---|
| 凭据 JSON | `{"account":{…},"auth":{"accessToken":"…","refreshToken":"…"}}` |
| 扁平数组 | `[{uid, access_token, refresh_token, expires_at}]` |
| magpie 存储备份 | `plugin-auth.json` 里的单条（`access` / `refresh` / `expires`） |
| Cookie / 请求头 | `access_token=…; refresh_token=…`、`Cookie: …`、`authorization: Bearer …` |
| query / curl | `access_token=…&refresh_token=…`、`curl … -H 'X-API-Key: …'` |
| 浏览器扩展导出 | `[{name:"access_token",value:"…"}]` |
| API key | `ck_…` / `pt_…`，或 `{"key":"…"}` / `{"apiKey":"…"}` / `{"ck":"…"}` |

字段拼法不区分大小写与驼峰/下划线：`accessToken` / `access_token` / `access` / `token`，
`refreshToken` / `refresh_token` / `refresh`，到期时间支持秒、毫秒和 ISO-8601。

## 行为

- **登录前先刷新一次。** 普通凭据会真的拿 refresh token 换一次新 token；换不到就在窗口里
  报错，窗口留着让你改，不会先报成功。
- **API key 不刷新、不预校验。** key 按 magpie 的 `{type:"api", key}` 存，与「WorkBuddy
  API key」登录同一种账号；无效 key 会在第一次真实请求时被拒绝。
- **重复导入会被拒绝。** 已有同 uid 的账号、或同一条 API key，直接拒绝；magpie 自己不去重。
- **Cookie 必须带 token。** 只有 `sessionid=…` 的 Cookie 换不到 token，窗口会说明原因。

## 为什么包在社区插件外面

magpie 一个供应商只能由一个插件提供服务。自己注册插件接管 `workbuddy` 会让社区插件原有
的三个方式整个消失；不接管又调不出自己的方式。所以这里加载社区插件、原样保留它的
config / provider / auth，只在 `auth.methods` 末尾追加第四种方式。

## 本地窗口

`127.0.0.1` 上的临时页面，带一次性 nonce，最多存活 5 分钟；凭据只在内存里过一遍，
不落盘、不外发。只发一个请求：`POST https://copilot.tencent.com/v2/plugin/auth/token/refresh`。

## 卸载

```bash
magpie plugin rm ./plugin
magpie plugin use @magpie-community/opencode-workbuddy-auth@latest workbuddy
```

已登录的账号不受影响。

## 许可

MIT。
