# manage-skills 软链接管理器设计

**日期：** 2026-09-20  
**项目：** `bamhub-ai-tools`  
**状态：** 待用户审阅

## 1. 背景

`bamhub-ai-tools` 中的 `skills/` 目录按所有权、来源和上游同步需求组织，便于维护，但 DSH、Codex 和 Claude Code 的运行时 skill 扫描目录是一层目录，不能直接复用仓库的多层分类结构。

本功能提供一个独立的交互式工具：从用户确认的 skill catalog 中选择 skill，以相对符号链接暴露到用户级运行时目录。真实 `SKILL.md` 和资源文件始终留在 catalog 中，运行时目录不复制 skill 内容。

## 2. 目标

- 在 `bamhub-ai-tools` 内提供独立的 `manage-skills` 工具。
- 默认从工具所在仓库推导 `skills/`，但不硬编码 `/work/bamhub-ai-tools`。
- 如果默认 catalog 不存在或用户不使用，交互式要求用户指定 catalog。
- 支持 DSH、Codex、Claude Code 和自定义全局 skill 目录。
- 默认以交互式向导完成扫描、选择、预览和执行。
- 只创建和删除软链接，不复制、修改或删除源 skill 文件。
- 只管理目标为当前 catalog 内路径的软链接；实体文件、实体目录和外部软链接始终受保护。
- DSH 直接使用现有持久化的 `$DSH_HOME/skills`，不新增 PVC 子目录、环境变量或插件。
- 提供非交互参数模式用于测试、自动化和故障恢复。

## 3. 非目标

- 不开发 DSH 插件。
- 不修改 skill 内容、frontmatter 或上游同步逻辑。
- 不管理项目级 `.agents/skills` 或 `.claude/skills`。
- 不删除外部仓库的软链接。
- 不自动 clone 或更新 skill catalog 仓库。
- 不在 Pod 启动链路中自动重建软链接。

## 4. 运行时目录

三种运行时使用各自的全局目录：

| 运行时 | 目标目录 | 检测方式 |
|---|---|---|
| DSH | `$DSH_HOME/skills` | 优先使用 `DSH_HOME`；未设置时可检查 `$HOME/.dsh/skills` |
| Codex | `$HOME/.agents/skills` | 用户级 Agent Skills 目录 |
| Claude Code | `$HOME/.claude/skills` | Claude Code 用户级 skills 目录 |
| 自定义 | 用户输入的目录 | 交互式或 `--target` |

在当前 DSH Pod 中，`DSH_HOME=/opt/data/dsh`，因此目标为 `/opt/data/dsh/skills`。该目录位于现有 PVC 的 `home` 子路径中，不需要增加 `agents` 子目录或新的挂载。

skill catalog 可以位于 `/work/bamhub-ai-tools/skills`，但该路径只作为运行时示例，不写入工具逻辑。脚本从自身位置推导仓库根目录和 `skills/`，或者使用用户提供的路径。

## 5. 目录结构

功能相关内容全部内聚在脚本目录中：

```text
scripts/manage-skills/
├── manage-skills              # 可执行入口
├── manage-skills.mjs          # CLI 主流程
├── lib/
│   ├── catalog.mjs            # catalog 扫描与 skill 元信息
│   ├── links.mjs              # 软链接状态、归属和执行
│   ├── runtimes.mjs           # DSH/Codex/Claude 目录检测
│   ├── plan.mjs               # 目标状态与变更计划
│   └── interactive.mjs        # 原生 readline 交互
├── tests/
│   ├── catalog.test.mjs
│   ├── links.test.mjs
│   ├── runtimes.test.mjs
│   └── manage-skills.test.mjs
└── README.md
```

实现使用 Node.js 原生模块，不新增 npm 依赖。Shell 入口只负责定位脚本并转发参数；核心逻辑使用 Node.js，保证 macOS、Linux 和 DSH Pod 的路径与文件系统行为一致。

