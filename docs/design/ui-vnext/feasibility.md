# UI vNext 可实现性调研 — mock 效果 × 执行后端

2026-07-19 · 二稿（联网核实后修正）。结论先行：

1. **引擎会话**：mock 全部效果直接可做（数据已存在）。
2. **外部 CLI 的"红叉"取决于运行形态，不是能力上限**：
   - **旁观模式**（现状 v1：用户自己终端手敲 `claude`/`codex`，产品旁观 PTY）——门/就地操作的红叉**成立**；
   - **受管模式**（产品作为宿主启动 CLI：Codex `app-server` JSON-RPC / Claude Agent SDK 或
     headless 双向流）——**权限门、就地 Approve、动作行、diffstat、turn 边界、中断全部官方支持**，
     红叉基本变绿。这正是 ADR-0017 里记录在案的 "end-state path"。
3. 被用户叫停撤销的是 **Claude hooks 注入**（改用户配置增强旁观模式）；受管模式是产品 spawn
   自己的子进程/SDK 会话，**不碰用户终端与配置**，与该红线不冲突——但把它纳入范围需要用户拍板。

## 0. 执行后端的事实澄清

- 产品的执行后端 = **Charter 引擎**（进程内 runtime，全事件流）+ **外部 CLI 会话**（ADR-0017）。
- 外部 CLI 当前支持 **Claude Code 与 Codex** 两个（`external-session-service` / `sessionAttention`
  中 `cli !== 'claude' && cli !== 'codex'`；检测列表可经 `PI_IDE_EXTERNAL_CLIS` 扩展）。
- **仓库中不存在 "Codegen" 后端**——代码里的 "codegen" 只是 worktree setup 注释里的泛称
  （`task-service.ts:124`）。若未来要接入其他 CLI，走同一条检测/快照/记账管线即可。
- 红线（用户此前裁决）：**不重做 Claude hooks 注入式结构化捕获**。现有 structured 档是
  **被动识别** PTY 输出中本就存在的结构化标记（Codex `turn.completed`、Claude 结构化流），
  不改用户配置，与红线不冲突。

## 1. 数据源现状（代码核实）

| 数据 | 引擎会话 | 外部 CLI 会话 |
| --- | --- | --- |
| 任务状态机（EXPLORING…REVIEW_READY） | ✅ | ✅ 同一状态机（ADR-0017 决策 2） |
| Needs-you / attention | ✅ 门状态（plan/permission/review） | ✅ 回合边界：structured=真实 turn 完成；observed=输出静默启发式（`sessionAttention.ts`） |
| 实时动作 | ✅ 最新 tool/plan step（PIVOT-013 已验收） | ⚠️ 无 verb+target 工具行 → 用记账事件里最近触达的文件（`external.sessionChanged` 增量） |
| 净变更 / diffstat / review / rollback | ✅ CHG 机制 | ✅ 同一 CHG 机制（入场快照 + `ensureBaselineFromBytes`） |
| 验证（verify 门） | ✅ 命令级：运行中/耗时/结果 | ❌ 无验证门（CLI 自己跑测试，产品不感知） |
| Plan / 权限门 | ✅ | ❌（明确排除转录解析为门） |
| 回放记录 | ✅ events/baselines/blobs（PIVOT-017） | ✅ 文件版本 + structured 事件持续记录（`external-session-service.ts:451`），无 plan/verify 语义章节 |
| 文件写入涟漪 / 热度 | ✅ change events（PIVOT-025） | ✅ 已驱动 glow pulses（`externalStore.ts:123`） |

## 2. 效果 × 后端矩阵（fusion mock 逐项）

✅ 直接可做 ⚠️ 降级方案 ❌ 不做（说明）

| Mock 效果 | 引擎 | 外部 structured | 外部 observed | 说明 / 降级规则 |
| --- | --- | --- | --- | --- |
| Home 态势摘要行（N running / N need you） | ✅ | ✅ | ✅ | 任务状态 + attention 计数，现有数据 |
| Deck 计数仪表（Running / Needs you / Files in flight） | ✅ | ✅ | ✅ | `changedFiles` 等字段已在 TaskDto |
| Deck「Verified today / Accepted this wk」 | ✅ | ✅(accepted) | ✅(accepted) | 需新增对任务历史的聚合查询（数据已在库）；外部会话无 verified 概念，只计 accepted |
| Fleet activity 示波器（events/min） | ✅ tool events | ⚠️ structured 事件率 | ⚠️ 变更/输出活跃度近似 | 混合源近似指标，标注为活跃度而非精确事件数 |
| Needs You 卡：plan 预览 + 就地 Approve/Edit | ✅ | ❌ → ⚠️ | ❌ → ⚠️ | 外部会话的 Needs You 卡变体：「回合完成 · 等你回复」+ Open Session（无 stdin 桥，去 Room 终端回复） |
| Needs You 卡：review ready + diffstat + Open review | ✅ | ✅ | ✅ | 外部会话本就走 REVIEW_READY |
| Fleet 卡动作行（verb + target 打字机） | ✅ | ⚠️ 最近触达文件 | ⚠️ 最近触达文件 | 外部显示 `touched <path>`；无变更时显示「terminal active」 |
| Fleet 卡三段门（Plan/Perms/Verify） | ✅ | ❌ → ⚠️ | ❌ → ⚠️ | 外部会话行/卡显示 EXT 徽章 + 简化状态（working / awaiting you / review ready），不画三段门 |
| 验证进度「npm run check · 41s」 | ✅ | ❌ | ❌ | 引擎命令级状态+耗时直接有 |
| 验证计数「test 9/24」 | ⚠️ | ❌ | ❌ | 需解析 runner 输出，列为可选增强；v1 降级为命令+耗时+spinner |
| Rows 密度 + 单键/批量门操作 | ✅ | ⚠️ | ⚠️ | 批量=循环既有 IPC；外部行键位仅「⏎ open」 |
| Settled today（accepted/answered/rolled back） | ✅ | ✅ | ✅ | 状态历史，PIVOT-031 answered 已有 |
| Room mini reel：拖动回放 | ✅ 全语义 | ⚠️ 无 plan/verify 章节 | ⚠️ 同左 | 外部 reel：时间轴 + 文件版本刻度 + turn 旗标（structured 才有）；重建文件状态可行（版本已记录） |
| Reel 章节色带（Plan/Work/Fix/Verify） | ✅ | ⚠️ turn 分段 | ⚠️ 仅变更密度分段 | 章节语义按捕获等级降级 |
| 呼吸/心跳/扫光动效 | ✅ | ✅ | ✅ | 纯前端 animation + 语义色；沿用动画预算红线（不聚焦冷却、reduced-motion 全停） |
| 六皮肤 + 效果 token | ✅ | ✅ | ✅ | 纯前端；Electron(Chromium) 对 backdrop-filter / color-mix / keyframes 全支持 |

