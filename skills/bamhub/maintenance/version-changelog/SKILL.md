---
name: "version-changelog"
description: "自动记录版本变更，更新 CHANGELOG.md 文件。当需要发布版本或记录版本变更时调用。"
keywords: ["版本变更", "CHANGELOG", "版本号", "发布", "版本管理"]
categories: ["开发工具", "版本管理", "文档管理"]
examples:
  - scenario: 记录版本变更
    input: "记录当前分支的版本变更"
    output: "已更新 CHANGELOG.md 文件"
  - scenario: 发布版本
    input: "准备发布新版本"
    output: "已生成版本变更描述，更新 CHANGELOG.md，并更新版本号"
---

# 版本变更记录 Skill

## 技能功能

本技能用于自动化版本变更记录流程，主要功能包括：

1. **分析分支差异**：分析当前功能分支与 master 分支之间的差异
2. **生成变更描述**：根据提交信息和变更文件自动生成版本变更描述
3. **更新 CHANGELOG.md**：在 CHANGELOG.md 文件中插入新的版本记录

## 调用时机

在以下情况下调用本技能：

- 准备发布新版本时
- 完成功能开发需要记录变更时
- 需要更新项目版本号时
- 合并到 master 分支前需要记录变更时

## 执行流程

### 1. 环境检查

#### 1.1 确认项目根目录

确保当前工作目录为项目根目录：

- 项目根目录：`/Users/maomao/Documents/workspace/my-project/bamboo-cloud`
- 验证方法：检查是否存在 pom.xml 文件

**验证命令**：
```bash
ls -la pom.xml
```

如果 pom.xml 不存在，提示用户切换到项目根目录。

#### 1.2 确认当前分支

检查当前分支名称：

- 获取当前分支：`git branch --show-current`
- 验证：不在 master 分支上执行

**验证命令**：
```bash
git branch --show-current
```

如果当前分支是 master，提示用户切换到功能分支。

#### 1.3 确认 git 状态

检查是否有未提交的更改：

- 执行：`git status --porcelain`
- 如果有未提交的更改，提示用户先提交或暂存

**验证命令**：
```bash
git status --porcelain
```

如果输出不为空，提示用户先提交更改或使用 `git stash` 暂存。

### 2. 分析分支差异

#### 2.1 获取提交列表

获取当前分支相对于 master 的所有提交：

**命令**：
```bash
git log --pretty=format:"%h - %s" master..HEAD
```

**输出示例**：
```
83d57eeb - modify
172ebeb1 - log
2a9049a5 - version
e6496fbe - modify: 支持 html 结果解析
f7f9301b - feat: 增加支持 Html 页面内容提取
```

#### 2.2 获取变更文件

获取变更的文件列表：

**命令**：
```bash
git diff --name-only master...HEAD
```

**输出示例**：
```
bamboo-biz/bamboo-biz-data-reader/...
bamboo-framework/bamboo-common/...
```

筛选业务模块文件：bamboo-biz、bamboo-framework、bamboo-system

#### 2.3 分析变更模块

根据变更文件确定涉及的模块：

- 提取模块名称：从文件路径中提取模块名
- 例如：`bamboo-biz/bamboo-biz-data-reader/...` → `bamboo-biz-data-reader`

**提取规则**：
- 从文件路径中提取第二级目录名
- 例如：`bamboo-biz/bamboo-biz-data-reader/src/...` → `bamboo-biz-data-reader`

### 3. 生成变更描述

#### 3.1 分类变更

根据提交信息分类变更类型：

**分类规则**：

| 变更类型 | 关键词 |
|---------|--------|
| 新特性&优化 | feat、新增、支持、add、feature |
| Bug修复 | fix、修复、解决、bug、resolve |
| 其他 | 其他所有提交 |

#### 3.2 生成描述文本

根据提交信息生成描述：

**格式规则**：
- 格式：`【模块名】描述内容`
- 如果提交信息包含模块名，则使用提交信息
- 如果提交信息不包含模块名，则从变更文件推断模块名