## 6. Catalog 选择

优先级如下：

1. 显式参数 `--catalog <path>`；
2. 环境变量 `MANAGE_SKILLS_CATALOG`；
3. 从脚本位置推导 `<repository-root>/skills`；
4. 交互式输入路径。

默认目录存在时也必须向用户确认；不存在时不得静默创建或猜测。一次运行只使用一个 catalog 根目录，以便明确软链接归属和避免跨仓库同名混合。

catalog 扫描递归查找 `SKILL.md`。每个文件的父目录是一个 skill bundle。读取 frontmatter 中的 `name` 和 `description`，名称必须符合 Agent Skills 规范：小写字母、数字和连字符，不以连字符开头或结尾，不含路径分隔符。

非法或缺失 frontmatter 的 skill 只报告，不修改源文件。

## 7. 交互式流程

直接执行：

```bash
scripts/manage-skills/manage-skills
```

按以下顺序执行：

1. 扫描环境和运行时目录；
2. 查找并确认默认 catalog，或让用户输入 catalog；
3. 扫描 catalog，报告有效 skill、非法 skill 和重名 skill；
4. 多选需要管理的全局运行时目录；
5. 扫描目标目录中的软链接状态；
6. 选择最终启用的 skill 集合；
7. 生成创建、删除、保持、冲突和保护项计划；
8. 用户二次确认；
9. 执行创建和删除；
10. 重新扫描并输出复核结果。

交互列表支持上下移动、空格切换、全选、全不选、回车确认和 Esc 返回。非 TTY 环境不进入交互模式。

工具内不提供说明菜单，详细说明放在 `scripts/manage-skills/README.md`。

## 8. Skill 重名

运行时链接名称默认使用 frontmatter 的 `name`，不使用父目录名。

同一 catalog 内发现同名 skill 时不自动选择，要求用户选择源路径、暂不处理或使用运行时别名。别名只改变软链接名称，不修改源 `SKILL.md`：

```text
/opt/data/dsh/skills/bamhub-brainstorming
  -> /work/bamhub-ai-tools/skills/bamhub/brainstorming
```

## 9. 软链接状态与安全规则

目标目录条目分类为：

- `managed-valid`：软链接目标在 catalog 内，且目标存在有效 `SKILL.md`；
- `managed-broken`：软链接文本指向 catalog 内部，但目标已不存在；
- `foreign-symlink`：软链接目标位于 catalog 外；
- `regular-file`：实体文件；
- `regular-directory`：实体目录；
- `unknown`：无法确认归属的条目。

软链接归属通过目标路径判定，不增加 manifest：

- 有效链接使用 `realpath`；
- 失效链接使用 `readlink`，相对于链接父目录解析并规范化；
- 使用路径边界判断，避免把 `skills-evil` 误判为 `skills` 子目录；
- catalog 内部指向外部的嵌套软链接不得被接受为有效 skill。

只允许删除 `managed-valid` 和用户明确选择清理的 `managed-broken`。以下内容永远不自动删除或覆盖：

- 实体文件；
- 实体目录；
- 外部软链接；
- 无法确认归属的失效软链接。

所有新链接使用 `path.relative()` 计算相对目标路径。禁止硬编码 `/Users/...` 或 `/work/...`。

## 10. 变更计划与执行

脚本先构造内存计划：

```js
{
  targetRoot,
  create,
  remove,
  keep,
  conflicts,
  protected
}
```

执行前重新确认 catalog 和目标目录状态未发生变化。执行顺序：

1. 创建目标目录（仅在用户选中且最终确认后）；
2. 创建新增软链接；
3. 删除用户确认的受管软链接；
4. 重新扫描；
5. 输出复核结果。

删除软链接使用针对链接本身的操作，不使用 `rm -rf`。部分操作失败时保留已完成结果并逐项报告，不进行未经用户要求的隐式回滚。

## 11. 参数模式

