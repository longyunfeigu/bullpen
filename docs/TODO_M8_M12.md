# TODO — 剩余里程碑 M8–M12（新会话接续文档）

> 本文件是"M7 完成后"的接续待办清单，供新的 session 直接读取执行。
> **先读顺序**：`CLAUDE.md` → `docs/HANDOFF.md`（架构事实 + 环境坑）→ 本文件 → `docs/IMPLEMENTATION_STATUS.md`。
> 规范源仍是 `docs/PRODUCT_ENGINEERING_SPEC.md` + `docs/IMPLEMENTATION_BACKLOG.md`；冲突时以验收标准为准，偏离记 ADR。
> 最后更新：2026-07-21，M12 unsigned Beta release candidate 完成。

## 已完成状态（截至本文件）

| 里程碑 | 状态 |
| --- | --- |
| M1 工程基线 → M8 Agent 写入、计划与审查 | VERIFIED |
| **M9 验证、完成报告与任务历史** | **VERIFIED**（E2E-016/017/018 绿，全套 29 E2E 连续两轮绿） |
| M10–M11 | VERIFIED |
| M12 | DONE（unsigned Beta RC）；signed/notarized Stable 因付费证书与产品验收 BLOCKED |

M9 交付要点（M10+ 可直接复用）：

- `packages/verification-service`：runner（经 tool-gateway 的 runCommand）、detectSuggestions（package.json scripts）、superseded（同 label 重跑旧行标 superseded_by）、stale（写工具成功后 TaskService 用 changeSet 指纹 markStale）；大输出进 BlobStore（output_ref）+ 2KB excerpt。SQL 存储 `verification-store.ts`。
- 工具：`run_verification`（R2 recognized，auto 自动放行/edit 询问）、`rename_file`（R1，rename 目标存在即拒）。ChangeService.renameFile 加了不覆盖守卫。
- Final Report（`buildFinalReportData`）：agentSummary（最后一条 agent 消息，标注"未验证叙述"）与系统证据（changeSet ±、verification runs 含 stale/superseded、denied/failed 工具数、git HEAD 是否移动）分区；无验证 → UNVERIFIED_BY_USER。
- `task.accept` 需 confirmUnverified（有文件变更且 0 验证时抛 ACCEPT_NEEDS_CONFIRM，UI window.confirm 重试）；`task.rollback` 先 preflight，冲突返回 status:'conflicts'（事件 rollback.blocked），用户显式 force 才覆盖。
- 用户验证重跑 `task.runVerification`：REVIEW_READY→IN_PROGRESS→VERIFYING→REVIEW_READY 合法跳变链。
- **修复的真实缺陷**：渲染器布局保存 400ms 防抖在退出时不 flush → pagehide flush（APP-003 恢复保真）；m5 E2E unstage 点击落在 SCM 重渲染边界被吞 → 幂等 poll-click 模式（断言不弱化）。新 E2E 与重渲染列表交互时优先用该模式。
- fixture 增加 check-agent.mjs（读 check-target.txt 判 RIGHT）；场景 edit-rollback / verify-fail-fix。

M8 交付要点（M9+ 可直接复用）：

