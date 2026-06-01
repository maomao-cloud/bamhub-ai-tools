# Kibana Search 授权引导增强设计

## 背景

`kibana-search` 当前在缺少凭证时会返回 `AUTH_MISSING_CREDENTIAL`，但只给出一句登录建议。用户仍需要自己理解 `auth.profile`、`credentialRef`、Cookie/Header 获取方式和凭证写入位置，容易卡在无法继续查询的状态。

本次增强目标是在缺少授权信息时自动进入授权引导：`kibana-search` 负责识别缺凭证并展示下一步，`shared-auth` 负责实际导入和保存凭证。

## 目标

- `kibana-search logs` 缺凭证或凭证过期时，默认展示可操作的中文授权引导。
- `--json` 模式保持机器可解析，并返回结构化 `authGuide`。
- 凭证写入逻辑仍只保留在 `shared-auth`，不散落到 `kibana-search`。
- `shared-auth` 增加 `auth import` 子命令，支持交互式和非交互式导入 Cookie/Header/Token。
- 用户可在获取并导入凭证后重试原查询；文本交互模式可在导入成功后自动重试。

## 非目标

- 不实现真正的 SSO 自动化登录闭环。
- 不从浏览器 profile 中自动读取 Cookie。
- 不把凭证写入系统钥匙串或加密存储。
- 不让 `kibana-search` 直接保存 Cookie/Header/Token。

## 用户可见语言规则

用户可见文案默认使用简体中文，包括：

- 文本模式提示
- `error.message`
- `error.suggestion`
- `authGuide.manualSteps`
- `ok: true` 时的导入成功消息

机器字段、错误码和命令保持英文，包括：

- `ok`
- `error.code`
- `authGuide`
- `profile`
- `credentialRef`
- `commands`
- `retryCommand`

## `shared-auth import` 子流程

新增命令：

```bash
bash skills/shared-auth/scripts/auth import --profile bg_prod_main_sso
```

该命令负责把用户从浏览器中复制的 Cookie/Header 写入 `skills/shared-auth/.local/credentials.json`。

### 非交互式导入

支持直接传参：

```bash
bash skills/shared-auth/scripts/auth import \
  --profile bg_prod_main_sso \
  --cookie 'sid=...; SESSION=...'
```

或：

```bash
bash skills/shared-auth/scripts/auth import \
  --profile bg_prod_main_sso \
  --header 'Authorization: Bearer ...'
```

JSON 成功输出：

```json
{
  "ok": true,
  "profile": "bg_prod_main_sso",
  "credentialRef": "bg_prod_main",
  "credentialFile": "skills/shared-auth/.local/credentials.json",
  "message": "凭证已导入，可以重新执行 Kibana 查询。"
}
```

### 交互式导入

如果未传 `--cookie` 或 `--header`，文本模式提示用户粘贴：

```text
请粘贴从浏览器请求中复制的 Cookie Header 或 Authorization Header。
示例：
  Cookie: sid=...; SESSION=...
  Authorization: Bearer ...

粘贴完成后按 Enter：
>
```

识别规则：

- `Cookie: sid=abc; SESSION=xyz` → `{ cookie: "sid=abc; SESSION=xyz" }`
- `sid=abc; SESSION=xyz` → cookie
- `Authorization: Bearer token` → `{ authorization: "Bearer token" }`
- `Bearer token` → authorization
- `ApiKey token` → authorization
- 空字符串或无法识别 → `AUTH_IMPORT_INPUT_INVALID`

写入 credentials 时，key 使用 auth profile 中的 `credentialRef`，不是 profile 名。例如：

- profile：`bg_prod_main_sso`
- credentialRef：`bg_prod_main`

保存结构：

```json
{
  "profiles": {
    "bg_prod_main": {
      "source": "imported",
      "cookie": "sid=...; SESSION=...",
      "authorization": "Bearer ...",
      "importedAt": "2026-06-01T00:00:00.000Z",
      "expiresAt": null
    }
  }
}
```

如果输入无法识别，返回：

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_IMPORT_INPUT_INVALID",
    "message": "无法识别粘贴内容，请提供 Cookie 或 Authorization Header。",
    "suggestion": "请从浏览器开发者工具 Network 面板复制 Request Headers 中的 Cookie 或 Authorization。"
  }
}
```

## `kibana-search` 缺凭证引导

当 `kibana-search logs` 检测到 `AUTH_MISSING_CREDENTIAL` 或 `AUTH_EXPIRED` 时，它应构造授权上下文：

```json
{
  "env": "bg_prod_main",
  "profile": "bg_prod_main_sso",
  "credentialRef": "bg_prod_main",
  "credentialFile": "skills/shared-auth/.local/credentials.json",
  "originalCommand": "bash skills/kibana-search/scripts/kibana-search logs --env bg_prod_main --service groot-lms-api --level ERROR --since 1h"
}
```

### 文本模式输出

文本模式下展示中文引导：

```text
Kibana 查询需要先完成授权。

环境：bg_prod_main
认证 profile：bg_prod_main_sso
凭证引用：bg_prod_main
凭证文件：skills/shared-auth/.local/credentials.json

下一步可以执行：
  bash skills/shared-auth/scripts/auth login --profile bg_prod_main_sso --mode auto

