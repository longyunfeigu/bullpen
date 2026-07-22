# ADR-0046: 进入会话即切换工作上下文 — Files 树跟随所选会话的项目

- Status: Accepted (user report 2026-07-22 「我点击某个项目和项目下的 session
  的时候，Files 也应该显示这个项目的文件，而不是别的项目」)
- 日期: 2026-07-22
- Relates to: ADR-0024/0029 (rail Files 面板 = 唯一项目树，投喂对话)、
  ADR-0042 (导航组拥有主 surface)、PIVOT-006 (打开项目落 IDE surface)

## 背景

Session Rail 按项目分组列出所有项目的会话，点击任意会话即可打开其房间——
房间的数据（timeline、diff）都是 task 级 RPC，与当前 workspace 无关。但
rail 的 Files 面板（ADR-0029 唯一项目树）绑定的是**全局 workspace**，只有
显式的项目打开动作（Projects 面板、New Session 的项目选择器、Open Folder）
才会切换它。结果：用户点开 fable5 项目下的会话，切到 Files 标签，看到的仍
是上一次绑定的 charter-site 的文件——左侧两个标签页对同一次选择给出两个
项目，无法为当前会话投喂上下文。

## 决策

**用户进入哪个会话，哪个会话的项目就是工作上下文。** 打开会话房间（或
rail 里的外部 CLI 终端会话）时，若其 `projectPath` 与当前 workspace 不同，
自动执行 `workspace.open` 跟随过去——Files 树、编辑器、composer 绑定随之
对齐。具体：

1. `workspaceStore.followProject(path)`：空路径或同路径为 no-op；切换前置
   `homePick`，使 `workspace.changed` 处理器不把 surface 拽去 IDE（跟随是
   隐式上下文对齐，不是 PIVOT-006 的显式打开）；打开失败（项目目录已删）
   还原 homePick 并 toast 错误，workspace 留在原地。
2. `appStore.openTaskRoom` 收口任务会话：打开房间后经动态 import（taskStore/
   workspaceStore 均反向依赖 appStore，静态引用成环）查 task 的 projectPath
   并 followProject。所有入口（rail 点击、⌘1-9/⌘[]、QuickLauncher、通知
   激活、考古页 adopt、编队、Review 等）自动获得同一行为；task 不在列表时
   静默跳过（新建任务必属当前 workspace）。
3. 无任务的裸终端会话（claude/codex CLI 行）在 SessionRail 点击与键盘导航
   处按终端的 `projectPath` 跟随——不下沉进 `openTerminalSession`，因为那
   需要 appStore 动态 import TerminalPanel（xterm 链对 node 侧单测致命，
   见 archaeologyStore 同款注释）。

## 后果

- 会话分组头的展开/折叠**不**切换上下文——折叠动作不该有副作用；点击组内
  任意会话行才是"进入"。
- 快速连点两个不同项目的会话存在既有的 homePick 布尔竞态（两次 changed
  事件，第二次可能落 setSurface('workspace')）；与 startSession 同源，
  罕见且不新增，未在本 ADR 范围内改 homePick 语义。
- ADR-0042 的 surface 恢复（跨导航组返回时重放 openTaskRoom）同样触发跟随
  ——回到会话即回到其项目上下文，与本决策一致。
