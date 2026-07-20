# ADR-0035 — Replay V3.2: lean recap — 排场跟着任务大小走，账本一条不少

- Status: Accepted (product owner approved the before/after mock)
- Date: 2026-07-20
- Extends: ADR-0031 (Replay V3.1 conversation-first recap), ADR-0017 Amendment 8
- Mock: `docs/design/replay-v32-lean-recap-mock.html`（同一会话的现状/改造后对比）

## Context

Owner 用真实小任务（"写一个 add 函数"，30 秒、一次写入）审阅 V3.1 Recap，
结论：13 行里 5 根折叠条 + 4 个重复徽章，仪式多于内容 ——

1. 折叠条负压缩："折叠了 1 条" 用一整行去藏一行；
2. 排场不随任务缩放：单步任务享受与 28 分钟多转折会话相同的章节仪式；
3. 批准占两张卡："Plan approved" 与 "Approved: Create add.py" 是对其他事实
   的回应，不是独立故事节拍；
4. 原始错误码吓人：`Listed "" · WS_DIR_UNREADABLE` 红图标出现在一次成功的
   会话里，读起来像事故（对 spec 定义的非编程用户尤甚）；
5. "结构化记录" 徽章行行都有，等于没有。

判断依据：用户 99% 的时候只确认"干了什么、成了没"；1% 的审计时刻
（"我批准过什么？"）带时间戳的权限记录是黄金。所以**账本层照记全量，
只改 Recap 投影层的默认展示**。Explore / Verify 深度完全不变。

## Decisions（五条投影规则）

1. **折叠条别比内容多。** 两个保留节点之间的隐藏跨度：全是状态心跳
   （kind `state`/`system`）→ 不立牌子，计入 footer 汇总（"N 次状态记录
   未占行 · 探究层可见全部"）；实质记录 < `FOLD_MIN`(3) 条 → 直接内联成
   小字行；≥ 3 条 → 保留可展开折叠条（该跨度内的心跳也算进条内计数，
   每条记录恰好被呈现一次：行 / 贴纸 / 条内 / footer 计数）。

2. **紧凑模式是涌现的，不是开关。** 小会话的跨度天然全是心跳或 <3 条
   实质记录，按规则 1 自动零折叠条；大会话（87 次读取的探索段）自动保留
   正压缩的折叠条。无需按节点数分档的显式模式位。

3. **批准是贴纸，不是卡。** 新增 id-backed 关系 `resolves`：
   - 已允许的 permission 决定沿 requestId → pending 请求 → 记录的 callId
     链接到被门禁的工具事实；
   - 已批准的 plan-decision 按**记录的计划版本号**（`plan-v{version}`，
     activity 投影在 planProposed/planDecision 两侧写入 parentKey，与
     permission 的 requestId join 同构）链接到提案事实。
   目标行可见时，批准（连同其 pending 请求）渲染为该行上的
   "✓ 你批准了 / 自动批准 HH:MM" chip，点击打开该批准自身的审计详情。
   拒绝永不 chip 化；链路 join 失败（如批准时编辑过计划导致版本 +1）
   fail open 保持独立行 —— 相邻性永不造边的诚实不变量不动。

4. **错误说人话，红色留给真出事的。** `read`/`search`/`state`/`system`
   类错误且会话 outcome === 'completed'（两个都是记录值，无推断）→
   渲染为 amber 软提示行："过程性错误 · 会话仍完成"，原始错误码降为
   小字 mono；command/write/verification/permission 失败保持红色硬节拍。
   attention 列表与账本不变。

5. **徽章反着打。** 'recorded'（结构化记录）是默认态，Recap 故事行不再
   渲染；只有例外等级打标：已验证 / 观察记录 / 推导叙事 / 证据缺失。
   Explore/Verify 与 EvidenceDrawer 的等级展示不变。

## Alternatives rejected

- 显式"紧凑模式"开关（按语义节点数分档）——规则 1+3 已让小会话自然
  归零折叠条，多一个模式位就多一个漂移点；
- 时间相邻推断 plan-decision → plan 的归属——违反"关系只来自记录 id"
  不变量；改为在事件两侧补记录版本号 join 键；
- 错误码人话化字典（code → 文案映射表）——维护面大且是变相改写账本；
  软提示行保留原文，只降视觉等级。

## Security and data impact

无 schema 迁移、无新表。`ReplayRelationSchema.type` 增枚举值 `resolves`
（向后兼容的加法变更）；activity 投影为 planProposed / planDecision 增
`parentKey`（既有可选字段，复用 permission join 语义）。其余全部是
renderer 投影规则（`replay-model.ts` 纯函数 + RecapDepth 渲染），
账本与 IPC 面不变。

## Verification evidence

- Unit: `packages/ipc-contracts/src/replay.test.ts` +4（permission 链
  resolves、denied 不生成、plan 版本 join、版本不匹配 fail open）；
  `activity.test.ts` 补 parentKey 断言（含无版本号不生成）；
  `apps/desktop-renderer/.../replay-model.test.ts` +7（心跳跨度零折叠条
  且 footer 计数、<3 内联、≥3 保条且条内全额记账、chip 排除不重复计数、
  chip 收集含 pending 折入、denied/无目标不 chip、软错误分类边界）。
  全量单测 667/667；`npm run check` 干净。
- E2E: `tests/e2e/replay-v3.spec.ts` 5/5 — 新断言：小会话（edit-basic）
  零折叠条、批准 chip 可见且点击进审计详情、故事列表无 '结构化记录'
  徽章、plan-decision 无独立行；pivot 场景断言修订版计划的批准 chip
  出现在转折卡上；10k 账本折叠条测试原样保留（大跨度仍是正压缩）。
  `replay-semantic-ui.spec.ts` 3/3、`p2-parallel-replay` 3/3。
