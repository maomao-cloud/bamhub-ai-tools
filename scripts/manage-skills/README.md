# manage-skills

`manage-skills` 是 bamhub-ai-tools 提供的全局 skill 软链接管理器。它从一个用户确认的 catalog 中选择有效 skill，并把相对软链接暴露到 DSH、Codex、Claude Code 或经过安全检查的自定义全局 skill root。skill 内容始终留在 catalog，不会复制到运行时目录。

## 快速开始

在仓库根目录运行：

```bash
scripts/manage-skills/manage-skills
```

显式使用参数时：

```bash
scripts/manage-skills/manage-skills.mjs status --catalog <path> --runtime dsh --json
scripts/manage-skills/manage-skills.mjs apply --catalog <path> --runtime dsh --enable brainstorming --yes
scripts/manage-skills/manage-skills.mjs recover --state-root <path> --journal <path> --json
```

`apply` 的 `--enable` 是最终 desired state；清空本工具当前 manifest 管理的链接时，必须显式使用：

```bash
scripts/manage-skills/manage-skills.mjs apply --catalog <path> --runtime dsh --disable-all --yes
```

## Catalog 选择与来源

catalog 的优先级固定为（显式 --catalog 优先）：

1. 显式 `--catalog <path>`；
2. `MANAGE_SKILLS_CATALOG`；
3. 从脚本位置推导本仓库的 `skills/`；
4. 交互式输入路径。

显式参数或环境变量指向无效路径时直接报错，不会回退到其他候选。工具只读取一个 catalog，要求它是可读目录；不会创建缺失目录，也不会 clone、pull、fetch、checkout、reset 或自动更新 catalog。Pod 中的 bamhub checkout 必须由维护者先手动放入 `/work` PVC（这是手动 checkout 前置条件），并在运行前确认 checkout 是可用 Git 工作树且包含 `skills/`；工具不负责 checkout 或同步。

## 归属与保护规则

每个运行时 target 都有位于 skill root 之外的 manifest，记录 catalog、target、source identity 以及相对链接目标。工具只自动删除 manifest-owned 且二次校验仍匹配的链接。

- 没有 manifest、没有 manifest ownership 或归属身份不匹配的链接均受保护；即使链接目标位于当前 catalog 内，也不会被推断为可删除。
- foreign/unmanaged symlink、broken symlink、regular file 和 regular directory 不会被覆盖或删除。
- 只创建相对软链接，不修改、复制或删除 catalog 中的 skill 文件。
- `--disable-all` 只清空本工具当前 manifest 管理的 desired state，不接管其他工具或人工创建的链接。
- 交互预览会列出每个 target 的 create、remove、keep、conflicts 和 protected；最终确认前不会创建目录、写 manifest、加锁或修改软链接。

## 全局目标与运行时目录

本工具只管理全局目录，不管理项目级 `.agents/skills`、`.claude/skills` 或其他 project skill root。标准运行时目录为：

| 运行时 | 默认全局 root |
| --- | --- |
| DSH | `$DSH_HOME/skills`；未设置 `DSH_HOME` 时回退到 `$HOME/.dsh/skills` |
| Codex | `$HOME/.agents/skills` |
| Claude Code | `$HOME/.claude/skills` |
| 自定义 | 用户指定、并通过 global-only guard 的目录 |

自定义 target 不得位于 Git worktree、项目级 skill 目录、catalog 内或 catalog/target 的重叠路径中；不安全的软链接祖先、非目录 target 和缺失父链也会被拒绝。标准目录可以作为缺失候选显示，但工具只在用户确认并执行 apply 后创建最后一级目录。

DSH Web 是否实际发现 skill 还受 active profile/preset 的 provider gate 约束。仅创建 `$DSH_HOME/skills` 或写入软链接不等于 DSH Web 已加载 skill；必须独立确认 `skill-filesystem` 与 `tool-skill` 在目标 preset 中启用，并用实际会话验证 discovery。

## Pod 操作边界

当前 DSH Pod 只把 PVC 的 `work` 子目录挂载为 `/work`，不会自动提供 bamhub checkout。运行 manage-skills 前，维护者必须手动把仓库 checkout 到 `/work` 下的某个路径，并确认：

```bash
git -C <checkout> rev-parse --show-toplevel
test -d <checkout>/skills
git -C <checkout> status --short
```

不要把某个当前 checkout 路径硬编码为默认值；使用时通过 `--catalog <checkout>/skills` 或 `MANAGE_SKILLS_CATALOG` 传入实际路径。工具没有自动 clone、自动 pull 或自动 sync 行为；也就是不自动 clone、不自动更新 catalog。

## 安全检查与验证

建议先只读查看：

```bash
scripts/manage-skills/manage-skills.mjs status --catalog <path> --runtime dsh --json
scripts/manage-skills/manage-skills.mjs plan --catalog <path> --runtime dsh --enable brainstorming --json
```

非交互 `apply` 必须同时提供明确 desired state 与 `--yes`。`recover` 接受 `--state-root <path> --journal <path>`，调用 journal recovery；成功返回 0，恢复失败返回 1，参数错误返回 2。JSON 模式只把一个报告写到 stdout，诊断写到 stderr。执行时工具会重新扫描 catalog、manifest 和 target，并校验身份、fingerprint、lock 与链接类型；竞态变化会报告 conflict，而不是覆盖或删除未知对象。

实现与测试位于本目录。运行全部 manage-skills 测试：

```bash
node --test scripts/manage-skills/tests/*.test.mjs
```

DSH provider gate 是运行时部署验收项，不由本工具自动启用，也不在本工具中修改 DSH profile、Pod YAML、PVC 或镜像。
