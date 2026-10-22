---
name: yunxiao-pipeline
description: 当需要查询云效流水线列表或详情、运行（触发）流水线、重试或停止流水线任务、查看运行状态与构建日志，或排查云效 MCP 返回 403 与"查不到流水线"等问题时使用
---

# 云效流水线

通过云效官方 MCP 的 `pipeline-management` 工具集操作阿里云云效（Yunxiao）流水线。此 skill 只覆盖流水线。

下文所有"实测"结论来自 2026-10-13 至 2026-10-21 的本机会话记录。**token 授权或 MCP 版本变化后这些结论可能失效：任何一条与实际返回不一致时，以实际返回为准，并把这里的结论当作待复核的历史事实，而不是硬规则。**

不适用范围：创建或更新流水线配置、变量组、资源成员、服务连接、主机或 K8s 部署单。其中 `list_service_connections`、`list_resource_members` 实测返回 403；其余接口未在本仓库验证过。需要这些能力时不要在流水线流程里顺手尝试，先单独确认权限。

## 何时使用

- 查询组织下有哪些流水线，或读取某条流水线的配置与详情。
- 运行指定流水线（指定分支、环境变量、备注）。
- 重试失败任务、停止运行中的任务、通过人工卡点。
- 查看运行状态、任务列表与构建日志。
- 云效 MCP 返回 `403: Current token has no permission to api`、空 `items`、"查不到流水线"时定位原因。

## 快速参考

```text
1. get_user_organizations            → 取 organizationId（不要用 get_current_*）
2. smart_list_pipelines              → timeReference="all time"，取 pipelineId
3. get_pipeline                      → 核对 name 与默认分支，确认目标
4. create_pipeline_run               → 返回运行实例 ID（纯数字）
5. get_pipeline_run                  → 轮询到 SUCCESS / FAIL（或到等待上限）
```

## 解析组织

`get_current_user`、`get_current_organization_info` 在本环境长期稳定返回 403（2026-10-13 至 2026-10-21 多次复核均如此），这是 token 的 API 授权范围问题，不代表云效不可用，不要据此判定失败，也不要反复重试。

用 `get_user_organizations` 取组织 ID。它返回 `id` 与 `name` 的列表，按用户给的组织名（如"竹林"）在 `name` 上做精确匹配（先去掉首尾空白；中文名按原样比对，英文名忽略大小写）。用户直接给出组织 ID 时，用该 ID 与返回列表核对一次即可，不要在列表里再找名字。

- 匹配到唯一一条：直接用它。
- 匹配不到，或匹配到多条：把候选的 `name` 与 `id` 列给用户选，不要猜。用户没说组织名时，若当前只有一个组织就直接用；有多个则先问。
- 组织名匹配不上时不要放宽成模糊匹配后就触发流水线——名字错一层就可能跑到别的组织。

调用任何流水线接口都必须显式传入 `organizationId`；接口不会自动推断组织。

## 选择查询接口

| 目标 | 接口 | 说明 |
| --- | --- | --- |
| 列流水线 | `smart_list_pipelines` | **首选**。传 `timeReference: "all time"` 才覆盖全部历史流水线 |
| 列流水线 | `list_pipelines` | 仅在需要按创建/执行时间精确过滤时使用，见下方陷阱 |
| 流水线详情与分支 | `get_pipeline` | 返回 `pipelineConfig.flow`（YAML），可读默认分支与步骤 |
| 最新一次运行 | `get_latest_pipeline_run` | 比 `list_pipeline_runs` 更省参数 |
| 运行记录列表 | `list_pipeline_runs` | 必须带时间范围与筛选，见下方陷阱 |
| 部署任务 | `list_pipeline_jobs_by_category` | `category` 只支持 `DEPLOY` |
| 任务执行历史 | `list_pipeline_job_historys` | 需先从上一步取到 `identifier` |
| 任务与步骤日志 | `get_pipeline_run`、`get_pipeline_job_steps`、`get_pipeline_job_step_log` | 从运行详情取 `jobId`，再取 `stepIndex`/`buildId` |

任务级操作（`retry_pipeline_job_run`、`stop_pipeline_job_run`、`execute_pipeline_job_run`、`pass_pipeline_validate`、`refuse_pipeline_validate`）的入参一致：`organizationId` + `pipelineId` + `pipelineRunId` + `jobId`。这四个 ID 必须全部来自同一个 `get_pipeline_run` 响应，不要混用不同运行实例的 `jobId`。这些接口已存在于工具集，但尚未在本仓库的会话记录中被实际执行过，首次使用前先确认 `jobId` 属于目标运行实例。

## 参数陷阱

这些行为已在真实调用中复现，按此传参可避免"请求成功但没有数据"的误判。