交互模式是默认入口。非交互模式用于测试和自动化：

```bash
scripts/manage-skills/manage-skills.mjs status \
  --catalog /work/bamhub-ai-tools/skills \
  --target /opt/data/dsh/skills \
  --json

scripts/manage-skills/manage-skills.mjs plan \
  --catalog /work/bamhub-ai-tools/skills \
  --target /opt/data/dsh/skills \
  --enable brainstorming,playbook-design

scripts/manage-skills/manage-skills.mjs apply \
  --catalog /work/bamhub-ai-tools/skills \
  --target /opt/data/dsh/skills \
  --enable brainstorming,playbook-design \
  --yes
```

`--non-interactive` 没有 `--yes` 时失败，避免隐式修改。失效链接清理必须显式使用 `--prune-broken`。参数模式与交互模式共用同一组 `lib` 逻辑。

## 12. DSH Pod 适配

bamhub 仓库固定放置在 `/work/bamhub-ai-tools` 只是部署约定，不是脚本硬编码要求。运行时：

```bash
kubectl --context home-pc-loc -n tools exec -it deploy/ai-dsh-web -- \
  /work/bamhub-ai-tools/scripts/manage-skills/manage-skills
```

脚本会检测：

```text
catalog candidate: /work/bamhub-ai-tools/skills
DSH target: /opt/data/dsh/skills
```

`/opt/data/dsh/skills` 和 `/work/bamhub-ai-tools/skills` 都位于现有 PVC 的 `home`、`work` 子路径中。Pod 重启不会丢失软链接，也不需要 initContainer 重建。上游同步只改变 catalog 内容；新增或取消暴露由本工具管理。

当前 Kubernetes Deployment 不需要增加 PVC、volumeMount、环境变量、initContainer、镜像内容或 DSH 插件。只需在 `home-k3s-pc/tools/ai-dsh/README.md` 中补充使用说明和持久化边界。

## 13. 测试与验收

测试使用 Node 内置 `node:test`，所有测试使用临时目录，不触碰真实用户目录：

- catalog 递归扫描、frontmatter、非法名称和重名；
- 有效软链接、失效软链接、外部软链接、实体文件和实体目录；
- 路径边界、空格路径、相对路径和跨平台路径；
- 创建、保持、删除、冲突保护和失效链接清理；
- DSH/Codex/Claude 运行时目录识别；
- 交互取消、非 TTY、确认和执行后复核；
- JSON 状态输出和参数模式。

本地验证：

```bash
node --check scripts/manage-skills/manage-skills.mjs
node --test scripts/manage-skills/tests/*.test.mjs
```

然后运行仓库已有测试命令，并根据实际匹配文件验证，不臆造不存在的命令。

Pod 验收先使用临时 catalog 和 `/tmp` target 执行 `status --json`、创建、删除和复核，不直接修改 `/opt/data/dsh/skills`。确认工具能在真实 Pod 中运行后，再通过交互向导管理生产 DSH 全局目录：

```bash
kubectl --context home-pc-loc -n tools exec deploy/ai-dsh-web -- \
  dsh --dump-config

kubectl --context home-pc-loc -n tools exec deploy/ai-dsh-web -- \
  find /opt/data/dsh/skills -maxdepth 1 -type l -print
```

最终确认目标项是软链接，且：

```bash
test -f /opt/data/dsh/skills/<skill-name>/SKILL.md
```

## 14. 决策摘要

```text
实现位置：scripts/manage-skills/
实现语言：Node.js 原生模块
默认入口：交互式向导
catalog：用户确认，默认从脚本位置推导
DSH 目标：$DSH_HOME/skills
Codex 目标：$HOME/.agents/skills
Claude 目标：$HOME/.claude/skills
链接类型：相对软链接
源文件：不复制、不修改
保护对象：实体文件、实体目录、外部软链接
持久化：复用现有 DSH PVC，不新增挂载
```