- **计划批准走工具通道**：`propose_plan`/`update_plan` 网关工具（`packages/tool-gateway/src/tools-write.ts`）。propose 的 execute 阻塞直到用户决定（PlanGate 由 TaskService 提供，`task-service.ts` plan flow 一节），auto 模式即时自动批准。真实 Pi 也走这条路（preamble 已注明）。拒绝 → PLAN_REJECTED + 任务 CANCELLED + abort run。
- **写门禁**：`createPlanAwarePermission` 包装 PermissionEngine——edit/auto 下 apply_patch/create_file/delete_file 在计划未批准前一律拒（AG-007，retryable）；plan 工具本身自动放行。
- **写工具**：apply_patch(R1)/create_file(R1)/delete_file(R3) 经 ChangeService；preview 产真实投影 diff；CHG_VERSION_CONFLICT / CHG_PATCH_FAILED 标 retryable。
- **Review**：`task.changeSet`（净 diff + hunks + 决策投影）、`task.reviewDecision`（file/hunk × accept/reject）、`task.accept`。hunk 键 = 内容哈希（`packages/change-service/src/review.ts` parseHunks）；拒 hunk = reversePatch 反向应用；拒文件 = `revertFile` 回基线。**语义注意**：被拒绝的 hunk 还原后从净 diff 消失——剩余全接受时文件状态即 `accepted`（E2E-015 按此断言）。
- **Mock**：`$lastReadHash` 令牌在 mock-runtime 替换为最近一次 read_file 的真实 hash；`echo: 'plan'` 步骤回显工具返回的计划（证明 agent 收到用户编辑版）。场景：edit-multifile / edit-plan-review / edit-conflict / edit-hunks。
- **渲染器坑（已修）**：Timeline 卡片在同位置从 `<Card collapsible>` 切到非 collapsible `<Card>` 时 React 复用 useState，open=false 卡死——两分支必须给不同 key（PlanCard 已用 plan-static/plan-interactive），Card 也加了 effect 兜底。新卡片组件重蹈此模式时注意。
- plan 事件：`agent.planProposed`/`agent.planUpdated`(带 delta)/`user.planEdited`/`user.planDecision`/`review.decision`/`task.accepted` 全部入 task_events；TaskService.planStatus 冷启动从事件重建。

M7 交付物（新会话可直接复用）：

- `packages/tool-gateway/src/permission-engine.ts` — `PermissionEngine`（PERM-001..010）：作用域 once/task/workspace/always；R3 永不持久授权；R4 在网关层先拒；PERM-007 参数哈希绑定，审批与执行间参数变化则原审批失效并重新请求；`cancelPendingForTask`/`cancelAll`。存储抽象 `PermissionStore`（内存版 `createMemoryPermissionStore`）。
- `apps/desktop-main/src/services/permission-store.ts` — `SqlPermissionStore`：权限请求/决定/常驻规则持久化到 `permission_requests`/`permission_decisions`（规则用 `rule_json` 非空的 decision 行表示，跨重启保留）。
- `packages/tool-gateway/src/command-classifier.ts` — `classifyCommand` R2–R4（§10.2/§10.4、PERM-008/009）：安装/网络/删除/commit=R3；sudo/git push/凭据路径/根破坏/workspace 外 cwd=R4；shell 字符串按命令位扫描升级。
- `packages/tool-gateway/src/command-runner.ts` — 结构化 spawn（CMD-001..005）：最小环境、SIGTERM→SIGKILL 进程组树杀、超时/取消/输出上限、凭据脱敏由工具层做。
- `packages/tool-gateway/src/tools-command.ts` — `run_command`（含每任务并发闸 CMD-006：1 写 + 2 只读验证）与 `ask_user`（R0）。`registerCommandTools(gateway, {root, userGate, ...})`。
- `apps/desktop-main/src/services/task-service.ts` — 已接入权限引擎：`onPermissionPending/Resolved`（记 timeline `permission.requested/decided`、进/出 `AWAITING_PERMISSION`）、`decidePermission`、`pendingPermissions`、`askUser/answerUser` 门。
- IPC：`task.permissionDecision`、`task.pendingPermissions`、`task.answerUser`（`apps/desktop-main/src/ipc/m7-handlers.ts`）；DTO `PermissionCardDto`/`AskUserPromptDto`（`packages/ipc-contracts/src/agent-dto.ts`）。
- 渲染器：`AgentPanel.tsx` 的 `PermissionCard`（§13.3：工具/原因/风险/精确目标/命令/diff 或"无 diff"/作用域按钮/查看策略）与 `QuestionCard`（ask_user）；`taskStore.decidePermission/answerUser`。
- Mock 场景：`command-install`（E2E-012）、`command-highrisk`（E2E-013）、`command-test`、`ask-clarify`（`packages/agent-runtime-mock/src/scenarios.ts`）。
- 测试证据：命令分类 17、运行器 11、权限引擎 15、命令工具 9、安全矩阵 9、SQL store 3 单测；E2E `m7-permissions.spec.ts` 4 项（E2E-012/013 + 批准执行 + ask_user）；全套 22 E2E 绿；`npm run check` 干净。
- 顺带修复：`tests/e2e/m4-search-lsp-terminal.spec.ts` E2E-005 重命名——F12 跨文件跳转后 TS worker 需就绪时间，加入确定性"util.ts 已渲染"等待 + 有界 worker 就绪等待 + 预览跨文件断言；3/3 稳定通过。

