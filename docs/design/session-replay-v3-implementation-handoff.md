# Agent Replay V3 — Production Implementation Handoff

> 用途：供新的实现 Session 直接接手。本文是 Replay V3 的实现交接主文档。  
> 日期：2026-07-15  
> 仓库基线：`e584d3c`，工作区存在大量用户未提交改动，**禁止 reset、checkout 或覆盖无关文件**。  
> 产品决定：A–E 不再作为五个并列入口；最终产品是 **Recap / Explore / Verify 三层深度，共用一份事件与证据记录**。

## 0. 给新 Session 的直接任务

在现有 Replay V2/A–E 基础上完成 Replay V3 的生产实现，不要另起一套 mock 数据或第二份回放数据库。

最终体验必须满足：

- 用户打开回放后，十秒内先看懂结果、重要变化和待处理风险。
- 用户可以播放一段不超过 90 秒的 Story Time 回顾，也可以切换到真实时间。
- Recap、Explore、Verify 切换时，当前任务、playhead、选中事件和证据上下文保持不变。
- Pi Home、Claude Terminal、Codex Terminal 和未来非编程 Agent 都进入同一事件/证据模型。
- 普通 Claude/Codex TUI 只能标记为 Observed；只有真实结构化事件才能标记为 Recorded。
- 永远不展示或重建隐藏 chain-of-thought；不能确认时必须明确说“记录无法确认”。
- 不再展示启发式 numeric confidence；只展示 Verified / Recorded / Observed / Inferred / Missing 和可测量的 coverage。

开始实现前，按顺序阅读：

1. [V3 产品决策](./session-replay-unified-experience-v3.md)
2. [完整交互 prototype](./session-replay-v3-prototype/README.md)
3. [prototype 设计 QA](./session-replay-v3-prototype/design-qa.md)
4. [外部 CLI 会话 ADR](../adr/ADR-0017-external-cli-agent-sessions.md)，特别是 Amendment 6
5. [当前生产 Replay](../../apps/desktop-renderer/src/views/ReplayView.tsx)
6. [当前 Replay model](../../apps/desktop-renderer/src/views/replay-model.ts)
7. [Activity 投影合同](../../packages/ipc-contracts/src/activity.ts)
8. [外部 structured parser](../../apps/desktop-main/src/services/external-replay-parser.ts)
9. [外部会话记录服务](../../apps/desktop-main/src/services/external-session-service.ts)

prototype 是交互与信息架构合同，不是可直接复制进生产的数据实现。不要把 `src/data.js` 的演示事件带进正式产品。

## 1. 已确认的产品方向

### 1.1 三层深度

| 深度 | 用户问题 | 吸收的原方向 | 默认内容 |
| --- | --- | --- | --- |
| Recap | 结果是什么，重要吗？ | A | Session contract、结果卡、语义章节、自适应产物、Story Time |
| Explore | 这一刻前后发生了什么？ | D + B/C 的有效部分 | 虚拟化事件列表、问题式过滤、应用/资源、明确关系、周围上下文 |
| Verify | 什么证据支持这项主张？ | E | 主张、证据链、完整性、审批、可逆性、导出凭证 |

B 和 C 不消失，但不再成为导航模式：

- B 的价值进入 `requested-by`、`produced`、`verified-by` 等**明确关系**。
- C 的价值进入应用 lanes、artifact renderer 和应用过滤。
- 时间相邻不等于因果；没有 relation id 时只能显示 surrounding context。

### 1.2 默认打开状态

Replay 不从第一个低层事件开始，也不自动播放。默认停在稳定的结果帧：

- 原始目标：`TaskDto.goalMd`
- 结果：Task state、`report.final`、结构化 result event 与系统证据共同派生
- 重要变化：高影响产物、审批、外部状态变化或文件 change set
- 需要注意：失败、拒绝、未验证、不可逆操作、缺失证据
- 验证状态：verified / partly verified / not verified
- 实际耗时与压缩回顾时长
- 按时间区间计算的证据 coverage band

“Agent 自己说成功”不能变成绿色 Verified。

### 1.3 Evidence language

| Level | 严格含义 |
| --- | --- |
| Verified | 直接产物或结果，并有成功验证、签名审批或可校验回执支持 |
| Recorded | Pi、provider、MCP、审批系统或应用发出的结构化事件 |
| Observed | 仅由 PTY、进程、文件系统或外部变化观察到，缺少语义确认 |
| Inferred | 基于事实生成的可替换叙事，必须带 citations，绝不是原始证据 |
| Missing | 已知时间段或主张没有足够记录 |

