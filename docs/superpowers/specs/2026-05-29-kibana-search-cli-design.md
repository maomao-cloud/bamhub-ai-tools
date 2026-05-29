# 单个 Skill 自包含的本地 Kibana 日志查询设计

## 背景

需要做一个本地 Kibana 查询搜索能力，用于跨环境、跨账号查询日志。整体交付形态不是“一个独立安装的外部工具 + 一个引用它的 skill”，而是**一个自包含的 skill**：skill 目录内同时包含说明文档、辅助脚本、配置模板，以及登录、缓存、查询相关逻辑。对外使用体验仍然保持为类似 `git` 的本地命令调用，但这些命令由 skill 内部脚本提供，而不是要求用户单独安装额外工具。

首个场景是查询线上 Kibana 中某个服务最近一段时间的错误等级日志，例如 `groot-lms-learning-server` 最近 15 小时的 `ERROR` 日志。

工具需要支持多环境配置、多账号隔离、通用认证逻辑复用、Kibana data view/index pattern 元数据缓存，以及一个配套 skill 来指导 Claude Code 如何调用这些本地脚本。

## 目标

- 提供一个自包含的本地 skill，内部带有类似 CLI 的脚本入口。
- 环境名作为完整隔离边界，定位组织、部署环境、账号、认证信息、Kibana 地址和工具配置。
- 支持通用服务日志查询：`service/app + level + keyword + traceId + time range`。
- 查询结果返回原始日志内容，由上层 AI 负责分析。
- 支持 Kibana/ES backend 策略配置：`kibana`、`es`、`auto`。
- 缓存 Kibana data view/index pattern 元数据，并支持 TTL 与强制刷新。
- 提供通用 auth 模块，MVP 使用本地明文凭证，后续可替换为钥匙串或加密存储。
- Skill 文档直接说明 Claude Code 如何调用 skill 目录中的脚本查询日志、处理错误和解析 Kibana Discover URL。

## 非目标

- 不实现 Web 管理台。
- 不以 MCP server 作为主入口。
- 不在工具内做 AI 摘要、错误聚类或根因分析。
- MVP 不强制实现安全凭证存储；凭证先明文保存，后续通过存储接口替换。
- MVP 可以先实现 Kibana backend；ES backend 保留接口与配置能力，等 ES endpoint 和权限明确后补齐。

## 总体形态

整体以一个单独 skill 交付，例如 `skills/kibana-search/`。该目录内包含：

- `SKILL.md`：说明触发场景、参数收集方式、错误恢复方式。
- `scripts/`：登录、缓存刷新、查询执行等脚本。
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

AI、脚本和人都通过 skill 内脚本调用。默认输出适合人阅读的原始日志行；加 `--json` 时输出稳定结构化 JSON，便于 Claude Code 或其他自动化工具解析。

这样用户只需要使用这个 skill，不需要额外安装一个独立发布的外部工具。

## 配置模型

采用**单一 skill 自管理配置**：配置文件由 `skills/kibana-search/` 约定格式并提供模板，但实际可写配置放在用户本地路径，避免把敏感账号信息提交进仓库。推荐结构：

- 仓库内模板：`skills/kibana-search/templates/config.example.json`
- 用户本地实际配置：`~/.claude/kibana-search/config.json`
- 用户本地凭证文件：`~/.claude/kibana-search/credentials.json`
- 用户本地缓存文件：`~/.claude/kibana-search/cache.json`

这样配置、账号、缓存都仍然是“这个 skill 的一部分”，不会散落到多个独立工具里；同时敏感信息与仓库代码分离。

环境仍然是第一层隔离边界，工具配置作为环境内的命名空间。示例：

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

环境名本身可以采用 `组织_环境_账号` 结构，例如 `bg_prod_main`。脚本必须显式传入 `--env`，并且只能读取该环境下的对应工具配置，避免跨账号、跨环境串用。

skill 还需要提供一个初始化入口，例如：

```bash
bash skills/kibana-search/scripts/kibana-search init
```

该命令负责：

- 将模板配置复制到 `~/.claude/kibana-search/config.json`
- 检查必要字段是否已填写
- 提示用户补充 `baseUrl`、默认 data view、字段映射等信息

## 认证与凭证

认证逻辑放在 skill 内的通用 auth 模块中，供未来这个 skill 扩展出的其他本地脚本复用。模块接口包括：

- `login`
- `getCredential`
- `saveCredential`
- `isExpired`
- `clearCredential`

MVP 使用 `~/.claude/kibana-search/credentials.json` 本地明文凭证文件，便于手动编辑和调试。凭证内容可包含：

- cookie
- bearer token
- Kibana xsrf header 所需值
- 过期时间或最近校验时间
- 所属环境和 auth profile

登录流程：

1. 查询前读取当前 `--env` 的凭证。
2. 如果缺失或过期，返回明确错误并提示登录命令。
3. 用户执行：
   ```bash
   bash skills/kibana-search/scripts/kibana-search auth login --env bg_prod_main
   ```
4. 登录命令优先支持浏览器 SSO；也允许手动粘贴 cookie/header 作为兜底。
5. 登录成功后保存凭证。
6. 后续查询在凭证有效期内直接复用。

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

缓存文件记录 `fetchedAt` 和 `ttlSeconds`。默认 TTL 为 24 小时，可在环境工具配置中覆盖。

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
    "suggestion": "Run: bash skills/kibana-search/scripts/kibana-search auth login --env bg_prod_main"
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

新增 `skills/kibana-search/SKILL.md`，skill 自身就是最终交付入口。它负责：

- 指导 Claude Code 何时调用这个 skill。
- 从用户请求中提取查询参数。
- 调用 `skills/kibana-search/scripts/kibana-search`。
- 在认证、缓存或配置失败时给出下一步指引。

触发场景：

- 用户要求查询某服务最近错误日志。
- 用户给出 Kibana Discover URL，希望转成查询。
- 用户按关键字、traceId、level、时间范围查日志。
- 用户要求刷新 Kibana index pattern/data view 缓存。

skill 流程：

1. 从用户请求中提取 `env`、`service`、`level`、`keyword`、`traceId`、`time range`、`fields`。
2. 如果缺少必要信息，问最少的问题。
3. 调用 skill 目录内脚本，并优先加 `--json` 方便解析。
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
6. 新增 `kibana-search` skill，并让它调用 skill 目录内脚本。
7. 用线上 Kibana 示例做手动验证。
