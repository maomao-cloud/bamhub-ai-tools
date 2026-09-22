---
name: shared-auth
description: 当仓库工具需要可复用的仓库本地认证能力，以支持 GUI 或无头登录流程时使用
---

# 共享认证

## 概述

当仓库工具需要已认证的浏览器或 API 会话，但不希望将凭证存入全局 Claude 状态时，使用此 skill。所有运行时文件均保留在当前仓库内，使 Claude Code 和 hermes-agent 能共享同一组本地认证配置文件。

将认证配置、Cookie、令牌和凭证材料保存在下列仓库本地运行时文件中，不要放在用户主目录。

## 运行时文件

- 配置：`skills/bamhub/integrations/shared-auth/.local/auth-config.json`
- 凭证：`skills/bamhub/integrations/shared-auth/.local/credentials.json`
- 配置示例：`skills/bamhub/integrations/shared-auth/templates/auth-config.example.json`
- CLI：`skills/bamhub/integrations/shared-auth/scripts/auth`

`skills/bamhub/integrations/shared-auth/.local/` 是此 skill 唯一预期的运行时位置。保持其本地化、私有化，且不要提交到 Git；仅 `.gitkeep` 等占位文件除外。

## 登录命令

从仓库根目录执行登录：

```bash
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name>
```

常用选项：

```bash
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name> --mode auto
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name> --mode headless
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name> --mode import
bash skills/bamhub/integrations/shared-auth/scripts/auth login --profile <profile-name> --json
```

若未设置 `SHARED_AUTH_CONFIG`，CLI 读取 `skills/bamhub/integrations/shared-auth/.local/auth-config.json`。若未设置 `SHARED_AUTH_CREDENTIALS`，仓库工具应使用 `skills/bamhub/integrations/shared-auth/.local/credentials.json`。

## 无头与导入模式指引

当前运行环境无法启动交互式浏览器、但可提供在其他位置完成登录的指引时，使用 `--mode headless`。命令会提示操作者在外部浏览器中完成提供方登录，再导入已认证会话。

会话已存在且操作者能够提供捕获的 Cookie 或所需认证请求头时，使用 `--mode import`。仅将生成的凭证保存在 `skills/bamhub/integrations/shared-auth/.local/credentials.json`。

对于 hermes-agent、类 CI shell、远程终端或其他无头系统，应优先使用 `headless` 或 `import`，而不是尝试 GUI 浏览器流程。

## 常见错误

- 使用用户主目录下的认证材料。应将凭证保留在 `skills/bamhub/integrations/shared-auth/.local/credentials.json`。
- 在登录前运行依赖工具。应先使用该工具配置中引用的准确配置文件登录。
- 假定 GUI 登录可用。若无法启动浏览器，使用 `--mode headless` 或 `--mode import`。