`captureGrade` 描述采集来源，不等于 evidence level。Evidence level 必须逐事件/逐主张计算，不能用一个 session badge 升级全场。

## 2. 当前仓库里的真实基础

当前工作区已经包含 Replay V2 的大量未提交实现。新 Session 必须保留并演进这些改动。

### 已具备

- [`task_events`](../../packages/persistence/src/migrations.ts) 是不可变顺序 ledger；Replay 和 Home activity 都从它投影。
- [`file_changes`](../../packages/persistence/src/migrations.ts) 保存 change id、before/after hash、patch、author 和 tool call 关系。
- [`BlobStore`](../../packages/change-service/src/blob-store.ts) 以 SHA-256 内容寻址保存文件版本和大输出。
- [`TaskService.activity`](../../apps/desktop-main/src/services/task-service.ts) 将事件投影成 `ActivityItem`，补充工具 duration、diffstat 和 change ids。
- [`task.changeRecord` / `task.changeEvidence`](../../apps/desktop-main/src/ipc/activity-handlers.ts) 可以按 change id 读取 patch 和 before/after text。
- Pi managed run 的 message、plan、tool、permission、verification、report 等事件已经存在。
- 外部 Claude/Codex 会话已记录：入口快照、文件版本、脱敏 PTY 文本、结构化 observation 和结束状态。
- 外部 PTY 文本上限为 2 MiB；达到上限后文件与 structured evidence 继续记录。
- Claude parser 已识别 `system/init`、assistant text、`tool_use`、`tool_result`、result，并丢弃 thinking/redacted thinking。
- Codex parser 已识别 thread/turn/item、command、file change、web search、MCP、plan update、approval，并丢弃 reasoning item。
- 当前生产 UI 已有 A–E、1–16×、scrubber、文件 before/after、详情、审计和外部 capture boundary。

### 当前实现必须修正

1. [`ReplayView.tsx`](../../apps/desktop-renderer/src/views/ReplayView.tsx) 仍暴露 A/B/C/D/E 五个设计方向。
2. `AuditView` 和 `confidenceForActivity()` 使用 58/86/96% 一类启发式置信度，违反 V3 决策。
3. `replayGrade()` 只要看到一条 structured event 就把整个 session 提升为 structured，混合证据会被错误升级。
4. `CausalView` 主要按顺序画节点，容易暗示不存在的因果。
5. `SpatialView` 把应用事件文案写成 `verified event`，即使来源可能只是 observed。
6. `chapterItems()` 按数量抽样，不按影响、风险、审批、失败和验证选章节。
7. `buildReplayTimeline()` 只有真实墙钟时间，没有 Story Time、idle folding、grouping 或 coverage interval。
8. `ReplayView` 每两秒重新读取完整 activity；`TaskService.activity()` 又固定 `LIMIT 5000`，不满足 10k event gate。
9. 当前默认从 step 1 打开，不是 result-first。
10. 当前 `openReplay()` 只是 boolean，无法表达 task、入口深度、change/event anchor 或 live-follow。
11. 当前 stage 仍偏 file/code，并含装饰性 orbit；缺少 domain renderer registry。
12. 当前没有 Ask Replay、证据 export、Story/Real 切换、区间 coverage 或 mobile Verify sheet。

这些不是重新推倒的理由；它们正好定义了 V2 → V3 的改造边界。

## 3. 当前技术能力与不能承诺的部分

| 来源 | 当前可以可靠实现 | 当前只能降级实现 | 当前不能实现/不能声称 |
| --- | --- | --- | --- |
| Pi managed Agent | 用户目标、可观察消息、计划、工具调用、权限、文件、验证、final report | 非文件 domain 需要 adapter 才能提供丰富 preview | 隐藏思维链 |
| Claude/Codex 普通 TUI | 进程时间、脱敏终端输出、入口快照、每次观察到的文件版本 | 行为语义、决策原因、应用身份只能标 Observed/Unknown | 仅凭终端像素证明内部工具、因果、审批或隐藏推理 |
| Claude structured stream | parser 已能消费真实 JSON envelope 中的 tool/result/message | 普通交互 TUI 不会自动变成 stream-json；当前是 opportunistic capture | 将未真实收到的事件标成 Recorded |
| Codex structured JSONL/app-server event | command/file/web/MCP/plan/approval 等可结构化 | 普通 TUI 默认路径仍可能只有 observed PTY | reasoning item、私有内部状态 |
| MCP / app connector | 如果事件带 server/tool/app/resource，可以展示跨应用记录 | 需要 connector 提供稳定 resource id 和 relation id | 从屏幕或时间相邻推断跨应用关系 |
| 非编程工作 | UI 和 event model 可以支持文档、表格、研究、邮件、日历、审批 | 正式 recorder/adapter 尚未覆盖每个应用 | prototype 的假数据不代表生产已经采集到这些证据 |

