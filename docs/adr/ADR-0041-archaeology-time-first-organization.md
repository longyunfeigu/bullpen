# ADR-0041: 考古页时间优先组织 — 状态降级为行内标记与筛选

- Status: Accepted (user decision 2026-07-21)
- 日期: 2026-07-21
- Relates to: ADR-0038 (会话考古 — 本 ADR 调整其决策 7 的列表组织方式)

## 背景

ADR-0038 的 `ArchaeologyView` 按归属状态分节：「Discovered outside
Charter」/「Directories never opened in Charter」/「Already tracked by
Charter」，节内按 `endedAt` 倒序。实际使用暴露出问题：首次打开时几乎全部
会话都是 External（实测 89/89 落在同一节），**分组维度没有区分度等于没有
分组**；且状态信息在每行已编码两次（External/Tracked 药丸 + Resume/Open
按钮），节标题是第三遍冗余。与此同时用户回忆一段会话的索引是时间加地点
（"昨天下午在 bullpen 里那次"），时间却只以行尾相对时间戳的形式弱呈现。

## 决策

1. **时间升级为一级结构**（`bucketSessionsByDay`，纯函数）：按本地日历日
   分桶 Today / Yesterday / Past 7 days / Earlier / Undated（`endedAt`
   为空或不可解析）。桶粒度取回忆视距而非逐日——30 天窗口逐日分组会产生
   30 个标题噪音。桶内保持 host 已排好的新→旧顺序；空桶不渲染；
   `Math.round` 吸收 DST 偏移日；未来时间戳并入 Today。
2. **状态从分组降级为筛选**（`filterSessions` + `ArchaeologyFilter`）：
   列表顶部 All / External / Tracked 三个 chip（含计数），二元属性做筛选
   而非分组。Tracked 行混排在时间轴内，靠既有药丸与 Open 按钮区分。
   筛选后为空显示专用空态（`arch-filter-empty`）。
3. **「Directories never opened in Charter」保持独立区块**：它是另一种
   实体（目录，地点维度的下钻入口），不混入会话时间轴，仍只在全机 scope
   显示，置于时间轴之后。

## 替代方案

- **保持状态分组、组内加时间子标题**：双层标题过重，且不解决"状态维度
  无区分度"的根本问题，弃用。
- **逐日分组（每天一个标题）**：30 天窗口尾部退化为一行一标题，弃用。
- **状态优先以最大化收编转化**：收编是逐条行为（用户找到"那一条"再
  Resume），入口在行内一个不少；找到那一条靠时间。弃用。
- **筛选态放 archaeologyStore 持久化**：视图局部 `useState` 足够，换
  scope/重开重置为 All 反而符合预期，不引入存储面。

## 安全与数据影响

纯渲染端重组：无新通道、无 schema 变更、无新能力面。`archaeology.scan` /
`archaeology.adopt` 契约不变。

## 迁移/回滚

无持久化变更。回滚 = 还原 `ArchaeologyView.tsx` 分节渲染与 store 两个
纯函数。

## 验证证据

- `apps/desktop-renderer/src/store/archaeologyStore.test.ts` +4 例：
  日历日边界（今日 00:05 / 昨日 23:55）、6 天前 vs 7 天前的 week/earlier
  分界、空桶省略、未来/不可解析时间戳降级、filter 三态。测试用本地时区
  构造时间戳，跨时区确定。
- `npm run check` 与全量 `npm test`（748 passed）通过。
