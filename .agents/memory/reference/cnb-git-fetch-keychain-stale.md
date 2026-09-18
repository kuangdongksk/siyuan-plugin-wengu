---
name: cnb-git-fetch-keychain-stale
description: cnb 远端 git fetch 报「仓库不存在」的解法——osxkeychain 旧凭证作祟，用 ~/.cnb/token 的
    access_token 走 http.extraHeader Bearer
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_f064d4f3-35bc-4ea5-8a4e-d4c6e52bc143
---

20260916 起本机（机器 B）`git fetch cnb` 稳定报 `repository 'https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu.git/' not found`，但 cnb CLI 一切 API 正常——**是 osxkeychain 里 cnb.cool 的旧/无效凭证**（全局 credential.helper=osxkeychain），不是仓库真没了（API `get-repos` 能看到、curl Bearer 探测 `/info/refs` 200）。

**已根治（20260916 晚，SSH 不可行后走 helper）**：`~/.gitconfig` 里 `[credential "https://cnb.cool"]` 配了两行——**空 `helper =`（重置行，必须在前面，屏蔽系统级 osxkeychain 的旧 token）+ `helper = !cnb git-credential`**。git 对 cnb.cool 直接用 CLI 登录态（~/.cnb/token），fetch/push 验证均过。⚠️ 旧 token 失效时只需 `cnb login` 重新授权一次，CLI 与 git 一起恢复（用户拍板的心智）。SSH 路已否：22 端口 No route to host、443 是 HTTPS 不收 SSH。临时绕过（已不需要，留档）：`git -c http.extraHeader="Authorization: Bearer $TOKEN" fetch cnb`，TOKEN 从 ~/.cnb/token 的 JSON 里取 access_token（直接 cat 整文件当 token 会 401）。

相关：[[git-remote-push]]、[[machine-b-env-pitfalls]]。
