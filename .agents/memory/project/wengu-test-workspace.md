---
name: wengu-test-workspace
description: 测试工作区 D:\data\思源\测试——验证部署用；内核端口不固定需 netstat 扫描（本会话 52036）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_7e260705-3cf8-4587-826c-b20e179b0687
---

用户在机器 A 另有一个**测试工作区** `D:\data\思源\测试`（与主工作区 `D:\data\思源\工作` 并列），用于安全地验证插件部署：

- 插件目录：`D:/data/思源/测试/data/plugins/siyuan-plugin-wengu/`
- conf.json 在 `conf/conf.json`（3.8.1 布局），本会话 api.token=`ycfl0ijk9mxvnh21`（16 位，与主工作区不同，变了去那里找）
- **内核端口不固定**：该实例 6806 不监听，需 `netstat -ano -p tcp | grep -i listening` 列端口后逐个 POST /api/version 探测。本会话真内核在 **52036**（petal API 可用）；39099 也回 SiYuan 版本 JSON 但 petal 路由报 Unknown endpoint（疑似别的本地服务），别被它骗了。
- 端口探测判别：`/api/petal/setPetalEnabled` 带 token 打过去，`{"code":0,...}` 即真内核。更直接的办法（20260830 复验）：`wmic process where "name='SiYuan-Kernel.exe'" get CommandLine` 直接读 `--port`/`--workspace`（同 AGENTS.md 法，本会话又是 52036）。
- **辨内核服务哪个工作区（20260904）**：`/api/system/version` 不挑 token——两区 token 都回 code 0，不能作判别；用 `/api/notebook/lsNotebooks`——返回笔记本清单的 token 对应真服务区（另一区 token 回空）。另：wmic 见单内核 `--wd` 指向 resources 目录（无 --workspace）别当成启动器内核——它可能正服务着某工作区（该会话 55468=测试区）。
- ⚠️ **插件安装目录的 i18n 在根级 `i18n/`，不是 `src/i18n/`**（20260830 踩坑）：装好的插件只有 `i18n/zh-CN.json`，`cp src/i18n/*.json "$d/src/i18n/"` 报 not a directory——AGENTS.md 只说「拷 src/i18n/{zh-CN,en}.json」没给目标子路径。

2026-08-30 在此工作区验证 companionMenuHide 补键（右键学伴→「隐藏学伴」）。相关：[[wengu-ai-session-unification]]。
