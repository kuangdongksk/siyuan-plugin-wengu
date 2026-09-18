---
name: ai-session-manager-panel
description: AI 会话管理面板（rail 第五钮）——track 登记+回看+继续追问；20260903 左栏树改种类优先两级（转换→文档→调用）；三批修复（b8d6966/14abfa1/5d40e27）已随 86dbf33 构建装机+petal 重载，待真机验证
metadata:
    node_type: memory
    type: project
    originSessionId: sess_7722c896-b9cd-4361-bc48-3fd1e492d295
---

20260831 应用户需求落地「AI 会话」管理（用户原话「AI 绘画」是「AI 会话」同音笔误）：判题/转换/检测/标签/路由/出题/单词复盘等一次性 AI 调用（agentChatOnce 带 track{kind,title}）自动登记进 saveData("ai-sessions")，rail 第五钮工作区面板列表+明细回看完整轮次与产出，可继续追问（agentChatContinued）。

**Why:** 这些任务跑完即 removeSession、弹层关掉就看不到问了什么答了什么；用户明确「不可能一直在弹层那里等着」。

**How to apply:**

- 状态（20260903 下午）：三批修复已提交（b8d6966/14abfa1/5d40e27）并**已部署装机**（用户关闭思源后拷贝 dist 三件套，md5 一致；冷启动自动加载，无需 petal 重载）——**待用户开思源真机验证树改版**。期间「题库落盘失败 [object Object]」toast 是 petal 重载残骸旧实例的僵尸重试（盘上 bank 正常增长），非当前实例。
- 关键取舍：继续会话不复用旧 sessionID（早被清仓+内核 revision/commitTurn 无从对齐），历史轮次按 user/assistant 条目回放播种新会话（条目类型核实记录见 [[siyuan-api-patterns]]）；伴学聊天不纳入登记（自有聊天历史 UI）。
- 架构与十处调用点清单查 AGENTS.md ai 域描述与 CHANGELOG，实现看 src/ai/（data/AiSessions、client.ts、components/SessionPanelApp 四件套、SessionPanel.ts 挂载）。
- 登记簿落盘格式（20260902 直读文件核对）：`data/storage/petal/siyuan-plugin-wengu/ai-sessions`（**无 .json 后缀**），顶层 `{version, items}`；item 字段 `id/kind/title/model/createdAt/status/turns`，turn 是 `{role:"user"|"assistant", text}`（**不是** entries/type/content）——核对登记直接读文件，别按猜的字段名解析。
- **左栏树 20260903 改版（种类优先）**：用户拍板「转换一个树，检测一个树，转换下面是高等数学、线代」——顶层一类一棵树，类内主题=标题第一个「 · 」后部分（转换=文档名，跨次运行合并）作第二级，单条记录不设空层上提；文档分支两击删（removeIds 按可见成员 id），种类级无删除钮。20260902 的「按运行组归并」渲染已废（track.group 数据层保留）；诊断技法：复现树问题先拿盘上 ai-sessions 真数据直接跑 buildSessionTree 纯函数——数据/纯函数都对就只剩渲染层。
