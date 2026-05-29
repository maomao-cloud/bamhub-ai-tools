# 共享认证 Skill 与 Kibana 查询 Skill 设计

## 背景

需要做一个本地 Kibana 查询搜索能力，用于跨环境、跨账号查询日志。整体交付形态不是“一个独立安装的外部工具 + 一个引用它的 skill”，而是**仓库内多个可组合 skill 的本地方案**：

- `skills/shared-auth/` 负责共享账号、SSO、凭证存储与登录态复用
- `skills/kibana-search/` 负责 Kibana 查询、data view 缓存、KQL 组装和查询执行

对外使用体验仍然保持为类似 `git` 的本地命令调用，但这些命令由 skill 内部脚本提供，而不是要求用户单独安装额外工具。这样既能保证 Kibana 查询独立演进，也能让后续其他工具复用同一套认证逻辑。

首个场景是查询线上 Kibana 中某个服务最近一段时间的错误等级日志，例如 `groot-lms-learning-server` 最近 15 小时的 `ERROR` 日志。

工具需要支持多环境配置、多账号隔离、通用认证逻辑复用、Kibana data view/index pattern 元数据缓存，以及一个配套 skill 来指导 Claude Code 如何调用这些本地脚本。

## 目标

- 提供一套仓库内 skill 组合方案：共享认证 skill + Kibana 查询 skill。
- 环境名作为完整隔离边界，定位组织、部署环境、账号、认证信息、Kibana 地址和工具配置。
- 支持通用服务日志查询：`service/app + level + keyword + traceId + time range`。
- 查询结果返回原始日志内容，由上层 AI 负责分析。
- 支持 Kibana/ES backend 策略配置：`kibana`、`es`、`auto`。
- 缓存 Kibana data view/index pattern 元数据，并支持 TTL 与强制刷新。
- 共享认证由 `skills/shared-auth/` 提供，MVP 使用仓库内本地明文凭证，后续可替换为钥匙串或加密存储。
- 认证流程必须支持有 GUI 与无 GUI 系统，不能假设本地一定能打开浏览器。
- `skills/kibana-search/` 直接说明 Claude Code、hermes-agent 等如何调用 skill 目录中的脚本查询日志、处理错误和解析 Kibana Discover URL。

## 非目标

- 不实现 Web 管理台。
- 不以 MCP server 作为主入口。
- 不在工具内做 AI 摘要、错误聚类或根因分析。
- MVP 不强制实现安全凭证存储；凭证先明文保存，后续通过存储接口替换。
- MVP 可以先实现 Kibana backend；ES backend 保留接口与配置能力，等 ES endpoint 和权限明确后补齐。

## 总体形态

整体以两个可组合 skill 交付：

### 1. `skills/shared-auth/`

负责所有可跨工具复用的认证能力：

- 账号 profile 管理
- 多通道登录：GUI 浏览器 SSO、headless 授权、手动导入现有会话
- 明文凭证读写
- 凭证过期检查
- 本地浏览器/自动化能力探测
- 为其他 skill 提供统一的凭证读取入口

### 2. `skills/kibana-search/`

负责 Kibana 专属能力：

- `SKILL.md`：说明触发场景、参数收集方式、错误恢复方式。
- `scripts/`：查询执行、缓存刷新、配置检查等脚本。
- `templates/`：示例配置模板。
- `lib/`：如果需要，可放脚本共用的本地实现。

对外仍然保留类似 CLI 的调用体验，例如：

```bash
bash skills/kibana-search/scripts/kibana-search logs \
  --env bg_prod_main \
  --service groot-lms-learning-server \
  --level ERROR \
  --since 15h \
  --fields level,message
```

AI、脚本和人都通过 skill 内脚本调用。默认输出适合人阅读的原始日志行；加 `--json` 时输出稳定结构化 JSON，便于 Claude Code、hermes-agent 或其他自动化工具解析。

这样用户不需要额外安装一个独立发布的外部工具；同时认证逻辑不会被 `kibana-search` 私有化，后续其他 skill 也可以复用。

## 配置模型

采用**共享认证配置 + Kibana 专属配置**的双层模型，且两者都跟随 skill 存放，不绑定 Claude 私有目录，兼容 Claude Code 与 hermes-agent 等运行方。

推荐结构：

- `skills/shared-auth/templates/auth-config.example.json`
- `skills/shared-auth/.local/auth-config.json`
- `skills/shared-auth/.local/credentials.json`
- `skills/kibana-search/templates/config.example.json`
- `skills/kibana-search/.local/config.json`
- `skills/kibana-search/.local/cache.json`

约定：

