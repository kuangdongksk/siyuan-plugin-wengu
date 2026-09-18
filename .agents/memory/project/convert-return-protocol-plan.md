---
name: convert-return-protocol-plan
description: 20260902 转换域两项定诊待拍板——纯标题段空批（发批前跳过、不动冻结的 structuralChunks）与 AI 返回格式
    kramdown→行定界协议改造（否决 JSON 与 YAML，防 LaTeX/中文踩格式雷）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_e2145de5-bd6d-43cb-a18b-1ae2d9149b5c
---

2026-09-02 用户在 AI 会话面板看到「转换·概率论与数理统计-题解」会话发给模型的文档内容只有一行 `## 随机事件和概率`，问「为何会是空内容」。定诊两项，方案已给、用户未回（同日又提返回格式议题），等拍板开工：

**① 纯标题段空批（已定诊）**：`structuralChunks` 按标题行切段，标题到下一标题之间无直接正文（内容全在更深子标题里）时该段=一行标题，照样独立成批发 AI → 模型回 CAN_CONVERT: no。真机核查该源文档（id 20260828150255-64batvp，162k 字符）159 段里 **9 个纯标题段**：h1 文档题 + 7 个章级 `##`（正文全在 `### 习题N` 下）+ `### 习题269`（源文档本身缺题干，MinerU 丢的）。影响有限：整体转换成功，只是 9 次空 AI 调用 + 面板噪声会话 + 完成消息 emptyBatches 警告虚高。修法：ConvertBatch worker 发批前跳过「无非标题行」的块（results[i] 记空、不计 emptyBatches）；**别改 structuralChunks 切法**——srcKey 格式与切块确定性在数据演进冻结清单，改了存量增量指纹一次性全报「变更」。该次全量转换 20260902 10:19 起跑（159 批串行约 2.5h），核查时仅文首 2/9 空批已现，其余 7 条随流水线推进到对应章节才陆续出现——用户后续再看到不是新问题。

**② AI 返回格式协议化（方向已荐）**：用户提出「返回格式不该是 kramdown，应是自己的数据结构」。现状：buildPrompt 让模型手写超级块 kramdown，extractQuestions 五条修补规则兜格式偏差、OptionShuffle 在字符串上做行级手术、prompt 过半 token 在教格式；路由（KnowledgeLink）早已 JSON、检测是行协议，唯主生成扛 kramdown。推荐方案：**行定界结构化文本协议**（Q type=/STEM/OPT/ANS/SOL/END 块，公式零转义）→ 解析成 QuestionDraft 结构 → 确定性渲染器逐字复刻现行 kramdown 落盘。**否决 JSON**：题源是考研数学，正文满是 `\frac` 类 LaTeX，JSON 反斜杠转义模型错误率高、非法即整批报废（全或无）。安全性论证：冻结清单冻的是**落盘进用户文档的形态**，不是 AI 返回形态——渲染器输出与现行一致则 questionHash 指纹/BankParse/增量重转换零影响。复杂题型（steps 多步/材料组/cloze slot-k/match）协议字段最花心思；容错口径=漏 END/缺字段局部恢复、坏一题不坏一批。两项合成一次转换域施工，先出协议全量定义给用户过目再动代码。

相关：[[convert-pipeline-pending]] [[hash-incremental-convert-proposal]] [[ai-session-manager-panel]]
