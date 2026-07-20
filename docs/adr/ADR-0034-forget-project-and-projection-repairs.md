# ADR-0034: 删除项目（forget project）+ 回滚后投影修复 + 房间自适应布局

- Status: Accepted (用户缺陷报告 2026-07-20：①Restore 后右栏 Diff 残留已回滚文件；②窄窗口下 composer 错位/幽灵横向滚动条；③Projects 列表没有删除入口)
- 日期: 2026-07-20
- Relates to: ADR-0006 (纯投影), ADR-0009 (全局任务), ADR-0017 (外部会话), ADR-0032 (会话即对话), §9.3 (IPC schema), §11.2 (持久化 schema)

## 背景

三个用户报告的缺陷，排查后归结为四个根因：

1. **一条遗留脏行毒死整个 `task.list`。** pre-ADR-0030 构建写入过
   `external_json.status = 'interrupted'`（现行 `TaskExternalSchema` 只接受
   `active|ended`）。`task.list` 响应是全量任务数组，路由层响应校验
   （§9.3）对整体 fail-closed —— 一行脏数据让**所有** `refreshTasks()`
   永久失败（dev 日志反复出现 `ipc response schema violation`），冷启动的
   会话列表与 rollback 后的兜底刷新全部失效。
2. **回滚后「已触文件」投影只增不减。** `activityStore.fold` 的
   `filesTouched` 只做并集；`task.rolledBack` 事件不携带任何"重置"语义。
   同时 `taskStore.rollbackTask()` 成功后不清/不刷 `changeSet`。结果：左侧
   文件树（watcher 驱动）正确显示文件已删，右栏 Diff 工具仍展示已回滚文件
   的 hunks 和计数。
3. **Session Canvas 断点看窗口宽度，不看房间实际可用宽度。**
   `@media (max-width: 1120px)` 无法感知侧栏/文件树占用 —— 1500px 窗口开着
   侧栏与 1100px 窗口不开侧栏一样挤。两栏 `min-width: 390px` 在挤压下溢出
   （`overflow: hidden` 裁掉右栏、居中的 reply 卡片向左溢出被裁）；
   `.rt-scroll` 未禁横向溢出，宽内容会在 composer 上方长出常驻横向滚动条。
4. **Projects 列表没有任何移除入口**（用户建了 abc/abc1 测试项目后无法清理）。

## 决策

### 1. 数据修复：迁移 + 读侧归一（双保险）

- **迁移 v7 `repair-legacy-external-status`**：
  `json_extract(external_json,'$.status') NOT IN ('active','ended')` 的行
  一律归一为 `'ended'`（非活即结束）。
- **`rowToDto` 读侧防御**：解析 `external_json` 时对越界 status 同样归一为
  `'ended'` —— 恢复备份/未来漂移不再能毒死列表响应。schema 词汇表**不**扩
  （现行代码不再写 `interrupted`；不为死词汇扩枚举）。

### 2. 回滚重置投影（live 与 replay 同一条规则）

- `ActivityItem` 增加可选 `filesReset: boolean`；纯投影
  `projectActivityEvent` 仅对 **`task.rolledBack`**（全量回滚，字节级还原
  一切）置 `true`。`turn.rolledBack`（单轮回滚）保持只加不减 —— 早先轮次
  的改动仍然在。
- `activityStore.fold` 遇 `filesReset` 从空集重新累计（ADR-0006：live fold
  与 replay 用同一投影，两者永不讲不同的故事）。
- `taskStore.rollbackTask()` 成功后立即 `changeSet: null` 并重新拉取 ——
  打开中的 Diff 工具不可能继续渲染已回滚的 hunks。

### 3. 房间自适应：容器查询取代窗口断点

- `.tr-root` 声明 `container: task-room / inline-size`。
- 原 `@media 1120px`（双栏改上下堆叠）与 `@media 920px`（头部/按钮收缩）
  改为 `@container task-room (max-width: 880px / 700px)` —— 断点量的是房间
  **实际分到的宽度**。`hm-*` 规则同时服务 Home composer（无容器上下文），
  为 Home 保留等效 `@media 920px` 块。
- 结构加固：`.rt-scroll { overflow-x: hidden }`（阅读列永不横向滚动，宽证
  据在自己的块内滚，如 `.md-codeblock pre`）；`.tr-ccard { min-width: 0 }`
  （flex 隐式 `min-width:auto` 曾让居中卡片撑出列外被裁成 "…eply"）。
- 已核验容器不改变 overlay 语义：`position: fixed` 的浮层（Review/Replay/
  QuickConsole 等）全部挂在 Workbench overlayRegistry，位于 `.tr-root` 之外。

### 4. 删除项目 = 「忘记」（forget），永不碰磁盘

- **新通道 `workspace.remove`**（v1，`{ path }` →
  `{ removed, removedSessions }`）。
- 语义：删除 workspace 行 + 该项目全部会话记录（tasks 及 task_events、
  tool_calls、agent_runs/sessions、file_baselines/changes、verification_runs、
  permission_*、memory_*、ui_workspace_state、task_conversation_references），
  单事务完成。**磁盘上的项目文件永不触碰。**
- 防护：仍有运行中会话（运行态 state 或 external `status='active'`）→
  `WORKSPACE_REMOVE_BLOCKED` 拒绝（崩溃遗留的假运行态由启动时
  `system.interruptedByRestart` 修复，不会永久卡死）。当前打开的项目在防护
  通过后先 `host.close()` 再删。
- UI：Projects 面板行尾 hover 出垃圾桶（ArmedIconButton 两击确认）；有会话
  记录时再加一次 `window.confirm`（明示记录数与"不碰磁盘文件"）。
- 已知取舍：
  - `task_conversation_references.source_task_id` 为 NOT NULL 外键 —— 其他
    项目引用被删任务的快照行**必须**级联删除（schema 决定，快照无法悬空）。
  - 内容寻址 blob 不回收（BlobStore 本就无删除路径，孤儿 blob 是既有设计；
    将来 GC 一并处理）。
  - TaskService 内存中的 ProjectContext/watcher 若已为该根创建，删除后闲置
    至重启 —— 无副作用（防护已保证无运行中任务）。

## 后果

- `task.list` 恢复可用：冷启动会话列表、rollback/accept 后的刷新链路全部
  恢复；单行数据损坏从「全局故障」降级为「单行自愈」。
- Restore 后房间三处一致：文件树（watcher）、Diff 工具（changeSet 重取）、
  文件计数（filesTouched 重置）讲同一个故事；replay 回放同一事件序列得到
  同样结果。
- 布局对「窗口 − 侧栏」的真实预算响应，不再依赖用户屏幕尺寸的巧合。
- 测试：迁移 v7（修复/不误伤）、removeWorkspace（级联/拒绝/缺失）、
  投影 filesReset（全量重置/单轮不重置）均有单测覆盖。
