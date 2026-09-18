---
name: github-push-via-proxy-7897
description: git 访问 GitHub 顺序：先试直连（时通时不通），失败再走 127.0.0.1:7897 代理（代理进程未必在跑，先探端口）
metadata:
    node_type: memory
    type: user
    originSessionId: sess_3a7ea4ea-ac32-43a5-8bcf-0bbcd3fe6e73
---

用户本机（机器 A，Windows）本地代理端口为 **7897**（Clash 惯用端口，
用户确认「本机都是 7897」——端口不用再问）。但**代理进程未必常开**
（20260903 实测：7897 无监听、无 clash/v2ray 类进程，而同日 git 直连
拉取成功）；更早（20260901）则相反：直连 8 连败、走 7897 代理即通。
结论：**网络状况和代理开关都在变，别按旧结论死磕**。

**How to apply:** git push/fetch/访问 GitHub 时按序尝试：

1. 先直接跑（可加 `http.low-speed-limit/low-speed-time` 短超时快败）；
2. 直连失败 → `netstat` 探 7897 是否在监听：
    - 在监听：加一次性代理（不写全局配置，避免拖累思源内核 127.0.0.1
      与国内网络访问）：

          git -c http.proxy=http://127.0.0.1:7897 -c https.proxy=http://127.0.0.1:7897 push origin dev

    - 没监听：向用户报告代理未开，请用户开代理或稍后重试。

每条路重试 1~2 次即换，别循环死磕。

**20260904 两枚新坑**：① 7897 在监听、curl 过代理也 200，但 git 报
`schannel: failed to receive handshake, SSL/TLS connection failed`——
Git for Windows 默认 schannel 后端过代理握手的毛病，一次性加
`-c http.sslBackend=openssl` 即通（fetch/push 全适用）；② 代理进程
（Clash Verge）会中途重启——7897 突然拒连（connection refused）不是
网络死透，等 15~30s netstat 重探（PID 会换），回来即推。

[[project-parallel-sessions]] 记的「GitHub 时通时不通循环重试有效」
按此修正。