- `shared-auth` 管理账号、SSO、凭证与登录态。
- `kibana-search` 管理环境、Kibana 地址、字段映射、backend 策略和 data view 缓存。
- `kibana-search` 通过 `auth.profile` 引用 `shared-auth` 中定义的认证配置。
- `.local/` 属于运行态数据目录，应加入忽略规则，不进入 git。

环境仍然是第一层隔离边界，工具配置作为环境内的命名空间。示例：

```json
{
  "environments": {
    "bg_prod_main": {
      "organization": "bg",
      "stage": "prod",
      "account": "main",
      "auth": {
        "profile": "bg_prod_main_sso"
      },
      "tools": {
        "kibana": {
          "baseUrl": "https://kibana.bg.allschool.com",
          "preferredBackend": "auto",
          "space": "default",
          "defaultDataViewId": "f12ae960-16d1-11ec-97d3-31b29b7fe5a5",
          "defaultColumns": ["level", "message"],
          "serviceField": "APP_NAME",
          "levelField": "level",
          "messageField": "message",
          "traceIdField": "traceId",
          "timeField": "@timestamp",
          "cache": {
            "dataViewTtlSeconds": 86400
          }
        }
      }
    }
  }
}
```

环境名本身可以采用 `组织_环境_账号` 结构，例如 `bg_prod_main`。脚本必须显式传入 `--env`，并且只能读取该环境下的对应工具配置，避免跨账号、跨环境串用。

`skills/shared-auth/.local/auth-config.json` 中维护认证 profile，例如：

```json
{
  "profiles": {
    "bg_prod_main_sso": {
      "type": "sso_browser",
      "credentialRef": "bg_prod_main",
      "loginMode": "auto"
    }
  }
}
```

`kibana-search` 只引用 `auth.profile`，不重复保存认证细节。

`kibana-search` 还需要提供一个初始化入口，例如：

```bash
bash skills/kibana-search/scripts/kibana-search init
```

该命令负责：

- 将模板配置复制到 `skills/kibana-search/.local/config.json`
- 检查必要字段是否已填写
- 提示用户补充 `baseUrl`、默认 data view、字段映射等信息
- 检查 `auth.profile` 是否能在 `shared-auth` 配置中找到

## 认证与凭证

认证逻辑放在 `skills/shared-auth/` 中，供 `kibana-search` 以及未来其他 skill 复用。模块接口包括：

- `login`
- `getCredential`
- `saveCredential`
- `isExpired`
- `clearCredential`
- `detectLoginCapabilities`
- `importSession`

MVP 使用 `skills/shared-auth/.local/credentials.json` 明文凭证文件，便于手动编辑和调试。凭证内容可包含：

- cookie
- bearer token
- Kibana xsrf header 所需值
- 过期时间或最近校验时间
- 所属环境和 auth profile
- 登录来源（gui / headless / imported）

### 登录通道

`shared-auth` 必须支持三种登录通道：

1. **GUI 浏览器登录**
   - 当系统存在桌面能力，且能找到可用浏览器或本地自动化能力时使用。
   - 可以优先探测系统默认浏览器、已安装浏览器、或本地可用的浏览器自动化插件/脚本能力。
   - 这些能力只能作为可选增强，不能作为唯一依赖。

2. **Headless 授权登录**
   - 当系统无 GUI、无法打开浏览器，或浏览器探测失败时使用。
   - CLI 输出一个登录 URL、必要的 state 信息和后续指引。
   - 用户可在另一台有浏览器的设备上完成登录，再将返回结果、cookie、token 或 header 粘贴回当前终端。
   - 如果目标平台支持 device authorization、一次性授权码或中转回填，也优先复用该机制。

3. **已有会话导入**
   - 允许用户直接导入本机已有的 cookie、header、token、文件或环境变量。
   - 用于跳板机、容器、CI、受限服务器等不适合交互式登录的场景。

### 通道选择顺序

默认 `loginMode=auto`，执行 `auth login` 时按以下顺序选择：

1. 探测本地是否存在可用 GUI 浏览器或自动化能力。
2. 若可用，走 GUI 浏览器登录。
3. 若不可用，进入 headless 授权模式。
4. 若用户显式指定 `--mode import`，则直接进入会话导入。

### 登录流程

1. 查询前读取当前 `--env` 对应 `auth.profile` 的凭证。
2. 如果缺失或过期，返回明确错误并提示登录命令。
3. 用户执行共享认证登录命令：
   ```bash
   bash skills/shared-auth/scripts/auth login --profile bg_prod_main_sso
   ```
