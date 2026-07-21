# ADR-0039: 剪贴板图片浮卡 — 不落盘的截图也能一步喂给 agent

- Status: Accepted (user decision 2026-07-21 "需要，直接帮我实现这个功能吧")
- 日期: 2026-07-21
- Relates to: ADR-0036 (截屏浮卡 — 本 ADR 反转其"剪贴板轮询"替代方案的否决), ADR-0024, ADR-0030

## 背景

ADR-0036 的目录 watcher 只覆盖**落盘**的 OS 截屏。真实排障发现（2026-07-21）：
用户机器上 watcher 正常运行、监听 `~/Desktop`，但全盘 Spotlight 找不到任何
`kMDItemIsScreenCapture` 文件——用户的截图习惯是微信截图 / `⌘⇧⌃4` 类
**仅剪贴板**路径，图片从不落盘，浮卡对这批用户完全失效。中文用户圈里
"截图进剪贴板"是主流习惯，这不是边缘场景。

ADR-0036 曾把"剪贴板轮询检测截屏"列为被否替代方案（理由：功耗与权限）。本 ADR
针对这两点给出具体设计后**反转该否决**：目录 watch 与剪贴板 poll 并存，喂同一条
浮卡管线。

## 决策

1. **主进程 `ClipboardScreenshotWatcher` 服务**（darwin && 非 E2E，
   `PI_IDE_CLIPBOARD_CAPTURE=0` 可关）。**元数据优先轮询**控制功耗与隐私面：
   - 每拍先 `clipboard.availableFormats()`（NSPasteboard types 查询，不读内容，
     不触发 macOS 26 pasteboard 内容访问提示）；
   - 仅当剪贴板是**裸图片**（含 `image/*` 且不含 text/plain、text/html、
     text/rtf、text/uri-list）才 `readImage()` + 位图 sha1 指纹。文本混载 =
     复制的内容（浏览器图片带 `<img>` markup、Finder 文件带 uri-list），不是
     截图工具的输出——这是噪音过滤的核心启发式；
   - 指纹去重 + **空闲退避**：同一张图停在剪贴板时轮询间隔 1.2s×1.6 递增，
     封顶 5s（连拍第二张最坏 5s 延迟）；指纹变化/非图片即复位；
   - **启动基线**：第一拍只记指纹不播报——app 启动前就在剪贴板里的图片不弹卡。
2. **PNG 落到受管目录再进原管线**：新图写入
   `userData/clipboard-captures/Clipboard <日期> at <时间>.png`（临时文件+rename
   原子写，重名 `-2` 后缀，**会话内文件名永不复用**——被淘汰文件的名字仍在
   announce 去重集合里，复用会静默丢卡；会话保留 16 张 FIFO，启动清上一会话
   遗留）。经 `ScreenshotWatcher.announce()`（新公开的统一入口，目录探测尾部
   同路）进入同一 allowlist / recent 环 / `screenshot.captured` 广播——渲染进程
   读取面不变，仍只有 watcher 见过的路径。
3. **事件负载**：`ScreenshotCaptureSchema` 增加可选 `origin: 'file' |
   'clipboard'`（缺省 = 'file'，纯增量可选字段，事件保持 v1）。浮卡仅换头部
   （"Clipboard image" / ⌘C 字形），三路动作（喂 agent / 标注 / 收素材）与
   ADR-0036 完全复用。
4. **误报即功能**：裸图片不全是截图（预览"拷贝图片"、微信聊天里复制图片也算）。
   卡片零副作用、8s 自动收起，"你刚复制的图片可以喂给 agent"本身即合理提议，
   故不做进一步截图判别。

## 修订

- **am.1（2026-07-21，用户验收反馈）**：验收发现"无活跃会话 → Keep for next
  Session"路线喂出的图，Pi 会话看不见——Home charter 把 pendingRefs 拍平成
  goal 纯文本 `Context files:\n- @path`，Pi runtime 无读图工具，模型只拿到
  路径字符串（路径解析本身正常：agent 成功 Listed 并核对了字节数）。修复：
  charter 引用分流（`charterRefs.ts`）——图片扩展名（镜像
  ATTACHMENT_IMAGE_MIMES）的 refs 改走 `task.start` 的 `fileRefs`
  （kind 'image' + 项目相对 path → `resolveFileRefImages` 项目根封禁后读成
  prompt 图片字节，ADR-0024 原路），每消息上限 4 张、溢出与非图片保持文本、
  永不静默丢弃；外部 CLI charter 维持全文本 `@ref`（Claude Code/Codex 自带
  读图工具）。

## 替代方案

- **NSPasteboard changeCount 原生监听**：Electron 未暴露，需原生模块——违背
  依赖极简；轮询 + 元数据优先已把内容读取压到"裸图片在场"时才发生。
- **粘贴（⌘V）拦截替代轮询**：只覆盖用户主动粘贴进 Charter 的场景，"截完图
  Charter 自动冒卡"的核心体验（无需切窗口）就没了，被否。
- **settings 开关**：沿 ADR-0036 先例 v1 默认开、无 UI 开关；环境变量
  `PI_IDE_CLIPBOARD_CAPTURE=0` 作应急关闭口，用户反馈打扰再补 settings 节。

## 安全与数据影响

- 剪贴板**内容**读取仅发生在"裸图片在场"时；类型查询不触发 macOS 26
  pasteboard 提示，首次内容读取可能弹一次系统提示（用户"始终允许"即可，验收
  说明记载）。
- 图片字节只写入 userData 受管目录（会话 16 张上限 + 启动清理），经既有
  allowlist 通道进渲染进程，不出本机。E2E 永不启用（OS 剪贴板不可测控），单测
  以注入 read/thumbnail/now 全覆盖。
- 渲染进程能力零扩张：读取面仍是 `ScreenshotWatcher.seen()` 集合。

## 迁移/回滚

无数据迁移。回滚 = revert 本次提交（`origin` 为可选字段，旧渲染端忽略之）。

## 验证证据

- 单测：`clipboard-screenshot-watcher.test.ts` 9 条（裸图片启发式、基线跳过、
  新图播报+PNG 落盘+origin、指纹去重、同秒 `-2` 后缀、16 张保留、启动清理、
  超限跳过、dispose）；`screenshot-watcher.test.ts` +1（announce 去重与
  seen/recent 注册）。
- `npm run check` + 全量 vitest 通过（见 IMPLEMENTATION_STATUS）。
