# 易混词数据设计（审核稿）

> 目标：把「用户会把哪几个词混淆在一起」变成项目里的结构化数据。
> 本文档是设计稿，审核通过后作为 word-timing 实施（docs/word-timing.md
> 决策 7）的数据基础。开放决策点见 §六。
>
> 命名澄清：本设计的「易混组」是**混淆关系的数据记录**（哪几个词
> 互相混），与刷题流的「每组单词数」无关——刷题组是纯数量硬截断
> （连续 N 张卡一组，不按词根/意思聚合，N 可配置，见 word-timing
> 决策 6）；易混组不参与切组、不影响刷题流。

## 一、核心实体：易混组（confusable group）

不用「对」（pair）而用**组**（2~N 个词）：考研经典混淆常是三元组
（adapt/adopt/adept），二元表达不了。组是最小调度单元。

```ts
/** 一组互相易混的词（构建期预置或运行时积累）。 */
interface WenguConfusableGroup {
    /** 组内词条（词书扁平下标，升序，≥2 个）。 */
    ids: number[];
    /** 成因。form=形近 sound=音近 both=兼有 */
    kind: "form" | "sound" | "both";
    /** 来源。preset=构建期预置 ai=运行时 AI 判定 evidence=作答实证 */
    src: "preset" | "ai" | "evidence";
    /** 一句话组内辨析（AI 生成一次后存档，出题/AI 复盘时复用）。 */
    note?: string;
}
```

示例（写成数据的样子）：

```ts
// 下标为词书扁平 id（示意）
{ids: [1207, 3482], kind: "both",  src: "preset",
 note: "resolution 解决；revolution 革命——词根 solve 解 / volve 转"}
{ids: [512, 890, 4633], kind: "sound", src: "ai",
 note: "adapt 适应；adopt 采纳；adept 熟练的——a 差一个字母，读音相近"}
{ids: [2231, 4107], kind: "form", src: "evidence",
 note: null}  // 用户把 quite 拼成 quiet 的实证
```

判定口径（写进 AI 生成与判定的提示词）：

* **form 形近**：拼写骨架相同——共享 ≥4 连续字符且词长差 ≤3，
  或编辑距离 ≤2（quite/quiet、principal/principle）。
* **sound 音近**：发音相同或仅一音节之差（affect/effect、
  adapt/adopt）。词表**没有音标数据**，由 AI 按其语音知识判定。

## 二、两级数据：预置 + 实证

| | 预置组 | 实证组 |
|---|---|---|
| 内容 | 全书通用易混组 | 该用户实测的混淆 |
| 位置 | `src/wengu/data/confusables.ts`（构建期内置，工具生成） | `WenguWordProgress.confusables: WenguConfusableGroup[]`（saveData 落盘） |
| 产生 | 离线管线一次生成（§三） | 运行时：作答实证 + AI 组分析判定 |
| 修改 | 不在插件里改，重跑脚本 | 随作答增长 |

两轨**不合并写**：出题与查询时在内存把两轨的组做并集、按词下标
建倒排索引（`id → 组列表`，首次使用时构建缓存）。理由：预置组是
共享静态资产，实证组是个人数据，合并写会让两者互相污染、预置组
无法随脚本重生成。

## 三、AI 判定管线

### 离线：预置组生成（tools/gen-confusables.mjs）

沿用词表管线模式（`tools/gen-wordbook.mjs` 同风格，产物同样
「勿手改」头注释）：

1. **算法预筛形近候选**：读词表，滑窗比对共享子串/编辑距离，
   输出候选对（纯本地，零成本，召回为主）。
2. **AI 确认与补全**：候选对按批（每批 ≤50 对）喂内置 AI——
   确认是否真易混、聚合成组（传递闭包：A~B、B~C → {A,B,C}）；
   同时让 AI 凭知识**补音近组**（预筛算法帮不上音近的忙）。
   走 `/api/ai/chatGPT`（可并发，模型跟设置默认，见 AGENTS.md）。
3. **产出**：`data/confusables.ts`（ids+kind；note 留空，可另跑
   一遍补），提交进仓库。

### 在线：实证与 AI 判定（接 word-timing 决策 7）

* **evidence**：作答中出现「A 认成 B」（自述/拼错成真词/选 B
  释义）→ 落一个实证组 `{ids:[A,B], src:"evidence"}`，B 不在
  词书时记 `raw: "B原文"` 供展示。
* **ai**：组复盘（word-timing 决策 6/7）时，AI 拿到该组作答
  数据 + 涉及词的**预置组上下文**，返回判定——若确认 A 与 B/C
  易混，写 `{src:"ai"}` 组。决策 7 的「误认对」就此泛化成组。

## 四、集成点（实施时接）

1. **选择题干扰项**（WordQuiz.buildMeaningOptions/buildWordOptions）：
   干扰项**同易混组优先**（现在的干扰取同单元），组内不足再回
   同单元补足——让辨析题真的在考辨析。
2. **对照复习**：决策 7 的 A/B 对照泛化为 A/组对照；组内其它词
   一并调到明天，详情区并列展示。
3. **查词详情**（WordLookup）：词条属易混组时列出同组词。
4. **WordAi prompt**：组复盘时带上涉及词的预置组辨析 note，
   减少 AI 重复推断。

## 五、文件与流程布局

```
tools/gen-confusables.mjs        # 预置组生成脚本（预筛+AI）
src/wengu/data/confusables.ts    # 产物：预置组数组（勿手改）
src/wengu/WordConfusables.ts     # 运行时：倒排索引/查询/实证落盘
WenguWordProgress.confusables    # 实证组存储（旧数据回填空数组）
```

## 六、待拍板（审核重点）

1. **预置组生成时机**：全书约数千词，AI 确认需分批百次左右调用
   （走可并发的 chatGPT 端点，预计几十分钟、随模型速度）。
   - A. 实施时先跑一次，预置组直接进仓库（推荐：干扰项/对照
     复习立刻有料）；
   - B. 先只上实证组，预置管线后补（功能先闭环，出题质量提升
     晚一点）。
2. **组粒度上限**：传递闭包可能滚出大组（-sion/-tion 系），
   建议上限 5 词/组，超限由 AI 拆分。认可？
3. **kind 是否值得分**：form/sound 都只影响展示措辞，不影响调度。
   若嫌繁可合并为单一 kind。我倾向保留（查词详情可提示
   「长得像」vs「读得像」，用户自述混淆时可对号入座）。
4. **note 的生成**：预置组一句话辨析是否值得多跑一遍 AI 补齐
   （每次组复盘时 AI 现场推断也行，存档可省 token）。
