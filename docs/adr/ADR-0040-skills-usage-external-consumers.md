# ADR-0040: Skills 透视纳入外部 CLI 消费方 —— Charter / Claude Code / Codex 分账

- Status: Accepted (产品对齐 2026-07-21:同一批 skill 被多个 CLI 共用,单看 Charter 账本会把"外面天天用"的 skill 误判为 unused)
- 日期: 2026-07-21
- Relates to: ADR-0037 (skills 透视), ADR-0038 (session archaeology), §9.3 (IPC schema)

## 背景

ADR-0037 的使用量只统计 Charter 自己的账本(`tool_calls` 的 `load_skill` +
`skill_invocations`)。但 skills 目录(`~/.claude/skills`、`~/.codex/skills`、
`~/.agents/skills`)天然被多个 CLI 共享:用户在 Claude Code / Codex 里独立
使用同一批 skill,这些调用完全不计入,导致:

1. "unused 45d" 徽章与断舍离建议对外部重度使用的 skill 给出错误信号;
2. 用户想知道"这个 skill 在 Claude Code 里到底用了多少",无处可看。

数据可得性(本机实测):Claude Code 转录
(`~/.claude/projects/**/*.jsonl`)把每次 skill 调用记录为 assistant 行的
`tool_use { name: 'Skill', input: { skill } }`,行级 `timestamp` 可用,且
ADR-0038 的 `parseClaudeTranscript` 已经提取该信号(缺时间戳)。Codex 侧
229 个本地会话零 skill 痕迹,调用落盘格式无法验证。

## 决策

### 1. consumer 维度贯穿:events → 聚合 → DTO v2 → UI

- 三元组 `SKILL_CONSUMERS = ['charter', 'claude', 'codex']`(与
  `archaeology.ts` 的 `DISCOVERED_CLIS` 呼应)。
- `skill-usage.ts` 事件带 `consumer`;`aggregateSkillUsage` 单遍同时累加
  合计与对应消费方切片(共享窗口/时钟 clamp/周桶逻辑,两个视图不可能不一致)。
- `SkillUsageDto` 顶层 `uses/lastUsedAt/weekly` 语义改为"跨消费方合计",
  新增必填 `byConsumer.{charter,claude,codex}`(各自 uses/lastUsedAt/weekly,
  桶数与合计一致);`skills.usage` channel **v1 → v2**。
- `TaskService.skillUsage` 改为 `skillUsageEvents`(返回原始事件),聚合
  上移到 `skills.usage` handler,与外部事件合并后统一进行。

### 2. 只计 `tool_use Skill` 事件,不解析 `<command-name>`

Claude Code 里用户敲 `/skill` 通常也触发 `Skill` tool_use,双算即重复计数。
纯斜杠、未触发工具的运行在 v1 少算(可接受,方向性偏保守);v1.1 若需要,
可加按轮去重后再计 `<command-name>` 行。sidechain(子代理)行沿用解析器
既有跳过逻辑,不计入。

### 3. 外部事件采集复用 archaeology(不新建扫描器)

- `TranscriptSummary` 增加 `skillEvents: {skill, at}[]`;无时间戳的行仍进
  `skills`(archaeology 展示用)但不产生事件。
- `SessionArchaeologyService.skillUsageEvents()`:仅遍历 Claude 候选文件
  (Codex 解析器不产事件,不走盘),复用 (path, mtime, size) 解析缓存与
  并发合并(`collecting` promise);无窗口参数 —— Claude 目录无日期分区,
  遍历成本固定,窗口无关的结果可安全合并并发调用,窗口过滤统一在聚合层。
- 首扫成本离关键路径:`skillsStore.init()` 在应用启动时即触发
  `refreshUsage()`,Settings 打开时命中缓存。`enabled` 门控沿用
  `!PI_IDE_E2E || PI_IDE_ARCHAEOLOGY_HOME`。handler 侧 try/catch,外部源
  失败降级为仅 Charter,面板永不因此损坏。

### 4. join 算法:外部原始名 → 目录运行时名

外部 CLI 记录的是原始调用名;目录运行时名经过 `skillSlug` 且冲突时被限定
(`pdf@claude`)。`joinExternalSkillEvents` 按优先级解析:

1. `(sourceId, skillSlug(displayName))` 命中 —— 外部 CLI 物理读的就是自己
   目录的副本(内建源 sourceId 恰为 `claude`/`codex`),冲突限定名正确落账;
2. 精确运行时名回退(该源无副本、名字未被限定时);
3. 丢弃。插件命名空间名(`plugin:skill`)不在目录内,自然丢弃 —— v1 接受,
   外部总量对重度插件用户偏低估。

### 5. Codex 保留位,不写猜测性解析器

数据模型与 UI 按三方设计,Codex 恒为零:229 个本地会话零 skill 痕迹,格式
无法实测,按路径启发式猜写解析器会产生无法察觉的误报/漏报。UI 上 Codex
筛选 chip 置灰并注明原因;待真实格式可验证后补 `parseCodexRollout` 即可,
契约与聚合无需再动。

### 6. UI 语义(`SkillsSettings.tsx`)

- **Via 筛选 chips**(All / Charter / Claude Code / Codex,带消费方色点):
  投影行级数字 —— 计数、火花线、全部排序跟随所选消费方;All = 合计。
  实现为纯函数 `projectUsage`(顶层三元组换成切片),下游 sort/spark 零改动。
- **火花线堆叠**:周桶内按固定消费方序分段着色(charter `#6ca1e8`、
  claude `#e0876a`、codex `#46b477`,均取自 INSIGHT_PALETTE 家族;预算条
  仍按目录序取色,两者视觉语境不同,接受)。
- **tooltip 明细**:`consumerBreakdown` 列出非零消费方各自次数与末次时间。
- **`unused 45d` 徽章**:改为全消费方合计为零才显示(全局健康信号,不随筛选)。
- **断舍离经济学仍按 Charter**:preamble 是 Charter 的成本,cost-per-use
  除以 `byConsumer.charter.uses`;合计为零 → 候选且预勾选;仅外部有使用 →
  候选但不预勾选,理由注明外部用量(用户显然在别处需要它);Charter 有用
  但贵 → 照旧不预勾选。

## 后果

- Claude Code 历史回溯即有(转录是既有数据);Codex 列上线即恒零,直到
  格式可验证。
- slug 撞名会静默合并计数;插件命名空间的外部用量不计 —— 均文档化接受。
- 首扫全量读 `~/.claude/projects`(mtime 缓存后增量);>50MB 转录沿用
  maxBytes 跳过;恰好名为 `Skill` 且带 `input.skill` 的无关 MCP 工具会被
  误计(与 archaeology `skills[]` 同等暴露,接受)。
- 渲染层继续只见 DTO;转录读取全部留在 main(§9.3 边界)。不新增依赖。
