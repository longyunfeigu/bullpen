# TODO — Home v2 (P1→P3) then M10→M12

> 用户睡前全权委托（2026-07-13 夜）：不再提问、跳过 mockup 确认、按 ADR-0005/0006 完成
> P1→P2→P3 → M10 → M11 → M12，全部完成后**停下等通知**。
> 设计基准：`docs/adr/ADR-0006-activity-stream-replay-parallel.md` + `docs/UX_PIVOT_SPEC.md`
> PIVOT-011..020。视觉基准：`docs/design/home-v2-mockup.html`（状态①—⑥）。
> 规矩不变：TDD、每阶段全量回归（unit + 全部 E2E 两轮）、milestone 提交、更新
> IMPLEMENTATION_STATUS/HANDOFF、不许削弱验收。

## P1 — Home v2 核心 + 指挥台 + 通知 + 上下文投喂（PIVOT-011..015）

### P1a 合同与主进程

- [ ] `packages/ipc-contracts/src/activity.ts`：ActivityItem schema + `projectActivityEvent`
      纯投影（tool.call→语义 kind：write/command/read/search/plan；agent.message→message；
      agent.question→question；permission.\*→permission；verification.\*→verification；
      task.stateChanged→state；report.final→report；user.message→user/answer）。
      label 生成人话（"Edited src/x.ts (+18 −4)" / "Ran npm test (exit 0)" / 中性动作句）。
      单测覆盖所有事件类型 + 未知类型返回 null 不炸。
- [ ] channels：`task.activity {taskId, tail?}`（main 投影 + tool_calls 时长 + file_changes
      diffstat/paths 富化）；`task.changeRecord {taskId, changeId}`；EVENT_CHANNELS
      `app.focusTask {taskId}`。
- [ ] `persistToolAudit`：非终态 audit 也广播 ephemeral task.event（sequence 0，
      type 'tool.call'，payload 含 state），终态照旧持久化（现状不变）。
- [ ] settings schema：`notifications: { enabled: boolean }`（默认 true）；
      确认 `general.theme` 默认 'system'（PIVOT-011），不是则改默认 + 迁移说明。
- [ ] `apps/desktop-main/src/services/notification-service.ts`：TaskService.onStateChanged
      钩子（新增 listener set）→ 边沿去重 → 窗口聚焦时抑制 → Electron Notification →
      点击 focus window + broadcast app.focusTask。单测（注入 fake notifier/focus 探针）。
- [ ] `workspace.relativize {paths}` channel（拖拽路径归一化/边界判定）。
- [ ] `RecentWorkspaceDto.kind?`：main 列 recents 时廉价探测（package.json→node、
      pyproject/requirements→py、Cargo.toml→rust、go.mod→go、index.html→web）。

### P1b 渲染器

- [ ] `store/activityStore.ts`：全局订阅 task.event/task.stream/task.stateChanged；
      perTask{last, tail(50), filesTouched, running}；pulse ring（path+taskId+at）
      + 衰减（~4s）；初始 hydration 用 task.activity(tail)。
- [ ] Home v2 重写（`views/HomeView.tsx` + `styles/home.css` + `views/home-icons.tsx`）：
      左侧栏（brand/New Task/Reviews badge/Projects(active=当前 workspace, 点击经
      homePick 切换)/Tasks(状态点)/底部 Open IDE workspace + Settings）；
      主区 hero + composer（项目·分支 chip[git.status]、textarea、审批 select、模型
      select、＋ 附件、发送圆钮、Advanced 展开=boundaries/success criteria→acceptance[]
      + verification 建议/自定义）；指挥台（composer 下方 Needs you / Running 卡，
      live 当前动作行，点击直达任务）。testid 兼容清单：home-view/home-intent/
      home-project/home-recent-\*/home-open-folder/home-mode/home-model/home-submit/
      home-enter-ide/home-settings/home-task-\*（E2E 依赖，mode/model 保持原生 select）。
