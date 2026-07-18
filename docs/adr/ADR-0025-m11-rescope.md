# ADR-0025: M11 任务清单重定义 — 差距收口式改写与 pivot 新增面纳入

- 状态：Accepted（用户决定 2026-07-18）
- 日期：2026-07-18
- 关联需求：spec §14 Milestone 11、§16.4 安全门槛、§16.5 性能门槛、§17.1 Security 测试层级、A11Y-001..005、PRIV-001..003；ADR-0009 am.1（多 Provider）、ADR-0017（外部 CLI 会话）、ADR-0019（多源 Skills）、ADR-0022（预览与 PR 草稿）、ADR-0024（Room 上下文投喂）、PIVOT-037（单壳统一）

## 背景

原 M11 任务清单（M11-01..06）写于工程起点，假设的代码形态是"Editor 为中心的
IDE + 尚未存在的安全/性能基础"。此后完成了 M1–M10 与 ADR-0004 起的整个壳层
pivot（Charter、Task Room、SESSION-CANVAS 单壳、外部 CLI、预览、Skills、多
Provider、附件导入），原清单与现实代码出现三类偏差。盘点基线：commit
`e81b72e`（repo-clean sweep 之后）。

**偏差一：相当一部分 M11 范围已在功能工作中顺手完成。**

- `apps/desktop-main/src/security.ts`（59 行）：`will-navigate` 拦截、
  `will-attach-webview` 阻止、`setPermissionRequestHandler` 默认拒绝、
  `openExternal` allowlist；`csp.ts`（32 行）已抽出并被单测钉定
  （PREVIEW-GATE 时 `frame-src` 精确放宽至 localhost）；sandbox /
  contextIsolation / nodeIntegration=false 自 M1 即为底线。
- `packages/foundation/src/redact.ts` 默认接入 logger；M10 已交付脱敏支持包
  （`support-bundle.ts`）。
- 路径遍历 / 符号链接 / 越界用例散布于普通套件（tools-skill、tools-command、
  command-classifier、skill-store、context-attachment-handlers）。
- Replay Explore 列表已虚拟化（`ExploreDepth.tsx` OVERSCAN 窗口化）；已有
  10k-fact perf gate 单测、10k-event ledger e2e、10k 文件懒加载树（M3）。
- 终端 scrollback 裁剪、gateway/搜索输出截断、搜索可取消。
- repo-clean `7421d2e`：RoomTimeline/TimelineList 派生 memo 化、TimelineCard
  React.memo、SessionRail 订阅收窄至 `s.tasks`、闲置 ticker 门控 —— 流式
  逐 token 重建已消除。
- 55 个渲染器文件使用 aria-\*、5 处 aria-live、⌘1-9/⌘[⌘] 导航、外部面板
  splitter 的 ARIA range + 键盘控制。

**偏差二：原任务假设的对象已换位或缺项。**

- PIVOT-037 之后 RoomTimeline 是产品唯一主表面（1309 行，无窗口化）——
  §16.5「10k 事件滚动可用」的门槛现在打在它身上，而非原清单设想的旧
  Editor timeline。
- `package.json` 的 `test:security` / `test:perf` 指向不存在的
  `vitest.security.config.ts`、`tests/security/playwright.config.ts`、
  `vitest.perf.config.ts` —— 两个必需命令（CLAUDE.md）当前不可运行。
- Electron fuses 零使用；UI 缩放（A11Y-003）零实现（zoomFactor/zoomLevel
  全仓零命中）；accessible diff（A11Y-005）缺失；50k 文件 / 1GB 文本
  fixture 缺失。
- §16.4 的「API Key 在 renderer heap snapshot、localStorage、普通日志、
  支持包中均不可检出」四路验收从未执行过。
- spec §14 M11 交付明确包含「隐私设置」，原清单没有任何对应任务。
  现状：`settings.privacy.telemetryEnabled/crashReportsEnabled` 有 schema
  （默认 false）+ Settings→Privacy UI，但 schema 与 SettingsView 之外零消
  费者；Crash reports 的提示文案「Separate opt-in with redacted preview」
  描述了不存在的行为 —— 触碰 CLAUDE.md 规则 9（完成的功能禁止静态假 UI），
  在修复前不得视为已完成功能。

**偏差三：pivot 引入了原清单不存在的攻击面 / 性能面 / 秘密路径。**

- 预览 iframe 与 element-picker 注入（ADR-0022：产品第一次向预览页执行注入
  代码，现有 port 围栏 / self-cleaning，需要系统化审计）。
- 外部 CLI 会话与转录发现（ADR-0017：读取 `~/.claude/projects`、
  `~/.codex/sessions`）。