## 全局工作纪律（每个里程碑都遵守）

1. TDD：先写失败测试→看红→最小实现→绿→重构。真实代码路径优先，mock 仅作确定性后端。
2. 每个里程碑：happy + 失败/取消 + 空/加载状态 + 持久化 + 安全边界 + 自动化测试 + 映射需求/验收 ID。
3. 完成一项就 `npm run check`（prettier + boundary + tsc）、`npm test`、相关 `playwright`。里程碑退出测试过了才在 STATUS/BACKLOG 标 VERIFIED。
4. 每里程碑一次提交，作为证据；`docs/IMPLEMENTATION_STATUS.md` + `docs/IMPLEMENTATION_BACKLOG.md` 同步更新。
5. 依赖变化/架构偏离/安全权衡/Pi 补丁 → 加 ADR（`docs/adr/`）。
6. 绝不为了过测试而弱化验收；规范要改先记 ADR。
7. E2E 用 `PI_IDE_FORCE_MOCK=1` + `PI_IDE_OPEN_WORKSPACE` 驱动真实网关；真实 Pi smoke 需用户 API key（未运行，记为待验证）。
8. 涉及编辑器/LSP 的 E2E：F12/F2/rename 等异步跳转后要等 TS worker 就绪（见 E2E-005 修法），别用裸 sleep 之外无信号的断言。

---

## M8 — Agent 写入、计划与审查

**目标**：Agent 能完成真实跨文件任务；用户/Agent 并发编辑不丢数据；Review 完整。
**退出测试**：E2E-010、E2E-011、E2E-014、E2E-015。

### 已铺垫（直接复用）

- `packages/change-service/src/change-service.ts`：`applyPatch`（baseHash 校验、CHG_VERSION_CONFLICT）、`createFile`（不覆盖）、`deleteFile`（R3、先快照）、`renameFile`、`writeFileDirect`、`changeSet`（净变更投影）、`rollbackPreflight`/`rollback`；`structuredPatch` 已导出（逐 hunk UI 用）。
- `getM5()`（`apps/desktop-main/src/index.ts`）暴露 `M5Services.changeService`、`blobStore`、`documentStore`。
- 计划事件已在映射器里：`plan.proposed`/`plan.updated` → timeline `agent.planProposed`/`agent.planUpdated`（`task-service.ts` onAgentEvent）。`TaskPlan` 类型在 `agent-contract`。
- 任务状态机已含 `PLANNING`/`AWAITING_PLAN_APPROVAL`（`packages/app-domain/src/task-machine.ts`，转换见 spec §6.1）。

### 待办

1. **写/执行工具接入网关**（M8-02/03）：新增 `registerWriteTools(gateway, {changeService, taskId 来源})`，注册 `apply_patch`(R1)、`create_file`(R1)、`delete_file`(R3) 经 `changeService`。风险等级：apply/create=R1，delete=R3。preview 要产出真实 diff（用 `structuredPatch` 或 `createTwoFilesPatch`）填 `ToolPreview.diff`，权限卡才能显示。ask 模式仍硬拒（已由网关保证）。
   - TDD：`tools-write.test.ts` — 走真实 ChangeService + 临时仓库，验证 baseHash 冲突→VERSION_CONFLICT、create 不覆盖、delete 先快照、审计与 file_changes 落库。
2. **计划批准流**（M8-01、PLAN、§13.2）：Edit 模式首个写操作前须有计划；`plan.proposed` → 状态 `PLANNING`→`AWAITING_PLAN_APPROVAL`；UI 计划卡可编辑文字/顺序/删除步骤（删已完成需确认），批准→`IN_PROGRESS`，拒绝→`CANCELLED`。批准/编辑经新 IPC（如 `task.planDecision`）。计划更新记 delta 不覆盖历史。
   - 注意 spec §6.1：`AWAITING_PLAN_APPROVAL` 只从 `PLANNING` 进入，出到 `IN_PROGRESS`/`CANCELLED`。
