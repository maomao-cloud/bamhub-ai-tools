# manage-skills 软链接管理器设计

**日期：** 2026-09-20  
**项目：** `bamhub-ai-tools`  
**状态：** 交叉审查修订版，待再次审阅

## 1. 背景

`bamhub-ai-tools/skills/` 按所有权、来源和上游同步需求组织，便于维护，但运行时 skill 目录要求每个 skill 是目标目录的直接子目录：

```text
<skill-root>/<skill-name>/SKILL.md
```

本功能提供一个独立工具：从用户确认的 catalog 中选择 skill，以相对符号链接暴露到全局运行时目录。真实 `SKILL.md` 和资源文件始终留在 catalog 中，运行时目录不复制 skill 内容。

本设计基于对当前 DSH Pod 的真实检查修订：

- 当前 Pod 的 bamhub checkout 实际路径为 `/work/bamhub-other/bamhub-ai-tools`，路径不是部署契约；
- 当前 Pod 的 `/opt/data/dsh/skills` 尚不存在，但它位于现有 PVC 的 `home` 子路径中，创建后可持久化；
- 当前 Web profile 的 host 层 `skill-filesystem` 和 `tool-skill` 在 `dsh --profile web --dump-config` 中显示为 `disabled: true`；
- 因此不能仅凭创建 `/opt/data/dsh/skills` 就声称当前 DSH Web 会发现或加载 skill，必须先通过运行时 gate 验证 active agent preset/skill provider，必要时另行设计 DSH profile patch。

## 2. 目标

- 在 `bamhub-ai-tools` 内提供独立的 `manage-skills` 工具，全部代码、模块、测试和工具文档内聚于 `scripts/manage-skills/`。
- 默认从工具所在仓库推导 `skills/`，但不硬编码 `/work/bamhub-ai-tools`。
- 如果默认 catalog 不存在、不可读或用户不接受，交互式要求用户指定 catalog。
- 支持 DSH、Codex、Claude Code 和经过“全局目录”校验的自定义目标目录。
- 默认以交互式向导完成环境扫描、catalog 确认、目标确认、状态扫描、选择、预览、确认、执行和复核。
- 只创建和删除软链接，不复制、修改或删除源 skill 文件。
- 只有 manifest 明确记录且二次校验匹配的软链接才允许删除；没有 manifest 的现有软链接默认只读保护。
- 使用相对软链接，并防止 catalog/target 重叠、父级软链接越界和竞态替换。
- DSH 目标复用现有 `$DSH_HOME/skills` PVC 路径，不新增 PVC、挂载、`DSH_AGENTS_HOME`、initContainer、镜像内容或 DSH 插件。
- 提供非交互参数模式用于测试、自动化和故障恢复。

## 3. 非目标

- 不开发 DSH 插件。
- 不自动启用或修改 DSH 的 `skill-filesystem`、`tool-skill` 或 agent preset；当前 DSH Web 的 skill provider gate 是独立的运行时适配事项。
- 不修改 skill 内容、frontmatter 或上游同步逻辑。
- 不管理项目级 `.agents/skills` 或 `.claude/skills`。
- 不删除没有本工具 manifest 记录的软链接，即使它指向当前 catalog。
- 不自动 clone、pull、fetch、checkout、reset 或更新 skill catalog。
- 不在 Pod 启动链路中自动重建软链接。

## 4. 全局运行时目录

| 运行时 | 默认目标目录 | 检测方式 |
|---|---|---|
| DSH | `$DSH_HOME/skills` | 优先使用 `DSH_HOME`；未设置时仅将 `$HOME/.dsh/skills` 作为待确认 fallback |
| Codex | `$HOME/.agents/skills` | 用户级 Agent Skills 目录 |
| Claude Code | `$HOME/.claude/skills` | Claude Code 用户级 skills 目录 |
| 自定义 | 用户输入的全局目录 | 通过全局边界校验后才能选择 |

DSH 自身可能还扫描 project `.dsh/skills`、project `.agents/skills`、custom provider 和 `$DSH_AGENTS_HOME/skills`。本工具只管理上表中的全局目标，不管理 DSH 可见范围内的所有 skill 来源。

### 4.1 自定义目录的全局边界

