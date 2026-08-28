# 短选项紧凑排版设计（一行 2/4 个）— 20260829

> 分支 `opt-compact`（工作树 `../wengu-optcompact`）。起因：数学卷短公式
> 选项（π/6、π²/6、π/3、π²/3）每个独占一行，右侧大片空白。目标：短
> 选项一行 4 个、中短一行 2 个、长选项照旧独占；公式渲染链路不动。

## 一、现状：选项的三条显示路径

| 路径 | 场景 | 选项 HTML | 现布局 |
|---|---|---|---|
| 静态/降级 | 题库模式、长卷 >50 题静态渲染、Protyle 挂载失败降级、复习详情 | `optionRowHtml`（ProtyleHost.ts:224）→ `safeLute` = `Md2BlockDOM` | 每项一个块级行，纵向堆叠 |
| 文档模式 | 文档做题（真 Protyle） | Protyle 原生有序列表，CSS counter 把 1234 画成 A.（card-render.scss:304） | ol 语义每项一行 |
| steps/slots | 步骤题选项按钮、匹配题候选池 | `button.wengu-step-opt`（CardHtml.ts:109，flex column 容器）/ `.wengu-match-poolitem`（SlotHtml.ts:48） | 纵向一列 / 池内逐项 |

「每项一行」的直接原因（静态路径）：`Md2BlockDOM` 输出**块级** DOM——
单行选项 = 顶层一个 `<div class="p" data-node-id=…>`，正文包在块 div 里，
只能纵向堆叠。三路字母角标显示一致（页签画角标 / chips / counter）是
硬约定，本设计不动角标逻辑。

## 二、「必须用 Lute 吗 / 自己渲染」结论

**内容渲染保留 Lute，只做「剥壳」；不自写渲染器。**

- 选项是 markdown（契约 `optionMd`），可带 `$公式$`、`**粗体**`、行内
  代码乃至嵌套列表。Lute 把 `$…$` 转成 inline-math span，再由
  `ProtyleMethod.mathRender`（KaTeX）惰性渲染（renderMathWhenVisible）。
  截图里的 π/6 本身就是公式——**纯文本自渲染会把公式打回裸 `$`**。
- 自写 mini 内联渲染器（escape + `$…$`→math span + 少量标记）技术上
  可行，但要逐字对齐 mathRender 的选择器/属性契约（`data-subtype`
  /`data-content`），主题样式也按 Lute 输出的 DOM 结构匹配——复刻子集
  的维护成本大于收益，**不做**。
- **剥壳**：新增 `unwrapSingleBlock(luteHtml)`——顶层恰一个 div 时返回
  其 innerHTML（纯内联 HTML，inline-math span 原样保留），否则原样返回
  （多块/畸形选项整行独占，行为不变）。实现用 detached element 解析
  （长卷 ~800 选项 × 微秒级，开销可忽略），不做正则剥壳。剥壳后多列
  排布就纯 CSS；题干/解析/引导语继续走块级 `safeLute` 不动。

## 三、排版方案（推荐 C）

- **A 纯 flex-wrap 自然流动**：容器 wrap、选项按内容宽并排。零测量，
  但列不齐、同行参差，不像「一行 2/4 个」的样子。否。
- **B 硬 grid 分档**：估宽→全短 4 列 / 次短 2 列。列最齐，但估宽误差
  无处可退（估小同行挤爆）。否。
- **C（推荐）估宽分档 + flex-basis + wrap**：
  - `estimateOptWidth(展示md)`：`$…$` 段每段计定值 **8 单位**（π²/6
    渲染约 60px ≈ 8 半角单位，宁大勿小）；其余文本 CJK 记 2、半角记 1。
  - 档位：`w≤10` → `opt-s`（basis 25%，一行 4 个）；`w≤24` → `opt-m`
    （basis 50%，一行 2 个）；否则独占（不加类，basis 100%）。
  - 容器 `.wengu-opts { display:flex; flex-wrap:wrap; column-gap:12px;
    row-gap:2px }`；选项行内部结构不变（角标 + 剥壳后的内联正文）。
  - 误差兜底：估偏大 → 该项提前换行（安全侧）；估偏小 → 同行略挤不
    破版（KaTeX 是惰性后渲染，估宽定值已按渲染后宽度计）。阈值常量，
    真机截图调参。
- **D DOM 实测两遍**：渲染后量 offsetWidth 再套 grid。最准但长卷批量
    多一遍 reflow，复杂度不值。备选。

## 四、覆盖范围（□ 勾选后实施）

- □1 **静态/降级 + 复习详情（默认做，覆盖截图场景）**：
  `fallbackQuestionHtml` 把选项行包进新容器 `div.wengu-opts`（现无
  容器）；`optionRowHtml` 正文剥壳 + 按估宽加档类。三个消费方（题库
  静态、降级、复习）一处改全改。纯展示行，作答走独立 chips，零交互
  影响。
- □2 **steps 步骤选项**：`.wengu-step-opts` flex column → 同款容器
  wrap + 档类。选项是可点 button，多列后命中区变小（可接受）；
  StepsFlow 的 selected/right 逻辑不动。
- □3 **slots 候选池**：`.wengu-match-poolitem`（30vh 滚动池内）同款
  分档；池容器结构实施时按 english.scss 上下文接线。
- □4 **文档模式 ol 多列（建议二期）**：`[data-subtype="o"]` 列表改
  grid 分档。风险较高：counter 在 grid 下正常，但含块级内容（公式块/
  代码块/嵌套列表）的 li 需 `li:has(> div:not(.p))` 强制跨列（依赖
  `:has`，思源 Electron 可用）。先看 □1 效果再定。

## 五、实施要点

- `unwrapSingleBlock` 放 ProtyleHost.ts（safeLute 旁）；单测：单块剥 /
  多块不剥 / 空串 / 畸形 HTML。
- `estimateOptWidth` 放 types.ts（optionDisplayMd 旁）；单测：CJK /
  公式段定值 / 混排、阈值边界。
- KaTeX 惰性链（renderMathWhenVisible / mathRender 选择器）零改动。
- 同步 `docs/question-block-contract.md`「选项展示形态」与 CHANGELOG。
- 真机验证在 **Neo 主题**下截图对比（UI 调整规矩）。

## 六、验证清单

- 题库模式：短公式选项一行 4 个；中短一行 2 个；长选项独占。
- 同题长短混档（s/m/l 混排）不破版、不重叠。
- 复习详情、steps 题、（若勾）slots / 文档模式。
- 公式 KaTeX 正常（惰性链不动）；Lute 异常退 `pre` 的降级不受影响。