如果当前机器没有浏览器：
  bash skills/shared-auth/scripts/auth login --profile bg_prod_main_sso --mode headless

如果你已经在浏览器里登录过 Kibana：
  bash skills/shared-auth/scripts/auth import --profile bg_prod_main_sso

如何获取 Cookie/Header：
1. 在浏览器打开 Kibana 并完成 SSO 登录。
2. 打开开发者工具 Network 面板。
3. 刷新 Kibana 页面或执行一次 Discover 查询。
4. 选中任意发往 Kibana 域名的请求。
5. 在 Request Headers 中复制 Cookie 或 Authorization。
6. 回到终端运行 shared-auth import 并粘贴。
```

### JSON 模式输出

`--json` 模式不进入 stdin 交互，不自动重试，返回：

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_MISSING_CREDENTIAL",
    "message": "环境 bg_prod_main 缺少可用的 Kibana 授权凭证。",
    "suggestion": "请使用 shared-auth 完成登录或导入浏览器中的 Cookie/Header。"
  },
  "authGuide": {
    "profile": "bg_prod_main_sso",
    "credentialRef": "bg_prod_main",
    "credentialFile": "skills/shared-auth/.local/credentials.json",
    "commands": {
      "auto": "bash skills/shared-auth/scripts/auth login --profile bg_prod_main_sso --mode auto",
      "headless": "bash skills/shared-auth/scripts/auth login --profile bg_prod_main_sso --mode headless",
      "import": "bash skills/shared-auth/scripts/auth import --profile bg_prod_main_sso"
    },
    "manualSteps": [
      "在浏览器打开 Kibana 并完成 SSO 登录。",
      "打开开发者工具 Network 面板。",
      "刷新 Kibana 页面或执行一次 Discover 查询。",
      "复制 Request Headers 里的 Cookie 或 Authorization。",
      "运行 shared-auth import 命令导入凭证。",
      "重新执行原始 kibana-search 查询。"
    ],
    "retryCommand": "bash skills/kibana-search/scripts/kibana-search logs --env bg_prod_main --service groot-lms-api --level ERROR --since 1h --json"
  }
}
```

### 自动重试边界

自动重试只允许在以下条件同时满足时发生：

- 当前不是 `--json`
- 用户通过交互式 import 成功写入凭证
- `shared-auth` 返回 `ok: true`
- 原始命令可安全重放

重试前输出：

```text
凭证已保存，正在重新执行 Kibana 查询...
```

如果重试失败，展示真实错误，不吞掉错误。

## Skill 文档更新

`skills/kibana-search/SKILL.md` 必须说明：

- 缺凭证时优先读取 `authGuide`。
- 不要停在 `AUTH_MISSING_CREDENTIAL`。
- 如果用户是人类，给中文下一步。
- 如果用户让 AI 继续操作，AI 应提示用户粘贴 Cookie/Header，或指导运行 import。
- 完成 import 后重试原查询。

`skills/shared-auth/SKILL.md` 必须说明：

- `login` 是判断通道并给引导。
- `import` 是实际导入凭证。
- 如何从浏览器开发者工具复制 Cookie/Header。
- 凭证写入 `credentialRef`。

## 测试设计

### shared-auth 单元测试

- `parseImportedCredential`
  - `Cookie: sid=abc; SESSION=xyz` → cookie
  - `sid=abc; SESSION=xyz` → cookie
  - `Authorization: Bearer token` → authorization
  - `Bearer token` → authorization
  - 空字符串 / 无法识别文本 → `AUTH_IMPORT_INPUT_INVALID`

- `importCredential`
  - 读取 auth profile
  - 使用 `credentialRef` 作为 credentials key
  - 写入 `source: "imported"`
  - 保持 `0600` 文件权限

### shared-auth CLI 集成测试

- `auth import --profile bg_prod_main_sso --cookie 'sid=abc' --json`
  - 返回 `ok: true`
  - 写入 `profiles.bg_prod_main`
- `auth import --profile bg_prod_main_sso --header 'Authorization: Bearer t' --json`
- `auth import --profile bg_prod_main_sso --json` 且 stdin 输入 cookie
- 无效输入返回 `AUTH_IMPORT_INPUT_INVALID`
- 缺 profile / profile 不存在保持现有稳定 JSON 错误

### kibana-search 集成测试

- 缺凭证时 `--json` 返回：
  - `error.code = AUTH_MISSING_CREDENTIAL`
  - 中文 `message/suggestion`
  - `authGuide.profile`
  - `authGuide.credentialRef`
  - `authGuide.commands.import`
  - `authGuide.manualSteps`
  - `authGuide.retryCommand`

- 文本模式缺凭证时输出中文引导：
  - “Kibana 查询需要先完成授权”
  - `shared-auth import`
  - “如何获取 Cookie/Header”

- 凭证导入后，重新运行查询能进入正常查询路径。

### skill 文档测试

- `shared-auth/SKILL.md` 必须提到：
  - `auth import`
  - Cookie/Header 获取步骤
  - `credentialRef`
  - 中文引导

- `kibana-search/SKILL.md` 必须提到：
  - `authGuide`
  - 不要停在 `AUTH_MISSING_CREDENTIAL`
  - import 后重试原查询
