---
name: kibana-search
description: 使用共享认证配置文件，从仓库本地配置中查询 Kibana 日志时使用
---

# Kibana 日志查询

## 概述

当 Claude Code 或 hermes-agent 需要从仓库本地环境配置查询 Kibana 日志，并向调用方返回原始日志条目时使用此 skill。它使用 shared-auth 配置文件管理凭证，并将运行时配置保留在当前仓库内。

## 何时使用

- 调查 Kibana 日志中的应用错误、调用链、告警或生产行为。
- 从已配置环境中按服务、级别、关键词或 trace ID 搜索。
- 向其他代理或用户返回原始日志供其检查。

不要使用此 skill 省略日志证据而只做总结。应返回 CLI 生成的原始日志；仅在被要求时，才额外给出解读。

## 运行时文件

- 配置：`skills/bamhub/integrations/kibana-search/.local/config.json`
- 缓存：`skills/bamhub/integrations/kibana-search/.local/cache.json`
- 配置示例：`skills/bamhub/integrations/kibana-search/templates/config.example.json`
- CLI：`skills/bamhub/integrations/kibana-search/scripts/kibana-search`
- 认证配置：`skills/bamhub/integrations/shared-auth/.local/auth-config.json`
- 认证凭证：`skills/bamhub/integrations/shared-auth/.local/credentials.json`

Kibana 配置通过 `environments.<env>.auth.profile` 引用 shared-auth 配置文件。该配置文件必须存在于 `skills/bamhub/integrations/shared-auth/.local/auth-config.json` 中。

## 命令

### 初始化本地配置

首次使用前，复制并编辑配置示例：

```bash
cp skills/bamhub/integrations/kibana-search/templates/config.example.json skills/bamhub/integrations/kibana-search/.local/config.json
cp skills/bamhub/integrations/shared-auth/templates/auth-config.example.json skills/bamhub/integrations/shared-auth/.local/auth-config.json
```

仅当有意使用非默认的仓库本地路径时，才设置 `KIBANA_SEARCH_CONFIG` 或 `SHARED_AUTH_CONFIG`。

### 搜索日志

从仓库根目录运行：

```bash
bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs --env <environment>
```

常用筛选条件：

```bash
bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs --env <environment> --service <service-name>
bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs --env <environment> --level error
bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs --env <environment> --keyword <text>
bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs --env <environment> --trace-id <trace-id>
bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs --env <environment> --json
```

返回 stdout 中的原始日志。使用 `--json` 时，应保留包含 `logs`、`query`、`backend` 和 `dataViewId` 的 JSON 载荷。

### 刷新缓存

数据视图元数据缓存于 `skills/bamhub/integrations/kibana-search/.local/cache.json`。如需强制刷新，删除缓存文件后重新执行日志命令：

```bash
rm skills/bamhub/integrations/kibana-search/.local/cache.json
bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs --env <environment>
```

## 认证缺失或已过期

若 CLI 报告 `AUTH_MISSING_CREDENTIAL` 或 `AUTH_EXPIRED`，使用错误信息或环境配置中指定的 shared-auth 配置文件登录：

```bash
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name>
```

随后重新运行 Kibana 日志命令。将凭证保留在仓库本地的 shared-auth 运行时文件中。

## 无头系统

对于 hermes-agent、远程终端、类 CI shell 或任何不支持 GUI 浏览器的环境，使用 shared-auth 的无头或导入模式：

```bash
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name> --mode headless
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name> --mode import
```

shared-auth 流程将凭证保存到 `skills/bamhub/integrations/shared-auth/.local/credentials.json` 后，再次执行 `bash skills/bamhub/integrations/kibana-search/scripts/kibana-search logs`。

## 常见错误

- 在 shared-auth 配置文件拥有凭证前就搜索。应先运行 `skills/bamhub/integrations/shared-auth/scripts/auth login`。
- 为 Kibana 认证编辑全局 Claude 配置。应将 Kibana 配置和凭证保留在仓库本地。
- 只返回总结。应保留并返回原始日志，以便调用方验证证据。
