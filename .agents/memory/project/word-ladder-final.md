---
name: word-ladder-final
description: 背单词新词四步梯定稿（20260827 口述版）：英选中→中选英→听音选义→英文回想；仅认识前进；四词错峰流水线
    pipelineLadder；三档按钮全阶段固定 认识(1)/模糊(2)/不认识(3)；readalong 挂账
metadata:
    node_type: memory
    type: project
    originSessionId: sess_d3ef15b2-3a92-4e9a-9d16-f600790f5fa6
---

2026-08-27 用户口述定稿并已接线（此前 redesign §二 参考流草案 choiceEn→recallEn→listen→readalong 作废）：

- **梯序**：①choiceEn 英选中 → ②choiceZh 中选英 → ③listen 听音选义 → ④recallEn 英文回想。跟读 readalong 题型定义保留但未接线（挂账）。降级保护：干扰项<4 时选择/听音退回想（中选英退 recallZh）。
- **前进规则（20260828 用户加严定稿，覆盖 0827「原步重出」版）**：仅「认识」进下一步；模糊/忘记/答错/看答案**整梯归零**回①重走——静态流水线后续位不足时按缺口补插 REINSERT_GAP 邻域（WordView.advanceAfterFinish）。
- **四词错峰（用户核心诉求「四个单词分别占四个阶段」）**：新学建队走 pipelineLadder（WordQuiz.ts 纯函数）：组宽 ≤4 同组轮转出镜，任意相邻四张卡是四个不同词各占一梯；词不足自动缩组（「没有会慢慢安排」）。AI 组边界 rebuildTail 增 remainOf 入参按剩余梯步折算出镜次数。0828 起答错归零词按缺口补插（静态流水线剩余位不够重走全梯时），不再是纯靠后位。
- **三档按钮顺序**：全阶段统一左起 认识(1)/模糊(2)/不认识(3)——20260827 用户点名两分支顺序写反后统一；键盘 Digit1=know / 2=fuzzy / 3=no，i18n 快捷键编号同步。
- **配套**：选择/听音正面「看答案」小字钮（answered.peek 按答错计）；listen 题面大喇叭（iconVolume 自绘 symbol 注册，非思源 sprite）进卡自动播、空格重听；WordSpeak.ts = speechSynthesis en-US·0.9x 离线 TTS；翻面详情区小喇叭朗读。
- **词尾四点梯进度**（463a94c 竖排 + d2ec340 从下往上，仿不背单词）：爬梯中词尾渲染 4 个小圆点纵列，总高与单词行同高（词行 flex + 列 column-reverse：DOM 序①→④视觉反转，①贴底向上变绿）；已完成步 primary-lighter 实心/当前步主色放大/未到步灰。挂三处——英选中·回想大词尾、中选英释义行尾、详情词条行；listen 步词面隐藏时随题面隐去（不泄露「这是第几遍」的听测信息）；复习词/已出师词不显示。
- 新学队列书序来源（用户问「最开始怎么排的」）：buildQueue 从 cursor 按词书下标升序取未学词，无打乱；四步梯之前每词只走一步 choiceEn。
- 20260828 已随 ca0503a 推送 origin/dev 上线；后续详情视图两轮布局微调见 624935e（词条置顶，[[ui-consistency-feedback]] 第十三条）。
- **20260901 听音选义新增音标展示**（用户要求「展示读音」，澄清=音标文本非语音）：听音卡喇叭下、英选词面下、词条详情行内三处；中选英/回想面**不展示**防泄底；数据自带 ECDICT 离线表（详见 [[word-phonetics-ecdict]]），真机回验过。

**Why:** 用户明确拍板的交互终态，别再按旧参考流草案实现或提议跟读；梯序/顺序改动属产品变更需用户点头。
**How to apply:** 动新学流程/题型时按此对照；WordLadder.test.ts 锁了梯序与流水线轮转性质，改梯先同步测试与 docs/wordbook-redesign.md §二。相关：[[product-decisions]]、[[word-card-bubble-flip]]。
