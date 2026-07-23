---
name: sync-upstream-skills
description: 安全检查并镜像配置的第三方 skill 来源到本仓库。
---

# 同步上游 skill

使用这个仅服务本仓库的 skill 更新 `skills/sources.json` 中的来源映射。它只管理已配置的上游根目录，并在每个目标根目录生成由 Bamhub 管理的 `README.md`。

## 应用前检查

先执行只读检查：

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs check --source superpowers
```

JSON 报告按来源分别输出。`up-to-date` 无需操作，`update-available` 可以应用，`failed` 只标识该来源的问题。使用 `--all` 检查全部已配置来源；某个来源失败不会阻止其他来源被检查。

## 应用已确认的更新

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --source superpowers
```

此命令会用选定的上游根目录替换已配置目标，在 `skills/sources.json` 记录已接受提交，并重新生成其 README。仅在明确要丢弃该受管目标下的本地修改时使用 `--force`：

```bash
node skills/project/sync-upstream-skills/scripts/sync-skills.mjs apply --source superpowers --force
```

生成的 README 将同步元数据与 AI 内容分开管理。具备 AI 能力的调用方必须先理解用户的请求，随后才可以在 AI 内容标记之间写入真实、由用户请求的内容；如果没有这类内容，必须保持该区块为空。调用方绝不能编辑元数据标记或其中的元数据。同步器在 `apply` 时会保留有效的 AI 内容。调用方可以读取 `check` 的 JSON 报告并在本次调用中给出摘要，但不得将摘要传给 `apply` 或存入仓库。

配置的上游根目录必须是真实目录。同步器会在暂存文件前拒绝符号链接根目录，以及解析后指向根目录外的嵌套符号链接。已接受提交仍是当前版本且目录干净的来源会报告为 `up-to-date`，不会改写其 README 或 `acceptedAt`。

## 定期执行

定期检查应由 GitHub Actions 托管，而非在本地 macOS 安装定时器。合并任何自动更新前，请审阅每个来源的输出和产生的改动。