自定义目标不能位于 Git 工作树内部，也不能是项目级 `.agents/skills` 或 `.claude/skills`。脚本解析目标路径和其现有祖先：

- 目标或祖先存在于包含 `.git` 的工作树内：拒绝；
- 目标、catalog 或其父级是软链接：先解析 canonical path 并保存 identity；无法安全解析时拒绝；
- target 与 catalog 相等、互为祖先/后代或 canonical path 重叠：拒绝；
- target 不存在时，只允许创建最后一层目录，不能自动创建缺失的父链或跟随软链接父级。

标准 DSH/Codex/Claude 目标按运行时契约解析，不通过 custom 例外绕过这些边界。

## 5. Catalog 选择与 checkout 前置条件

优先级如下：

1. 显式参数 `--catalog <path>`：路径无效或不是目录时直接报错，不回退到其他候选；
2. 环境变量 `MANAGE_SKILLS_CATALOG`：路径无效时直接报错，不回退；
3. 从脚本位置推导 `<repository-root>/skills`：不存在时只作为缺失候选，不自动创建；
4. 交互式输入路径。

默认候选必须经过用户确认；显式参数和环境变量在非交互模式下视为明确选择。交互输入必须验证为可读目录；工具不负责 clone 或同步。

在 DSH Pod 中，现有 Deployment 只将 PVC 的 `work` 子目录挂载为 `/work`，不会自动提供 bamhub checkout。使用前由人工把 checkout 放到 `/work` PVC 中，例如当前环境可使用：

```text
/work/bamhub-other/bamhub-ai-tools
```

但工具不能把该路径当成固定默认值。执行前必须验证：

```bash
git -C <checkout> rev-parse --show-toplevel
test -d <checkout>/skills
git -C <checkout> status --short
```

未确认的工作树修改、缺少 `skills/` 或无法确定 commit 时，工具停止。

一次运行只使用一个 catalog 根目录，以便明确 manifest 归属和避免跨仓库同名混合。

## 6. Catalog 扫描与有效 skill

工具递归查找 catalog 下的 `SKILL.md`，但 runtime 暴露时只链接 skill bundle 的直接目录，不把 catalog 多层目录整体链接过去。

每个候选必须满足：

- `SKILL.md` 是 regular file，不是软链接；
- bundle 目录 canonical path 位于 catalog canonical root 内；
- `SKILL.md` canonical path 位于 bundle 内且仍位于 catalog 内；
- frontmatter 使用 `---` 包围；
- v1 只解析顶层单行 `name:` 和 `description:`，值可用单/双引号包裹；多行、嵌套、重复关键字段和缺失必填字段报告为 invalid；
- `name` 只允许小写字母、数字和连字符，不以连字符开头或结尾；
- bundle 内若存在软链接，解析后不得逃出 catalog；逃逸资源报告为 invalid，不得暴露。

有效记录：

```js
{
  name,
  description,
  sourceDir,
  skillFile,
  relativeSource,
  sourceIdentity: { dev, ino }
}
```

同名 skill 不自动选择。v1 支持结构化 selector：

```js
{
  name: 'brainstorming',
  source: 'skills/superpowers/brainstorming',
  linkName: 'brainstorming'
}
```

`linkName` 可选；缺省使用 `name`。`linkName` 必须是合法 skill 名称且在同一 target 内唯一。源路径必须是当前 catalog 内某个有效 skill 的 `relativeSource`，不能只传一个模糊名称。

## 7. Manifest、归属和安全删除

不再根据“软链接目标位于 catalog 内”推断归属。每个 target 使用独立 manifest，manifest 存放在 target 外部的 state 目录：

- DSH：`$DSH_HOME/.manage-skills/targets/`；
- Codex/Claude：`$XDG_STATE_HOME/manage-skills/`，未设置时使用 `$HOME/.local/state/manage-skills/`；
- custom：使用同一 state 根，但 target identity 作为文件名哈希的一部分。

Manifest 记录：

```js
{
  version: 1,
  target: { path, dev, ino },
  catalog: { path, dev, ino, gitRemote, gitCommit },
  links: [
    {
      linkName,
      sourceRelative,
      sourceIdentity: { dev, ino },
      relativeTarget,
      createdAt
    }
  ]
}
```

规则：