结论：V3 在当前技术基础上可实现，但必须诚实降级。真正的“跨应用回放”取决于 MCP/provider/application adapter 发出结构化事件，而不是 Replay UI 自己猜。

## 4. 目标架构

```text
Pi events / Claude-Codex structured events / PTY+FS observations / app connectors
                                  │
                                  ▼
        task_events + file_changes + blobs + verification_runs
                   （唯一 durable source of truth）
                                  │
                                  ▼
                    ReplayService（Main 进程）
          facts · evidence · relations · chapters · coverage · summary
                                  │
                                  ▼
              versioned IPC：session / events / evidence / ask
                                  │
                                  ▼
           Replay controller（一个 task、一个 playhead、一个 selection）
                       │          │          │
                       ▼          ▼          ▼
                    Recap      Explore     Verify
```

不要在 React component 内继续堆 provider 解析、证据等级、章节排序和关系推断。可复用且影响信任的逻辑应放在 Main 或纯 model 层，并有单元测试。

### 4.1 推荐新增的 IPC DTO

在 [`packages/ipc-contracts`](../../packages/ipc-contracts/src) 中加入独立 Replay DTO；`ActivityItem` 继续服务 Home/mission control，不要被迫承担全部审计语义。

```ts
type ReplayDepth = 'recap' | 'explore' | 'verify';
type ReplayEvidenceLevel = 'verified' | 'recorded' | 'observed' | 'inferred' | 'missing';
type ReplayLane = 'intent' | 'actions' | 'artifacts' | 'risk';

interface ReplayFactDto {
  id: string;                  // stable event/fact id
  sequence: number;
  startedAt: string;
  endedAt?: string;
  storyStartMs: number;
  storyEndMs: number;
  lane: ReplayLane;
  actor: { kind: 'user' | 'agent' | 'application' | 'system'; label: string };
  action: string;
  target?: { type: string; label: string; app?: string; resource?: string };
  result?: { status: string; summary?: string };
  level: ReplayEvidenceLevel;
  capture: 'full' | 'structured' | 'observed';
  evidenceRefs: string[];
  relations: Array<{
    type: 'requested-by' | 'produced' | 'verified-by';
    factId: string;
  }>;
  risk: 'none' | 'low' | 'medium' | 'high';
  reversibility: 'reversible' | 'compensatable' | 'irreversible' | 'unknown';
}

interface ReplayEvidenceDto {
  id: string;
  type: 'event' | 'file-version' | 'tool-result' | 'verification' | 'permission' | 'terminal' | 'application';
  source: string;
  capturedAt: string;
  integrityHash?: string;
  beforeRef?: string;
  afterRef?: string;
  previewAdapter: string;
  redactions: Array<{ reason: string }>;
}

interface ReplaySessionDto {
  taskId: string;
  goal: string;
  outcome: 'completed' | 'partial' | 'attention' | 'stopped' | 'running';
  verification: 'verified' | 'partial' | 'unverified';
  actualDurationMs: number;
  storyDurationMs: number;
  eventCount: number;
  summary: {
    result: string;
    changed: string[];
    attention: string[];
    citations: string[];
  };
  chapters: Array<{ id: string; label: string; factId: string; storyStartMs: number }>;
  coverage: Array<{
    actualStartMs: number;
    actualEndMs: number;
    storyStartMs: number;
    storyEndMs: number;
    level: ReplayEvidenceLevel;
  }>;
}
```

字段命名可以调整，但必须保留：稳定 id、实际时间、Story Time、逐事实 evidence level、evidence refs、明确 relations、risk、reversibility。

### 4.2 推荐 IPC

