# 同步输出中文化设计

## 目标与边界

将 Bamhub 生成的同步 README 和项目级 `sync-upstream-skills` 说明改为中文，方便本仓库使用者阅读。`skills/superpowers/` 仍是上游 `obra/superpowers` 的可替换镜像：其中的 `SKILL.md`、引用文件和原始英文描述绝不直接翻译或改写。

## 生成 README

同步器继续从当前上游 skill 集合读取名称和原始描述，但在生成目标根目录的 README 时使用中文标题、来源元数据标签、使用方法、适用场景和通用流程。Superpowers 的已知 skill 由项目级中文展示映射提供简短描述；该映射属于 Bamhub 同步器，而不是上游镜像。

若某个来源新增 skill 或未来来源没有中文映射，README 显示中文兜底说明：提示使用者阅读对应 `SKILL.md` 获取完整用法。这样每次同步都生成中文导览，同时无需 AI 服务、额外同步状态或修改上游内容。

## 项目级说明与兼容性

`skills/project/sync-upstream-skills/SKILL.md` 全文使用中文，命令、来源 ID、JSON `status` 值和错误代码保持原样，避免破坏脚本接口与自动化。README 的来源 URL、commit 和 skill 目录名也保持原值。

不再维护 `skills/brainstorming/visual-companion.md` 旧路径兼容别名。该路径不属于分类后的目录结构，也不由同步器管理；上游镜像内对该旧路径的引用保留原样，但本仓库不提供本地重定向。`AGENTS.md` 和布局测试必须明确该旧平级路径不存在。

测试验证中文 README 包含中文栏目和已知 skill 的中文描述，未知 skill 走中文兜底，并确认 `skills/superpowers/**` 除同步器管理的 README 外没有本地内容修改；同时确认旧 brainstorming 兼容路径不存在且没有重复的本地 skill 内容。
