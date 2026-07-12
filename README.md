# Pi-powered Agentic IDE — Specification Package v1.0

把本目录内容放到新项目根目录，然后让 Claude Code 先阅读 `CLAUDE.md`、`docs/PRODUCT_ENGINEERING_SPEC.md` 与 `docs/IMPLEMENTATION_BACKLOG.md`。

## 文件角色

- `CLAUDE.md`：Claude Code 的强制执行协议。
- `docs/PRODUCT_ENGINEERING_SPEC.md`：完整产品、UX、架构、状态机、需求和发布验收的唯一规范源。
- `docs/PRODUCT_ENGINEERING_SPEC.docx`：供产品与人工评审的排版版。
- `docs/IMPLEMENTATION_BACKLOG.md`：12 个 Milestone 的执行任务与依赖。
- `docs/IMPLEMENTATION_STATUS.md`：持续更新的实施状态。
- `docs/DECISIONS.md`：架构决策记录索引。
- `docs/TEST_REPORT.md`：测试与发布证据。
- `docs/RELEASE_CHECKLIST.md`：Stable 发布前检查。

## 启动指令建议

向 Claude Code 发出：

> 阅读 CLAUDE.md 和 docs 下的完整规格。先建立需求追踪表和 Milestone 1 的任务分解，然后开始实现。不得停在原型或阶段性演示；每项只有通过验收后才能标 VERIFIED，并持续更新 IMPLEMENTATION_STATUS.md。