- `task.replaySession { taskId }`：返回 session contract、summary、chapters、coverage、event count 和最新 sequence。
- `task.replayEvents { taskId, afterSequence?, cursor?, limit, filters? }`：分页返回 facts；默认 200，上限 500。
- `task.replayEvidence { taskId, evidenceId }`：按需读取 preview 和 integrity metadata；大文本不要塞进 session payload。
- `task.replayAsk { taskId, factId, question }`：Pass 3 才开放；返回 `{ text, citations, boundary }`。

Live mode 复用现有 `task.event` broadcast 或按 sequence 增量读取，不再每两秒拉全量 5000 条。

### 4.3 明确关系的来源

只允许以下关系进入 B 的遗产能力：

- permission/request event 与相同 `callId` 的 tool call：`requested-by`
- tool call 与 `file_changes.tool_call_id`：`produced`
- verification run 与被验证的 code revision/change/fact：`verified-by`
- provider/MCP event 中真实给出的 parent/call/resource id

禁止用数组相邻、时间接近或文案相似生成 causal edge。

## 5. 数据派生规则

### 5.1 Result card

Pass 1 先使用 deterministic templates，避免无引用模型总结：

| 字段 | 正式来源 |
| --- | --- |
| Original goal | `TaskDto.goalMd`，external task 缺失时明确显示“未记录原始目标” |
| Outcome | Task state + final report + failed/interrupted events；REVIEW_READY 表示“Agent finished, awaiting review”，不是已批准 |
| Changed | net change set + produced application artifacts；按风险/影响排序，最多 3 条 |
| Attention | error/denied/warn、失败验证、Observed/Missing 关键结论、不可逆动作 |
| Verification | `verification_runs` 的成功、失败、stale、superseded 状态 |
| Actual duration | 第一条到最后一条 event 的墙钟时间，live 时到 now |
| Story duration | Story Time projection 的最终长度 |

后续模型 narrative 必须保存 citations 和生成版本；叙事不能覆盖或伪装成 evidence。

### 5.2 Evidence level

推荐优先级：

1. 与成功且未 stale 的 verification/签名审批直接关联 → Verified
2. `captureGrade=full|structured` 且存在真实 evidence ref → Recorded
3. `captureGrade=observed` → Observed
4. Replay 生成的 result/chapter/answer narrative → Inferred，且 citations 非空
5. 明知存在结果或区间但没有 evidence ref → Missing

文件 change 本身不是 Verified；Pi 或 structured write 通常是 Recorded，外部 watcher write 是 Observed。只有验证结果或签名回执可以进一步支持 Verified claim。

### 5.3 Story Time

现有 real-time timeline 保留为投影之一，新增 Story Time mapping：

1. 将同一 kind/app/resource、短时间内重复且低影响的 read/search/terminal refresh 分组。
2. 将长 idle gap 折叠为 0.5–1.0 秒的 gap marker。
3. 以下事件不可跳过：error、denied、approval、high risk、irreversible、material change、verification、final result。
4. 普通事件分配短 frame；高影响事件分配较长 frame。
5. 目标总长 20–90 秒；短任务不得被强行拉长到 60 秒。
6. 每个 Story segment 保留 actual start/end，切换 Real Time 时同一 selected fact 不变。

不要只把真实总时长线性缩放成 60 秒；那会让重复 refresh 与审批拥有相同注意力。

### 5.4 Semantic chapters

替换 `chapterItems()` 的等距抽样。每类最多选最重要的事实：

- Request
- Approach
- Discovery
- Decision / approval
- Material change
- Problem / recovery
- Verification
- Result

排序分数只能用于选择章节，不显示给用户。建议加权：failure、approval、high risk、irreversible、produced artifact、verification、result 优先；重复和纯状态噪声降权。总数最多 8。

### 5.5 Coverage band

Coverage 是真实采集覆盖，不是置信度：

- 按 actual interval 计算来源等级，再投影到 Story interval。
- 一个 strong event 不能把前后 observed gap 染成 Recorded。
- 已知 session 活跃但没有任何 event 的长区间标 Missing 或 folded idle，不能静默延伸上一事件等级。
- 可显示“82% structured/full coverage”，但文案必须写 coverage，不得写 confidence。

## 6. Production UI 改造

### 6.1 组件边界

将 800+ 行的 `ReplayView.tsx` 拆成可测试组件；推荐结构：

