# Remove approved Qoder statusline helper and command aliases

## Goal

移除 S7 内部 test-only helper 和旧命令常量键，保留 widget 未知类型处理与命令识别行为。

## Authority and background

[批准计划 S7](/Users/jasonliao/Desktop/code/Artifacts/infra-dead-code-audit-20261003/DELETION_PLAN.md) 为清理依据。“可以请继续”和后续“确认”已批准原实施及任务创建/启动。当前源码的全部旧键测试引用由主代理补充核对；这是原决定的测试迁移细化。基线见 [baseline.json](/Users/jasonliao/Desktop/code/Artifacts/infra-dead-code-cleanup-20261003/task-preparation/baseline.json)。

## Requirements

- R1 删除 `src/utils/widgets.ts:isKnownWidgetType` 与只自测该 helper 的测试/导入；保留 registry/renderer 实际未知 widget 行为测试。
- R2 删除 `src/utils/claude-settings.ts` 中 `CCSTATUSLINE_COMMANDS.NPM/BUNX/SELF_MANAGED`；直接受影响现有测试分别迁到 `AUTO_NPX/AUTO_BUNX/GLOBAL`，覆盖全部引用并保留命令识别语义。
- R3 保留 `PINNED_INSTALL_COMMANDS.NPM`（不同的活跃键）、当前安装模式、发布 exports、监督入口与 Qoder 独立部署边界。
- R4 范围仅上述源码及其直接受影响现有测试、删除导致的无用导入。回读并保留并发修改。不编辑部署、包/profile/archived 内容或兼容接口，不 stage/commit/push/fetch，不运行 deploy apply/rollback、真实凭据或 provider 请求。交付 source-only/uncommitted。
- R5 required documentation-only dependency：主代理回读并批准修正 `AGENTS.md` 两处与删除直接相关的说明：删除 `isKnownWidgetType` 条目，常量名称改为 `AUTO_NPX/AUTO_BUNX/GLOBAL`；独立检查发现 `.trellis/spec/frontend/type-safety.md:28` 仍引用该 helper，主代理批准仅将该行的运行时查询接口改为 `getWidget()`。保持 `CLAUDE.md -> AGENTS.md` 链接、string schema、forward compatibility 和其他规范。

## Acceptance Criteria

- [x] R1/R2 旧函数/常量及旧引用移除，有效未知 widget/安装模式/命令识别断言保留。
- [x] R3 活跃 pinned 安装键保持，当前 `AUTO_NPX/AUTO_BUNX/GLOBAL` 全部可用。
- [x] 相关 widget/claude-settings 测试及 `bun test`、`bun run lint`、`bun run build` 通过，构建保持 Node.js 14+ 兼容；`git diff --check` 通过。
- [x] 结果只证明 source/build，未部署、未提交；失败/缺失检查和并发修改如实报告。

## Settled decisions

轻量 PRD 足够；本准备阶段保持 planning，由主代理审阅后启动。
