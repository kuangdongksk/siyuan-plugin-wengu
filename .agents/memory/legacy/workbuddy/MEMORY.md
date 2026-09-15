# 温故（siyuan-plugin-wengu）· 项目长期记忆

## 工作流（2026-09-10 起，最高优先级约定）

- **云端开发，本地只调度**：所有**业务代码**改动一律由 CNB 上的 NPC 完成；
  本地（飒飒 + 青简）只负责**审查 / 出方案 / 调度**——开 Issue、召唤 NPC、
  跟踪流水线、审 PR、合并。
- **例外**：`.cnb/`、`.cnb.yml`、AGENTS.md 的协作约定段属「调度基础设施」，
  本地可直接改并推 `dev`。`src/`、`tests/`、正式文档无例外。
- 标准流转：本地出方案 → 开 Issue（带文件路径 + 可验证验收标准）→ 召唤 →
  NPC 拉 dev 分支实现并开 PR → 本地独立验证 → 合并。
- **一次只跑一个 NPC 任务**，避免多个 PR 抢改同一文件。

## CNB 关键事实

- 仓库：`sasa1107/open-source/si-yuan/siyuan-plugin-wengu`（私有）。
  remote `cnb` = CNB，`origin` = GitHub（历史存档），两边 `dev` 保持同步。
- `dev` 是长期开发分支 **且** CNB 默认分支（NPC 流水线固定跑默认分支）；
  `main` 只作发布分支。PR base 一律 `dev`。
- 召唤必须写完整路径：`@sasa1107/open-source/si-yuan/siyuan-plugin-wengu(青简)`，
  裸 `@青简` 无任何反应；且评论**必须带 work-mode**（勾「替我上班」/
  API `post-issue-comment --work-mode`），否则 NPC 只有读权限。
- 模型配在 `.cnb.yml`（`.cnb/settings.yml` 没有 model 字段）：`$` 兜底
  `deepseek-v4.1-flash`，「复核」角色 = `glm-5.3-flash`。
- 排查命令：`cnb build get-build-logs --event issue.comment@npc -v` 取 sn；
  `cnb build get-build-stage --sn <sn> --pipelineId <sn>-001 --stageId stage-0 -v`
  看实时日志；`cnb build get-build-ai-audit --sn <sn> --pipelineId <sn>-001 -v`
  核对实际模型与用量。
- CNB 文档站是 VitePress：URL 末尾加 `.md` 拿全文 markdown
  （网页版对 internal-steps 这类长页会截断）。

## 审查口径

- 不信 NPC 自述：拉 PR 分支到独立 worktree 跑
  `pnpm test` / `pnpm check:svelte` / `pnpm lint` / `pnpm format:check`。
- ⚠️ `pnpm lint` = `eslint . --fix`，**会就地改文件**，必须在独立目录跑。

## 项目侧要点（细节见 AGENTS.md）

- 源码 `src/` 按功能分域（siyuan / ai / quiz / convert / word / bank）；各域
  `index.ts` 必须是编排代码，禁止纯 re-export barrel。
- 重复的流程知识沉淀到 skill：`~/.workbuddy/skills/cnb-npc-dev/`。
