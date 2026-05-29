# 本地 Kibana 日志查询 CLI 与配套 Skill 设计

## 背景

需要做一个本地 Kibana 查询搜索工具，用于跨环境、跨账号查询日志。工具主要由 AI 调用，但入口应像 `git` 一样是本地 CLI，而不是需要启动常驻服务的 MCP。首个场景是查询线上 Kibana 中某个服务最近一段时间的错误等级日志，例如 `groot-lms-learning-server` 最近 15 小时的 `ERROR` 日志。

工具需要支持多环境配置、多账号隔离、通用认证逻辑复用、Kibana data view/index pattern 元数据缓存，以及一个配套 skill 来指导 Claude Code 如何调用该 CLI。

## 目标

- 提供本地 CLI-first 的 Kibana 日志查询工具。
- 环境名作为完整隔离边界，定位组织、部署环境、账号、认证信息、Kibana 地址和工具配置。
- 支持通用服务日志查询：`service/app + level + keyword + traceId + time range`。
- 查询结果返回原始日志内容，由上层 AI 负责分析。
- 支持 Kibana/ES backend 策略配置：`kibana`、`es`、`auto`。
- 缓存 Kibana data view/index pattern 元数据，并支持 TTL 与强制刷新。
- 提供通用 auth 模块，MVP 使用本地明文凭证，后续可替换为钥匙串或加密存储。
- 新增配套 skill，说明 Claude Code 如何使用该 CLI 查询日志、处理错误和解析 Kibana Discover URL。

## 非目标

- 不实现 Web 管理台。
- 不以 MCP server 作为主入口。
- 不在工具内做 AI 摘要、错误聚类或根因分析。
- MVP 不强制实现安全凭证存储；凭证先明文保存，后续通过存储接口替换。
- MVP 可以先实现 Kibana backend；ES backend 保留接口与配置能力，等 ES endpoint 和权限明确后补齐。

## 总体形态

对外提供一个本地 CLI，例如 `kibana-search`：

```bash
kibana-search logs \
  --env bg_prod_main \
  --service groot-lms-learning-server \
  --level ERROR \
  --since 15h \
  --fields level,message
```

AI、脚本和人都通过该命令调用。默认输出适合人阅读的原始日志行；加 `--json` 时输出稳定结构化 JSON，便于 Claude Code 或其他自动化工具解析。

配套 skill 位于 `skills/kibana-search/SKILL.md`，只负责编排 CLI 使用方式，不复制查询逻辑。

## 配置模型

采用单一环境配置文件，环境为第一层隔离边界，工具配置作为环境内的命名空间。示例：

```json
{
  "environments": {
    "bg_prod_main": {
      "organization": "bg",
      "stage": "prod",
      "account": "main",
      "auth": {
        "profile": "bg_prod_main_sso",
        "type": "sso_browser",
        "credentialRef": "bg_prod_main"
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

环境名本身可以采用 `组织_环境_账号` 结构，例如 `bg_prod_main`。CLI 必须显式传入 `--env`，并且只能读取该环境下的对应工具配置，避免跨账号、跨环境串用。

## 认证与凭证

认证逻辑放在通用 auth 模块中，供未来其他本地工具复用。模块接口包括：

- `login`
- `getCredential`
- `saveCredential`
- `isExpired`
- `clearCredential`

MVP 使用本地明文凭证文件，便于手动编辑和调试。凭证内容可包含：

- cookie
- bearer token
- Kibana xsrf header 所需值
- 过期时间或最近校验时间
- 所属环境和 auth profile

登录流程：

1. 查询前读取当前 `--env` 的凭证。
2. 如果缺失或过期，返回明确错误并提示登录命令。
3. 用户执行 `kibana-search auth login --env bg_prod_main`。
4. 登录命令优先支持浏览器 SSO；也允许手动粘贴 cookie/header 作为兜底。
5. 登录成功后保存凭证。
6. 后续查询在凭证有效期内直接复用。

凭证缓存 key 至少包含 `env + auth.profile + tool`，避免不同环境或账号复用错误凭证。

## 查询能力

首批核心能力是通用服务日志查询：

```bash
kibana-search logs \
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
kibana-search logs \
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

缓存文件记录 `fetchedAt` 和 `ttlSeconds`。默认 TTL 为 24 小时，可在环境工具配置中覆盖。

刷新命令：

```bash
kibana-search cache refresh --env bg_prod_main
kibana-search cache clear --env bg_prod_main
```

查询时也支持：

```bash
kibana-search logs --env bg_prod_main --service groot-lms-learning-server --refresh-cache
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
    "suggestion": "Run: kibana-search auth login --env bg_prod_main"
  }
}
```

错误码包括：

- `CONFIG_MISSING_ENV`：没有找到环境。
- `CONFIG_MISSING_TOOL`：环境中没有 `tools.kibana`。
- `AUTH_MISSING_CREDENTIAL`：没有可用凭证。
- `AUTH_EXPIRED`：凭证过期或 Kibana 返回未登录。
- `CACHE_MISSING`：缺少 data view/index pattern 缓存且刷新失败。
- `CACHE_EXPIRED_REFRESH_FAILED`：缓存过期但刷新失败。
- `QUERY_INVALID_FIELD`：字段不在缓存字段中。
- `QUERY_BACKEND_UNAVAILABLE`：指定 backend 不可用。
- `QUERY_FAILED`：Kibana/ES 查询失败。

## Skill 使用方式

新增 `skills/kibana-search/SKILL.md`，用于指导 Claude Code 调用 CLI。

触发场景：

- 用户要求查询某服务最近错误日志。
- 用户给出 Kibana Discover URL，希望转成查询。
- 用户按关键字、traceId、level、时间范围查日志。
- 用户要求刷新 Kibana index pattern/data view 缓存。

skill 流程：

1. 从用户请求中提取 `env`、`service`、`level`、`keyword`、`traceId`、`time range`、`fields`。
2. 如果缺少必要信息，问最少的问题。
3. 调用 CLI，并优先加 `--json` 方便解析。
4. 如果返回认证或缓存错误，根据 `suggestion` 指导用户登录或刷新。
5. 得到原始日志后，由 Claude Code 根据用户目标分析，不在 skill 中固化摘要规则。

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

手动验证覆盖：

- 使用 `bg_prod_main` 环境和线上 Kibana 示例参数查询最近 15 小时 ERROR 日志。
- 首次无凭证时确认提示登录。
- 写入或登录凭证后确认查询成功。
- 执行 `cache refresh` 后确认缓存文件更新。
- 使用 `--json` 确认输出可由 AI 稳定解析。

## 实施顺序建议

1. 建立 CLI 框架、配置读取和错误输出。
2. 实现明文凭证读取、保存和登录兜底流程。
3. 实现 Kibana data view 缓存读取、刷新和 TTL 判断。
4. 实现 `logs` 查询命令和 KQL 构造。
5. 用 mock Kibana API 补齐单元测试与集成测试。
6. 新增 `kibana-search` skill，指导 Claude Code 使用 CLI。
7. 用线上 Kibana 示例做手动验证。
