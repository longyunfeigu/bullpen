# ADR-0030: 外部会话单输入口 — CLI 自己的输入行是 Room 唯一的对话面

- Status: Accepted (user decision 2026-07-20，HTML mockup 浏览器验收：`docs/design/external-terminal-single-input.html`，选区注入选定 B 案)
- 日期: 2026-07-20
- Relates to: ADR-0017 (外部会话一等 Task Room), ADR-0024 (Room 上下文投喂对齐), ADR-0022 (code context refs)
- Supersedes in part: ADR-0017/ADR-0024 中外部 Room 底部 product composer（`ExternalContextComposer` + `external.message` 通道）的全部表述

## 背景

外部 CLI 会话（Claude Code / Codex）的 Task Room 同屏存在两个输入口：终端里 CLI
自己的输入行，和底部的 product composer（打字后由主进程 bracketed-paste + 延时
回车代发）。用户验收时无法分辨第二个输入框的职责（"下面那个框是干嘛的？"），
且代发消息"凭空出现在终端里"的观感与 CLI 原生心智模型冲突。用户裁定：**删除
底部 composer，终端是唯一输入口**；拖拽文件与代码选区直接落进 CLI 自己的输入行。

## 决策

1. **`ExternalContextComposer` 删除**，`external.message` 通道与
   `ExternalSessionService.sendMessage` 一并移除（唯一调用方就是该 composer）。
   Home 启动带首条 prompt 的路径（launch intent → `armPromptDelivery`）不受影响。
2. **新通道 `external.injectContext`**（v1，schema:
   `{ taskId, ref: file{path,isFolder} | selection{code: CodeContextRef} }`）：
   主进程校验后把引用写进会话 PTY——bracketed paste、**刻意不带回车**。
   文件 → `@path `（目录带尾斜杠）；选区 → `formatPromptWithCodeContext` 的
   冻结快照块（B 案：字节随粘贴走，后续文件改动不影响所引内容）。
   payload 构造为纯函数 `externalInjectText`（单测覆盖"永不含 CR"契约）。
3. **拖拽落点 = 终端**。外部 Room 的终端列接管 dragover/drop：树内拖拽
   （dragRefs 相对路径）与 OS 文件（`workspace.relativize`）注入 `@引用`；
   项目外条目跳过并 toast 说明（@引用按契约是项目相对路径）。live 态显示蓝色
   落点提示（"松手插入，不代发"）；ended 态拦截并引导 Resume（沿用
   `externalStore.resumeTask`）。
4. **选区上下文分流**：`addCodeContext` 对外部任务不再进 draftStore chips，
   改走 `external.injectContext`（selection）；受管（Pi）会话路径不变。
5. **记账保留**：注入即记 `external.contextInjected` 台账事件（cli、kind、
   path、行区间、selectionHash），activity 映射为用户侧条目。会话命名来源由
   composer 首条消息改为 **typed-line 首次提交行**（placeholder 守卫，
   launch-intent 命名不被覆盖；产品写入经 `writeProduct` 屏蔽不参与命名）。

## 替代方案

- **保留 composer 仅去掉输入框（只留 chips）**：仍是双入口心智，被否。
- **选区 A 案（注入 `@path#行号` 活引用）**：CLI 发送时读活文件，无法表达
  "选中那一刻的字节"（diff/旧版本选区），用户选定 B 案。
- **注入后代发回车**：违背"所见即所发"，回到 composer 的隐式代发问题，被否。

## 安全与数据影响

PTY 写入面从"任意文本 + 代发回车"收窄为"结构化引用 + 永不回车"：注入内容由
schema 限定（路径强制项目相对、选区走既有 CodeContextRef 校验），TUI 处于
对话框态时最坏结果是输入行出现未发送字符，不会触发提交。台账事件不含选区
全文，只含路径/区间/哈希（全文已进 PTY，属会话终端记录）。

## 迁移/回滚

无数据迁移（`external.message` 无持久化消费方）。回滚 = revert 本次提交。

## 验证证据

- 单测：`external-session.test.ts`（`externalInjectText` 文件/目录/选区/无 CR）、
  `code-context.test.ts`（`ExternalInjectRefSchema` 路径逃逸拒绝）。
- e2e：`code-context.spec.ts`（claude/codex 冻结快照经真实 PTY 到达假 CLI，
  经 `external.injectContext`）、`claude-session-identity.spec.ts`（observed 回复
  presence 流程改为直接向 Room 终端打字触发）。
- `npm run check` 通过；mock 定稿见 `docs/design/external-terminal-single-input.html`。