3. **Edit/Auto 默认策略**（M8-04）：Edit=首写前计划、写/命令走审批；Auto=已识别低风险自动、R3+ 暂停。权限引擎的 mode 策略已支持（`decide` 里 auto 自动放行 R1/识别的 R2）；补计划门在 Edit/Auto 的差异。
4. **Review 页面 + 逐文件/hunk 接受拒绝**（M8-05、REV、E2E-015）：用 `changeSet(taskId)` 出每文件净 diff；`structuredPatch` 拆 hunk；接受/拒绝单 hunk → 用 `writeFileDirect` 重算目标内容落盘；UI 状态与文件一致。新 IPC：`task.changeSet`、`task.reviewDecision`。
5. **三方冲突视图**（M8-06、E2E-014）：Agent 读文件后用户改，旧 patch → VERSION_CONFLICT（ChangeService 已保证不覆盖）；UI 展示 base/agent/user 三方，提供重试/放弃。`EditorArea.tsx` 已有 diff 模型基建（`compareWith`）。
6. **Mock 场景 `edit-multifile`**：真实写 ≥3 文件 + 跑测试，驱动 E2E-010（接受→ACCEPTED）。当前 `edit-basic` 的 apply_patch 用假 baseHash，需改成先 `read_file` 拿真 hash 再 patch（mock 工具执行器是真网关，hash 必须对）。
7. **E2E**：
   - E2E-010 Edit 完整任务：改≥3 文件→跑测试→REVIEW_READY→接受→ACCEPTED。
   - E2E-011 计划拒绝与编辑：首个计划→编辑→批准→后续遵循且历史保留。
   - E2E-014 并发编辑：Agent 读后用户改→旧 patch VERSION_CONFLICT→不覆盖。
   - E2E-015 逐 hunk：多 hunk，接受一个拒绝一个，文件与 UI 一致。

---

## M9 — 验证、完成报告与任务历史

**目标**：五类验证状态（通过/失败/超时/取消/无验证）；Agent 完成绝不直接 ACCEPTED。
**退出测试**：E2E-016、E2E-017、E2E-018（+ 回滚 E2E-016 实际属 M9/M10 交界，回滚基建已在 ChangeService）。

### 已铺垫

- 表 `verification_runs` 已在 schema v1。
- `TaskService.buildFinalReport` 是骨架（标 `unverified`）——需替换为真实系统证据投影。
- 任务筛选 `listTasks('all'|'active'|'review'|'done'|'failed')` 已有；`archive` 已有。
- `run_command` 分类器已识别验证命令（npm test/lint、tsc、pytest 等，`recognized=true`）。

### 待办

1. **VerificationService**（M9-01/02、VER）：项目探测（package.json scripts、常见命令）；跑验证经 `run_command`（复用 M7 runner）；记录 `verification_runs`（label/command/code_revision/state/exit_code/output_ref，大输出进 BlobStore）；stale/superseded 语义（代码改动后旧结果标记 stale；重跑标 superseded）。状态 `VERIFYING`（spec §6.1：IN_PROGRESS↔VERIFYING↔REVIEW_READY）。
2. **真实 Final Report**（M9-03、§13.4）：Outcome/验收命中/Changed files ±行（`changeSet`）/Verification 通过失败跳过/Diagnostics/未决风险/model+usage/Next actions。**Agent 自述与系统证据分区显示**；系统证据来自 ChangeService/VerificationService/Problems/权限记录。无验证时标 `UNVERIFIED_BY_USER`，接受需二次确认。
3. **REVIEW_READY→ACCEPTED/ROLLED_BACK 规则**（M9-04）：ACCEPTED 前必有 Final Report；ROLLED_BACK 前必跑 `rollbackPreflight`（CHG-010 冲突进冲突流程，不直接成功）。
4. **继续修改**：REVIEW_READY 可再 `IN_PROGRESS` 继续（steer/followUp 已有；确认状态机允许）。
5. **E2E**：
   - E2E-016 完整回滚：create/modify/delete/rename 后回滚，字节/存在/权限位恢复（`rollback` 已实现，补 UI + E2E）。
   - E2E-017 验证失败再修复：第一次失败→改→第二次过；两次记录都在，旧结果 stale/superseded。
   - E2E-018 无验证接受：跳过验证→Final Report 标 Unverified→接受需二次确认。

