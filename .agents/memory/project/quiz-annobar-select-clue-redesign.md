---
name: quiz-annobar-select-clue-redesign
description: 20260911 报障三连全部落地装机——#27 拖选解锁+段距、#29 滑选重设计（退修一轮抓长卷
    chip 删错题）、#31/#32 NPC 自行补漏（复核钮归属、user-select 毯子级联洞）；#30 词条保真在途
metadata:
    node_type: memory
    type: project
    originSessionId: sess_fa8916aa-4b62-4fa1-af1a-face57737667
---

20260911 用户报障（装机 ae51f0e 后）整句拆解成三条，根因全部定诊：

- **全界面左键拖选失效**（根因在宿主不在插件）：思源壳层 base.css `.layout-tab-container { user-select:none }`——温故自定义页签整个挂在其中，Protyle 编辑器自己覆盖了这条而插件页签没覆盖 → 选区拉不起来；AnnoFlow 标注浮条（`bindAnnotationLayer` 靠 document selectionchange）永不出现，「标为线索/查生词」全废。插件自身 scss 无全局 user-select（companion/panels 两处均为局部），别走弯路。修复=阅读面（材料/题干/解析）覆盖 `user-select:text`（含 -webkit-）、控件面保持 none。
- **英语材料/题干段落贴死**：`src/ui/MdRender.ts` 段落输出 `<div class="p">` 刻意无默认 margin（对齐 Lute 形态），`card-render.scss:339` 起的「MdRender 标签基线表」补了 ul/ol/table/pre/h1-6/blockquote **独漏 .p** → `.wengu-gmat`/`.wengu-qprotyle` 多段零间距。
- **滑选标注现状缺口**（重设计动因）：`ClueFlow.addClue` 要求 `q.group`——无材料组的政治/语文阅读题直接拒绝（clueOnlyGroup 提示）；线索=会话纯文本快照，原文上无持久视觉标记，标完看不到标了哪；查真实 bank 材料（storage/petal/siyuan-plugin-wengu/bank 无后缀文件）——转换时 AI 把特殊词词条全剥了，正文裸奔。
- **原卷形态**（用户文档「英语真题测试-2020Text1」+ 素材目录 /Volumes/baiWeiNV7200/下载/00.考研真相/英语一 全 PDF）：逐句精讲=段落内英文+中文翻译同块；词条独立成行 `funding ^{补} ['fʌndɪŋ] n. 资金`（kramdown 上标，MdRender html:false 下 `^{补}` 漏字面）；原卷正文里被注释词带下划线+标号。
- **调度进展**：Issue **#26**（P1，拖选解锁+补段距；纯 scss、根因+验收写死单内、AnnoFlow/MdRender 逻辑零改动）已召唤青简（--work-mode，流水线 sn cnb-as2-1k270lpom 触发，后台轮询等 PR）。**第二单等 #26 合并后开**（方向已向用户预告）：滑选重设计=线索不限材料组（政治/语文题干可标）+已标文本持久高亮（恢复会话还在）；英文词条保真=转换让 AI 保留词条行→材料尾词表区，正文词形确定性联动下划线+上标标号（AI 只搬运不判断），`^{补}` 残渣不再漏字面。

见 [[quiz-interaction-issues-12-13]]、[[cnb-npc-full-workflow-first-run]]。