```text
apps/desktop-renderer/src/views/replay/
  ReplayShell.tsx
  ReplayHeader.tsx
  SessionContract.tsx
  RecapDepth.tsx
  ExploreDepth.tsx
  VerifyDepth.tsx
  SemanticTimeline.tsx
  EvidenceDrawer.tsx
  ArtifactStage.tsx
  replay-controller.ts
  replay-model.ts
  renderers/
    FileRenderer.tsx
    DocumentRenderer.tsx
    SpreadsheetRenderer.tsx
    WebSourceRenderer.tsx
    MessageRenderer.tsx
    CalendarTaskRenderer.tsx
    ApprovalRenderer.tsx
    TerminalRenderer.tsx
    GenericActionRenderer.tsx
```

可以分批移动，但最终 `ReplayView.tsx` 只负责装配和 overlay 生命周期。

### 6.2 一个 controller

三层深度必须共享：

- `taskId`
- `depth`
- `selectedFactId`
- `actual/story time mode`
- `playhead`
- `playing`
- `speed`
- `liveFollow` / detached
- filters/search
- selected evidence

Depth change 不能 reset playhead。Real/Story change 不能改变 selected fact。

### 6.3 Replay entry state

把 `taskStore.replayOpen: boolean` 改为显式 request：

```ts
interface ReplayRequest {
  taskId: string;
  depth?: 'recap' | 'explore' | 'verify';
  anchor?:
    | { type: 'result' }
    | { type: 'fact'; id: string }
    | { type: 'change'; id: string }
    | { type: 'actual-time'; ms: number };
  liveFollow?: boolean;
}
```

入口映射：

- Home completed card → Recap/result
- Home running card → Recap/live-follow
- Task Room Replay → Recap/result
- Changes panel play → Recap/该 change 的 first fact
- External session ended toast → Recap/result
- Approval/high-risk notification → Verify/该 fact
- Evidence share link → Verify/该 claim

Replay overlay 必须绑定 request.taskId，不能依赖用户之后是否切换了 `activeTaskId`。

### 6.4 Artifact renderer registry

renderer 的选择依据是 evidence/target type，不是 agent 名称：

- file/code → before/after、patch、verification
- document → version passages
- spreadsheet → changed cells/formulas/chart impact
- web/research → source、captured excerpt、citation、resulting claim
- message/email → draft/final、recipient、delivery state，正文按 policy redacted
- calendar/task → before/new state、participants、due time
- approval/purchase → request、policy/checkpoint、approver、disposition
- MCP/application → normalized request/result、named app/resource
- unknown → generic observable action card

Pass 2 可以先让未实现 renderer 落到 GenericActionRenderer，但不能伪造 preview。

### 6.5 视觉实现约束

- 以 prototype 的层级、密度、状态语言为准，但使用产品现有 theme/skin tokens，不复制 Google Font `@import`。
- 使用现有 `Ic` icon family；不要 emoji、文本箭头或手写 SVG/CSS illustration。
- 删除装饰性 orbit、没有 relation id 的连线和无证据的空间节点。
- 1440px：chapter rail + stage + evidence drawer。
- 1024px：chapter 横向 strip，evidence overlay/sheet。
- mobile：Recap 垂直 feed，Verify receipt 与 evidence drawer 必须可达。
- `prefers-reduced-motion`、keyboard、focus-visible、screen-reader live announcement 是验收项。

## 7. “Ask this replay”实现要求

不要在前端根据 event 文案拼一个看似聪明的答案。Pass 3 的正确流程：

1. renderer 只提交 `taskId + factId + question`。
2. Main 读取允许的 facts/evidence，构造有界 context。
3. 将 evidence text 当作不可信输入，防止 prompt injection。
4. 模型输出结构必须包含 answer、citation ids、boundary。
5. Main 校验每个 citation id 真实存在且属于该 task；无合法 citation 则拒绝答案。
6. Ledger 无法回答“为什么”时，返回确定性 boundary：“记录只能确认 X，无法确认内部原因。”
7. answer 是 Inferred narrative；不得写回原始 evidence，也不得升级 evidence level。

在这条链路完成前，UI 可以显示受限 deterministic explanation，但不能放一个假 AI answer。

## 8. Evidence receipt 的诚实边界

当前 blob 有 SHA-256，但 `task_events` 不是签名或 hash-chained ledger。因此第一版只能叫“Evidence export / evidence receipt”，不能声称第三方不可篡改或 cryptographically sealed。

可实现的 receipt：