4. `shared-auth` 根据 `loginMode` 与能力探测结果自动选择 GUI、headless 或导入模式。
5. 登录成功后保存凭证到 `skills/shared-auth/.local/credentials.json`。
6. `kibana-search` 后续查询在凭证有效期内直接复用。

凭证缓存 key 至少包含 `env + auth.profile + tool`，避免不同环境或账号复用错误凭证。

## 查询能力

首批核心能力是通用服务日志查询：

```bash
bash skills/kibana-search/scripts/kibana-search logs \
  --env bg_prod_main \
  --service groot-lms-learning-server \
  --level ERROR \
  --since 15h \
  --fields level,message \
  --json
```

支持参数：

- `--env`：必填，环境名。
- `--service`：服务或应用名，对应配置中的 `serviceField`。
- `--level`：日志级别，对应 `levelField`。
- `--keyword`：在 message 或默认文本字段中搜索关键字。
- `--trace-id`：按 trace id 字段搜索。
- `--since`：相对时间范围，例如 `15h`。
- `--from` / `--to`：绝对或 Kibana 风格时间范围。
- `--fields`：返回字段列表。
- `--data-view`：覆盖默认 data view/index pattern。
- `--kql`：追加或覆盖 KQL 查询。
- `--limit`：返回条数。
- `--json`：输出结构化 JSON。
- `--refresh-cache`：查询前强制刷新 data view 缓存。

给定示例 Discover URL 可转成：

```bash
bash skills/kibana-search/scripts/kibana-search logs \
  --env bg_prod_main \
  --service groot-lms-learning-server \
  --level ERROR \
  --since 15h \
  --fields level,message
```

生成 KQL：

```text
APP_NAME:"groot-lms-learning-server" and level:"ERROR"
```

## Backend 策略

每个环境的 Kibana 工具配置支持 `preferredBackend`：

- `kibana`：固定走 Kibana 接口。
- `es`：固定直连 Elasticsearch。
- `auto`：根据当前环境配置与可用权限选择 backend。

MVP 先实现 Kibana backend，因为当前已有 Kibana Discover URL 和 data view id。ES backend 通过接口预留，后续拿到 ES endpoint 与权限后补齐。

## Data view / index pattern 缓存

首次使用某个环境时，CLI 读取 Kibana data view 信息并缓存：

- data view id
- title / index pattern
- fields
- time field
- 字段类型
- 是否 searchable / aggregatable
- 默认 columns

缓存 key 以环境为边界，例如：

```text
env:bg_prod_main/tool:kibana/data-views
```

缓存文件记录 `fetchedAt` 和 `ttlSeconds`。默认 TTL 为 24 小时，可在环境工具配置中覆盖。缓存建议保存在 `skills/kibana-search/.local/cache.json`。

刷新命令：

```bash
bash skills/kibana-search/scripts/kibana-search cache refresh --env bg_prod_main
bash skills/kibana-search/scripts/kibana-search cache clear --env bg_prod_main
```

查询时也支持：

```bash
bash skills/kibana-search/scripts/kibana-search logs --env bg_prod_main --service groot-lms-learning-server --refresh-cache
```

超过 TTL 后，查询会尝试自动刷新缓存。如果刷新失败且旧缓存存在，CLI 应返回明确提示；是否继续使用过期缓存由后续实现阶段决定，但不能静默掩盖刷新失败。

## 输出格式

文本模式返回原始日志行，例如：

```text
2026-05-29T10:00:00Z ERROR groot-lms-learning-server message...
2026-05-29T10:00:01Z ERROR groot-lms-learning-server message...
```

JSON 模式示例：

```json
{
  "ok": true,
  "env": "bg_prod_main",
  "backend": "kibana",
  "dataViewId": "f12ae960-16d1-11ec-97d3-31b29b7fe5a5",
  "query": {
    "kql": "APP_NAME:\"groot-lms-learning-server\" and level:\"ERROR\"",
    "timeRange": {
      "from": "now-15h",
      "to": "now"
    },
    "fields": ["level", "message"]
  },
  "logs": [
    {
      "@timestamp": "2026-05-29T10:00:00Z",
      "level": "ERROR",
      "message": "..."
    }
  ]
}
```

## 错误处理

错误需要对人和 AI 都可操作。`--json` 下返回结构化错误：

```json
{
  "ok": false,
  "error": {
    "code": "AUTH_EXPIRED",
    "message": "Kibana credential expired for env bg_prod_main.",
    "suggestion": "Run: bash skills/shared-auth/scripts/auth login --profile bg_prod_main_sso"
  }
}
```

错误码包括：

