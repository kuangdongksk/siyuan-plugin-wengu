---
name: scheduling-20260918-two-fixes
description: 20260918 晨调度：装机 dev@93001b7 + 两报障开单（#169 继续上次被空轮埋没 / #170 AI面板叶行挤）双 NPC 并行，#170 已出 PR#171 待审
metadata:
    node_type: memory
    type: project
    originSessionId: sess_a1e34516-cf90-485b-be44-2894bd05a991
---

20260918 晨会话事实（细节见 [[english-conversion-yield-42-vs-5]] 与 [[cnb-cli-command-calls]]）：

- **拉取装机**：cnb/dev `5b8acc4`→`93001b7`（5 提交，核心=PR #162 word 移动端样式反压修复），构建+拷四件+重载+探针（`wengu-word-entry`）全过。旧提交顺带更正远端口径=origin=CNB、github=存档。
- **#169「进度与范围没有继续上一次」**（已派 NPC，分支 `fix/resume-skip-empty-tail`，流水线 pending）：查 history 店实诊——涉事政治卷所有有作答的轮都已收卷（**无丢进度**），最后一轮是空轮（answered=0，其一 mu6anse2-2zarfg 开轮 3 秒被写 endedAt）；判据 `answered>0 && !endedAt` 本身对，坑在候选轮只看数组末元素（`StartPanel.ts` 的 buildStartPanelModel 与 startRound 两处），尾随空轮把恢复入口永久埋掉。修法=从尾向前找第一个有作答未收卷轮；已知修完存量数据也不会现选项（可续的轮确实都交了）。
- **#170 AI 面板叶行「太挤」**（已派 NPC，已出 [PR #171](https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu/-/pulls/171) head `31635e7` 待审）：设计稿 leaf=三件（点+名+徽标），`wengu-aipanel-meta` 是 #129 间隙期第四件，类别段与组行重复。PR 自述判据用 `lv.spin`（视图词表，避 #92 词表混用坑）、i18n `aiRowMeta` 改一段式。审查 worktree 已建 `/tmp/wengu-review-171`（fetch cnb 分支后 add FETCH_HEAD + 软链 node_modules——直接 worktree add 分支名会 invalid reference，须先 fetch）。
- **材料块 type 属性无害**：`QuestionDraft.ts` 落盘时 `d.material` 走独立分支，attrs.type 被静默丢弃——AI 在 @@Q material=1 上写 type=single/cloze 不污染题型并集，prompt 无需禁。
- 弃轮空轮生命周期存疑：mu6anse2 开轮 3 秒即被收卷（非擦除）的路径没查清，#169 里作为调查项丢给了 NPC。