**示例**：
- 提交信息：`feat: 增加支持 Html 页面内容提取`
- 变更文件：`bamboo-biz/bamboo-biz-data-reader/...`
- 模块名：`bamboo-biz-data-reader`
- 生成描述：`【bamboo-biz-data-reader】增加支持 Html 页面内容提取`

#### 3.3 确认变更内容

向用户展示生成的变更描述：

1. 显示分类后的变更列表
2. 询问用户是否需要修改或补充
3. 支持用户手动编辑变更描述

**确认方式**：
使用 AskUserQuestion 工具询问用户是否需要修改变更描述。

### 4. 更新 CHANGELOG.md

#### 4.1 读取现有 CHANGELOG.md

读取文件内容：

- 文件路径：`/Users/maomao/Documents/workspace/my-project/bamboo-cloud/doc/CHANGELOG.md`

#### 4.2 准备新版本条目

生成新的版本条目：

- 获取当前日期：`date +%Y-%-m-%-d`（格式：YYYY-M-D）
- 分隔线：`-------------------------------------------------------------------------------------------------------------`（109 个 `-` 字符）
- 版本标题：`# YYYY-M-D`

**示例**：
```
-------------------------------------------------------------------------------------------------------------
# 2026-3-9
```

#### 4.3 插入新版本条目

在文件开头插入新版本条目：

- 位置：在第 2 行之后（标题和空行之后）
- 格式：
  ```
  -------------------------------------------------------------------------------------------------------------
  # YYYY-M-D

  ### 🐣新特性&优化
  * 【模块名】描述内容

  ### 🐞Bug修复
  * 【模块名】描述内容
  ```

**插入位置**：
- CHANGELOG.md 文件通常以项目标题开头
- 在标题和空行之后插入新版本条目

#### 4.4 验证更新

确认 CHANGELOG.md 更新成功：

1. 检查文件是否存在
2. 检查新版本条目是否正确插入

**验证命令**：
```bash
head -n 20 doc/CHANGELOG.md
```

### 5. 提供反馈

#### 5.1 总结变更

向用户展示完整的变更摘要：

1. 显示更新的 CHANGELOG.md 条目
2. 显示更新的文件

#### 5.2 提示后续操作

提醒用户后续步骤：

1. 提交变更到 git
2. 推送到远程仓库
3. 合并到 master 分支

**后续操作命令**：
```bash
git add doc/CHANGELOG.md pom.xml bamboo-dependencies/pom.xml
git commit -m "docs: 更新版本变更记录和版本号"
git push
```

## 工具特性

本技能使用以下工具：

- **Bash**：执行 git 命令、脚本执行、文件操作
- **Read**：读取 CHANGELOG.md、pom.xml 等文件
- **Write**：写入更新后的 CHANGELOG.md
- **Edit**：编辑文件内容
- **AskUserQuestion**：询问用户确认和输入

## 注意事项

### 执行前检查

1. **必须在项目根目录执行**：所有操作必须在项目根目录执行
2. **不在 master 分支执行**：本技能不在 master 分支上执行
3. **先提交更改**：执行前确保所有更改已提交

### 格式要求

1. **日期格式**：CHANGELOG.md 使用 YYYY-M-D 格式（月和日不带前导零）
2. **版本号格式**：版本号格式为 YYYY.M.D.X-snapshot（月和日不带前导零）
3. **分隔线长度**：分隔线长度为 109 个 `-` 字符
4. **模块名称**：模块名称要准确，使用项目中的实际模块名
5. **描述内容**：描述内容要简洁明了，突出重点

### 其他注意事项

- 确保有足够的文件权限
- 确保脚本有执行权限
- 确保网络连接正常（如果需要推送）

## 示例命令

### 完整执行流程

```bash
# 1. 确认当前目录
pwd
# 输出：/Users/maomao/Documents/workspace/my-project/bamboo-cloud

# 2. 确认当前分支
git branch --show-current
# 输出：feature/T-0223

# 3. 确认 git 状态
git status --porcelain
# 输出：（空）

# 4. 获取提交列表
git log --pretty=format:"%h - %s" master..HEAD

# 5. 获取变更文件
git diff --name-only master...HEAD

# 6. 提交变更
git add doc/CHANGELOG.md
git commit -m "docs: 更新版本变更记录"
```