- manifest 不放进 skill root，不会被任何 runtime 当成 skill；
- manifest 缺失、catalog identity 不匹配或 target identity 不匹配时，只允许 status/plan，禁止自动删除；
- 现有未登记软链接显示为 `unmanaged-symlink`，不覆盖、不删除；v1 不提供接管流程，用户需要自行处理后再重新生成 manifest-owned link；
- 失效链接只有在 manifest 记录、link path 匹配且 lexical target 与记录匹配时才可进入 quarantine；
- 删除前必须二次 `lstat`，并校验 dev/ino、类型和 link target 均与 plan 快照相同；否则标记 conflict，停止该 target 的删除。

## 8. 变更计划、锁和恢复

计划模型：

```js
{
  target: { path, dev, ino },
  catalog: { path, dev, ino, gitCommit },
  desired: [{ name, sourceRelative, linkName }],
  create: [{ linkPath, sourceDir, relativeTarget, sourceIdentity }],
  remove: [{ linkPath, relativeTarget, manifestEntry }],
  keep: [{ linkPath, relativeTarget }],
  conflicts: [{ linkPath, kind, reason }],
  protected: [{ linkPath, kind, reason }],
  fingerprint
}
```

一个 `PlanSet` 包含多个 target 的 plan。执行前必须重新扫描 catalog、manifest 和所有 target；fingerprint 或 identity 变化时拒绝执行并要求重新生成计划。

每个 target 使用 state 目录下的原子 lock。已有 lock 必须显示 owner/time；过期 lock 不自动抢占，用户需要显式清理。

应用顺序：

1. 所有 target 预检和加锁完成后才开始变更；
2. 对每个 target 重新校验 source/target identity；
3. 创建新软链接；
4. 删除项先 rename 到 state quarantine，不直接 unlink；
5. 原子写入 manifest；
6. 重新扫描和验证；
7. 验证成功后清理 quarantine；
8. 任何失败留下 journal/quarantine，并输出可恢复状态，不声称全部成功。

多 target 不是跨目录事务，但必须输出每个 target 的独立结果；本次创建项可在失败时按 journal 回滚，已 quarantine 的删除项保留，不自动永久删除。

## 9. 交互流程

默认执行：

```bash
scripts/manage-skills/manage-skills
```

固定顺序：

1. 扫描 DSH/Codex/Claude 和已有 custom 候选；
2. 确认 catalog（或输入路径）；
3. 扫描有效/invalid/duplicate skill；
4. 选择要管理的全局目标目录；
5. 读取 target 状态和 manifest；
6. 选择最终 desired skill 集合；
7. 显示每个 target 的完整 PlanSet：create/remove/keep/conflicts/protected；
8. 用户二次确认；确认前不得 mkdir、写 manifest、创建/删除软链或获取写锁；
9. 加锁并执行；
10. 复核并显示每个 target 的结果。

交互必须在 `try/finally` 中恢复 terminal raw mode、关闭 readline、处理 EOF/SIGINT/SIGTERM。非 TTY 不进入交互模式。

## 10. 参数模式

非交互模式必须明确 desired-state 输入：

- `status`：只读；
- `plan --enable <selector,...>`：生成计划，不修改；
- `apply --enable <selector,...> --yes`：把 selector 集合当作最终 desired 集合并执行；
- `apply --disable-all --yes`：显式清空当前 manifest 管理的链接；
- `--catalog` 与 `--runtime`/`--target` 的优先级和冲突必须明确：`--target` 表示单个 custom target，不能与 `--runtime` 同时使用；`--runtime` 可重复，`all` 只展开用户明确确认且可解析的标准目录；
- 无 `--yes` 的 `apply` 不得在 `--non-interactive` 下执行；
- JSON 模式 stdout 只输出一个 schema 对象，诊断写 stderr。

`--enable` selector 使用：

```text
name
name=alias
source/relative/path
source/relative/path=alias
```

逗号分隔项必须 trim，空项报错；不支持隐式通配和模糊名称。manifest 不作为用户输入格式，避免另造一套 selector 解析；状态 manifest 只由工具写入。

## 11. DSH Pod 运行时 gate

