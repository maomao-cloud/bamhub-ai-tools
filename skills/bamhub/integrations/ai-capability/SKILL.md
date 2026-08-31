---
name: ai-capability
description: 当代理需要发现或调用远程 AI 能力服务、查看能力名称和说明、加载某项能力的输入模式，或通过仓库 CLI 执行由提供方支持的能力时使用
---

# 通用 AI 能力

将此 skill 作为面向代理的稳定接口来使用远程 AI 能力。首个支持的提供方是 Bamboo 开放能力 API；工作流与提供方无关，且不得暴露 TaskBot 内部细节。

## 快速参考

```bash
# 发现轻量级能力元数据
bash skills/bamhub/integrations/ai-capability/scripts/ai-capability \
  capabilities --keyword '日志' --json

# 仅在选定一个代码后加载模式
bash skills/bamhub/integrations/ai-capability/scripts/ai-capability \
  describe --code <capability-code> --json

# 使用通过返回的 inputSchema 校验的参数调用
bash skills/bamhub/integrations/ai-capability/scripts/ai-capability \
  invoke --code <capability-code> --arguments '<json>' --json
```

本地命令与当前远程 API 的映射如下：

| 本地命令 | 远程请求 | 用途 |
|---|---|---|
| `capabilities` | `POST {baseUrl}/ai/capability/page`，`detail=false` | 列出／筛选 `code`、`name`、`description` |
| `describe` | 同一 `page` 端点，使用 `codes=[code]`、`detail=true` | 加载一个 `inputSchema` |
| `invoke` | `POST {baseUrl}/ai/capability/invoke` | 执行选定的能力 |

远程端不存在 `/search` 或 `/detail/{code}` 端点。

## 配置与认证

将 `templates/config.example.json` 复制为 `.local/config.json`，并设置服务 `baseUrl`。API 密钥必须存放在 Git 之外，推荐放在 `apiKeyEnv` 指定的环境变量中：

```bash
export AI_CAPABILITY_API_KEY='provided-out-of-band'
```

默认本地配置位于此 skill 同级的 `.local/config.json`，因此通过其他仓库中的符号链接调用该 skill 时，命令同样可用。在 macOS 上，`apiKeyKeychainService` 可以将密钥保存在钥匙串中；显式导出的 `AI_CAPABILITY_API_KEY` 优先级更高。

共享客户端会在**每次**列表分页、详情分页和调用请求中发送配置的密钥，默认使用 `X-API-KEY`。不要将密钥放入 `arguments`、URL、已提交文件、输出或日志中。密钥缺失或被拒绝即为停止条件；不要匿名重试或猜测其他密钥。

## 必需工作流

1. 使用 `detail=false` 调用 `capabilities`；根据 `name` 和 `description` 匹配用户意图。
2. 若匹配多个能力，请用户选择；不要猜测代码。
3. 只对选定代码调用 `describe`；阅读其 `inputSchema`、必填字段、说明和限制。
4. 基于该模式构建并校验 `arguments`。将 `capabilityCode` 放在参数对象之外。
5. 调用 `invoke` 并返回提供方结果，不得泄露凭证或提供方内部配置。

## 失败处理

- `AUTH_API_KEY_MISSING` / `AUTH_API_KEY_INVALID`：停止并索取有效 API 密钥。
- `CONFIG_INVALID` / `SERVICE_INVALID`：索取有效的服务配置。
- `REQUEST_TIMEOUT` / `REQUEST_FAILED`：报告不泄露敏感信息的摘要，仅在网络或服务问题解决后重试。
- 发现结果为空或不明确：请用户提供更具体的能力需求或澄清。
- 模式校验失败：索取缺少的业务输入；绝不编造密钥或隐藏的提供方字段。

## 边界

- TaskBot 只是一个提供方；不要硬编码 TaskPlan、TaskPlanDetail、Cookie、`sid` 或内部任务协议字段。
- 不要在选择能力前加载所有模式。
- 不要调用未发现或未明确配置的能力代码。
- 除非用户要求且数据可安全返回，否则不要概括、转换或暴露敏感的提供方输出。