## 错误处理

### 常见错误及解决方法

#### 1. 不在项目根目录

**错误信息**：`找不到 pom.xml 文件`

**解决方法**：
```bash
cd /Users/maomao/Documents/workspace/my-project/bamboo-cloud
```

#### 2. 在 master 分支执行

**错误信息**：`当前在 master 分支，无法执行版本变更记录`

**解决方法**：
```bash
git checkout -b feature/new-feature
```

#### 3. 有未提交的更改

**错误信息**：`存在未提交的更改，请先提交或暂存`

**解决方法**：
```bash
# 提交更改
git add .
git commit -m "commit message"

# 或暂存更改
git stash
```

#### 4. 没有分支差异

**错误信息**：`当前分支与 master 分支没有差异`

**解决方法**：
- 确认当前分支有提交
- 检查是否在正确的分支上
- 检查是否已经合并到 master

#### 5. CHANGELOG.md 不存在

**错误信息**：`找不到 CHANGELOG.md 文件`

**解决方法**：
- 确认文件路径正确
- 或创建 CHANGELOG.md 文件


## 变更描述生成规则

### 提交信息解析

1. **提取提交类型**：从提交信息中提取类型标识
    - `feat:` → 新特性
    - `fix:` → Bug修复
    - `optimize:` → 优化

2. **提取提交内容**：从提交信息中提取实际内容
    - 去除类型标识
    - 去除冒号和空格

3. **提取模块名**：从变更文件中提取模块名
    - 从文件路径中提取第二级目录名
    - 例如：`bamboo-biz/bamboo-biz-data-reader/...` → `bamboo-biz-data-reader`

### 描述生成

1. **标准格式**：`【模块名】描述内容`
2. **简化格式**：如果提交信息已经包含模块名，直接使用提交信息
3. **完整格式**：`【模块名】提交类型：描述内容`

**示例**：

| 提交信息 | 变更文件 | 生成的描述 |
|---------|---------|-----------|
| `feat: 增加支持 Html 页面内容提取` | `bamboo-biz/bamboo-biz-data-reader/...` | `【bamboo-biz-data-reader】增加支持 Html 页面内容提取` |
| `fix: 修复数据解析错误` | `bamboo-framework/bamboo-common/...` | `【bamboo-common】修复数据解析错误` |
| `optimize: 优化缓存性能` | `bamboo-framework/bamboo-framework-cache/...` | `【bamboo-framework-cache】优化缓存性能` |

## 相关技能

以下技能可能与本技能配合使用：

- **commit**：提交代码变更
- **review-pr**：审查 Pull Request
- **planning-with-files**：文件式规划

## 验证方法

### 1. 检查 Skill 文件是否正确创建

```bash
ls -la .trae/skills/版本变更记录/
```

预期输出：
```
total 8
drwxr-xr-x  3 user  staff    96 Mar  9 10:00 .
drwxr-xr-x  4 user  staff   128 Mar  9 10:00 ..
-rw-r--r--  1 user  staff  8192 Mar  9 10:00 SKILL.md
```

### 2. 检查 CHANGELOG.md 是否包含新的版本记录

```bash
head -n 20 doc/CHANGELOG.md
```

预期输出：
```
# Bamboo Cloud 变更日志

-------------------------------------------------------------------------------------------------------------
# 2026-3-9

### 🐣新特性&优化
* 【bamboo-biz-data-reader】增加支持 Html 页面内容提取

### 🐞Bug修复
* 【模块名】描述内容
```

## 总结

本技能提供了一个完整的版本变更记录流程，自动化了以下任务：

1. 分析分支差异
2. 生成变更描述
3. 更新 CHANGELOG.md

通过使用本技能，可以简化版本发布流程，确保版本变更记录的准确性和一致性。