---
name: reply-with-pr-issue-links
description: 用户要求：每次回复必须带 PR 和 issue 的链接（CNB web URL）
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_fa8916aa-4b62-4fa1-af1a-face57737667
---

20260911 用户明示：「每次回复你都要带 pr 和 issue 链接，记住」。20260921 用户再纠：调度轮汇报仍用裸编号被点名——每条单据给 markdown 链接。

**Why**：调度场景下用户要一键跳转到 CNB 页面看单据/PR 详情，纯编号要手动搜。

**How to apply**：凡回复中提到 issue / PR（CNB 单据一律用链接，本地/gh 的 GitHub 单据同理用其链接）。CNB 链接格式（`/-/` 命名空间，仓库私有匿名抓 404 但登录态可开）：

- Issue：`https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu/-/issues/{编号}`
- 构建：`…/-/build/logs/{sn}`
- PR：`https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu/-/pulls/{编号}`
- 仓库：`https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu`（20260916 仓库转移后路径，旧 `sasa1107/open-source/si-yuan/` 路径链接永久失效；双远端见 [[remote-naming-per-machine]]）