当前真实 Pod 的 `dsh --profile web --dump-config` 显示 host `skill-filesystem` 和 `tool-skill` disabled。因而 `/opt/data/dsh/skills` 的持久化和软链接测试不能等同于 DSH Web 已经发现 skill。

生产验收前必须完成独立 gate：

1. 确定当前 active agent preset 是否挂载 filesystem provider；
2. 如果没有，单独设计并验证 profile patch/配置，使 `skill-filesystem` 和 `tool-skill` 在目标 preset 中启用；
3. 用一个受控 skill 在实际 Web session/agent invocation 中验证可见和可加载；
4. 对 symlink 指向的 catalog 做 controlled mutation probe，验证 frontmatter/目录变化是否被 watcher 感知；不能仅凭 `followSymlinks` 文档推断。

在 gate 未通过时，manage-skills 仍可以作为安全的持久化软链接管理器运行，但不得宣称 DSH Web 已支持这些链接。

## 12. DSH PVC 与同步职责

现有映射：

```text
/www/data/dsh/home/ -> /opt/data/dsh/
/www/data/dsh/work/ -> /work/
```

因此 DSH link root 为 `/opt/data/dsh/skills`，catalog checkout 必须位于 `/work` 下，具体路径由用户确认。Pod 重启只保证 PVC 内已存在的 link 和 checkout 持久化；不会自动 clone、pull、rollout 或更新 catalog。

运行顺序：

1. 人工把 catalog checkout 放入 `/work` PVC，并确认 Git commit；
2. 必要时按既有 ai-dsh 运维流程人工升级镜像；
3. Pod Ready 后执行 `/tmp` 非生产 probe；
4. 生成并审阅生产 PlanSet；
5. 用户确认后 apply；
6. 完成 link、source 和实际 DSH runtime gate 验证。

当前 manage-skills 功能不修改 Kubernetes YAML。部署运维说明补充到 `maomao-deploy/home-k3s-pc/tools/ai-dsh/README.md`，且与 bamhub 工具文档分仓提交。

## 13. 测试与验收

测试全部使用临时目录和可注入 IO，不触碰真实用户目录：

- catalog 递归扫描、frontmatter 边界、非法名称、重复/alias selector；
- sourceDir/SKILL.md regular-file 和 bundle 内 symlink 逃逸；
- catalog/target 相等、祖先/后代、symlink ancestor、Git worktree project target；
- valid、broken、foreign、unmanaged、regular file、regular directory；
- manifest 缺失/identity 不匹配/路径替换；
- target lock、source replacement、link replacement、并发 apply；
- quarantine、journal、失败恢复和多 target partial result；
- DSH fallback、Codex/Claude/custom runtime detection；
- selector 缺失、`--disable-all`、`--yes`、JSON stdout/stderr；
- TTY EOF、Esc、Ctrl-C、异常退出后的 raw mode 恢复；
- 预览阶段无 mkdir/写入；
- Pod 真实路径发现、临时 probe、symlink identity 和实际 DSH discovery gate。

最终 DSH 命令必须带 profile、context 和 container：

```bash
kubectl --context home-pc-loc -n tools exec -c ai-dsh deploy/ai-dsh-web -- \
  dsh --profile web --dump-config
```

软链接验收至少同时检查：

```bash
kubectl --context home-pc-loc -n tools exec -c ai-dsh deploy/ai-dsh-web -- \
  sh -c 'test -L /opt/data/dsh/skills/<name> && readlink /opt/data/dsh/skills/<name> && test -f /opt/data/dsh/skills/<name>/SKILL.md'
```

上述文件检查不能替代实际 DSH Web discovery gate。

## 14. 决策摘要

```text
实现位置：scripts/manage-skills/
实现语言：Node.js 原生模块；可选 POSIX wrapper
默认入口：交互式向导
catalog：用户确认；默认从脚本位置推导
DSH 目标：$DSH_HOME/skills，但当前 Web provider 必须先过 runtime gate
Codex 目标：$HOME/.agents/skills
Claude 目标：$HOME/.claude/skills
链接类型：相对软链接
归属：target 外部 per-target manifest，不凭路径猜测
源文件：不复制、不修改
保护对象：无 manifest 软链、实体文件、实体目录、外部软链
恢复：lock + journal + quarantine
持久化：复用现有 DSH PVC，不新增挂载
```
