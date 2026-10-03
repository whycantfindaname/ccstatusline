# S7 independent check

DONE：批准范围内的源码删除正确；发现并修正一处直接相关的规范漂移。交付保持 source/build-only、uncommitted，由主代理负责验收勾选和任务收尾。

## Findings (fixed)

- File: `.trellis/spec/frontend/type-safety.md:28`
- Issue: runtime lookup 说明仍引用已删除的 `isKnownWidgetType()`。
- Fix: 经主代理批准，仅将该行改为 `getWidget()`；string schema、forward compatibility 及其他内容逐字节保持。PRD R5 已记录该必要文档依赖。

## Findings (not fixed)

无影响本次验收的未修复问题。未发现源码或测试迁移缺陷。

## Scope and behavior

以 `fa40f27208bf` 为基线核查最终七个跟踪文件。源码只删孤立 helper/set 和三个旧键，当前 `AUTO_NPX/AUTO_BUNX/GLOBAL` 值与基线旧键分别相同；`PINNED_INSTALL_COMMANDS.NPM` 及活跃消费者保留。registry/manifest、renderer、string schema、CLI entry、package.json、bun.lock 均未修改。`CLAUDE.md -> AGENTS.md` 保持。

保存的逐字节检查确认：`claude-settings.test.ts` 正好迁移 27 处引用和 5 个标题；`update-checker.test.ts` 正好迁移 4 处引用；其他输入、断言与预期值保持。`widgets.test.ts` 正好删除一个导入和两个只服务 helper 的自测，legacy `getWidget('git-pr')` 同实例和 catalog 排除断言保持。

`renderer.ts:819-829` 仍通过 `getWidget()` 查找未知类型，保留空内容并保持索引。全部 renderer 与 config legacy migration 测试差异为空。本轮未发现专用 renderer 未知 widget 测试，也未将未知终端宽度用例冒充该覆盖；删除的未知类型断言仅自测已退休 helper，按批准范围移除。无产品行为变化，不需要新增测试或其他规范改动。

## Verification

- Lint: PASS，独立 `bun run lint` exit 0。
- TypeCheck: PASS，同一支持脚本执行 `bun tsc --noEmit && eslint ...`，完整脚本 exit 0。
- Tests: PASS，独立 `bun test --timeout=7000 ./src/utils/__tests__/widgets.test.ts ./src/utils/__tests__/claude-settings.test.ts ./src/utils/__tests__/update-checker.test.ts` exit 0，129 pass、0 fail、389 expect calls。
- Full tests: PASS，已读取并复用实施者原始 `bun test --timeout=7000` 结果，exit 0，1938 pass、0 fail、4710 expect calls、141 files。检查阶段只改 Markdown，无新源代码差异，不重复完整套件。
- Build: PASS，已读取并复用实施者 `bun run build` 原始命令/输出/exit 0；参数 `--target=node --target-version=14`，443 modules，版本占位替换为 2.2.27。未在 Node.js 14 实际运行时执行。
- Diff: PASS，独立 `git diff --check` exit 0；最终七跟踪文件 39 additions、63 deletions。
- References: PASS，独立全仓库定向扫描（排除 Git、依赖、dist 和任务历史）exit 1、空输出，表示退休 helper/set/旧常量引用未匹配。

独立检查子进程隔离 `HOME/USERPROFILE/CLAUDE_CONFIG_DIR/XDG_CONFIG_HOME/XDG_CACHE_HOME`，清除代理及 provider API/auth token 环境变量。没有调用部署、真实 provider 请求、stage/commit/push/fetch 或平台激活。

## Evidence

独立证据根目录：`/Users/jasonliao/Desktop/code/Artifacts/infra-dead-code-cleanup-20261003/qoder/check/`。

- `verify.py`、`*.command.json`、`*.result.json`、`*.stdout.log`、`*.stderr.log`、`verification-results.json`：独立检查的实际命令、退出码与输出。
- `collect.py`、`semantic-comparison.json`：基线和当前内容逐字节比较、31 个引用计数、准确范围与链接拓扑。
- `final.patch`、`path-map.json`：包含必要 spec 修正的最终七文件差异和用途。
- 复用原始门禁：上级 `after-dependencies/full-tests.*` 和 `after-dependencies/build.*`；首次缺依赖失败及安装日志仍保留在上级证据目录。

实施者原有六文件 `final.patch`、`path-map.json` 未覆盖；最终七文件版本以 `check/` 为准。任务未标记 done、归档或提交。
