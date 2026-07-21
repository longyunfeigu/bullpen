# ADR-0042: 左侧导航与主区域始终对应 — 导航组拥有自己的主 surface

- Status: Accepted (user decision 2026-07-21 "这是一类问题，你应该修复这样的一类问题")
- 日期: 2026-07-21
- Relates to: ADR-0024 (Files 面板投喂对话)、ADR-0029 (railView 提升到
  appStore / 单一项目树)、ADR-0038/0041 (考古页)

## 背景

用户报告的一类 bug：左侧 activity bar 在 Sessions / Projects 间切换时，只有
侧栏面板变化，主区域仍显示上一个区块的内容（如 Sessions 里打开的会话房间在
切到 Projects 后原样留存；从 Projects 打开的考古页在切回 Sessions 后也原样
留存）。根源：主区域由四个互斥字段决定
（`sessionTerminalId > taskRoomTaskId > archaeology > projectTool > home`，
HomeShell 渲染优先级），而 `setRailView` 只改侧栏、从不触碰这些字段；反向
也一样——`openTaskRoom` 等 opener 从不摆正 railView。左右两侧各自为政，
任何跨区导航都产生"左右不对应"的陈旧态。

## 决策

1. **导航组模型**（纯函数 `railGroupOf`）：rail 四个视图分成两个导航组。
   `sessions / inbox / files` 同属 **workbench** 组——inbox 是会话的过滤
   视图，Files 面板的职责是向打开的对话投喂上下文（ADR-0024），三者共享
   主区域；`projects` 自成一组。**组内切换绝不触碰主区域**（保护投喂流），
   **跨组切换时主区域跟随**。
2. **主 surface 身份**（纯函数 `mainSurfaceOf`，镜像 HomeShell 渲染优先
   级）：`home | room | terminal | project-tool | archaeology` 五种。
3. **跨组切换 = 快照 + 恢复**（`setRailView` 收口）：离开一组时把当前
   surface 存入 `savedSurfaces[组]`；进入目标组时经 **原 opener** 重放其
   记忆的 surface（openTaskRoom/openArchaeology/… 的互斥、tool 重置、peek
   作用域等不变量免费成立），无记忆则回 home。从 Sessions（开着房间）切到
   Projects 再切回，房间原样恢复。
4. **opener 反向摆正 rail**（`crossRailPatch`）：打开某组拥有的 surface 时
   若 rail 停在另一组，翻转 railView 并快照被离开的组——
   `openTaskRoom`/`openTerminalSession` → `sessions`（在考古页点 Open/
   Resume 后 rail 跟到 Sessions）；`openArchaeology` → `projects`；
   `setProjectTool`/`setSurface('workspace')`/`showSideBarView(search|scm)`
   → `files`（ADR-0029 的 editor+Files 树配对从调用点收编进 store）。
   同组内调用不动 rail（inbox 里点会话不被拽去 sessions）。
5. **调用点契约**：先切区、后落显式意图。`startSession` 原先"设 composer
   → 最后 setView('sessions')"，恢复逻辑会用旧 surface 盖掉 composer；
   改为先 `setView` 再 `closeTaskRoom`+`setSurface('home')`（同一事件内
   同步完成，React 合批无闪烁）。项目行点击处的手动 `setView('files')`
   删除（store 已配对，异步 openPath 下反而抢跑）。

## 替代方案

- **跨组切换一律重置回 home（无记忆）**：实现最小，但"瞄一眼 Projects 再
  回来，会话房间被关了"制造新的惊讶，弃用。
- **每个 railView 一个记忆槽（四槽）**：Sessions⇄Files⇄Inbox 本就共享一个
  工作台语境，切 Files 若换 surface 会杀死投喂流程，弃用。
- **持久化 savedSurfaces**：主 surface 本身（房间选择等）从不跨重启持久
  化，记忆槽跟随其生命周期，不落盘。
- **恢复时校验 task/terminal 仍存在**：需要 appStore→taskStore 反向依赖
  （层次倒置）。会话内对象极少凭空消失，且恢复经 opener 走正常渲染路径，
  最坏是空房间可导航离开。记录为已知限制，不为此引入循环依赖。

## 安全与数据影响

纯渲染端导航状态重组：无通道、schema、能力面变更。

## 迁移/回滚

无持久化变更（sessionStorage 仍只存 railView）。回滚 = 还原 appStore 的
setRailView/opener 与 SessionRail 两处调用点。

## 验证证据

- NEW `apps/desktop-renderer/src/store/appStore.nav.test.ts` 12 例：分组/
  surface 派生、跨组清空+返程恢复（房间与考古页双向）、组内切换不触碰主
  区域、opener 翻转 rail 并记忆被离开组、inbox 内打开房间不拽走面板、
  setProjectTool 仅跨组时配对 files。
- e2e：`project-files-restructure`（项目行 → files tab 配对）、
  `session-workbench` 全量 10 例（含暴露调用点时序问题的
  "binds a project, then starts a native Agent"）、`m4-search-lsp-terminal`
  通过；全量 e2e 见 IMPLEMENTATION_STATUS。
- `npm test` 渲染端全过（并行会话在途的 skill-usage byConsumer 改动导致
  其自己的 5 例失败，与本 ADR 无关）。