- **`list_pipelines` 的两个结束时间都不能传 `0`。** `createStartTime`/`executeStartTime` 传 `0` 表示不限起始，可以接受；但 `createEndTime` 或 `executeEndTime` 任一个传 `0` 就会整片过滤为空。两个结束时间都要给未来时间戳：`{createStartTime: 0, createEndTime: 2000000000000, executeStartTime: 0, executeEndTime: 2000000000000}`。
- **`list_pipelines` 与 `smart_list_pipelines` 实测 `pagination.total` 恒为 0、`perPage` 恒回显 10**（传 30 也不生效）。判断有无数据只看 `items`，不要看 `total`；`perPage` 不生效但 `page` 有效，翻页靠递增 `page` 观察 `items` 变化。
- **`timeReference` 用相对时间会漏数据。** `today`、`this month` 只覆盖该时间窗内创建的流水线；要全量必须 `"all time"`。该值不在工具 schema 的枚举示例里但已被实际接受；若某次调用对它报参数错误或仍返回不全，回退到 `list_pipelines` 并用四组时间参数的写法（见上条）分页取全，不要反复试别的自然语言值。
- **`list_pipeline_runs` 实测只给 `startTime`/`endTime` 会返回空**；同时传 `status`（`SUCCESS`/`FAIL`/`RUNNING`）并配合 `triggerMode` 才返回记录。`triggerMode` 文档枚举为 1-手动、2-定时、3-代码提交、5-流水线触发、6-Webhook；本机实测由 MCP 触发的运行记为 `4`，不在文档枚举内（属实测结论，版本变化后以实际返回为准）。查询单次运行请优先用 `get_pipeline_run`。
- **`list_pipeline_job_historys` 的 `identifier` 是任务标识，不是任务名。** 先调 `list_pipeline_jobs_by_category` 取 `identifier`。
- **`create_pipeline_run` 只返回运行实例 ID（纯数字），不带状态。** 必须再调 `get_pipeline_run` 轮询，未到终态就报告"已触发但未完成"。
- **`pipelineId` 用数字或字符串都可**，两种形式均已验证通过。

## 运行流水线

用简化参数，不要手写 `params` JSON（它会覆盖其他参数）：

```json
{
  "organizationId": "<组织ID>",
  "pipelineId": 4134022,
  "branch": "develop",
  "environmentVariables": { "ENV": "qa" },
  "comment": "本次改动说明"
}
```

触发前必须用 `get_pipeline` 核对 `name`，确认它是预期的那条流水线（例如后端服务而非前端）。流水线名相近时先报名称与 ID 让用户确认，不要凭猜测触发——触发会消耗免费核分。

触发后立即用返回的 ID 调 `get_pipeline_run`，并报告 `pipelineRunId`、`status`、所跑分支与目标环境。

轮询约定：每 15-30 秒查一次，最多等到 10 分钟（或用户指定时长）。仍在 `RUNNING` 就如实报告"已触发，仍在运行"，不要为了给结论而延长时间或反复高频空转。超时后可以再查一次确认，但仍未到终态就按未完成报告。

判读终态时以运行详情里的 `status` 为准，同时看 `stages[].jobs[].status`：运行实例显示 `RUNNING` 但某个 job 已是失败状态，说明后续阶段不会真正成功，应据实报告失败 job 而不是继续等。长时间停在 `PENDING`/`WAITING` 通常是排队或人工卡点，报告卡在哪个阶段即可，不要反复重试触发。

指定分支与流水线默认分支不一致时不要自行改写分支，也不要用 `createReleaseBranch` 之类参数绕过；先把不一致告诉用户，由用户确认是否按指定分支执行。

## 空结果排查

拿到空结果时按这个顺序走完再下结论，不要跳到"组织里没有流水线"或"组织 ID 错了"：

1. 用的哪个列表接口？`list_pipelines` 要求四组时间参数齐全（见参数陷阱），`smart_list_pipelines` 要求 `timeReference: "all time"`。先补齐。
2. 是不是在查运行记录？`list_pipeline_runs` 要补 `status` 与 `triggerMode`。
3. 递增 `page`（2、3……）看 `items` 是否变化，排除"只看到第一页"。
4. 交叉验证：`list_pipelines` 空就用 `smart_list_pipelines` 复查一次，反之亦然。
5. 检查 403 是否来自预期接口（见失败处理）。若空结果伴随 403，必须先排除凭证问题，不能当作"没有数据"。

停止条件：1-5 步都执行过、两个列表接口都返回空、且已排除 403 与凭证问题，才可以说"该组织下未查到流水线"，并同时说明用了哪些接口和参数；仅凭单次单接口空结果不得下这个结论。

## 失败处理

- **`403: Current token has no permission to api`**：先分辨接口。`get_current_user`、`get_current_organization_info`、`list_service_connections`、`list_resource_members` 返回 403 属预期，忽略即可。若 `smart_list_pipelines` 或 `get_pipeline` 也 403，才是凭证/API 授权问题，应停止并请用户补权限，不要更换组织 ID 猜试。
- **`unsupported call`**：历史上出现过触发接口返回该错误的情况（记录于 2026-10-20，本机会话日志中未复现，可能与该 MCP 版本或部署环境有关）。遇到时先重试一次确认不是偶发；仍然失败则说明该接口在当前 MCP 版本未加载。此时若已知运行实例 ID，用 `get_pipeline_run` 直接按 ID 查状态；若还没有 ID，让用户在云效控制台手动触发。不要反复重复同一调用。

## 边界

- 本工具集**没有用量/核分查询接口**。用户是免费账户，被问及额度时说明只能在云效控制台资源页查看，并提示统计约 1 小时延迟；不要编造额度数据。
- 不读写、不回显任何 token 或凭证；凭证由 MCP 客户端配置管理。
- 不在未确认目标时触发流水线，不对生产环境做无提示的批量操作。
- 组织 ID 与流水线清单属于运行环境事实，每次通过 `smart_list_pipelines` 重新解析，不要写死在本仓库文档里。
