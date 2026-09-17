---
name: machine-a-git-proxy
description: 机器 A git push 直连 GitHub 必失败（connection reset），须挂本地代理
  http://127.0.0.1:7897（Clash Verge），且用户按需开关代理
metadata:
  node_type: memory
  type: project
  originSessionId: sess_e12bf49e-468d-4e06-8cf1-afb5b3c87efd
---

机器 A（本机）直连 github.com 443 基本连不通（Recv failure: Connection reset / connect timeout），git 本身和 shell 环境变量都没配代理。用户开 Clash Verge（监听 `127.0.0.1:7897`）后，`git -c http.proxy=http://127.0.0.1:7897 push origin dev` 一次成功。

**Why:** 代理是用户手动按需开关的——push 失败先问用户是否已开代理（或探测 7897 端口），不要反复盲试直连。

**How to apply:** push 失败时 `netstat -ano | grep 127.0.0.1:7897` 探测代理在不在，在就用 `git -c http.proxy=http://127.0.0.1:7897 -c http.sslBackend=openssl push`（20260904：端口在也可能 schannel 握手失败，openssl 后端一次通；代理进程会中途重启，拒连先等 15~30s 重探）；不在就告知用户需要开代理。不要写死进 git 全局配置（代理关了会全线失败）。见 [[github-push-via-proxy-7897]]、[[project-parallel-sessions]]。