---

## M10 — 恢复、可靠性与诊断

**目标**：主/Renderer/Worker/LSP/PTY 故障恢复；未完成任务恢复；DB 备份；支持包；soak。
**退出测试**：E2E-019（已过核心）、E2E-020、E2E-022 + 50 次连续任务 soak、杀 Renderer、磁盘写失败、迁移回滚。

### 已铺垫

- `TaskService.markOrphanedRunsInterrupted()`（重启扫描把运行态任务标 INTERRUPTED，并把遗留 PENDING 权限请求标 CANCELLED——本轮 M7 加的）。
- Worker crash → INTERRUPTED + crash 卡（E2E-019 核心已过）。
- `openDatabase` 已有迁移前备份 + 失败恢复、WAL、quick_check（`packages/persistence/src/database.ts`）。
- `redactObject`/`redactText`（`packages/foundation/src/redact.ts`）——支持包脱敏基建。

### 待办

1. **恢复页/流程**（REC）：重启后列出 INTERRUPTED 任务，提供审查/恢复/回滚入口。
2. **E2E-020 应用崩溃恢复**：在"写入中"和"等待权限中"分别强杀主进程；重启后 DB/快照/状态一致，**无重复执行**（工具调用不重放——REL-002 已保证 worker 不重放；确认权限 PENDING 不复活执行）。
3. **DB 备份/恢复演练**（REL）：迁移失败注入→回滚到备份（`openDatabase` 已有，补 E2E 与 support）。
4. **支持包脱敏导出**（E2E-022、SUP）：打包错误/命令/Provider 状态；**不含密钥/代码/Prompt/绝对用户路径**（用 redact + 路径相对化）。新 IPC `diagnostics.supportBundle`。
5. **soak**：50 次连续任务无孤儿进程/句柄泄漏；杀 Renderer 后主进程存活重开窗口；磁盘写失败（只读目录/满盘注入）优雅报错不丢数据。
6. **LSP/PTY 故障恢复**：pylsp 崩溃降级提示（部分已有）；PTY 进程树清理（`node-pty`，M4 已有基建）。

---

## M11 — 安全、性能、隐私、可访问性硬化

**目标**：安全测试矩阵 100%；参考负载达性能门槛；核心流程纯键盘可完成。
**退出测试**：安全矩阵、性能门槛、a11y。

### 已铺垫

- CSP + 导航拦截 + `app://` 协议（`apps/desktop-main/src/index.ts`）。
- Secret Store（safeStorage，`secret-service.ts`）、日志/对象脱敏（redact）。
- 路径/symlink/TOCTOU 安全在 M7 `security-matrix.test.ts` 有单元级；`resolveInsideRoot` 兜底。
- 大树 fixture `createLargeTreeFixture`、timeline 10k 事件虚拟化留在这里做。
- **缺**：`vitest.security.config.ts` / `vitest.perf.config.ts`（package.json 的 `test:security`/`test:perf` 脚本已引用但文件不存在，需创建）；`tests/security/` 目录空。

### 待办

