---
name: siyuan-web-auth
description: 机器 B 思源 Web 端（浏览器验证用）锁屏/授权流程与踩坑——check-auth 页、loginAuth
    端点、accessAuthCode 位置、内核重启后前端卡「点击刷新」
metadata:
    node_type: memory
    type: project
    originSessionId: sess_d3ef15b2-3a92-4e9a-9d16-f600790f5fa6
---

机器 B（Mac）思源 3.8.1 开了访问授权（conf/conf.json 的 `api.accessAuthCode`，
2026-08-27 值 awsd31302），浏览器直开 `/` 可能整页 `{"code":-1,"msg":"Auth
failed [session]"}` 或进工作区后内核重启变砖屏。

**Why:** 用内置浏览器真机验证插件 UI 是本项目标准流程，但 Web 端被授权墙挡住时
会浪费大量盲试；这套流程一次摸清后直接照走。

**How to apply:**

- 解锁页固定在 `http://127.0.0.1:6806/check-auth`（200 可直达）；输密码提交
  即写 session cookie。API 等价端点是 `POST /api/system/loginAuth`
  `{authCode}` → code 0（注意不是 checkAuth/loginAuthCode，都 404）。
- 内核重启后前端常卡「点　击　刷　新」：刷新页面无用时，先 curl 内核 API 确认活没活，
  活着就重走一遍 check-auth 登录再强刷；还不行就交给桌面端验证，别硬耗。
- petal setPetalEnabled 关→开曾伴发内核进程整个退出一次（20260828，原因未查明）；
  重启用 `open /Volumes/baiWeiNV7200/app/SiYuan.app`。
- curl 验证 API 存活：`POST /api/system/version` 带 Authorization token 返回 code 0。
