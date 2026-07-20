# ADR-0036: 截屏浮卡 — 系统截屏落盘一步喂给 agent

- Status: Accepted (user decision 2026-07-20，HTML mockup 浏览器验收：`docs/design/screenshot-quickcard-mock.html`)
- 日期: 2026-07-20
- Relates to: ADR-0024 (Room 上下文投喂对齐，`task.attachments.import`), ADR-0030 (外部会话单输入口，`external.injectContext`), PIVOT-020 (图片标注器)

## 背景

vibe coding 最高频动作之一是"把我屏幕上看到的这个报错给 agent 看"。现状路径：
⌘⇧4 截屏 → 切到 Finder/Desktop 找文件 → 拖进 Charter 或 ⌘V。标注器、附件链、
拖拽/粘贴入口都已存在（ADR-0024 / PIVOT-020），缺的只是"截屏落盘 → 出现在
Charter 里"这最后一公里。用户裁定按 mock 实现，并明确：喂给的目标不仅是受管
Pi 会话（Composer 附件），也包括外部 CLI 会话（Claude Code / Codex）。

## 决策

1. **主进程 `ScreenshotWatcher` 服务**：启动时经 `defaults read
   com.apple.screencapture location` 解析截屏目录（失败/未设置回退 `~/Desktop`），
   `fs.watch` 非递归监听。新落盘的图片文件经**双重过滤**：(a) 尺寸稳定探测
   （两次 stat 间隔 200ms 相等，避开半写状态）；(b) darwin 上以
   `mdls kMDItemIsScreenCapture` 判真截屏（与语言无关），mdls 不可用时回退
   文件名模式（Screenshot / Screen Shot / 截屏 / 截图 / CleanShot）。只认
   watcher 启动之后出生的文件；同一路径只发一次。
2. **事件 `screenshot.captured`**（v1）推送 `{path, name, sizeBytes,
   capturedAtMs, thumbDataUrl}`；缩略图在主进程用 `nativeImage` 生成
   （宽 ≤360 JPEG data URL，上限 `MAX_SCREENSHOT_THUMB_CHARS`）。渲染进程
   永远拿不到任意 fs 读取能力：新增 rpc 通道 `screenshot.read`（读原图，
   用于标注底图）与 `screenshot.saveToAssets` 的 path 源都**只接受 watcher
   见过的路径**（主进程留存 seen 集合，上限 64 条 + recent 环形缓冲 5 条，
   `screenshot.recent` 可查）。
3. **浮卡（renderer `ScreenshotQuickCard`）**：挂在 Workbench 浮层（与 toasts
   同级），不抢焦点，8s 自动收起（悬停暂停），超时/关闭零副作用。连拍堆叠：
   卡片只显示最新一张 + "+N 更早"徽标；对当前张执行动作后弹出下一张，✕/超时
   一次清空整叠。三个动作按当前会话（`taskRoomTaskId`）分流，先例是
   `addCodeContext` 的双路（codeContext.ts）：
   - **喂给终端 agent**（主动作）——受管 Pi 会话：`task.attachments.import`
     （path 源，ADR-0024 原路）→ draftStore fileRef chip → `focusComposer`。
     外部 CLI 会话：先 `screenshot.saveToAssets` 拷进项目（`@引用`按 ADR-0030
     契约必须项目相对），再 `external.injectContext`（file ref，bracketed
     paste 不带回车）。无活跃会话：saveToAssets + `addPendingRefs`（随下一次
     Home charter 附上）。
   - **先标注再发**——复用 PIVOT-020 标注器（自 ImageView 抽出为独立
     `Annotator`，动作按钮参数化；ImageView 行为不变）。底图经
     `screenshot.read`；导出 PNG 按上述同样三路分流（bytes 源）。
   - **收进项目素材**——`screenshot.saveToAssets` 写入
     `<project>/assets/screenshots/<原名>`（重名 `-2`/`-3` 后缀，永不覆盖，
     临时文件 + rename 原子写，PNG bytes 源带 magic 校验），不打断对话。
4. **测试/E2E 可控性**：`PI_IDE_SCREENSHOT_DIR` 覆盖监听目录并跳过 mdls
   （目录内任何新图片都算截屏，测试确定性）；`PI_IDE_E2E` 且无覆盖时 watcher
   不启动（同 SkillStore 不摸真实 home 的惯例）。非 darwin 平台仅在显式覆盖
   时启用。
5. **记账**：外部注入沿用 `external.contextInjected` 台账事件（ADR-0030 原样）；
   Pi 路径沿用附件链既有记账。浮卡本身不新增账目——未被采取的动作不留痕。

## 替代方案

- **`external.injectContext` 增加绝对路径 ref**：违背 ADR-0030 "路径强制项目
  相对"的安全收窄，且 CLI 的 `@` 引用本就按项目相对解析，被否。
- **NSWorkspace / 剪贴板轮询检测截屏**：Electron 主进程无原生 API，轮询有功耗
  与权限问题；目录 watch + mdls 零权限、零轮询。
- **浮卡做成独立 always-on-top 小窗**：Charter 不在前台时也可见，但多窗口管理
  与焦点问题（spec §4 单窗口模型）成本高；v1 挂在主窗浮层，ADR 记为可能的
  后续增强。
- **watcher 加 settings 开关**：v1 默认开、无开关（卡片零副作用、数据不出本机）；
  若用户反馈打扰，后续在 settings `screenshots` 节补开关。

## 安全与数据影响

渲染进程对截屏文件的读取面 = watcher 见过的路径集合，无任意路径读取；写入面
= 工作区内 `assets/screenshots/`（`resolveInsideRoot` 约束）+ 既有
`attachments/<taskId>/` 导入路。bytes 源写入带 PNG magic 校验（同
`image.saveAnnotated`）。原截屏文件永不修改/移动/删除。缩略图与原图 base64
只经 IPC 进入本机渲染进程，不出本机。

## 迁移/回滚

无数据迁移。回滚 = revert 本次提交（新通道无持久化消费方）。

## 验证证据

- 单测：`screenshot-watcher.test.ts`（落盘触发/稳定探测/预存文件忽略/去重/
  dispose）、`screenshot-handlers.test.ts`（seen 集合约束、素材重名后缀、PNG
  magic、越界拒绝）、`channels.test.ts`（新通道 schema）、
  `screenshotStore.test.ts`（堆叠/弹出/清空语义）、`screenshotFeed.test.ts`
  （三路分流规划）。
- `npm run check` 通过；mock 定稿见 `docs/design/screenshot-quickcard-mock.html`。
