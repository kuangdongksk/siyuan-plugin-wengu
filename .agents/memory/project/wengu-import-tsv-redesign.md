---
name: wengu-import-tsv-redesign
description: 进度导入改版定稿：TSV三列+删PDF+复制模板按钮+错峰窗口随量自适应+b3-form__upload；已部署两区待验收未提交
metadata:
    node_type: memory
    type: project
    originSessionId: sess_dece38d3-da04-4b03-a124-3f1692a92140
---

进度导入改版（2026-08-30 定稿，用户多轮拍板）：弃 PDF 文字层提取、「导入不背单词进度」→「导入进度」，一份 TSV 三列 `单词<Tab>状态<Tab>天数`。状态行内自带（未学习/复习中/复习完成/已标熟，英文枚举同认），UI 状态下拉与 PDF 标题 auto 识别退役。编码 UTF-8 fatal 失败回 GBK（Excel 中文另存）+剥 BOM；表头行（状态/status）跳过；状态不认识进 badStatus 不导入。

**三条语义定稿**：

1. 天数列=**复习中专属**进度锚点（初版曾对复习完成也开，用户看模板质疑「复习完成哪来的天数」→ 收窄；apply 层忽略其余状态的 days）。
2. **复习完成仍进 FSRS 循环**（用户追问「相当于已经学会了」后认可维持现状）：完成≠永久记住，「学会」由间隔指数拉长表达（Good 后 20d→50d→120d），标熟才是显式跳过；备考 110 天正好考前保温。
3. **错峰窗口随量自适应** `spreadWindow=clamp(ceil(N/100),7,60)`（用户：「几千个都落在6-12天不行」）：复习中 due=1+(i%W)、复习完成 6+(i%W)、i=词书序（非哈希，用户指定）、已标熟固定 32。

**复制模板按钮**：长 hint 已删；模板值进 i18n `wordImportTplValue`（zh/en 各一套）随语言本地化，按钮行 desc 承接精简语义；剪贴板 navigator.clipboard 失败回 execCommand，按钮 2s 变「已复制」；单测锚定两语言模板均被 parseTsv 干净解析（防模板↔解析器漂移）；为此 tsconfig 开 `resolveJsonModule`（勿在 test 引 node:fs——commonjs 无 node types）。

**上传控件 b3-form__upload**（用户指路）：`.b3-file` 在思源 CSS 无定义；官方配方=按钮 `style="position:relative"` 内嵌隐形全覆盖 input（`.b3-form__upload{position:absolute;opacity:.001;…}`），StartScreen 词书+进度两文件行均已换装。

**踩坑**：①并行会话曾把我们 `wordImportCopyTplDesc` 清空成空串——i18n 被清先 `git diff` 辨归属再原子改（node 读写 JSON，别用内联 node -e 带中文引号会炸，用文件）；②build 被并行会话 quiz 半成品（QuizShell import 不存在的 RoundReport）挡过约半小时，对方收尾后自然恢复——tsc/svelte-check 红全在对方 quiz/ui 文件、word 零错即可判归属。

已部署机器 A 两区+setPetalEnabled 重载（52036=测试区）待验收，**未提交**（并行会话仍活跃）。验收点：TSV 导入、大文件错峰分布（几千词应摊 30 天+）、明细文案、复制模板、上传按钮观感。

关联 [[wengu-wordbook-multi-model]] [[wengu-word-flow-redesign]] [[project-parallel-sessions]] [[siyuan-web-ui-debug]]