- `CONFIG_MISSING_ENV`：没有找到环境。
- `CONFIG_MISSING_TOOL`：环境中没有 `tools.kibana`。
- `AUTH_MISSING_CREDENTIAL`：没有可用凭证。
- `AUTH_EXPIRED`：凭证过期或 Kibana 返回未登录。
- `AUTH_CAPABILITY_UNAVAILABLE`：请求的登录模式在当前系统不可用。
- `AUTH_HEADLESS_ACTION_REQUIRED`：需要用户在外部设备完成授权或粘贴返回凭证。
- `CACHE_MISSING`：缺少 data view/index pattern 缓存且刷新失败。
- `CACHE_EXPIRED_REFRESH_FAILED`：缓存过期但刷新失败。
- `QUERY_INVALID_FIELD`：字段不在缓存字段中。
- `QUERY_BACKEND_UNAVAILABLE`：指定 backend 不可用。
- `QUERY_FAILED`：Kibana/ES 查询失败。

## Skill 使用方式

新增 `skills/kibana-search/SKILL.md`，它是 Kibana 查询入口，但依赖 `skills/shared-auth/` 提供的共享认证能力。它负责：

- 指导 Claude Code、hermes-agent 何时调用这个 skill。
- 从用户请求中提取查询参数。
- 调用 `skills/kibana-search/scripts/kibana-search`。
- 在认证、缓存或配置失败时给出下一步指引。
- 需要登录时，转而引导调用 `skills/shared-auth/scripts/auth`。
- 识别当前环境是否可能为无 GUI 系统，并优先提示正确的登录通道。

触发场景：

- 用户要求查询某服务最近错误日志。
- 用户给出 Kibana Discover URL，希望转成查询。
- 用户按关键字、traceId、level、时间范围查日志。
- 用户要求刷新 Kibana index pattern/data view 缓存。

skill 流程：

1. 从用户请求中提取 `env`、`service`、`level`、`keyword`、`traceId`、`time range`、`fields`。
2. 如果缺少必要信息，问最少的问题。
3. 调用 skill 目录内脚本，并优先加 `--json` 方便解析。
4. 如果返回认证或缓存错误，根据 `suggestion` 指导用户登录或刷新；认证相关操作统一走 `shared-auth`。
5. 如果错误表明当前环境无 GUI 或浏览器能力不可用，优先引导用户使用 headless 授权或会话导入，而不是继续要求本地打开浏览器。
6. 得到原始日志后，由 Claude Code 根据用户目标分析，不在 skill 中固化摘要规则。

处理 Kibana URL 时，skill 应说明：

- 解析 `_a.index` 作为 data view id。
- 解析 `_a.query.query` 作为 KQL。
- 解析 `_g.time.from/to` 作为时间范围。
- 解析 `_a.columns` 作为返回字段。
- 如果 URL 中的 index 与当前环境配置不一致，提醒用户确认是否用 `--data-view` 覆盖。

## 测试设计

单元测试覆盖：

- 配置解析：环境不存在、工具配置缺失、字段映射读取。
- KQL 构造：`service`、`level`、`keyword`、`traceId` 组合。
- Discover URL 解析：提取 base URL、data view id、columns、time range、KQL。
- 缓存 TTL 判断：未过期、已过期、强制刷新。
- 错误 JSON 输出格式。

集成测试覆盖 mock Kibana API：

- data view 缓存刷新。
- logs 查询请求 payload。
- 401/403 返回认证错误。
- 字段不存在返回明确错误。
- GUI 模式不可用时自动回退到 headless 模式。
- `--mode import` 时会话导入流程可用。

手动验证覆盖：

- 使用 `bg_prod_main` 环境和线上 Kibana 示例参数查询最近 15 小时 ERROR 日志。
- 首次无凭证时确认提示登录。
- 在有 GUI 环境中验证浏览器登录可用。
- 在无 GUI 环境中验证 headless 授权或会话导入可用。
- 写入或登录凭证后确认查询成功。
- 执行 `cache refresh` 后确认缓存文件更新。
- 使用 `--json` 确认输出可由 AI 稳定解析。

## 实施顺序建议

1. 建立 CLI 框架、配置读取和错误输出。
2. 实现明文凭证读取、保存和登录兜底流程。
3. 实现 Kibana data view 缓存读取、刷新和 TTL 判断。
4. 实现 `logs` 查询命令和 KQL 构造。
5. 用 mock Kibana API 补齐单元测试与集成测试。
6. 新增 `shared-auth` 与 `kibana-search` 两个 skill，并让 `kibana-search` 调用共享认证与自身脚本。
7. 用线上 Kibana 示例做手动验证。
