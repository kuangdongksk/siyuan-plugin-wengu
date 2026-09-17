---
name: wengu-cnb-cli-credential
description: cnb remote 鉴权改走 cnb-cli OAuth2+git credential helper，内嵌 token 的
  remote URL 已废弃（2026-09-12）
metadata:
  node_type: memory
  type: project
  originSessionId: sess_d169247f-5f10-46c8-bf8a-67217b560e33
---

2026-09-12 cnb remote 内嵌 token 过期（fetch 报「仓库不存在」，API 返回 401 errcode 16）。修复方式（机器 A 已生效）：

- `cnb login`（OAuth2 设备授权流，浏览器确认，token 本地保存）
- `git config --global credential.https://cnb.cool.helper '!cnb git-credential'`
- remote URL 改为净 URL（无内嵌 token）：`https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu.git`

**Why:** 内嵌 token 会过期且报错误导（「仓库不存在」像仓库被删，实为凭证失效）；credential helper 每次 git 操作实时取 CLI 本地 token，CLI 重新 login 即自愈，无须再改 remote。

**20260917 仓库已转移**：CNB 新路径 `https://cnb.cool/bianchao777/sasa/siyuan-plugin-wengu.git`（旧 `sasa1107/open-source/si-yuan` 层级已变，提交 8233417 全量换新），机器 A remote 已 set-url 换新并验证；再遇旧路径报「仓库不存在」先想到转移不是凭证。

**20260917 凭证遮蔽坑**：系统级 gitconfig 的 `credential.helper=manager` 排最前，Windows 凭证管理器里的过期 token 抢先命中（报错同「仓库不存在」），cnb 助手的 `cnb_…` token 轮不上。修复：`printf 'protocol=https\nhost=cnb.cool\n' | git credential reject` 清掉过期条目即落到 cnb 助手。**且 git fetch 可能卡死数分钟无输出 = GCM 弹了隐藏交互对话框**，非交互环境跑 git 网络操作须带 `GIT_TERMINAL_PROMPT=0 GCM_INTERACTIVE=never`。

**How to apply:** 再遇 cnb fetch「Repository Not Found」，先 `cnb status` 辨凭证；`git credential fill` 看实际解析到的 token 是否 `cnb_…` 开头——不是则是凭证管理器旧条目遮蔽，reject 清之；失效就 `cnb login` 重登，git 侧零改动。机器 B 的 cnb remote 仍是旧内嵌 token URL，首次用到前须照此迁移。API 手动探测时取 token：`printf 'protocol=https\nhost=cnb.cool\n\n' | cnb git-credential get`（action 是 get 不是 fill）。CNB pulls API 的 state 枚举是 `open`（不是 opened），直接用 `cnb pulls list-pulls --repo … --state open` 最稳。调度轮常用只读查询（20260913 实测）：`cnb issues list-issues --repo <org/repo> --state open --page-size 30`、`cnb pulls list-pull-files --number N`（输出大，grep 文件名）、`cnb pulls list-pull-commit-statuses --number N` 看 CI；输出是 `status: 200` + 缩进列表（非 JSON），grep `number:|title:` 提取即可。
