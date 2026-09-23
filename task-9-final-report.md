# Task 9 最终验证报告

## 本地验证

工作树：`codex/manage-skills`

通过：

```text
node --check scripts/manage-skills/manage-skills.mjs
node --check scripts/manage-skills/lib/*.mjs
node --check scripts/manage-skills/tests/*.test.mjs
sh -n scripts/manage-skills/manage-skills
test -x scripts/manage-skills/manage-skills
git diff --check
```

测试结果：

```text
manage-skills tests: 128 passed, 0 failed
bamhub JavaScript tests: 101 passed, 0 failed
bamhub project ESM tests: 45 passed, 0 failed
bamhub skill-layout tests: 11 passed, 0 failed
```

合计：`285` 项通过，`0` 失败。既有 Node `MODULE_TYPELESS_PACKAGE_JSON` warning 不影响退出码和测试结果。

## 真实 Pod 探针

macOS 本机执行临时 probe 时，使用 canonical `/private/tmp`（不要直接使用会经过 symlink 的 `/tmp`）；Pod Linux 环境可继续使用 `/tmp`。以下命令是在 Pod Linux 中执行，因此保留 `/tmp` 路径。

Pod：`home-pc-loc/tools/ai-dsh`，container：`ai-dsh`。

真实 checkout：`/work/bamhub-other/bamhub-ai-tools`，由 Pod 内现有 PVC 的 `/work` 子路径提供；工具通过显式 `--catalog` 使用该路径，不依赖固定 `/work/bamhub-ai-tools`。

### Catalog status

命令：

```bash
node /tmp/manage-skills/manage-skills.mjs status \
  --catalog /work/bamhub-other/bamhub-ai-tools/skills \
  --target /tmp/dsh-skill-test \
  --json
```

结果：

```text
exitCode: 0
catalog.invalid: []
catalog.duplicates: test-driven-development（仅报告，不阻断）
target: target-missing
```

### 临时 target 生命周期

使用实际 Pod Node runtime 和 `/tmp/manage-skills` 临时脚本副本验证：

1. `apply --enable bamhub/architecture/playbook-design --yes --json` 成功；
2. 自动创建缺失 `/tmp/dsh-skill-test`；
3. 创建相对软链接：
   `/tmp/dsh-skill-test/playbook-design -> ../../work/bamhub-other/bamhub-ai-tools/skills/bamhub/architecture/playbook-design`；
4. `test -L`、`readlink`、`test -f .../SKILL.md` 全部通过；
5. `apply --disable-all --yes --json` 成功 quarantine/remove；
6. `/tmp/dsh-skill-test`、临时 state 和脚本副本均清理完成。

临时 custom target 第一次探针发现 Pod 的 `/home/dsh/.local/state` 不可写；随后使用 `XDG_STATE_HOME=/tmp/manage-state` 重跑成功。这是 Pod 用户目录权限事实，不影响 DSH runtime state root（`$DSH_HOME/.manage-skills`）设计。

## DSH runtime gate

真实执行：

```bash
dsh --profile web --dump-config
```

当前 Pod 输出确认：

```text
skill-filesystem disabled: true
tool-skill disabled: true
```

因此本次只能证明：

- catalog 能在真实 Pod 中解析；
- 脚本能在真实 Pod Node runtime 中执行；
- missing target、relative symlink、manifest/quarantine 生命周期有效；
- 生产 `/opt/data/dsh/skills` 未被修改；

不能宣称当前 DSH Web 已发现或加载全局 skill。临时 patch 探针确认以下 overlay 可以使 composed config 显示：

```text
skill-filesystem disabled: false
tool-skill disabled: false
```

但这只是 config merge 证据，不是实际 Web session discovery 证据。正式启用 active preset/provider 并完成实际 Web session discovery 仍是独立运行时 gate。

## Final review 修复补充

- 修正真实 CLI 入口的 script-relative catalog 根目录（`scripts/manage-skills/manage-skills.mjs` 向上两级）。
- 交互式 catalog 缺失时通过 `session.line` 请求路径，并把路径传入 resolver 重新确认/扫描；覆盖 TTY 与 non-TTY 注入测试。
- 增加 `recover --state-root <path> --journal <path> [--json]`，复用 `recoverJournal`，按 0/1/2 映射成功、恢复失败、参数错误。
- `validateTarget` 统一使用 `stateRootForTarget` 并传递 env/home；manifest closed schema 校验 kebab、唯一 linkName 与相对路径。
- transaction apply 在每次 source identity recheck 时重新扫描 bundle nested symlink 的 catalog boundary；quarantine 创建改为初始 journal 落盘后，journal 初始化失败时仅清理 marker-owned quarantine。
- recover CLI 明确只允许 `--state-root`、`--journal`、`--json`；custom target selector 按实际目录存在状态报告 `exists`。
- 同步脚本 README 与 manage-skills 计划说明；未修改 maomao-deploy YAML。

本次 final-review focused tests：`123 passed, 0 failed`；本轮新增回归测试覆盖 nested bundle symlink、state-root failure、recover 非允许参数与 custom target status。

## 工作树

最终实现工作树无未提交代码变更；运行时临时文件未提交。