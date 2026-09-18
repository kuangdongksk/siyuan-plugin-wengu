---
name: annobar-wordlookup-batch-convert-36-37
description: 20260911 报障排查定案：查词弹层冒泡自关实锤+用户定夺做题禁查词、120 字符浮条闸、跨节点高亮缺失、桌面端点击未复现；#36 已派 #37 待派
metadata:
    node_type: memory
    type: project
    originSessionId: sess_114948c1-7273-430f-bf55-ed5f88c7f9e9
---

20260911 用户报障四件（标为线索没反应/过长消失/做题不能查词/批量转换），Web 端 CDP 实测定案：

- **「标为线索没反应」两层**：①用户报障时跑的是 10:02 旧版（chips 不渲染，#34 已修），新版 Web 端合成事件+CDP trusted click 全链路通过；②桌面 Electron 客户端仍报「点击浮层关了但没高亮」——远程无法观测桌面事件链，未复现。修复走结构性防御（浮条根捕获段 stopPropagation 隔离宿主、按钮 mousedown→pointerdown、`lastSelText` 选区快照兜底），不依赖精确定位根因。
- **查词弹层冒泡自关（实锤 bug，但随需求变更整个移除）**：`showWordPopup` 在 mousedown 监听内同步 append 弹层+注册 document 的 mousedown 关闭监听——**同一事件的冒泡阶段就触发关闭**（实测：监听尾 popup=true、dispatch 返回后 false）。真实点击必现，「查生词」永远弹不出来=用户看到的「没反应」。教训：**同步注册 document 级关闭监听的形态必被当前事件冒泡吃掉，注册必须 setTimeout(0) 或比对 timeStamp**。
- **120 字符浮条闸（实锤）**：`AnnoFlow.positionBar` 的 `text.length > 120` 静默 hideBar——144/1136 字符实测浮条整个不出。用户定夺「过长也要能标」，放宽到 1000。
- **跨节点高亮缺失**：`applyClueMarks`→`locateInNodes` 单文本节点内定位，跨段/跨公式选段定位失败只出 chips 不出高亮。修复=复用 `ClueMark.normWithMap`（#34 的坐标同源产出）在文本节点拼接上匹配，命中区间逐节点取交集包装。
- **用户产品决策**：做题时**不允许查词义**（第 10 条，见 [[product-decisions]]）——「查生词」改「标生词」直接收词+通知，`showWordPopup` 连样式删除，冒泡自关 bug 随之消失；查词能力只住单词域。
- **调度状态**：Issue #36（浮条改造四合一，quiz/flow 三文件）已召唤青简；Issue #37（批量转换=文件夹式文档串行队列，借鉴 ConvertRun 单例/ConvertIncrement 串行先例/regenRecords 批量模式）已建**待 #36 合并后再派**（两单都动 AGENTS.md+契约文档，一次只跑一个 NPC）。
- 场景备查：「肖秀荣1000题-题解版」`20260828145729-djgn748` = 文件夹式文档（空壳，5 子文档 01-马原~05-思修-题解，`/MinerU/` 下，未转换入库）；子文档清单用 `filetree/listDocsByPath`，SQL parent_id 查不全。
- 测试痕迹：20260911 会话在 Web 端开了英语/概率论两个未收卷测试轮（各标过线索，已尽量删），用户「继续上次」可见，无害。