## 2.5 受管模式的官方能力核实（2026-07 联网确认）

**Codex — `codex app-server`**（证据最硬；OpenAI 声明这是"今后第一优先维护的集成方式"，
自家 VS Code / JetBrains 插件同源）：

| Mock 需求 | 协议机制 | 状态 |
| --- | --- | --- |
| 权限门 + 就地 Approve | `item/commandExecution/requestApproval` / `item/fileChange/requestApproval` —— 服务端发起请求，**turn 暂停等客户端回答**（accept / acceptForSession / decline / cancel） | ✅ 官方原生 |
| 实时动作行 | `item/started` → deltas → `item/completed`（命令、工具调用、推理） | ✅ |
| diffstat / 变更 | `turn/diff/updated`——每次 FileChange 后推送全 turn 统一 diff | ✅ |
| turn 边界 / Needs you | `turn/completed`（completed / interrupted / failed）+ token usage | ✅ |
| stdin 桥（产品内回复） | `turn/start` 携带用户输入；`turn/interrupt` 可中断 | ✅ |
| Plan 呈现 | plan 更新为 item 类型进入事件流 | ✅ |

**Claude Code — Agent SDK（TS/Python）或 headless 双向流**：

| Mock 需求 | 机制 | 状态 |
| --- | --- | --- |
| 事件流（工具/消息/plan） | `-p --output-format stream-json`（tool_use / tool_result / system 事件；`--include-partial-messages` 可到 token 级） | ✅ 官方 |
| 权限门 + 就地 Approve | Agent SDK `canUseTool` 回调（allow/deny 规则→hooks→回调的求值顺序有官方文档）；CLI 侧另有 `--permission-prompt-tool` | ✅ 官方 |
| 多轮 / stdin 桥 | `--continue` / `--resume <session_id>`；或 `--input-format stream-json` 双向流 | ✅ 存在，⚠️ CLI 直连双向流**文档滞后**（anthropics/claude-code issue #24594），稳妥路径是 **Claude Agent SDK（TypeScript）**——本产品正是 Electron/TS |
| 验证门 | 不依赖 CLI：产品在 turn 完成后自己跑 verification commands（复用引擎验证门机制） | ✅ 产品侧 |

仍然真实的限制（诚实记录）：
- "9/24" 测试计数：两类后端都需解析 runner 输出——维持"可选增强"定位。
- 旁观模式（用户手敲终端）永远拿不到门与 stdin 桥——降级显示规则仍然需要（两种形态长期并存）。
- Claude 受管路径建议走 Agent SDK 而非 CLI 裸双向流，规避文档缺口；Codex 建议 pin app-server
  schema 版本（协议仍在演进，`codex app-server generate-ts` 可生成对应版本类型）。

来源：Codex app-server 官方 README（openai/codex）、OpenAI "Unlocking the Codex harness" 博文、
developers.openai.com/codex/app-server；Claude Code 官方 headless 文档（code.claude.com/docs/en/headless）、
Agent SDK permissions 文档、anthropics/claude-code#24594。

## 3. 前端技术风险点（唯二）

1. **backdrop-filter 面积**（Obsidian 皮肤）：大面积玻璃 blur 在低端机有合成开销。对策：blur 只用于
   卡片/浮层（mock 已如此），Deck 底不用；上线前按 PIVOT-024 惯例实测帧率，超预算则降 blur 半径。
2. **常驻动画数量**（Deck 多卡呼吸 + 示波器）：沿用 PIVOT-025r 动画预算——仅可见且窗口聚焦时动，
   idle 冷却为静态，`prefers-reduced-motion` 全停。mock 中的动画均为 opacity/transform 合成层安全属性。

## 4. 结论与工程含义

- **不需要任何新的数据采集**；不触碰被否决的 hooks 注入。
- 需要新增的工程件：① Deck 聚合器（把既有 task/attention/change/verification 数据汇成态势带与
  fleet 列表，含 Verified/Accepted 聚合查询）；② 按 captureGrade/后端的**降级显示规则**（EXT 徽章、
  简化状态、动作行回退文案）；③ 外部会话 Needs You 卡变体；④ reel 的外部降级轨道。
- Mock 需随之微调的三处（实现前更新，避免验收歧义）：外部会话的 Fleet 行/卡样式（EXT 简化态）、
  Needs You 外部变体卡、验证计数改为可选增强。