- 多源 Skills 目录（ADR-0019：realpath 围栏已做，需纳入安全矩阵回归）。
- 多 Provider keychain 键 + 非敏感 meta（ADR-0009 am.1）。
- 任务附件导入（ADR-0024：10 MB 上限、路径逃逸防护已做，需纳入秘密扫描与
  遍历矩阵）。
- 常驻 Session Rail + Live Board 事件流（背压对象）。

## 决策

1. **保留 M11-01..06 任务编号与门槛锚定。** 六项任务全部保留；不删除、不
   降低任何 §16 门槛（Backlog 头部规则：本 Backlog 不能降低主规格）。
2. **每项「交付」改写为差距收口式描述**，显式记录「已有底座」，避免重复
   建设；重写后的清单见 `IMPLEMENTATION_BACKLOG.md` Milestone 11。
3. **pivot 新增面显式纳入任务范围**（预览 iframe/注入 → M11-01；外部 CLI
   转录、Provider keychain、附件 → M11-02；RoomTimeline/Session Rail →
   M11-04）。
4. **M11-04 虚拟化对象重定向**：旧 Editor timeline → RoomTimeline 窗口化 +
   Session Rail/Live Board 背压。与 `7421d2e` 的分界：memo 化只消除了逐
   token 重建，不是窗口化；10k 事件的 DOM 体量问题仍在。
5. **M11-05 重锚定并调整时序**：键盘核心流程改为 Home→Room→Session
   Canvas→审查 Dock；依赖从 M3,M8 改为 M11-04 —— 窗口化会改变 timeline 的
   DOM 与焦点语义，先虚拟化再做 a11y 审计，避免返工。
6. **新增 M11-07 隐私设置（PRIV-001..003）**：补上规格要求但原清单缺失的
   任务；把半接线的 Privacy 开关变成真实语义，或在无上报通道时诚实降级
   （文案不得描述不存在的行为）。
7. **测试入口恢复归属**：`test:security` 入口（vitest config + security
   playwright 项目）在 M11-01 立起；`test:perf` 入口在 M11-03 立起；散落
   用例归拢引用，不重写。
8. **事实同步**：Backlog M10 状态列与 `IMPLEMENTATION_STATUS.md` 对齐
   （M10 已 VERIFIED，Backlog 中仍标 NOT_STARTED 为文档陈旧）；
   DECISIONS.md 索引补录 ADR-0022/0023/0024。

## 替代方案

- **A. 原清单原样执行**：会重复建设已存在的导航拦截 / 脱敏 / 10k fixture，
  且漏掉预览注入、外部 CLI 转录等新面与整个隐私任务 —— 否决。
- **B. 取消 M11、把硬化摊进各功能线**：违反「里程碑退出 = 安全矩阵 100% +
  性能门槛」的集中验收设计，M11-06 门槛报告失去载体 —— 否决。
- **C. 全部重新编号**：破坏与 spec §14/§16 及既有文档交叉引用的可追溯性
  —— 否决，仅追加 M11-07。

## 安全与数据影响

本 ADR 仅改写计划文档，无代码变更。安全范围只增不减：新增 fuses、
heap-snapshot 检出验收、预览注入审计、隐私任务。显式挂账一个现存诚实性
问题（Privacy 开关零消费者 + Crash reports 文案描述不存在的 redacted
preview），归 M11-07 修复。

## 迁移/回滚

无数据迁移。回滚 = revert 本 ADR 及 `IMPLEMENTATION_BACKLOG.md` /
`DECISIONS.md` / `IMPLEMENTATION_STATUS.md` 的对应改动。

## 验证证据

- 盘点基线 `e81b72e`；差距均有 grep/文件证据：fuses、zoomFactor/zoomLevel
  全仓零命中；`vitest.security.config.ts`、`vitest.perf.config.ts`、
  `tests/security/` 不存在而 package.json 脚本引用之；`RoomTimeline.tsx`
  1309 行无窗口化，`ExploreDepth.tsx` 有；`redact.ts` 49 行默认接入
  logger；`security.ts`/`csp.ts` 59/32 行；`telemetryEnabled`/
  `crashReportsEnabled` 在 schema 与 SettingsView 之外零消费者；aria-live
  5 处。
- 已有底座与 `IMPLEMENTATION_STATUS.md` 各里程碑行交叉核对（M7 安全矩阵、
  M10 支持包、REPLAY-V3、LEGIBLE-TERMINAL、PREVIEW-GATE/ROOM、SKILLS-LIVE、
  repo-clean sweep）。
