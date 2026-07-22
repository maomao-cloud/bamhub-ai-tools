---
description: 生成并更新版本变更日志（默认 master..HEAD 到 doc/CHANGELOG.md）
---

# /version-changelog

根据当前分支相对 `master` 的差异，生成规范化版本变更描述并更新 `doc/CHANGELOG.md`。

## 默认行为

- 比较范围：`master..HEAD`
- 输出文件：`doc/CHANGELOG.md`
- 目标：保持与历史 version-changelog skill 的生成语义一致

## 执行流程

1. 环境检查
   - 确认在项目根目录（存在 `pom.xml`）
   - 检查当前分支（不在 `master` 上执行）
   - 检查工作区状态（建议先提交或暂存未提交改动）

2. 差异采集
   - 提交列表：`git log --pretty=format:"%h - %s" master..HEAD`
   - 文件列表：`git diff --name-only master...HEAD`
   - 识别涉及模块（优先从 `bamboo-biz` / `bamboo-framework` / `bamboo-system` 路径提取）

3. 分组摘要
   - 按提交关键词分类：
     - `新特性&优化`：`feat`、`新增`、`支持`、`add`、`feature`
     - `Bug修复`：`fix`、`修复`、`解决`、`bug`、`resolve`
     - 其他提交并入 `新特性&优化`（保持简化输出）

4. 生成段落
   - 日期格式：`YYYY-M-D`
   - 段落格式：
     - 分隔线（109 个 `-`）
     - `# YYYY-M-D`
     - `### 🐣新特性&优化`
     - `### 🐞Bug修复`
   - 条目格式：`* 【模块名】描述内容`

5. 写入与回显
   - 将新版本段落插入 `doc/CHANGELOG.md` 标题后
   - 若无差异，返回“无可记录变更”，不写入文件
   - 回显本次写入摘要与目标文件路径

## 使用示例

- `/version-changelog`
- `请执行 /version-changelog`

## 说明

当前为最小可用版本，不引入额外参数。
如需自定义 `base/head/output/preview`，可在后续增强。