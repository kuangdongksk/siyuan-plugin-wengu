# 《温故设计规范》（docs/design-spec.md）

> **本文是界面规范的唯一权威落点。** 口径来源＝
> `docs/design-review.md §〇`（旧文保留作审查清单，不删）、`AGENTS.md` 各 UI 段、
> `design/*.html` 设计稿、代码内构件注释；由审计单
> [#111](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/111)
> （规范草案）与 [#112](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/112)
> （现状违反清单 + 官方令牌白名单硬证据）校订成文。
>
> **本文只认令牌名与类名，不认具体色值。** `design/theme-tokens-neo.md` 是
> 「运行中的思源 3.8.3 + Neo+ 主题」的**观察记录**，会随主题升级静默过期，
> **不是规范来源**——后加入者别把里面的 hex 当规范用（规范要求零字面色值）。
>
> 每条规则标注**现状**：`✅ 达标` / `⚠️ 部分达标` / `❌ 违反`，违反项按期数
> 标注 `已修（整改 E #120）` 或 `待修（后续批次）`。

---

## 〇、总则

1. **规范只认令牌名与类名。** 颜色一律 `var(--b3-*)`，且必须用**官方全名**
   （见 §1 白名单）。具体色值只出现在主题运行时，不进仓库。
2. **静默降级必须设闸。** 四类引用会「不报错、直出错误观感」：

    | 引用形态                    | 缺省时的表现                       | 设闸手段                                |
    | --------------------------- | ---------------------------------- | --------------------------------------- |
    | i18n 键（`i18n[k] \|\| k`） | 界面上直接显示**键名**             | 中英键集合断言 + 死键清零（§8）         |
    | CSS 令牌（`var(--b3-x)`）   | 整条声明在计算值期失效、回落初始值 | §1 令牌白名单 + 只读校验                |
    | 图标 symbol id              | `<use>` 空引用 ⇒ **渲染空白**      | §6 sprite id 白名单 + 单测              |
    | 文档/文件路径               | 静默走降级分支                     | 引用可解析（内核路径标 `siyuan:` 前缀） |

    **新增任何一类「带清单/白名单的引用」，必须同时落地清单 + 断言**，别只写注释。

3. **例外必须具名且集中**（见 §9 例外登记表）。规范里的例外值一律登记
   「例外值 / 落点 / 理由 / 是否设计稿指定」；**未登记的按违规处理**。
4. **判定在 core、渲染在组件**（硬口径）。视图模型下沉纯函数并带单测，
   Svelte 组件零判断。**样式绑定**另立新规（整改 F1 / Issue #127，见 §十三）：
   **组件独占、无 TS 拼串触达、不跨组件复用的样式写进组件 `<style>`；**
   其余（TS 渲染层产物 / 跨组件共享 / 移动基座）**留共享片并登记**。
   旧口径「组件零 `<style>`」已作废（`docs/svelte-migration.md` 同步改写）。
5. **关键视觉规格必须落到断言。** 先例：`quiz/render/StartPanelStyle.test.ts`
   （**组件内 `<style>` 自 `?raw` 取出后 sass 真编译 + Svelte 真编译零
   `css_unused_selector` 双闸**，断言尺寸/令牌而非读源码文本）、
   `quiz/render/SubheadHtml.test.ts`（源级断言 primary 唯一）。
   规范条款能写成断言的，一律写成断言——这是防漂移的唯一硬手段。

---

## 一、令牌

**一句话规则**：颜色只走 `--b3-*` **全名**；卡片色族必须写全 `-background`/`-color`；
**禁用不存在的令牌名**；零字面色值（阴影/遮罩豁免，见下）。

### 1.1 令牌白名单（本仓在用，逐个标注官方出处）

以下是全仓 `var(--b3-*)` 的**完整集合**（31 个）。**新增令牌前先查本表**；
不在表内的名字一律视为拼错，须先在真机 `getComputedStyle` 验非空再入表。

| 令牌                                                             | 用途族                           | 官方出处    |
| ---------------------------------------------------------------- | -------------------------------- | ----------- |
| `--b3-theme-primary` / `-light` / `-lighter` / `-lightest`       | 主色四档                         | 官方主题 ✅ |
| `--b3-theme-on-primary`                                          | 主色实底上的字色                 | 官方主题 ✅ |
| `--b3-theme-background` / `-light`                               | 页面底                           | 官方主题 ✅ |
| `--b3-theme-surface` / `--b3-theme-surface-lighter`              | 面板/卡面                        | 官方主题 ✅ |
| `--b3-theme-on-background` / `-on-surface` / `-on-surface-light` | 三级文字色                       | 官方主题 ✅ |
| `--b3-theme-success` / `--b3-theme-error`                        | 判分语义色                       | 官方主题 ✅ |
| `--b3-card-info-background` / `-color`                           | 卡片语义色（信息）               | 官方主题 ✅ |
| `--b3-card-success-background` / `-color`                        | 卡片语义色（成功）               | 官方主题 ✅ |
| `--b3-card-warning-background` / `-color`                        | 卡片语义色（**警示：唯一来源**） | 官方主题 ✅ |
| `--b3-card-error-background` / `-color`                          | 卡片语义色（失败）               | 官方主题 ✅ |
| `--b3-border-color`                                              | 描边                             | 官方主题 ✅ |
| `--b3-border-radius`(6px) / `-radius-b`(12px)                    | 圆角两档令牌                     | 官方主题 ✅ |
| `--b3-dialog-shadow` / `--b3-point-shadow`                       | 阴影                             | 官方主题 ✅ |
| `--b3-font-family` / `-code`                                     | 字体族                           | 官方主题 ✅ |
| `--b3-list-hover`                                                | 列表 hover 底                    | 官方主题 ✅ |
| `--b3-scroll-color`                                              | 滚动条                           | 官方主题 ✅ |

**卡片色族令牌基名**（`--b3-card-info` / `-success` / `-warning` / `-error`）
是**例外形态**：思源只定义「基名‑后缀」，裸基名解不出来 ⇒ 整条背景失效
（#70 事故）。本仓 `quiz/flow/ClueColor.ts` 用**运行时变量探测**
（`themeVarsUsable()`，无 DOM 时按不可用收口）+ 单测锁死值域，是这一族的
正确落地样板；**新代码要读卡片色一律走 `-background`/`-color` 全名**。

### 1.2 三处悬空令牌（反面教材，⚠️ 部分达标）

以下三个名字**从来不是官方令牌**（v2.10.0 / v3.0.0 / v3.5.0 / v3.8.1 / master
五版 `daylight`+`midnight` 主题 css、官方核心 scss、内核 `kernel/model/theme.go`
均无定义）。`var()` 未定义 ⇒ 整条声明在计算值期失效、回落初始值：

| 悬空令牌                      | 后果                                                         | 正确写法                                  |
| ----------------------------- | ------------------------------------------------------------ | ----------------------------------------- |
| `--b3-theme-border`           | `border` **简写整条失效 ⇒ 边框直接消失**                     | `--b3-border-color`                       |
| `--b3-theme-on-primary-light` | 字色回落 `inherit`，实底上的对比度不可控                     | `--b3-theme-on-primary`                   |
| `--b3-theme-warning`          | `color` 回落 inherit、`background` 回落透明 ⇒ **警示色丢失** | `--b3-card-warning-color` / `-background` |

> ⚠️ **「warning」档只有卡片族、没有 theme 族**——思源只给
> `--b3-theme-success` / `--b3-theme-error` 两个 theme 语义色，第三档
> （近义/部分对）必须走 `--b3-card-warning-*`。这是最容易再犯的一条。

**✅ 已清零**：全仓 9 处悬空引用已清零（`cards.scss`、`english.scss`、
`report.scss`、`review.scss`）——由 **PR #116 / `fcbe302`**（Ref #113）修掉；
本单只把它校订成文并列为反面教材，**未改这 9 处代码**。

### 1.3 零字面色值与豁免

全仓字面色值只剩两类，**均显式豁免**：

- **阴影与全屏遮罩**允许纯黑低透明（`rgba(0,0,0,.2/.35/.42)`）——遮罩本就
  与主题无关，且这是通行做法。豁免面＝`box-shadow` 的兜底段与全屏 scrim。
- `var()` **兜底值**允许非透明，但**禁止品牌色**。

**❌ 违反，待修（后续批次）**：

- `scss/rail.scss:201` — `color: var(--b3-card-warning-color, #d97706);` 兜底是字面橙。该令牌是官方全名、本应存在，建议删兜底。
- `stats/StatsCharts.ts:35/36/80/81/82` — echarts 侧 5 处字面兜底（`#3575f0` / `#888888` / `#65b84d`，全是思源默认主题色，Neo+ 暖调下与全站脱节）。规范口径：**JS 取色只允许 `cssVar(令牌)`，兜底为空/透明并接受降级**。另 `:81` 把 `--b3-card-info-color` 当「正确率」的绿色用，**语义应为 `--b3-card-success-color`**。

### 1.4 校验手段（✅ 已落地断言，整改 E #120）

审计 #111/#112 已跑通「抽出仓内 `var(--b3-*)` → 对官方 theme.css 全部 `--b3-*` 定义做差集」的核对脚本。

**✅ 已落地（整改 E #120）**：`src/ui/SpecListings.test.ts`（4 条）把 §1.1 / §6.2
两张清单变成 **CI 会红**的东西——断言「**代码在用的每个 `--b3-*` 令牌 / sprite id
都在规范清单内**」，令牌侧 scss 走 **sass 真编译**（`?raw` 读 scss 恒空串）、
ts/svelte 走源码文本并**剥注释**（注释里复述写法不算在用，同 §8.4 的死键口径）。
两条反向验证已跑：删清单里的在用 id / 往代码塞表外令牌，**确实变红**。

⚠️ 一个已知的**宽松处**：端到端「对官方 theme.css 做差集」需联网，CI 里不跑；
本单只锁「清单 ⊇ 代码在用」这一侧（清单滞后是实际发生过的缺陷）。

---

## 二、按钮层级

**一句话规则**：`primary` = 一个面板/弹窗里**至多一个**唯一主操作；其余同级动作走
`outline`；轻操作 `text`；取消 `cancel`；危险操作 = `outline` + 两击语义色。

### 2.1 变体词表（收敛为单一来源）

`ui/Button.svelte` 的 `ButtonVariant` 是规范落进类型系统的唯一出口。
**层级**与**修饰**是两件事，别混进同一个枚举语义：

| 分档     | 值                     | 产出类                                  | 语义                    |
| -------- | ---------------------- | --------------------------------------- | ----------------------- |
| **层级** | `primary`              | **裸 `b3-button`**（主色实底）          | 唯一主操作              |
|          | `outline`              | `b3-button--outline`                    | 次级/普通操作           |
|          | `text`                 | `b3-button--text`                       | 幽灵/文字链             |
|          | `cancel`               | `b3-button--cancel`                     | 取消                    |
|          | `success` / `error`    | `wengu-btn-success` / `wengu-btn-error` | 语义色（自绘，见 §2.4） |
| **修饰** | `small`                | `b3-button--small`                      | 尺寸（官方变体，合规）  |
|          | **`main`（插件自造）** | `b3-button--main`                       | 见下                    |

- ⚠️ **`b3-button--main` 不存在**：官方 `_button.scss`（v3.8.3 与 master 逐字一致）
  的变体表只有 `--progress/--mid/--big/--text/--cancel/--outline/--remove/--white/
--error/--warning/--info/--success/--pink/--small/--icon`。所以 `variant="main"`
  **桌面端落到一条零命中的死类**、元素回落到 `.b3-button` 主色实底（视觉与
  `primary` 相同但语义重复），而**移动端页面样式表连基态主色都没有** ⇒ 观感落空。
- **✅ 已修（整改 E #120）**：`ButtonVariant` 联合类型**删除 `main`**，全仓
  `variant="main"` 一律改 `primary`（移动端 5 处字面量：`DrillScreen` ×4 +
  `HomeScreen` ×1；AI 面板 3 处：`SessionDetail` 1 处字面量 + `SessionPanelApp`
  2 处表达式）。移动端 `.wengu-md-btn-solid` 的状态说明见 §7.3。
- **默认值口径**：`Button` 的 `variant` 默认值 = **`outline`**（改动自整改 E #120）。
  原默认 `primary` 意味着「不写 variant 就拿到主色实底」，而 165 个调用点里
  有 51 处未写 `variant`（隐式吃默认值），靠自绘类盖掉基态才没出事——
  **一旦新组件漏写且没自绘类，就静默破坏「一个面板至多一个 primary」**。
  故默认取**最不可能违规**的那个档。
  **`primary` 必须显式声明**。
    > 现状：默认值已改，但**全量显式化未做**（本次只保证不依赖默认值表达主操作）；
    > 存量「靠隐式 primary」的调用点归位挂后续批次 F。

### 2.2 唯一主操作的落点

- 一个面板/弹窗**至多一个** `primary`。当前已知合法落点：
  开刷面板「开始刷题」（Issue #100 照 `design/wengu-desktop-drill.html` 屏①）、
  移动端主 CTA、AI 会话详情的错误态「重试」（`SessionDetail.svelte`，
  该屏唯一错误恢复动作）。
- **「选中态」不是主操作**：筛选条/chip 的选中态走主题色描边或浅底，
  **不得使用 primary 实底**（同屏两个实底钮会让用户分不出该点哪个）。
  详见 §2.3。
- **危险操作**：默认 `outline`，首击加 `wengu-col-armed` 变红
  （`var(--b3-card-error-color)`，3s 复原，底座 `ui/shared.ts` 的 `Armed<T>`）；
  **不得直接给语义实底**。两击确认是全仓统一手势，不上模态框。
- **弹窗底部动作行**：右起第一钮为**唯一主操作**。⚠️ 现状
  `ui/Dialog.ts` 的 `WenguDialogAction.variant` 只支持 `outline`，
  **表达不了 primary/text**——**待修（后续批次）**：放宽为与 `ButtonVariant` 同源。

### 2.3 AI 会话面板 kinds 筛选条（✅ 已修，整改 E #120）

原先 `variant={ui.filter === k ? "main" : "outline"}` —— 选中态落在 §2.1 的死类上，
**选中与未选中视觉无差**（都靠 outline 观感，仅 hover 有别）。

**规范口径**：过滤条 / chip 的选中态是**一等公民样式**，与
`.wengu-col-armed` 同族复用既有的「主题色语言」：

```scss
/* 选中态：浅底 + 主色字；未选中：默认描边钮 */
background: var(--b3-theme-primary-lightest);
color: var(--b3-theme-primary);
border-color: var(--b3-theme-primary); /* 与主操作实底明确区分 */
```

落地类名 `.wengu-ai-kinds .wengu-chip-on`（`scss/rail.scss`）。
**禁止用 `primary` 表达选中态**——那是「该点的那个动作」，不是「当前筛的是哪个」。

### 2.4 题卡作答区 vs 其余（双体系边界）

| 区域                              | 用哪套                                             | 理由           |
| --------------------------------- | -------------------------------------------------- | -------------- |
| **题卡作答区**                    | 自绘 `.wengu-btn`（`--b3-theme-primary-light` 底） | 贴题卡视觉     |
| **其余（工作区/面板/弹窗/表单）** | `ui/Button.svelte` + `b3-button` 体系              | 与思源原生一致 |

⚠️ 现存两套的**圆角不一致**（`.wengu-btn` 用 `4px`，`b3-button` 用
`var(--b3-border-radius)`=6px）。按 §3.3，**4px 归入「控件内小件」档**并写进
例外登记表；新的自绘件一律优先复用主题令牌。

---

## 三、字号 / 间距 / 圆角阶梯

**一句话规则**：三样各成**有限档位**，全部走令牌或档位值，**不散落裸 px**；
新增值必须取自档内，档外值必须进 §9 例外登记表。

### 3.1 字号（⚠️ 部分达标）

现状实测（`src/scss/*.scss`，剔注释）：`font-size` **22 档 / 218 处**，
其中 11~15.5px 区间挤了 **10 档**、半像素五档合计 45 处。
对照设计稿（`wengu-desktop-drill.html` 的 `12.5/13/13.5/14/14.5/15/11.5/12px`）
可确认：**12 / 12.5 / 13 / 13.5 / 11.5 这一族是稿里就有的**，属「规格」不是「漂移」——
规范的动作是**固化 + 关闸**，不是推翻。

**桌面字号档（目标档，七档）**：

| 档     | 值              | 用途                                                     |
| ------ | --------------- | -------------------------------------------------------- |
| `xs`   | **11px**        | 微标签、角标                                             |
| `sm`   | **12px**        | 次要文本、组行                                           |
| `base` | **12.5 / 13px** | 次要正文 / 正文（**档内微调**，非两档）                  |
| `lg`   | **14 / 14.5px** | 强调正文（**档内微调**）                                 |
| `xl`   | **15px**        | 强调、材料正文                                           |
| `2xl`  | **16px**        | 输入框、卡片标题                                         |
| `3xl+` | **17~44px**     | **展示型字号**（图标/数字大字/空态主标题），豁免档位约束 |

**关闸**：新增 `font-size` 必须取自 `11/12/12.5/13/13.5/14/14.5/15/16`；
`17+` 只允许出现在展示型元素上。

**❌ 违反，待修（后续批次 F）**：10px(4 处)、11.5px(11 处)、15.5px(4 处)、
16.5px(仅设计稿)、17px(4 处) 等离群值逐处归位。
**全仓替换不在本单范围。**

### 3.2 间距（⚠️ 部分达标）

**总则（沿用 §〇6）**：**凡横向并排 ≥2 个按钮的行（面板操作行 / 弹窗底部动作行 /
浮层底行 / 卡片操作行 / 工具行）一律 `gap: 8px`**——flex 行不写 gap 按钮就贴死。

现状实测：`gap` **16 档**（`8px×62 / 6px×27 / 4px×22 / 2px×13 / 12px×11 /
10px×10 / 5px×6 / 9px×5 / 3px×3 / 7px×2 / 11px×2 / 14px×2 / 1px×1 / 16px×1 / 18px×1`，
另有 `mobile-drawer.scss:73` 双值 `gap: 5px 14px`）。

**间距档（基数 4px，六档 + 具名例外）**：

| 档     | 值       | 用途                                      |
| ------ | -------- | ----------------------------------------- |
| `hair` | **2px**  | 纯图标微工具行（`wengu-side-headbtns`）   |
| `xs`   | **4px**  | 图标与相邻文字                            |
| `sm`   | **6px**  | 图标与文字、密集行内件                    |
| `base` | **8px**  | **按钮行总则**、头部行元素间、卡片内块间  |
| `md`   | **12px** | 单词卡主操作区（**具名例外**）            |
| `lg`   | **14px** | 开刷面板操作行（**具名例外**，设计稿屏①） |

**AI 会话面板密集刻度例外**：该面板的 `1/2/5/9px` 一排微间距是设计稿
（`convert-stop-redesign.html`）要求，**单列「面板密集区特例」**，不强行同档。
⚠️ 14px 有**两个**落点（`aiflow.scss` 的面板刻度、`startpanel.scss` 的设计稿
例外），**两者都要在 §9 具名**，否则读规范时分不清哪个是例外。

**❌ 违反，待修（后续批次 F）**：`gap` 内非 4 倍数（`3/5/7/9/11/18px`）共
**20 处**（`margin` / `padding` 内另有 39 处），逐处归位或进例外表。

### 3.3 圆角（⚠️ 部分达标）

现状：118 条 `border-radius*` 声明里，走令牌 55 处（`--b3-border-radius` 39 +
`-radius-b` 11 + 带字面兜底 5）；**裸值 63 处**——其中单一 px 值 **46 处 / 16 档**，
另有胶囊/圆形字面值 18 处（`50%`×14 / `999px`×3 / `99px`×1）——**同语义混用**。

**圆角四档**：

| 档     | 值                                    | 用途                                                       |
| ------ | ------------------------------------- | ---------------------------------------------------------- |
| `sm`   | **4px**                               | 控件内小件 / 徽标 / 题卡按钮（**具名例外档**，随题卡视觉） |
| `md`   | **`var(--b3-border-radius)`**(6px)    | 控件（**必须走令牌**，随主题）                             |
| `lg`   | **`var(--b3-border-radius-b)`**(12px) | 卡片 / 弹窗 / 移动端主钮                                   |
| `full` | **`999px`** / **`50%`**               | 胶囊 / 圆形                                                |

**硬口径**：**控件圆角必须走 `--b3-border-radius`**（随主题），
仅装饰性小件允许固定档。移动端抽屉顶角 `20px` 单列特例。

**❌ 违反，待修（后续批次 F）**：`3/9/10/11/15/16/22px` 等自选值收敛到四档。

### 3.4 行高（⚠️ 部分达标）

现状 17 档无阶梯。**行高三档**（并入本条）：
`tight 1.4`（密集列表/表单）/ `base 1.6`（题卡/通用）/ `read 1.78`（长文阅读区）。
移动端阅读区（1.78/1.85）与题卡区（1.6/1.62）本应同族。

---

## 四、表单构件

**一句话规则**：一律走 `FormHtml` 的 `formGroup / formRow / formSelect /
formSwitch / formInput / formOption`；输入必挂 `b3-text-field`；
文档 id 一律「选择器 + 回显」；hint 面向**用户收益**、不出现实现词汇。

### 4.1 行样式与控件出口（✅ 达标）

- `formRow` 行容器类名串固定：`fn__flex b3-label config__item wengu-formrow`
  （`ui/FormRow.svelte` 与 `ui/FormHtml.ts` 同款）。
- **与思源主题对抗**：行容器必须用 `.b3-label.wengu-formrow`（复合选择器，特异性
  0,2,0）+ `!important` 压主题注入的 `.b3-label` 单类（20260827 事故）。工作区面板
  （`.wengu-ws-page`）没有 `.config__items` 父容器兜底，**所有 formRow 都需要这条**。
- 定宽控件走内核类 `fn__size200`（200px，开刷面板例外 300px 见 §9）——
  这是内核约定，**不自行改写**。

### 4.2 输入控件（⚠️ 部分达标）

- 管理弹窗内的输入（如新建专题标题）**必须挂 `b3-text-field`**。
  ❌ 待修：`bank/ui/CollectionDialog.ts:53` 仍用自绘 `.wengu-input`。
- **豁免面＝题卡作答区**：`QuizCard` 的思路 textarea / 简答 textarea / 填空
  input 允许自绘 `.wengu-input`（作答输入本就是题卡视觉的一部分）。

### 4.3 文档 id / 模型选择器（✅ 达标，升格为条款）

候选 >20 的下拉**不用原生 `<select>`**，统一走「触发按钮 + 官方风格可搜索浮层」
（类名照抄官方 commonMenu：`b3-menu__filter` + `b3-text-field` 搜索 +
`b3-list--background` + `b3-list-item--narrow`）。触发按钮统一
`fn__size200 wengu-pick`：**当前值入按钮**、长值省略号 + `title` 全量、
空值还原占位「选择…」。20 项以内短列表仍用 `formSelect`。

**文档 id 与模型一律「选择器 + 回显」**，禁止裸 input 填 id
（现例：`ConvertDialogApp.svelte` 的 `docIdLabel` 行）。

### 4.4 hint 文案（⚠️ 部分达标）

面向**用户收益**，**不出现实现词汇**。

| ❌ 实现词（现状）       | ✅ 用户话术 |
| ----------------------- | ----------- |
| 零 AI 调用 / 无 AI 调用 | 不消耗 AI   |
| 指纹（内容一致判定）    | 内容未变    |
| 按批次计                | 分多次      |
| 并发 / 并发生成         | 同时处理    |

⚠️ 「指纹」这类概念词在**体检弹窗**内尚可（用户需要辨识），但**须在 §9 统一取舍**，
不能各处自决。
❌ 待修（后续批次 F）：`convertReconvertDoneHint` / `reimportUnchanged` /
`convertTotalUnknown` / `repairHint` / `repairDupHead` / `healthAutoHashBad` /
`batchSynHint` / `convertParallelLabel` / `setConvertParallelDesc` /
`aiFlowRowNoteSkipped` 等键。

---

## 五、弹窗与浮层

**一句话规则**：统一 `openWenguDialog` / `wengu-dialog` 挂类；长内容自封顶；
长任务状态住页面。

### 5.1 弹窗骨架（✅ 达标）

- 单一入口 `ui/Dialog.ts` 的 `openWenguDialog`：content 统一包
  `b3-dialog__content wengu-dialog`（+ `extraCls`），底部统一 `b3-dialog__action`。
- **⚠️ 已知重复**：Svelte 宿主壳（`ConvertDialogApp` / `ConvertPanelApp`）
  手写同一串类名（内容形态不同，不走 `openWenguDialog`）——
  **改 `.wengu-dialog` 时两处同步**；建议抽 `wenguDialogClass()` 常量（后续批次）。
- **宽度**：现状 7 档硬编码（480/520/560/620/640/680/780）。规范收敛为
  三档 `sm 480` / `md 560` / `lg 680`，且 `width` 取 `min(档位, calc(100vw - 32px))`
  防小屏顶满。**❌ 待修**。

### 5.2 长内容封顶（✅ 达标）

`.wengu-dialog { max-height: calc(100vh - 200px) }` 是**唯一落点**，
配合 `b3-dialog__content` 自带 `overflow:auto`。**禁各处另写 `max-height`。**

### 5.3 长任务状态住页面（✅ 达标）

转换/增量/索引等长任务的实时状态驻**页内转换条 + 流级横幅**
（`scss/aiflow.scss`），弹窗点击即关。**弹窗内不得有长任务的进度条。**

### 5.4 弹窗底部动作行（❌ 待修）

见 §2.2：右起第一钮为唯一主操作；`WenguDialogAction.variant` 需放宽到
与 `ButtonVariant` 同源（至少补 `primary` / `text`）。

### 5.5 层级约定（✅ 达标，注释升格为条款）

插件内 `z-index` **只在自己的层叠上下文内排序**；页根必须
`isolation: isolate`（`base.scss` 的 `.wengu-panel`、`words.scss` 的词域根，
20260830 吸顶头盖官方弹窗事故的根解）。**新增页根/浮层宿主照挂。**

### 5.6 `[hidden]` 兜底清单（✅ 达标，⚠️ 有一处越界）

作者层任何 `display` 声明都会压过 UA 的 `[hidden]{display:none}`。规范：
**清单是唯一落点**（`base.scss` 顶部），**凡用 `hidden` 切显隐的元素，
其类必须进清单**。
❌ 待修：`panels.scss:283` 的 `.wengu-col-qs[hidden]` 是清单第二处，应挪回；
`ui/FormHtml.ts:42` 的 `.b3-label__text` 走 `hidden` 但未进清单
（当前内核恰好没给该元素 `display`，属「靠实现保命」）。

---

## 六、图标

**一句话规则**：一律 `svgIcon` 思源 symbol；**禁 emoji 字符**（排版符号豁免）；
**symbol id 必须存在于思源 sprite**。

### 6.1 唯一出口与尺寸（✅ 达标）

- **禁止手写 `<svg><use>`**，一律 `svgIcon(id)`。`svgIcon` 自带
  `width/height=14`（20260905 根修），需要不同尺寸用 CSS 覆写属性。
  ❌ 待修：`word/components/QuizCard.svelte:119/140/155/217` 仍手写 `<use>`
  （正是 AGENTS 记载「三犯同坑」的形态）。
- 图标尺寸与相邻字号同档：`14`=正文、`16`=强调、`17`=移动题头、`22`=移动主钮、`32`=单词发音大钮。

### 6.2 symbol 白名单机制（⚠️ 部分达标）

⚠️ **机制澄清（审计 #112 更正 #111）**：思源**只有一份** sprite
（`appearance/icons/litheness/icon.js`，`assets.ts` 显示桌面与移动端**加载同一份**）
——所谓「移动端 sprite 差异」在 3.8.x **不成立**。**写错 id 桌面同样空白**，
只是移动端先撞上。

本仓现行 id 全表（**31 个**＝官方 28 + 插件自注册 3；口径：`src/**/*.{ts,svelte}`
里 `svgIcon("…")` / 字符串字面量与 `xlink:href="#…"` 的**并集**）：

```
官方 sprite（28 个，可在 appearance/icons/index.html 或 litheness/icon.js 查到）：
iconAdd iconBack iconBookmark iconBug iconCheck iconClock iconClose iconCopy iconDown
iconEdit iconEye iconFile iconFolder iconIndeterminateCheck iconInfo iconLeft iconLink
iconList iconPlay iconRefresh iconRiffCard iconRight iconSearch iconSettings iconSparkles
iconStar iconTags iconTrashcan
插件自有（3 个，src/index.ts 的 addIcons 自注册，id 永不改）：
iconWengu iconWenguWords iconVolume
```

⚠️ **清单必须与代码同步**：`iconIndeterminateCheck`（`FormHtml.statusIcon` /
`ReviewHtml` 的「部分正确」态）、`iconRiffCard`（`RelatedDialog` 的「相关刷题」）、
`iconTags`（`ViewBindings` 的「生成标签」）三个在用 id 曾漏登记 —— 已核实在官方
sprite 内（master 版 `appearance/icons/litheness/icon.js`，该版共 260 个 symbol）。
**「在用但不在清单」＝清单没跟上代码**，属清单自身失效，不是代码违规。

**硬口径**：

1. **id 必须能在官方图标清单页或 `litheness/icon.js` 里查到**（自有 id 除外）；
2. 插件级图标经 `addIcons` 用**自有稳定 id** 注册，形状抄官方 path；
   **id 永不改**——`conf.json uiLayout` 持久化了 dock 图标 id，启动恢复走存量数据；
3. **合法图标清单维护成单一来源**：清单＝本节代码块，**单测锁「全仓在用的每个
   id 都在清单内」已落地**（`src/ui/SpecListings.test.ts`，源头先例
   `SubheadHtml.test.ts`）。⚠️ 尚缺的是 **dev 期诊断**——`svgIcon` 目前不校验入参，
   写错 id 仍只在真机静默渲染空白（`IconIds.ts` 常量集 + `console.warn` 那半条
   **❌ 机制待建（后续批次）**）。

**历史教训（反面教材，20260914 已由 #106 修复）**：移动端曾用
`iconGrid` / `iconFlag` / `iconDoc` —— 这三个 id **思源 sprite 里根本不存在**
（最接近的是 `iconLayoutGrid` / `iconDock` / `iconDocx`），渲染必然空白。
改用 `iconList` / `iconBookmark` / `iconFile` 后正常。

### 6.3 emoji 与排版符号（✅ 达标，判据式表述）

- **emoji 字符一律禁用**（禁的是 emoji 码位：1F300–1FAFF、FE0F 等）。
- **排版符号允许**：`→ ⇒ · 「」 《》` ——它们是排版符号不是 emoji，
  且已被设计稿采用（`aiLogTurnInOut`「轮次 {n} · 输入 {x} 字 → 输出 {y} 字」）。
- 既有落地：结果行状态图统一走 `FormHtml.statusIcon`（自带同色填充），
  难度星走 `iconStar`；`FlowBanner` 把设计稿的 `▴/▾` 换成 `iconDown` + CSS 旋转。

---

## 七、移动端专属

**一句话规则**：样式挂 `.wengu-mobile` 后代选择器；**禁 media query**；
触控 ≥44px；输入 ≥16px；正文 ≥15px；**无标记零回归**。

### 7.1 四条硬口径（✅ 达标，执行到位）

1. **标记类 + 后代选择器**：触屏规则全部写成 `.wengu-mobile ...` 的后代选择器；
   标记由 `ui/shared.ts` 的 `markMobileUi` 给**单词面板根元素 + `document.body`**
   各打一份，`isMobileUi()` 按 `window.siyuan.mobile !== undefined` 判定
   （环境探测**一律**走它，别另造）。
2. **禁 media query**（触屏适配）：桌面浏览器窄窗口会误伤，故触屏适配**只按环境
   分流**。⚠️ 例外三分类，**别误删**：桌面面板自适应宽度**允许**
   `@media(max-width:1000px)`（`aiflow.scss` / `aipanel-tree.scss` 折单列）；
   `prefers-reduced-motion` 允许（`aipanel.scss`）；`base.scss` 那段是
   **注释**（记述内核 `base.css` 的窄屏响应式），不是规则。
3. **无标记零回归**：桌面不带 `.wengu-mobile` ⇒ 样式逐字节不变。各片头注
   都写明了这个验收条件。
4. **移动端样式独立成 `mobile-*.scss` 片**，**禁止追加到桌面片尾部**
   ——正是 `english.scss` 破 500 行的教训（§9）；该片已于整改 F1 #127 拆出
   `mobile-english.scss`（§13.5）。

### 7.2 触控与尺寸（⚠️ 部分达标）

- **输入 ≥16px**（防 iOS 聚焦缩放）：`.wengu-md-input` 16px、单行输入行高 48px。
- **触控 ≥44px**：现状主操作 44/46/48/52/60px 共 **22 处**（`min-width`/
  `min-height` 口径）；
  **⚠️ 有 11 处落在 40px**（`words-mobile.scss` 5 处 min-height + 1 处 min-width；
  `english.scss` 3 处 min-height + 2 处 min-width）。
  **规范定夺**：**主操作 ≥44px；次要/密集区 ≥40px**（`iconbtn` / `bookbtn` /
  `bookmenu 行` / `peek` / `form 内控件` 都不是误按代价高的动作）——
  这 11 处按**合法例外**登记进 §9，**不改实现**。
- **iOS 自动播报要在手势栈内**：`$effect` 是微任务，脱离手势的首播会被系统
  静默丢弃。自动播报落点按环境分流（移动端在控制器 click 链路里播、
  桌面走组件 `$effect`），判定收口在 `word/core/TapSpeech.ts`（带单测）。

### 7.3 移动端按钮（✅ 已修，整改 E #120）

移动端按钮是**独立实现**（有意不复用桌面壳），但**语义分级仍须对齐**：
实心 = 主操作、描边 = 次级、ghost = 轻。

⚠️ 实测：`b3-button` 的**基态主色实底是桌面样式表才有的规则**，移动端页面
样式表里没有 ⇒ `variant="primary"`（=裸 `b3-button`）在移动端**观感落空**。
故移动端主操作走 `<Button variant="primary" class="wengu-md-btn-solid">`，
由 `.wengu-md-btn-solid`（`scss/mobile-home.scss`）**自给实心样式**：
全主题令牌（`--b3-theme-primary` / `--b3-theme-on-primary`）、明暗自适应、
触区 48px、圆角 12px（= `--b3-border-radius-b` 档）。

**✅ 已修（整改 E #120）**：5 处 `variant="main"` 字面量 → `variant="primary"`
（`DrillScreen.svelte` ×4、`HomeScreen.svelte` ×1；`SessionPanelApp.svelte`
另有 2 处表达式，见 §2.3）；配合 §2.1 删除 `main`，移动端不再有
「落到不存在类名 / 落到无规则的基态」两种落空形态。

### 7.4 正文与次级文本（⚠️ 部分达标，口径拆分）

原口径只有一句「正文 ≥15px」，**不可执行也无法验收**（移动端 `font-size`
84 处里 <15px 有 52 处，其中大部分是合理的）。**拆两档**：

| 档                                  | 下限      | 点名基准件                        |
| ----------------------------------- | --------- | --------------------------------- |
| **正文 / 题干 / 选项 / 材料**       | **≥15px** | 题干 17px、材料 15.5px、输入 16px |
| **次要标签 / 徽标 / 图例 / 时间戳** | **≥12px** | 工具行、状态词、`<small>` 描述    |

❌ 待修（与在途改动面邻近，**建议错开排期**）：`mobile-answer.scss:166/261`、
`mobile-drill.scss:197`、`mobile-home.scss:260/316` 五处**正文语义**元素仍是
14/14.5px，应提到 15px。

### 7.5 未挂载路径的预防性适配（✅ 达标）

`english.scss` / `reading.scss` 的移动段在当前移动端**永不生效**（所在页签
移动端打不开），属正确的防御性投资——**允许预先备好，但注释必须写明生效
前置条件**（这两处做到了，可作范例引用）。

---

## 八、文案与 i18n

**一句话规则**：不硬编码；中英同步加；新键「域前缀 + 含义」；中文标点全角。

### 8.1 字典门禁（✅ 达标，写成验收条款）

- **`zh-CN.json` 与 `en.json` 键集合必须相等**（现状 921 : 921，对称差 0）；
- **零空值**（插件取词是 `i18n[k] || k`，**缺键或空串值都会回落键名**
  ——真机表现＝把英文键名渲染给用户）；
- **占位符集合两语言对齐**（`{n}`/`{c}`/`{a}`/`{x}`/`{y}`…）；
- **零 emoji**；`en.json` 允许保留中文（示例图片名「开心.png」这类）。

建议加一条键集合相等断言（本仓已有 `FlowOwnership.test` 的幽灵键断言同款）。

### 8.2 键名分域（⚠️ 部分达标，冻结条款）

- 新键一律 **「域前缀 + 语义」**；合法域前缀＝
  `convert / ai / word / know / col / review / stats / comp / mobile / set /
timing / scope / clue / health / regen / batch / tag / match / drill …`（34 个 ≥5 键的族）。
- **旧无前缀键不迁移**（避免无收益 churn，`docs/design-review.md §四-P2-4` 已定）；
  ⚠️ 但**新键仍在漂移**（`aiFlowChipDone` 一派 vs `convertStart` 一派）——
  本条**升格为冻结条款**：旧键不迁、新键必须带域前缀。

### 8.3 动态键族必须登记（❌ 机制待建）

`weakCause*`（← `WeakCause` 类型）、`matchFail_*`（← 失败原因枚举）
这类**拼出来的键**无法静态判定死活。规范要求：**动态键族必须在规范里登记
「族名 + 键模式 + 数据源枚举出处」**，并配一条单测（枚举全量值 → 键必须存在
且非空）。

### 8.4 死键清零（✅ 已修，整改 E #120）

**死键定义**：字典里有、全仓代码（含动态拼接可达面）零引用。
**删除前必须逐键 grep 确认无动态拼接引用**，并**中英同步删**。

⚠️ 判定陷阱：`this.i18n.xxx` 的**属性式访问**（非 `t("key")`）在纯文本 grep 里
看不见，必须单独扫；名字与局部变量/类字段同名时也易误判为「活」。

**✅ 已修（整改 E #120）**：删 **11** 个死键（中英同步）。字典键集本次变动：
`909 - 11 + 23(aiTitle*) = 921`（见 §8.6）——
`typeMaterial` / `clueOnlyGroup` / `convertRefused` / `timeUp` /
`convertDetected` / `convertDetectedCount` / `convertTotalUnknown` /
`convertBatchParallel` / `aiRoleUser` / `aiRoleAi` / `aiStop`。

⚠️ **`wordBtn` 不在此列（被留下）**：#112 清单把它列为死键，但复核发现
`src/index.ts:275` 有 **`this.i18n.wordBtn || "背单词"`** —— 正是本节警告的
「属性式访问在纯文本 grep 里看不见」形态，它**是活键**。删键前必须把该形态
单独扫一遍（本单已按此执行）。

### 8.5 组件内不得有字面中文（⚠️ 部分达标）

❌ 待修：`word/components/StatsScreen.svelte:22-23` 的「今」「明」是真实 UI 串
（未来 7 天柱状图横轴），英文环境仍显示中文——应加
`wordStatsDayToday` / `wordStatsDayTomorrow` 两键，组件经 `t` 取词。

### 8.6 AI 会话 title 一律走 i18n 模板（✅ 已修，整改 E #120）

**规则**：AI 会话 track/group 的 `title` 是**用户可见主文案**（#88「记录 title
任务名化」），**一律走 i18n 模板**（如 `aiTitleConvert`「转换 · {name}」），
**业务域只传参不传串**。

**机械判据**：`grep -nE 'title:.*[一-龥]' src` 应清零（排除 `ai/prompts/` 与
`*.test.ts`）。

❌ 存量已落盘的中文 title **不迁移**（数据不动，只管新生成）。

---

## 九、例外登记表

**未登记的按违规处理。** 每条写明：例外值 / 落点 / 理由 / 是否设计稿指定。

| #   | 例外值                 | 落点                                                                     | 理由                               | 稿定   |
| --- | ---------------------- | ------------------------------------------------------------------------ | ---------------------------------- | ------ |
| E1  | 间距 **14px**          | `StartPanelApp.svelte` `<style>` 开刷面板操作行（`wengu-start-actions`） | 随卡片尺寸放宽                     | ✅ 屏① |
| E2  | 间距 **14px**          | `aiflow.scss` 面板密集刻度                                               | AI 横幅内部节奏                    | ✅     |
| E3  | 间距 **1/2/5/9px**     | AI 会话面板（`aiflow` / `aipanel*`）                                     | 面板密集区特例                     | ✅     |
| E4  | 间距 **12px**          | `wengu-word-actions` 单词卡主操作区                                      | 大按钮触区、居中                   | ✅     |
| E5  | 圆角 **4px**           | 题卡自绘按钮族（`.wengu-btn` / `.wengu-chip`）                           | 贴题卡视觉                         | ✅     |
| E6  | 圆角 **20px 20px 0 0** | `mobile-drawer.scss` 抽屉顶角                                            | 移动端单列特例                     | ✅     |
| E7  | 触控 **40px**          | `words-mobile.scss`(6) + `english.scss`(5) 的次要/密集控件               | 非误按代价高的动作                 | ⬜     |
| E8  | 字号 **17~44px**       | 展示型字号（图标/数字大字/空态标题）                                     | 非正文档                           | ⬜     |
| E9  | 定宽 **300px**         | `StartPanelApp.svelte` `<style>` 开刷面板控件                            | 内核 `fn__size200` 的放宽          | ✅     |
| E10 | 字面色值               | 阴影兜底段 + 全屏遮罩（`rgba(0,0,0,.2/.35/.42)`）                        | 遮罩与主题无关                     | ⬜     |
| E11 | 超长文件               | `src/word/data/phonetics-data.ts`(47148) / `words-p01..p16`              | **生成数据文件**，脚本产出、勿手改 | —      |
| E12 | 超长文件               | `src/quiz/index.ts`(**576**，基线豁免)                                   | 编排内聚，**只许减不许增**         | —      |
| E13 | 样式落点               | 组件 `<style>`（`css:"injected"` 运行时注入，非 `dist/index.css`）       | 组件独占样式随组件走（§13）        | —      |

> ⚠️ **E12 的口径**：豁免**不是免死金牌**——`quiz/index.ts` 的基线是 574，
> 现已 576（净增 2）。规范口径＝**豁免额度即上限**，越线照样算违规。

### 9.1 公共构件清单（新增前先查此表，**禁复制第二份**）

`ui/Button.svelte`（按钮）· `ui/FormRow.svelte`（表单行）·
`ui/TreeList.svelte`（树，三棵树共用）· `ui/Dialog.ts`（弹窗骨架）·
`ui/FormHtml.ts`（HTML 侧表单构件 + `svgIcon` / `statusIcon`）·
`ui/Notify.ts`（通知）· `ui/shared.ts`（`Armed<T>` 两击确认、`esc` / `fmt` /
`copyText` / `isMobileUi` 等）。各只有一份，跨域复用。

---

## 十、与主题对抗

1. **抬特异性优先用复合选择器**，例如 `.b3-label.wengu-formrow { … !important }`
   把特异性抬到 0,2,0 压主题注入的 `.b3-label` 单类。
2. **`!important` 只允许两种用途**：压内核内联自定义属性
   （`aipanel-tree.scss` 的 `--file-toggle-width`）、对抗主题单类。
   **每处 `!important` 必须带注释说明对手是谁。**
3. **`[hidden]` 兜底清单是唯一落点**（见 §5.6）。

## 十一、结构红线

1. **单文件 ≤500 行**（唯一豁免 `quiz/index.ts`，且豁免即上限）。
   ⚠️ 豁免范围需明确：**生成数据文件豁免**（§9 E11）；
   **测试文件同受 ≤500**（视需要按 `describe` 分片）。
   **❌ 待修**：`ConvertBatch.ts`(604) / `QuestionBank.ts`(531) /
   `index.ts`(512) 三个文件超线（`english.scss`(564) 已于整改 F1 #127 拆片回线，
   见 §13.5）。
   **建议加一条极轻量单测**把红线变成 CI 会红的东西（10 行：扫
   `src/**/*.{ts,svelte,scss}` 断言行长 ≤500 + 显式豁免额度常量）——
   这是「拆一次压线后继续净增」的唯一根治手段。
2. **各域 `index.ts` 必须是编排入口，禁纯 re-export barrel**
   （判定：含实际逻辑/副作用）。
3. **禁复制第二份组件/逻辑**（见 §9.1）。

---

## 十二、整页不滚动

高度链要一路打通，滚动收进**面板内部的滚动窗**，工作区主区不出页面级滚动条。

- **原则**：面板的「常驻件」（标题栏、说明 hint、过滤条/工具行）与「清单头」
  （在途流横幅）必须**钉在视野里**；用户滚的是清单与详情，不是面板本身。
- **技术要点（缺一条链就整页照滚）**：
    1. flex / `min-height:0` 链一路打通（主区 → 面板页根 → 卡 → 卡内两列）；
    2. grid 行高**显式分配**（`grid-template-rows: auto minmax(0, 1fr)`）；
    3. 主区经 `--fit` 档改写，**开/关在面板挂载/卸载处配对**，
       且**只动本面板那一份骨架、禁 document 级全选**；
    4. 内滚窗落在**列**上，列加 `scrollbar-gutter: stable`；
    5. 弹窗长内容同口径（`max-height` 封顶 + 内容区自滚）。
- **落地**：AI 会话工作区（Issue #96）＝首个达标面板。
  **其余管理面板（专题/知识/统计/学伴）的迁移不在本条当前生效范围**——
  规范是总则，存量面板按其自有节奏迁移。
  ⚠️ 建议补一张「已达标 / 待迁移面板清单」，让后来者知道改哪块该套哪档。

---

## 十三、样式绑定：组件 `<style>` vs 共享片

> **新规生效（整改 F1 / Issue #127，20260915）。** 用户立规「**非通用样式一律写入
> 组件文件**」，替代旧约定「组件零 `<style>`，全部走全局 scss」（原
> `svelte-migration.md:15`，已于 `1c62857` 20260909 显式执行过一轮迁出）。
> 本节是该口径的**唯一权威落点**；`docs/svelte-migration.md` 与 `AGENTS.md`
> 只作索引与施工要点，不得与本条相左。

### 13.1 归属判定（三步定生死）

| 判据                                                         | 归属               |
| ------------------------------------------------------------ | ------------------ |
| 单组件独占、样式类名不出现在 TS 拼串里、不跨组件复用         | **组件 `<style>`** |
| ① **TS 字符串渲染层**产出的 `wengu-*` 类                     | 共享片（登记）     |
| ② **跨组件共享**（同一类名被 ≥2 组件引用）                   | 共享片（登记）     |
| ③ 四片 `mobile-*.scss` 共用的 `.wengu-mobile .wengu-md` 基座 | 共享片             |

①的清单（迁移硬约束，改动此节的渲染层须同步本节）：`QuizShell` / `CardHtml` /
`NumRail` / `MaterialDecorate` / `ClueMarkDom` / `ProtyleHost` / `PreviewFlow` /
`AnnoFlow` / `KnowPicker` / `ModelPicker` / `WorkspaceShell` / `MdRender` /
`FormHtml` / `SettingsDialog` 等拼 `innerHTML` 的 `.ts`。

### 13.2 迁入组件 `<style>` 的三条硬约束

1. **类名逐字保留**（DOM 零变化）——`<style>` 里的选择器与迁移前 scss **逐字一致**，
   只加 `:global()` 包裹（见下条）。
2. **凡类名由子组件渲染 / `{@html}` 注入 / TS 外部写入的选择器，一律 `:global()`
   局部包裹**。Svelte `scoped` 只重写**模板里的静态类名**；下列形态不加 `:global()`
   会导致**整条规则被静默删掉**（`svelte-check` 的 `css_unused_selector` 会预警，
   但 `check:svelte --threshold error` 把它吞了 ⇒ 必须靠单测兜底）：
    - `class=` 传给子组件（如 `<Select class="wengu-start-ctl">`、`<Button class="…">`）；
    - `{@html svgIcon(id, "cls")}` 注入的类名；
    - 父组件样式里定位**子组件渲染出的 DOM**（如 FormRow 的 `.wengu-formrow`）；
    - TS 侧 `classList.add/remove`、`className = "wengu-…"` 写入的类。
      **正确写法**：`:global()` 只包住会失配的那一段，保留自有静态类做 scoped 锚点，
      例如 `.wengu-start .wengu-start-card :global(.wengu-formrow) { … }`。
3. **构建通道**：组件 `<style>` 走 svelte-loader 的 `css:"injected"`
   （**运行时注入** `<style id="svelte-xxxx">` 到 `head`），与全局 scss 的
   `MiniCssExtractPlugin` → `dist/index.css` **两条通道并存**。
   ∴ `pnpm build` 后**不要**指望在 `dist/index.css` 里 grep 到组件样式；
   组件样式在 bundle 的 `$$css = { hash, code }` 里，靠 `append_styles` 运行时挂载。

### 13.3 样式绑定登记表（留共享片的样式必须在此登记）

**未登记的按违规处理**（同 §9 口径）。新迁出的每一片、以及任何留共享片的
「专属类族」，都要在此登记**绑定到哪个渲染函数 / 哪组组件**。

| 共享片                                  | 绑定到（渲染源）                                                 | 留片理由               |
| --------------------------------------- | ---------------------------------------------------------------- | ---------------------- |
| `base.scss`                             | `FormHtml.ts` / `QuizShell.ts` / 各域 TS 拼串                    | ① TS 渲染层 + 共享底座 |
| `panels.scss`                           | `FormHtml` / `KnowPicker` / `SettingsDialog` / `QuizShell` 等 TS | ①（47 类 TS 触达）     |
| `cards.scss` / `card-render.scss`       | `CardHtml` / `CardMount` / `QuizCard` 组件族                     | ①（各 21~25 类）       |
| `english.scss`                          | `GroupUnitApp` / `CardSlotsArea` / `ClueFlow` / `MaterialFlow`   | ①（27 类 TS 触达）     |
| `english-gloss.scss`                    | `AnnoFlow`（标注浮层）/ `ui/ColorMenu.svelte`（竖排色板）        | ① + 跨组件复用         |
| `reading.scss`                          | `GroupUnitApp` / `CardHtml`（原文高亮）                          | ①（19 类）             |
| `preview.scss`                          | `PreviewFlow.ts`（无 Svelte 渲染源）                             | ①（19 类）             |
| `rail.scss`                             | `RailApp` / 4 个面板骨架（`PanelFit.ts` TS 触达）                | ② 跨面板共享           |
| `words.scss` / `words-mobile.scss`      | `QuizCard` / `LookupScreen` / `WordHead` 等 6+ 组件（成对覆写）  | ② + 对偶片须同批       |
| `mobile-*.scss` / `mobile-english.scss` | `HomeScreen` / `DrillScreen` / `QuestionBody` 等移动组件族       | ③ 基座 + 跨组件        |
| `aipanel*.scss` / `aiflow.scss`         | `SessionPanelApp` / `SessionDetail` / `FlowBanner`               | ② 跨组件 + TS 触达     |

### 13.4 试点结论（Issue #127，`startpanel.scss` → `StartPanelApp.svelte`）

**试点片选**：#110 审计判定最干净的一片（唯一消费者、零 TS 拼串触达、107 行）。

**构建路径可用性（已验证）**：

- svelte-loader `css:"injected"` **首次启用即通**，真打通。产物形态＝
  bundle 内 `const $$css = { hash: 'svelte-xxxx', code: '…' }` +
  `append_styles(anchor, $$css)`，运行时 `create_element('style')` 插 `head`，
  以 `hash` 作 `style.id` 去重。
- 实测（`pnpm build` + 产物核对）：`dist/index.js` 内含
  `class="wengu-start svelte-xxxx"` 与完整 CSS 文本；`dist/index.css`
  **不再含** `wengu-start` 规则（符合「两通道并存」预期，非丢失）。
- 14 条 scss 规则 → 编译产物 14 条**一条不少**（sass 与 Svelte 双编译核对）。

**遇到的坑（写进 §13.2.2，后来者直接照抄修法）**：

1. **`:global()` 是必需品，不是可选项**。`startpanel.scss` 的 14 条规则里有 **6 条**
   命中「子组件渲染 / `{@html}` 注入」——涉及类名 `wengu-formrow` / `fn__flex-1` /
   `b3-label__text` / `wengu-start-ctl` / `wengu-start-act` / `wengu-start-cardicon`
   ⇒ 不加 `:global()` 就会被 scoped 整条删除。**迁片前先跑
   `grep -c 'class="[^"]*{'` 与「传给子组件的 `class=`」清单定量。**
2. **`svelte-check` 的 `css_unused_selector` 是唯一静态安全网，但被门禁吞掉**
   （`check:svelte --threshold error`）。∴ 试点把「Svelte 真编译零 unused 选择器」
   写进了 `StartPanelStyle.test.ts`——**每迁一片都要带这条闸**，否则失配只在真机画面暴露。
3. **规格断言不必丢**：sass 把 `:global(...)` 原样透传，故断言前做一次
   `:global(` 剥壳归一化即可**逐字沿用原规格断言**（本案 8 条规格断言一条未减，
   另加 2 条迁移闸）。

**后续批次建议**（对照 #110 纯度排序表，**同域串行、异域可并行**）：

- **批 1（低风险，可紧接着做）**：`companion.scss`(197→ ~150 可迁)、
  `startpanel.scss`（已完成）、`rail.scss` 的 rail 段（~60）。
- **批 2~3（中风险，含动态拼类需 `:global()`）**：`aiflow.scss`(498)、
  `report.scss`、`stats.scss`、`review.scss`。
- **批 4~5（中→高）**：`mobile-*.scss` 四片 + `aipanel*.scss`。
- **不迁**（① TS 渲染层）：`panels` / `english` / `base` / `cards` /
  `card-render` / `reading` / `preview`——维持共享片并登记（§13.3）。
- ⚠️ **跨组件对偶片**（`words.scss` ↔ `words-mobile.scss`）**必须成批迁移**，
  切勿单飞。

### 13.5 红线收口（整改 F1 顺带）

`english.scss` 原 564 行破 §11「单文件 ≤500」红线，本单按语义机械拆片
（零样式变更，83 条规则集完全一致）：`english.scss`(408) +
`english-gloss.scss`(108) + `mobile-english.scss`(60)。

---

## 附：本文与其它文档的关系

| 文档                                           | 角色                                                                   |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| **`docs/design-spec.md`（本文）**              | **界面规范唯一权威落点**                                               |
| `docs/design-review.md §〇`                    | 历史审查清单（**保留不删**），规范条款已上收本文；§一/§四 为历史快照   |
| `AGENTS.md` 通用横切约束                       | 索引 + 最常踩的几条（指向本文）                                        |
| `docs/svelte-migration.md`                     | Svelte 迁移施工手册（模式样板 / 暗雷清单；样式绑定权威口径见本文 §13） |
| `design/*.html` / `design/aipanel-gap-list.md` | **设计稿**（照稿施工、勿发明视觉）                                     |
| `design/theme-tokens-neo.md`                   | **观察记录，非规范来源**（见文首）                                     |
| `docs/question-block-contract.md`              | 题块契约（改行为必须同步）                                             |
