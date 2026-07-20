# ADR-0029: 单一项目文件树 — rail Files 面板成为唯一的树，编辑器表面移除 Files 工具列

- Status: Accepted (user decision 2026-07-20，口头验收：合并方案，无需 mockup)
- 日期: 2026-07-20
- Relates to: ADR-0024 (rail Files 面板/上下文喂给), ADR-0023 (分组 rail), ADR-0014 (session shell), PIVOT-016 (agent 写入发光), PIVOT-027r (树内点击 → Peek), ADR-0013 (git 装饰), ADR-0017 (外部会话 Editor 工具)
- Supersedes in part: ADR-0024 中「Editor 表面保留 canonical `ExplorerView`」的表述；`project-files-restructure`（"one canonical contextual tree" 位于编辑器旁）的布局结论

## 背景

ADR-0024 给 session rail 加了 Files 页签（上下文喂给树）之后，应用同屏存在两棵几乎一样的项目树：

1. rail 的 `SessionFilesPane` + `HomeProjectTree`（搜索、拖拽、hover “+”、room 打开时点击 = Peek）；
2. 编辑器表面 `ProjectToolView` 的 Files 工具列 `ExplorerView`（右键管理菜单、内联新建/重命名、忽略文件开关、虚拟滚动、git 标记）。

用户在验收截图中指出两栏冗余，并选定“合并”终局：**项目里只应有一棵文件树**。

## 决策

1. **一棵树 = `ProjectTree`（新组件）**。以 `ExplorerView` 为骨架（虚拟滚动、右键菜单：New File/Folder、Open in Browser、Rename、Delete→Trash、Copy 相对/绝对路径、内联输入），并入 `HomeProjectTree` 的能力（拖拽 `dragRefs`、hover “+” quick-add、room 同项目时点击 = Peek，⌘/⌥/Ctrl-click 强制跳编辑器）。testid 沿用 `explorer` / `tree-item-*` / `tree-git-*` / `explorer-inline-input`；quick-add 为 `tree-add-*`。`ExplorerView.tsx`、`HomeProjectTree.tsx` 删除。
2. **树只挂在 rail 的 Files 面板**（`SessionFilesPane`）。面板头部新增管理动作：New File（`explorer-new-file`）、Refresh、忽略文件开关；无项目空态提供 Open Folder。搜索（`search.files` 扁平结果）不变。
3. **编辑器表面移除 Files 工具列**。`ProjectTool` 的 `'files'` 改名 `'editor'`（纯编辑器，无上下文列）；工具 tab 仅剩 Search/Changes，点击已激活 tab 收起回 `'editor'`（替代原 `project-context-toggle` 按钮）。context aside 始终占位（grid 两列布局），`'editor'` 态 `aria-hidden` + `inert`。
4. **railView 提升到 appStore**（`railView` + `setRailView`，sessionStorage 持久化不变）。“打开项目文件”类流程（Projects 面板点项目）= `setProjectTool('editor')` + `setRailView('files')`；⌘⇧E（`view.explorer`，无 room 时）只翻转 rail 到 Files；进入编辑器/QuickOpen 等其它路径**不**劫持 rail 页签。编辑器空组空态新增 “Browse project files” 按钮指向 Files 面板。
5. **外部会话 Editor 工具（ADR-0017）内嵌树替换为同一 `ProjectTree`**（`SessionTerminalView`），不再有第二实现。
6. 遗留死代码 `HomeSidebar.tsx` 删除，`needsAttention`/`ATTENTION_STATES` 迁至 `views/labels.ts`。

## 替代方案

- **仅同屏互斥（保留两树）**：改动最小但两套实现继续漂移，被否。
- **削薄 rail Files 页签只留搜索**：违背 ADR-0024 的拖喂核心体验，被否。
- **进入编辑器表面时自动切 rail 到 Files**：会抢走用户的 rail 状态（sessions 列表消失），并破坏大量以 sessions 视图为前提的流程；仅在显式“打开项目文件”流程做该跳转。

## 安全与数据影响

无新 IPC/权限面；文件管理操作沿用既有 `fs.create/rename/trash/openInBrowser` 通道与 Tool Gateway 之外的用户直接操作路径。无迁移；`charter.rail.view.v1` 键与取值不变。

## 迁移/回滚

回滚 = revert 本次提交（组件删除与 testid 变更集中、无数据迁移）。

## 验证证据

- `tests/e2e/project-files-restructure.spec.ts` 重写：无 Files tab、rail 单树、树内新建文件、Search/Changes 折叠往返、900px 窄宽 rail 面板保留。
- 受影响 specs 更新为经 `rail-tab-files` 进树：m3/m4/m5/m10/p3/p4/site-assets2/ui-shots-*、room-context-feeding（`tree-item-*`/`tree-add-*`）。
- `npm run check` + 相关 e2e 通过（见 IMPLEMENTATION_STATUS）。
