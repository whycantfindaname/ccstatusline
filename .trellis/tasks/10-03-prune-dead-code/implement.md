# S7 implementation result

源码实施及规定验证完成，等待主代理安排独立 checker 并完成任务收尾。当前交付为 source/build-only、uncommitted。

## Files changed

- `src/utils/widgets.ts`：删除内部 `isKnownWidgetType` 及仅服务该函数的 `layoutWidgetTypes` 集合；保留 `getWidget`、legacy alias、catalog 与实际 registry。
- `src/utils/claude-settings.ts`：删除 `CCSTATUSLINE_COMMANDS.NPM/BUNX/SELF_MANAGED` 三个旧别名，保留 `AUTO_NPX/AUTO_BUNX/GLOBAL` 和独立的 `PINNED_INSTALL_COMMANDS.NPM/BUN`。
- `src/utils/__tests__/widgets.test.ts`：只删除 helper 导入和两个 helper 自测（`recognizes known widget and layout types`、`treats legacy git-pr as a known widget type`）。保留 `getWidget('git-pr')` 与 `git-review` 同实例断言、catalog 排除旧别名及全部其他测试。
- `src/utils/__tests__/claude-settings.test.ts`：27 处常量引用迁到当前键，5 个相关测试标题同步；断言和输入命令字符串语义保持。
- `src/utils/__tests__/update-checker.test.ts`：4 处常量引用迁到当前键，全部更新结果/命令动作断言保留。
- `AGENTS.md`：按主代理明确批准，只删除已不存在的 helper 说明并列出当前命令常量；`CLAUDE.md -> AGENTS.md` 保持。
- 本任务 `prd.md`：记录必要文档依赖 R5；本文件记录实施及验收证据。

## Verification

证据目录：`/Users/jasonliao/Desktop/code/Artifacts/infra-dead-code-cleanup-20261003/qoder/`。

首次运行发现 checkout 无 `node_modules`，相关测试、lint 和 build 因缺少依赖退出 1；首次原始日志及逐命令记录保留在证据根目录。主代理确认缺失依赖安装属于已授权准备后，已检查根生命周期只执行 `scripts/apply-install-patches.ts`（仅 patch 本地 node_modules/ink），运行 `bun install --frozen-lockfile`，退出 0；`package.json` 与 `bun.lock` 前后逐字节一致。

补齐依赖后的结果和原始 argv/exit/stdout/stderr 位于 `after-dependencies/`：

| Check | Result |
| --- | --- |
| `bun test --timeout=7000 ./src/utils/__tests__/widgets.test.ts ./src/utils/__tests__/claude-settings.test.ts ./src/utils/__tests__/update-checker.test.ts` | exit 0；129 pass，0 fail，389 expect calls |
| `bun run lint` | exit 0；项目脚本完成 TypeScript 与 ESLint |
| `bun test --timeout=7000` | exit 0；1938 pass，0 fail，4710 expect calls，141 files |
| `bun run build` | exit 0；443 modules，`--target=node --target-version=14`，version placeholder 替换为 2.2.27 |
| `git diff --check` | exit 0 |

验证使用独立子进程 `HOME/USERPROFILE/CLAUDE_CONFIG_DIR/XDG_CONFIG_HOME/XDG_CACHE_HOME` 并移除代理和 provider API/auth token 变量，没有将测试写入真实用户配置目录。完整验证脚本保存在证据 `verify.py`。

`final.patch`、`path-map.json`、逐命令扫描记录由保存的 `collect-evidence.py` 产生。`retired-references` 在 `src` 和 `AGENTS.md` 返回 1、空输出（未匹配），`active-references` 保留当前键和 pinned NPM 使用证据。六个已跟踪文件合计 38 行新增、62 行删除。

## Preserved assertions and boundaries

命令精确匹配、未知命令拒绝、partial-prefix/substrings 拒绝、含空格/括号/Windows 路径匹配、嵌入单引号转义、全局安装、pinned metadata、refreshInterval、备份/无效 JSON 恢复、hooks 安装与清理、registry failure 和更新动作断言均保留。renderer 源码及全部 renderer 测试和 config legacy migration 测试没有差异；实际跳过未知 widget 的源码路径保持（`renderer.ts` 的未知输出及未知类型跳过分支）。没有把未知终端宽度用例描述为未知 widget 断言，也未新增或声称存在未找到的专用未知 widget 测试。

未修改发布 exports、监督入口、独立 Qoder 部署边界、部署脚本、manifest 或 lockfile；未执行 deploy:local、apply、rollback、stage、commit、push、fetch 或平台激活。构建成功证明 Node.js 14 目标打包，未运行 Node.js 14 实际运行时，也未部署到 Qoder。

## Follow-up

主代理完成独立 checker 后决定 PRD 验收勾选及任务收尾；实施者未代替该审查阶段。