- [ ] 拖拽/@：drop 文件→workspace.relativize→路径 chip（出界 toast）；@ 弹 search.files
      选择器；提交时 refs append 进 goalMd。preload 暴露 webUtils.getPathForFile。
- [ ] 时间线路径可点：AgentPanel tool 卡 + 指挥台卡 label 里的 workspace 相对路径
      linkify → 打开编辑器（切 workspace surface）。
- [ ] SettingsView：notifications 开关。
- [ ] 主题：Home 用现有 --var 双主题（system 默认已支持，验证 light 全链路无硬编码色）。

### P1c 验证

- [ ] 单测：activity 投影、notification 服务、relativize、titleFromIntent 不回归。
- [ ] E2E 重写/新增：pivot-shell.spec 适配新 Home（侧栏选项目、composer 提交）；
      新增 home-v2.spec（指挥台出现 Running/Needs you 卡 + 点击跳转；Advanced 展开建任务
      带 acceptance/verification；拖拽 chip 模拟=直接 fill @？用 @ 选择器路径）；
      全量两轮绿 → commit `feat(home-v2): P1 …` + 文档更新。

## P2 — 并行 + 光效 + 回放 + ⌘K（PIVOT-016..018）

- [ ] ToolGateway `modeForTask` resolver（删 mutable mode 单飞 hack）+ 单测。
- [ ] TaskService 并发上限 `settings.agent.maxConcurrentRuns`（默认 3）+ 队列 drain
      + 单测（1=旧行为）。worker 并发 pump 验证（apps/agent-worker）。
- [ ] 光效：activityStore pulse → Home 项目行/任务卡 glow 衰减 + workspace 文件树节点
      glow（file-tree 组件挂 pulse 订阅）。禁轮询。
- [ ] 回放：task.activity(full) + task.changeRecord；`views/ReplayView.tsx`（scrubber、
      ←→/space、步详情=动作卡+写入 diff(存储 patch 渲染)+命令摘要、累计文件镜头、
      作者区分 agent/user/system）；入口：AgentPanel header + ReviewView。只读。
- [ ] ⌘K：全局 palette（projects/tasks/files/actions 分组、类型徽章、纯键盘）。
- [ ] E2E：parallel-two-tasks、replay 走查、⌘K 键盘流；全量两轮绿 → commit。

## P3 — 轻改（PIVOT-019..020）

- [ ] ADR-0007：Markdown 富编辑依赖选型（Milkdown vs TipTap，commonmark round-trip、
      bundle、维护性；精确锁版本）→ 实现 .md 富/源切换，dirty-guard 与 Monaco 同语义。
- [ ] 图片标注：自研 canvas（箭头/矩形/马赛克/撤销），`image.saveAnnotated` channel
      存副本（不覆盖原图），"attach to task"。
- [ ] E2E + 全量两轮绿 → commit。

## 然后 M10 → M11 → M12（见 docs/TODO_M8_M12.md 原条目），全部完成后停下等用户。

## 已核实的架构事实（编码时直接用）

- task_events 每插入必 broadcast('task.event')（全任务、全窗口）——dashboard 免新广播。
- tool.call 只在终态入 timeline；audit 回调起始也触发（persistToolAudit 首插）。
- file_changes 每步存完整 unified patch + before/after hash + toolCallId + author。
- AgentHost.activeRuns 是 Map（多 run 原生支持）；mock runs/sessions 均按 id Map。
- 并行唯一真堵点：TaskService.hasActiveRuns 门闸 + `gateway.mode = task.mode` 共享突变。
- 主题三态基建已在（appStore.applyThemeAttribute + theme.css 双套变量）。
- 渲染器 palette 状态已有（appStore.paletteOpen——⌘K 需另立 overlay，勿混用）。
- E2E 稳定性模式：poll-click、先断言内容再输入、testid 兼容清单见上。
