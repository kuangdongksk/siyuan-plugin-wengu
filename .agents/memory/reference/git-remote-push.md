---
name: git-remote-push
description: 本项目 git 远端与推送方式、多机并行开发策略；20260910 起开发全走 CNB issue+NPC（本地只调度，业务代码不再本地改/推 dev）
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_3bdb5d2e-1541-4791-98ce-e871f3905338
---

2026-08-21 本项目仓库 git 状态：

- origin（GitHub 仓库）＝ `git@github.com:kuangdongksk/siyuan-plugin-wengu.git`，默认分支 `main` 停在本地骨架 4953c79（已推 origin/main）。
- 开发分支 `dev`，已推 `origin/dev` 并设上游跟踪。
- **本机没有 `gh` CLI**（brew 安装 gh 被中断，`brew list gh` 无 keg）；但 `~/.ssh` 配了 GitHub ssh 密钥（`~/.ssh/github`，config 指向 github.com，`IdentitiesOnly yes`），`ssh -T git@github.com` 认证通过（用户 kuangdongksk）。推送直接用 `git push -u origin <branch>` 即可，无需 gh。
- 模板远程保留为 `upstream`（siyuan-note/plugin-sample），不要 push 到它。
- **gitignore 补充**：远端已加 `package-lock.json`；本机加 `.pnpm-store/`（pnpm 本地缓存目录）——两者都属"pnpm 残留文件勿入库"。

2026-08-24（拉取时发现）**两台机器在并行开发同一个仓库**：

- 本机（机器 A）推的 `dev`（HEAD=40dc7c7）只是骨架 + 块优先契约；远端 `dev` 已被另一台机器（机器 B）推到 008b64f，领先约 72 个提交：背单词（word-timing/dock）、不背单词交互对齐、AI 转换+渐进式呈现、分批转换、PDF 一键导入、错题闪卡、多步引导题/brief AI 判分、并发了 `wengu/pdf-import` 分支（尚未并入 dev）。作者均为许冬冬。
- **分叉处理**：本地独有的修复提交（如"题目查询按 id 匹配/enumerate options"）往往是冗余的——远端已在后续提交里包含更完善的等价修复。合并采用 `git rebase --skip` 丢弃本地该提交，直接接受远端（远端是权威实现行）。
- 合并后本地 dev 与 `origin/dev` 同步（008b7f 之后又加了 gitignore/.pnpm-store 提交推回）。
- **决策**：构建时以远端 `origin/dev` 为准（它才是当前能力实际存在的行）；若后续在此大摊代码上做新功能，方向需结合远端已落成的功能，避免重复造轮子。相关：[[pivot-to-ai-block-conversion]]、[[siyuan-api-patterns]]。

2026-08-25（机器 B）**大合并会无声复活旧代码**：9057724「图标去字符化」（«/»→iconLeft/iconRight、难度星 iconStar、statusIcon、i18n 剥 ✓✗◐）在 HEAD 祖先链上且其余项存活，唯独 CardHtml 的 «/» 两行被 english/ai-gen 分支合并解决冲突时吃了修复前旧侧（那两个分支在修复前分叉）。`git log -S` 默认不显示 merge 提交的计数变化，这类回退无声无息，靠 `git log --all -S <特征串>` 对照祖先链才考古出来。**教训**：每次大合并后抽查已知修复是否存活（grep 特征串：iconLeft/iconStar/wengu-dialog/b3-text-field 等）；用户说「我记得改过」时优先相信并考古，别当作从未做过。

20260914 **用户点名例外：小修本地直改 + 直推 dev 双远端**。当日两例：题库串行落盘链（用户「那就你来改吧」，08a31f3）与 Open Design 设计稿（8affba9），均已 `git push cnb dev && git push origin dev` 双推（cnb 7ce262c..8affba9、origin 57e94cd..8affba9，GitHub 走 SSH 慢但可达，cnb 走 https）。含义：「业务代码不本地改/推 dev」降级为**默认路径**——用户点名「你来改」「推送」时本地直改直推不算违规；change 与 design 文档类同样适用。

**20260916 CNB 仓库转移：新路径 `bianchao777/sasa/siyuan-plugin-wengu`**（用户转移到别的组织；web = https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu）。转移后的三件事：

1. **老路径 API 有重定向别名仍可用**（`cnb pulls list-pulls --repo sasa1107/open-source/...` 照常返回数据），但 **git 直接 not found**——找新路径的办法：对老路径发 `cnb repositories get-by-id`，返回体里的 `path`/`web_url` 就是新位置（用户没说新组织名时先试这个，别瞎猜）。
2. **换 remote 后 git 仍 not found ≠ 路径错**：是 osxkeychain 缓存了旧 token（`remote: token: 3d***OA` 不变）——`cnb login` 重新授权**不够**，必须 `printf "protocol=https\nhost=cnb.cool\n" | git credential-osxkeychain erase` 清钥匙串再 fetch 才通。
3. **此后所有 cnb CLI 调用 `--repo` 用新路径**；AGENTS.md 与 `.cnb/ISSUE_TEMPLATE/` 里的旧路径已全量换新直推 dev（8233417+0649b45，20260916 傍晚收口，见 [[cnb-npc-full-workflow-first-run]]）。⚠️ 最大暗雷=**NPC 提及不跟 API 重定向走**：旧 `@sasa1107/...` 召唤零流水线零报错，召唤语必须写新路径 `@bianchao777/sasa/siyuan-plugin-wengu(青简)`。