1. 创建 `vitest.security.config.ts`、`vitest.perf.config.ts`（参照根 vitest 配置，include 对应目录）。
2. **安全测试矩阵**（SEC、E2E-021 已有单元级）：renderer 无 node/electron（boundary lint 已有，补运行时断言 nodeIntegration=false/contextIsolation/sandbox）；CSP 生效；凭据不进 renderer/localStorage/日志/崩溃报告；R4 全拒；路径逃逸矩阵；Pi 只暴露网关工具（`adapter-contract.test.ts` 已有）。
3. **性能门槛**（PERF）：大仓库打开、搜索、编辑器响应、timeline 虚拟化（10k 事件）达标；用 `createLargeTreeFixture`。定门槛记 ADR。
4. **隐私设置**：遥测/崩溃报告默认与开关；数据本地化说明。
5. **可访问性**（A11Y）：核心流程纯键盘（新建任务/审批/审查/接受）；焦点管理；ARIA；对比度；屏幕阅读器 label。E2E 用键盘驱动全流程。
6. **DB 锁竞争自愈（REL 加固，2026-07-13 真机发现）**：`openDatabase` 遇 `SQLITE_BUSY` 时先 `busy_timeout` 重试数秒再降级 APP_STARTUP_FAILED——两个实例同开默认 `~/Library/Application Support/pi-ide` 时第二个撞写锁会弹安全页（数据无损，属正确降级，但体验吓人）。根因是并发实例；single-instance lock 已在（`requestSingleInstanceLock`+`second-instance` 聚焦），但"第一个实例退出中已释放 lock 但 DB 连接未关"的窗口（M10 的异步 will-quit teardown 略微拉长了它）内启动新实例仍会撞锁。补 busy_timeout 重试 + 单测（并发打开）。

---

## M12 — 安装、更新与发布

**目标**：第 16 章全部 Release Gates 通过；干净机器安装/升级/卸载；可复现构建。
**退出测试**：E2E-023（升级迁移）、E2E-024（干净安装）+ Release Gates。

### 已铺垫

- electron-builder 已配置并验证过 `--dir` 打包 + 启动（M1）。
- 迁移带 checksum + 备份（升级路径基础）。

### M12 Beta 交付状态（2026-07-21）

以下原待办均已落地：`release-verify.mjs` 全门禁、E2E-023/024、三平台 native packaging/install CI、GitHub Prerelease workflow、SPDX SBOM/许可证/校验和、SECURITY/PRIVACY/recovery/limitations/release notes，以及 ADR-0043 的 unsigned-only prerelease policy。macOS DMG 已完成真实挂载、复制、启动、清理；远端 candidate matrix 通过后才允许创建 tag。

### 原待办（保留作验收索引）

1. **`scripts/release-verify.mjs`**（缺）：串联 `check`+`test`+`test:e2e`+`test:security`+`test:perf`+`package`，输出 gate 报告；`npm run release:verify`。
2. **文档**：`SECURITY.md`、`PRIVACY.md`、`docs/TEST_REPORT.md`（填充最终证据）、许可证清单 + SBOM（可用 `license-checker` 或手工）。
3. **E2E-023 升级迁移**：装含旧 DB 的上一版→升级→迁移成功且任务可读；故障注入→恢复备份。
4. **E2E-024 干净机器安装**：macOS/Windows 干净环境装/启/卸；签名/公证——**无证书，记为发布阻断项 + ADR**（本机 GitHub 直连不可用，见 HANDOFF 环境坑）。
5. **可复现构建**：锁定版本、固定构建产物；最终 `IMPLEMENTATION_STATUS.md` 全 VERIFIED。
6. **ADR 补记**：OAuth Provider 未实现（仅 API Key）、validateCredential 仅存在性检查、get_symbols/get_diagnostics(LSP-007) 未注册、签名/公证阻断——这些在 HANDOFF"诚实清单"里，M12 收口时正式记 ADR + Known Limitations。

---

## 常用命令

```bash
npm run check         # prettier + boundary lint + tsc
npm test              # 全部 vitest 单元/集成
node scripts/build.mjs # 构建 main/preload/worker/renderer 产物（E2E 前必跑）
npx playwright test --config tests/e2e/playwright.config.ts            # 全套 E2E
npx playwright test --config tests/e2e/playwright.config.ts m8-xxx     # 单文件
npm run package       # electron-builder 打包
npm run release:verify # M12 全量发布门禁
```

E2E 环境变量：`PI_IDE_FORCE_MOCK=1`（用 mock runtime）、`PI_IDE_OPEN_WORKSPACE=<dir>`（自动开工作区）、`PI_IDE_E2E=1`、`PI_IDE_USER_DATA=<dir>`（隔离用户数据）。
调试单个交互：可仿照本轮的一次性 `_electron.launch` 探针脚本（放仓库根跑完即删，注意 `window.monaco` 未暴露）。