- task/session metadata
- event id + sequence + payload hash
- evidence id + blob hash
- redaction metadata
- verification/approval disposition
- app version、export time
- manifest SHA-256
- HTML + JSON 文件

如果以后要声称 signed/immutable，需要额外的签名密钥、hash chain 或远端 append-only/notary 设计；不属于纯 UI 工作。

## 9. 分阶段实施清单

### Phase 0 — 保护现有基础

- 先运行 `git status --short`，记录现有 dirty files；不要清理用户改动。
- 运行当前 Replay focused tests，确认 V2 基线是否仍绿。
- 为 V3 新 model/DTO 先写 failing tests，再改 UI。
- 如需更新 ADR，新增 Amendment 7 说明 A–E 被三深度取代，不要删除 Amendment 6 的历史。

### Phase 1 — 完成 V3 信息架构

- `ReplayMode A–E` → `ReplayDepth recap/explore/verify`
- 新 Replay request/store，支持 task/depth/anchor/liveFollow
- Session contract + result-first default
- 一个共享 controller，切 depth 不丢位置
- 去掉 numeric confidence 和 session-global upgrade
- 新 evidence level mapping 与 coverage band
- Story/Real time 和 semantic timeline
- A stage 迁入 Recap；D list 迁入 Explore；E evidence table 迁入 Verify
- B 只保留 explicit relations；C 只保留 app/resource lanes/filters
- 保持现有 diff、change evidence、keyboard 和 external boundary 能力

Phase 1 完成后，核心产品才算从“五选一”变成“一段故事三层深度”。

### Phase 2 — 可扩展数据与非编程任务

- 新 Main-side ReplayService 和 versioned IPC
- 事件分页/增量；移除每 2 秒全量 polling
- 支持 10k events 的 virtualization、search、filters
- semantic chapter ranking 与 Story Time grouping
- artifact renderer registry
- 最少交付 file/code、document/generic、terminal、web/source、spreadsheet、approval renderer
- 用真实 normalized fixtures 覆盖研究、表格、消息/日历、审批任务；不要直接复用 prototype 假数据

### Phase 3 — 信任、协作与 Live

- evidence-bounded Ask Replay
- running session Watch live + detach/follow
- Evidence receipt HTML+JSON export
- redaction reasons 与 missing evidence 展示
- explicit relations 从 Pi、MCP、Claude/Codex structured stream 持久化
- Home、Changes、external toast、approval 的全部入口

若某个 adapter 没有真实数据，允许 GenericActionRenderer + Missing/Observed 降级，不允许伪造完成。

## 10. 测试计划

### Unit / contract

扩展或新增：

- `replay-model.test.ts`
  - real/story mapping 保持同一 fact
  - idle folding、repeat grouping、mandatory event 不丢
  - mixed coverage 不发生 session upgrade
  - evidence level mapping
  - semantic chapters <= 8 且失败/审批/验证优先
  - 无 relation id 不产生 causal edge
  - 10k facts 的 projection 性能
- `activity.test.ts`
  - Pi/full、external observed、structured event 的 provenance
  - verification 与 change evidence refs
- `external-replay-parser.test.ts`
  - partial JSON 不泄露
  - thinking/reasoning 永不进入 observation 或 terminal documentary text
  - secret redaction
  - app/resource/relation id 仅来自真实字段
- IPC schema tests
  - pagination cursor、limits、invalid task/evidence isolation
- ReplayService tests
  - result card deterministic citations
  - event/evidence belongs-to-task boundary
  - receipt manifest hash reproducible
  - Ask citations fail closed

### Electron E2E

建议新增 `tests/e2e/replay-v3.spec.ts`，并保留现有 replay/external regression：

1. Managed Pi task 打开时先见结果卡，不 autoplay。
2. UI 不再出现 A/B/C/D/E peer navigation 或 numeric confidence。
3. Play、pause、scrub、1–16×、Story/Real 可用。
4. Recap → Explore → Verify 保持同一 fact 和 playhead。
5. result claim 三次交互内到达 evidence。
6. change anchor 从 Changes 打开到正确 fact。
7. 普通 external TUI 仍显示 Observed 和能力边界。
8. structured Claude/Codex event 才显示 Recorded app/tool evidence。
9. 失败、审批、不可逆动作、verification 在 90 秒 recap 中不被跳过。
10. 10k fixture 可以搜索和 scrub，renderer 不出现长任务阻塞。
11. 1440、1024、390 三个宽度无 persistent control overflow；mobile Verify evidence 可达。
12. keyboard、focus、reduced motion、console/pageerror 全绿。

### 建议命令

```bash
# 先跑 focused baseline
npx vitest run \
  apps/desktop-renderer/src/views/replay-model.test.ts \
  apps/desktop-main/src/services/external-replay-parser.test.ts \
  packages/ipc-contracts/src/activity.test.ts

# 新 V3 focused E2E
npx playwright test --config tests/e2e/playwright.config.ts \
  tests/e2e/replay-v3.spec.ts \
  tests/e2e/p2-parallel-replay.spec.ts \
  tests/e2e/external-cli.spec.ts

npm run check
npm test
node scripts/build.mjs
```

最终交付前再跑完整 E2E。不要只靠 prototype 浏览器测试证明 production Electron 功能完成。

## 11. Definition of Done

- [ ] A–E 不再作为 peer navigation 暴露；Recap / Explore / Verify 正式落地。
- [ ] 默认 frame 是 result-first，且不自动播放。
- [ ] 三层深度共享 task、playhead、selected fact、selected evidence。
- [ ] Story Time 不是线性缩短；mandatory events 永不省略。
- [ ] Real Time 可以还原实际 wall-clock gap。
- [ ] 每个 fact 有独立 evidence level，timeline 有 interval coverage。
- [ ] 全产品没有启发式 numeric confidence。
- [ ] 无 relation id 不显示因果关系。
- [ ] Plain TUI 永不被升级为 structured/recorded。
- [ ] Pi、plain Claude/Codex、structured Claude/Codex 均有测试。
- [ ] 文件、generic document/action、terminal、web/source、spreadsheet、approval renderer 可用或诚实降级。
- [ ] 10k events 可搜索、虚拟化、scrub，不阻塞 renderer。
- [ ] Ask Replay 只返回带合法 citations 的答案，否则明确无法确认。
- [ ] Receipt 不声称超出实际 integrity 能力。
- [ ] Home、Task Room、Changes、external toast、approval 入口传递正确 anchor/depth。
- [ ] 1440/1024/mobile、keyboard、a11y、reduced-motion、console health 通过。
- [ ] `npm run check`、unit、focused E2E、full E2E、production build 通过。
- [ ] 更新 ADR、IMPLEMENTATION_STATUS、TEST_REPORT 和本 handoff 的实际完成状态。

## 12. 明确非目标与禁止事项

- 不展示、存储或重建 hidden chain-of-thought。
- 不把终端像素、时间相邻或文案相似当成因果。
- 不把 coverage percentage 命名为 confidence。
- 不建立第二份 transcript/replay 数据库取代 `task_events`。
- 不让 Replay 播放修改真实工作区；Replay 默认只读，rollback 必须走已有授权/Review 路径。
- 不把 external unmanaged CLI 描述成 Tool Gateway 管理的 Agent。
- 不复制 prototype 的静态场景作为生产数据。
- 不为了 Replay 清理或 reset 当前 dirty worktree。
- 不在没有签名基础设施时声称 receipt “不可篡改”或“已签名”。

## 13. 新 Session 的第一段执行顺序

1. 读本文和第 0 节列出的文件。
2. `git status --short`，确认现有 V2/外部会话改动仍在。
3. 跑 focused unit baseline；若红，先区分 pre-existing failure 与本功能问题。
4. 先实现 Replay DTO、evidence-level mapping、Story projection 和 tests。
5. 再把 `ReplayView` 重构成三层共享 controller；不要先从 CSS 开始。
6. 完成 Phase 1 production Electron E2E 后再进入 domain adapters。
7. 每个阶段都更新测试证据；不要等最后一次性补测试。
8. 继续执行 Phase 2/3，直到 Definition of Done，除非用户明确缩小范围。

可以把下面这段直接作为新 Session 的开场指令：

> 请阅读 `docs/design/session-replay-v3-implementation-handoff.md`，在当前 dirty worktree 上继续实现 Agent Replay V3。不要 reset 或覆盖无关改动。以 `session-replay-unified-experience-v3.md` 和可交互 prototype 为产品合同，以现有 Replay V2、task_events、file_changes/blobs、ExternalSessionService 和 structured parser 为技术基础。按 handoff 的 Phase 0→3 执行并完成测试；不要停在方案说明，也不要重新实现第二份 mock 数据层。

