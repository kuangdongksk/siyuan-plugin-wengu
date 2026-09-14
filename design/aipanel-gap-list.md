# 温故 · AI 会话面板「设计稿 vs 实现」差距清单

对照口径：

- **设计稿（权威）**：`design/convert-stop-redesign.html` 的 `<style>` 与三屏 `ai-panel-*` mock（数值全部逐条从原稿提取，本清单不发明任何稿外视觉）。
- **实现（现状实测）**：`src/scss/aipanel.scss`、`src/scss/aiflow.scss`、`src/scss/rail.scss`（布局壳）、`src/ai/components/SessionPanelApp.svelte` + `FlowBanner.svelte` + `SessionDetail.svelte` + `ui/TreeList.svelte`、`src/ai/core/SessionTree.ts` + `SessionDetail.ts` + `FlowOwnership.ts`。
- **宿主约束**：色值一律 `var(--b3-*)`（#70 事故口径），设计稿 oklch 令牌按 §0 映射表落点；尺寸/字距/字重照稿字面值。
- **输入说明**：真机截图 `wengu-aipanel-current.png` 的视觉分析因图像工具持续 429 限流未能完成；本清单全部对比项基于设计稿与实现两侧**源码逐行实测**，数值精确到 px，不受此影响。

严重度分级（按用户可见影响排序）：

- **S（结构级）**：每一屏必见、决定「像不像设计稿」的骨架差距；
- **A（显著数值差）**：一屏内多处可见的尺寸/颜色档位偏差；
- **B（细节档位）**：浓度、字重、字距等单点小差；
- **C（稿外新增，需拍板）**：实现里有、设计稿里没有的功能件（非还原缺陷，但影响「逐字对齐」）。

---

## 0. 令牌映射表（设计稿 oklch → 思源 b3）

后面所有「修法」里的色值都引用本表，不重复展开。

| 稿令牌                    | 稿值（oklch）                                                                                                          | b3 落点（建议）                                                                                                                             | 说明                                                                                 |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `--surface`               | `0.3904 0.0228 232.5`                                                                                                  | `var(--b3-theme-surface)`                                                                                                                   | 卡面                                                                                 |
| `--surface-2`             | `0.4344 0.0162 233.5`                                                                                                  | `color-mix(in srgb, var(--b3-theme-surface) 90%, var(--b3-theme-on-surface) 10%)`                                                           | 横幅 run 底（比 surface 亮一档；嫌混色敏感可退回同 surface，靠 3px 左线+底边线分层） |
| `--surface-3`             | `0.3404 0.0242 234.5`                                                                                                  | `var(--b3-theme-background)`                                                                                                                | 树凹槽底（思源 background 恰比 surface 深一档）                                      |
| `--fg`                    | `0.8404 0.0144 233.5`                                                                                                  | `var(--b3-theme-on-surface)`                                                                                                                | 正文                                                                                 |
| `--muted`                 | `0.76 0.0295 88.4`                                                                                                     | `var(--b3-theme-on-surface-light)`                                                                                                          | 弱化正文                                                                             |
| `--faint`                 | `oklch(0.76 … / 0.55)`                                                                                                 | `color-mix(in srgb, var(--b3-theme-on-surface-light) 55%, transparent)`                                                                     | 第三档弱化（log-label / 时间戳 / dr-idx / dr-note）                                  |
| `--border`                | `oklch(0.8404 … / 0.2)`                                                                                                | `var(--b3-border-color)`                                                                                                                    | 常规边线                                                                             |
| `--border-2`              | `oklch(0.8404 … / 0.34)`                                                                                               | `color-mix(in srgb, var(--b3-theme-on-surface) 34%, transparent)`                                                                           | own-note 虚线（比常规边线实一档）                                                    |
| `--hover`                 | `oklch(0.8404 … / 0.08)`                                                                                               | `var(--b3-list-hover)`                                                                                                                      | 行 hover                                                                             |
| `--accent`                | `0.677 0.0876 44.8`                                                                                                    | `var(--b3-theme-primary)`                                                                                                                   | 主题陶土橙                                                                           |
| `--accent-solid`          | `0.56 0.095 44.8`                                                                                                      | `var(--b3-theme-primary)`（实心钮底=思源主钮）                                                                                              |                                                                                      |
| `--accent-text`           | `0.82 0.09 47`                                                                                                         | `var(--b3-theme-primary)`（无亮档变量，直接主色）                                                                                           | 徽标/chip 词色                                                                       |
| `--accent-dim`            | `oklch(0.677 … / 0.18)`                                                                                                | `color-mix(in srgb, var(--b3-theme-primary) 18%, transparent)`                                                                              | 选中底 / 徽标底 / run 点光晕                                                         |
| `--accent-hi`             | `0.732 0.098 44.5`                                                                                                     | —                                                                                                                                           | **原稿未使用**（只有定义），无需落点                                                 |
| `--ok` / `--ok-solid`     | `0.8 / 0.68 0.12 155`                                                                                                  | `var(--b3-card-success-color)`                                                                                                              | 词色与实心同源                                                                       |
| `--ok-dim`                | `oklch(0.68 … / 0.18)`                                                                                                 | `color-mix(in srgb, var(--b3-card-success-color) 18%, transparent)`                                                                         | done 徽标底                                                                          |
| `--fail` / `--fail-solid` | `0.8 / 0.62 0.16 28`                                                                                                   | `var(--b3-card-error-color)`                                                                                                                |                                                                                      |
| `--fail-dim`              | `oklch(0.62 … / 0.18)`                                                                                                 | `color-mix(in srgb, var(--b3-card-error-color) 18%, transparent)`                                                                           | fail 徽标底                                                                          |
| `--queued`                | `oklch(0.76 … / 0.42)`                                                                                                 | `color-mix(in srgb, var(--b3-theme-on-surface) 42%, transparent)`                                                                           | 排队虚线点                                                                           |
| `--queued-fill`           | `oklch(0.76 … / 0.16)`                                                                                                 | `color-mix(in srgb, var(--b3-theme-on-surface) 16%, transparent)`                                                                           | seg/bar 轨道底                                                                       |
| `--r` / `--r-b`           | `6px` / `12px`                                                                                                         | 字面量 `6px` / `12px`                                                                                                                       | b3 无尺寸变量约束；`--b3-border-radius` 恰为 6px 亦可                                |
| `--mono`                  | `ui-monospace, …`                                                                                                      | `var(--b3-font-family-code)`                                                                                                                | 所有数字/时间戳/小标签                                                               |
| 行内裸 oklch              | `s-skip 0.42`、`s-cancel 0.26`、`s-queued 0.14`、`dr-line 0.1`、`log-line 0.08`、`stop 底 0.14`、`cancel 描边 0.3/0.5` | 依次 `success 42%`、`on-surface 26%`、`on-surface 14%`、`on-surface 10%`、`on-surface 8%`、`primary 14%`、`on-surface 30%/50%` 的 color-mix | 见 §F/§E 各条                                                                        |

---

## 1. 结构级差距（S 级）

### S1 横幅与面板不是一张卡 ★ 最重

| 项           | 内容                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿       | `.ai-panel { display:grid; grid-template-columns:292px minmax(0,1fr); grid-template-areas:"banner banner" "tree detail"; background:var(--surface); border:1px solid var(--border); border-radius:12px; overflow:hidden }`——横幅是卡内第一行（跨两栏），自身**无**圆角、无外围边框、无外边距，只有 `border-bottom:1px solid var(--border)` + run/stop 态的 `border-left:3px solid var(--accent)`                                                     |
| 现状实现     | `.wengu-aiflow`（aiflow.scss:17）是**独立圆角卡**：`margin-bottom:10px; border-radius:var(--b3-border-radius); border:1px solid var(--b3-border-color); border-left-width:3px; overflow:hidden`；DOM 位置在 `SessionPanelApp.svelte:133`——宿主标题行、hint 行之后，kinds 过滤条与两栏区**之外**                                                                                                                                                      |
| 用户可见影响 | 设计稿的「面板=一张一体卡」骨架不存在；横幅圆角小卡 + 裸两栏拼在一起，层次断裂，这是「整体不像」的第一根因                                                                                                                                                                                                                                                                                                                                           |
| 修法         | ① 外层新增 `.wengu-aipanel` 卡壳（见 S2）；② FlowBanner 移入卡内作为跨栏首行（grid-area:banner 或卡内第一个子元素+树/详情包在第二行 grid 里）；③ `.wengu-aiflow` 删 `margin-bottom`、`border-radius`、外围 `border`，只留 `border-bottom:1px solid var(--b3-border-color)`；run 态 `border-left:3px solid var(--b3-theme-primary)`；stop 态底色 `color-mix(in srgb, var(--b3-theme-primary) 14%, transparent)`（稿 `oklch(0.56 0.095 44.8 / 0.14)`） |

### S2 面板没有外卡（边框 + 12px 圆角 + surface 底 + overflow hidden）

| 项       | 内容                                                                                                                                                                                                                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | 同 S1 的 `.ai-panel`：`border:1px solid var(--border); border-radius:12px(--r-b); background:var(--surface); overflow:hidden`；无横幅态 `.is-plain` 只留 `"tree detail"`；≤1000px 断点折单列（`"banner"/"tree"/"detail"`，树改 `border-bottom`）                                                         |
| 现状实现 | 无任何对应物。`.wengu-ai-two { display:flex; gap:16px; align-items:flex-start }`（rail.scss）、`.wengu-ai-side { flex:none; width:320px }`、`.wengu-ai-pane { flex:1; min-width:0 }`——两栏裸排，无统一背景/边框/圆角                                                                                     |
| 修法     | `.wengu-ai-two`（或其外包一层）改为：`display:grid; grid-template-columns:292px minmax(0,1fr); background:var(--b3-theme-surface); border:1px solid var(--b3-border-color); border-radius:12px; overflow:hidden`；两栏间 `gap` 去掉（改 0），分隔交给树的 `border-right`（见 A4）；补 ≤1000px 单列响应式 |

### S3 树宽 320px ≠ 292px

| 项       | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 设计稿   | `.ai-panel` 首列 `292px`（写死在 grid-template-columns）                |
| 现状实现 | `.wengu-ai-side { width:320px }`（rail.scss）                           |
| 修法     | 改 `292px`（S2 落地后由 grid 列宽接管，`.wengu-ai-side` 的 width 删除） |

### S4 树没有凹槽底色、没有右边线、没有容器 padding

| 项       | 内容                                                                                                                                                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.ai-tree { grid-area:tree; background:var(--surface-3); border-right:1px solid var(--border); padding:8px 0 12px; min-width:0 }`                                                                                                                                                |
| 现状实现 | 无对应样式。树列透明背景、无边线；`.wengu-ai-side .wengu-ai-list { max-height:calc(100vh - 260px); overflow-y:auto; padding-right:2px }`（rail.scss）——上下无 padding，多出 max-height/overflow/padding-right                                                                    |
| 修法     | 树列补：`background:var(--b3-theme-background)`（surface-3 落点）、`border-right:1px solid var(--b3-border-color)`、`padding:8px 0 12px`；`padding-right:2px` 删（右边线即界）；滚动移交卡壳或树列自身（`overflow-y:auto; min-height:0`），删裸 `max-height:calc(100vh - 260px)` |

### S5 树行尾元素与稿不符（徽标不贴右 + 多出时间戳/删除钮）

| 项           | 内容                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿       | `.leaf .badge { margin-left:auto }`——叶行 = 点 + 名 + **徽标贴右**，仅此三件；组行（tg1/tg2）行尾**无**任何元素                                                                                                                                         |
| 现状实现     | `.wengu-ai-list .b3-list-item .wengu-aipanel-badge { margin-left:6px }`（aipanel.scss:138）——徽标跟着名字走、不贴右；且 trailing 片段给每行挂了 `wengu-ai-meta` 时间戳（12px）+ hover 删除钮（SessionPanelApp.svelte:184-222），组行还有「N 条 · 时间」 |
| 用户可见影响 | 40 条记录时徽标随名字长短参差、扫视列不齐；行尾多出来的时间/meta 挤占空间，与稿的「极简三件」形态不同                                                                                                                                                   |
| 修法         | 徽标 `margin-left:auto`；叶行时间戳删除（时间已在详情头 meta；如需保留，折中收进 hover 区与删除钮同组、常驻不渲染）；组行「N 条 · 时间」meta 删或收进 hover（稿组行只有箭头+名）。删除钮属功能件可保留 hover 显隐，但不得占据常驻视觉位                 |

### S6 轮次日志行信息结构与稿不同

| 项       | 内容                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | 一行=一轮：`14:22:07 · 轮次 1 · 输入 <em>3,240 字</em> → 输出 <em>8 题</em>` / `14:22:31 · 轮次 2 · 校验 8 题，其中 <em>2 题重试</em>` / `14:22:48 · 轮次 3 · 写入题集 · <em>8 题</em>`——每行时间戳**逐轮推进**，有「轮次 N」编号，输入→输出合一行                                                                                                                                                    |
| 现状实现 | 一行=一条消息（SessionDetail.ts `rowOf`）：user 行「输入 N 字」、assistant 行「输出 N 题/N 字」各自成行；**无「轮次 N」编号**；时间戳全部用记录级锚 `rec.createdAt`（SessionDetail.ts:156）——**每行时间戳相同**（登记簿 AiTurn 未存逐轮时间）                                                                                                                                                         |
| 修法     | 文案层可施工的部分：把成对的 user+assistant turns 合并成一条轮次行「轮次 N · 输入 X 字 → 输出 Y 题」（turns 有序、字数恒可数、题数 `questionCountOf` 数得出才出）——即 i18n 模板从两条改一条；「校验 N 题，其中 M 题重试」「写入题集」无结构化数据支撑，**不编**（维持「宁缺勿错」口径，在 spec 标注为稿 mock 专属）；逐轮时间戳数据层缺失，维持记录级锚但应在 spec 明示这是已知偏差，禁止伪造递增时间 |

### S7 详情头多出 meta 串、抢掉徽标贴右位

| 项       | 内容                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.detail-head` = h3（14px/600）+ kind 徽标 + 状态徽标，`.detail-head .badge { margin-left:auto }`——**状态徽标贴右**，仅此三件                                                                                                                                              |
| 现状实现 | `margin-left:auto` 挂在 `.wengu-aipanel-meta`（aipanel.scss:178，「HH:MM:SS · 模型名」11.5px mono）上，徽标跟在 kind 徽标后不贴右（SessionDetail.svelte 头部顺序：h3 → kind 徽标 → 状态徽标 → meta）                                                                       |
| 修法     | 二选一，推荐 a：a) 按稿删 meta 常驻串——时间在日志首列已有，模型名并入 h3 的 `title` 属性悬停可见；徽标补 `margin-left:auto`。b) 保信息优先：顺序调为 h3 → kind 徽标 → 状态徽标（`margin-left:auto`）→ meta（12px 弱化、不抢 auto）。推荐 a（稿内无此元素，「不发明」口径） |

### S8 详情主体自带滚动窗（稿无）

| 项       | 内容                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.detail-body { padding:13px 16px; flex:1 1 auto; min-height:120px }`——无 max-height、无 overflow，滚动交给整卡                             |
| 现状实现 | `.wengu-aipanel-dbody` 额外有 `max-height:calc(100vh - 320px); overflow-y:auto`（aipanel.scss:193-194）                                     |
| 修法     | S2 卡壳落地后删这两行，由卡壳统一控高；`.wengu-aipanel-detail` 补 `min-width:0; background:var(--b3-theme-surface)`（稿 `.ai-detail` 两条） |

### S9（取舍说明，非必改）树头合并进宿主标题栏；kinds 过滤条与 hint 为稿外件

| 项       | 内容                                                                                                                                                                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.ai-tree-head { display:flex; align-items:center; gap:8px; padding:4px 14px 9px; font-size:13px; font-weight:600 }` + `badge--plain`（「3 组」）贴右——树头在卡内树栏首行；全卡只有「横幅+树+详情」三件                                                                                        |
| 现状实现 | 标题「AI 会话」+组数徽标+清空/刷新钮合并进宿主 `.wengu-ws-title`（SessionPanelApp.svelte:114 注释：紧贴出两遍「AI 会话」是纯噪音——**有意取舍**）；`.wengu-ai-kinds` 类别过滤条与 hint 行为稿外新增功能件                                                                                       |
| 修法     | 标题合并维持现状（稿信息没丢：600 字重 ✔、组数徽标在位，但徽标 `font-weight:400` ≠ 稿 badge 的 500，见 B1）；kinds 过滤条与 hint 留在卡外（不进 `.wengu-aipanel` 卡，保持卡内三件纯度）。若追求逐字对稿可把树头做回卡内，但会与宿主标题重复——两害取轻，建议保留取舍并在 code review 时统一口径 |

---

## 2. 树（A/B 级）

### A1 三级缩进：22/36/54px 制 ≠ 稿 14/27/42px

| 项           | 内容                                                                                                                                                                                                                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿       | `.tg1 { padding:3px 14px }`（正文起点 14px）、`.tg2 { padding:5px 14px 5px 27px }`（27px）、`.leaf { padding:6px 14px 6px 42px }`（42px）——左缘到文字，含 caret 9px 列（`.tg1 .caret { width:9px }`）                                                                                     |
| 现状实现     | 缩走 TreeList 原生 toggle 制（TreeList.svelte）：`INDENT=18`，`liVars(depth)`：深度0 `--file-toggle-width:22px`、深度d `18+d*18`（d1=36、d2=54）+ 思源 `.b3-list-item` 行壳自身内边距；叶子行 toggle 隐藏（`fn__hidden`）但宽度占位仍在——正文起点 ≈ 30/44/58px（随主题行壳 padding 浮动） |
| 用户可见影响 | 层级视觉松散，树宽 292px 下名字可用宽度更少                                                                                                                                                                                                                                               |
| 修法         | 在 `.wengu-aipanel` 作用域覆写（不动 TreeList 本体）：深度0 `--file-toggle-width:14px`、深度1 `27px`、深度2 `42px`，行壳左内边距归 0（`padding-left:0`，右 14px 保留），caret 列宽 9px；三级行高按稿 `3px+?`（tg1 12px 字+上下 3px、tg2 5px、leaf 6px——行 padding 见 A2 表）              |

### A2 行字号与行 padding：统一 13px ≠ 稿 12 / 12.5 / 12.5px

| 项       | 内容                                                                                                                                          |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | tg1 `font-size:12px; padding:3px 14px`；tg2 `font-size:12.5px; padding:5px 14px 5px 27px`；leaf `font-size:12.5px; padding:6px 14px 6px 42px` |
| 现状实现 | `.wengu-ai-name { font-size:13px }`（rail.scss，组行叶行统一）；行高/行距继承思源 `.b3-list-item` 原生（未覆写）                              |
| 修法     | 叶行与 tg2 组行 `font-size:12.5px`；tg1（种类行）`12px`；行 padding 按 A1/稿三件套（3/5/6px 上下）                                            |

### A3 组行与叶行字色无区分；种类行样式**根本没写**

| 项           | 内容                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 设计稿       | `.tg1 { color:var(--muted); letter-spacing:0.02em }`、`.tg2 { color:var(--muted) }`、`.leaf { color:var(--fg) }`；`.tg1 .caret { color:var(--faint); font-size:10px }`                                                                                                                                                                                                               |
| 现状实现     | **`.wengu-ai-name-group` 在全仓 scss 零定义**（grep 实证）——种类行与叶行同色同字号；`.wengu-ai-name` 也未设色（继承正文色）；无 letter-spacing                                                                                                                                                                                                                                       |
| 用户可见影响 | 「种类→主题→记录」三级层级在文字重量上读不出来，全部一样浓                                                                                                                                                                                                                                                                                                                           |
| 修法         | `.wengu-ai-name-group`（种类行=tg1）：`font-size:12px; color:var(--b3-theme-on-surface-light); letter-spacing:0.02em`；主题组行（tg2）：`font-size:12.5px; color:var(--b3-theme-on-surface-light)`；叶行 `.wengu-ai-name`：`color:var(--b3-theme-on-surface)`；caret（若有）`color:color-mix(in srgb, var(--b3-theme-on-surface-light) 55%, transparent); font-size:10px; width:9px` |

### A4 两栏间 16px gap ≠ 稿 0 间隙 + 1px 右边线

| 项       | 内容                                                                     |
| -------- | ------------------------------------------------------------------------ |
| 设计稿   | 两列间无 gap，分隔 = `.ai-tree { border-right:1px solid var(--border) }` |
| 现状实现 | `.wengu-ai-two { gap:16px }`，无边线                                     |
| 修法     | S2/S4 落地时一并处理：gap 去掉、树列补右边线                             |

### B2 hover 与选中态

| 项       | 内容                                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 设计稿   | `.leaf:hover { background:var(--hover) }`；`.leaf.is-selected { background:var(--accent-dim); box-shadow:inset 2px 0 0 var(--accent) }`                                                                                                          |
| 现状实现 | hover = 思源原生 `--b3-list-hover`（≈ 稿 hover 8% 档）✔ 等价；选中 = `b3-list-item--focus` 原生底色 + `.wengu-ai-list .b3-list-item--focus { box-shadow:inset 2px 0 0 var(--b3-theme-primary) }`（aipanel.scss:144）——inset 2px 竖线**已对齐** ✔ |
| 修法     | 底色对齐稿档位：`background:color-mix(in srgb, var(--b3-theme-primary) 18%, transparent)`（替换原生 focus 底色， specificity 用面板根类前缀压）；竖线保持现状                                                                                    |

### B3 点与名字的间距

| 项       | 内容                                                                                  |
| -------- | ------------------------------------------------------------------------------------- |
| 设计稿   | `.leaf { gap:8px }`——dot/名/徽标相邻一律 8px                                          |
| 现状实现 | `.wengu-aipanel-dot { margin-right:2px }`（aipanel.scss:134）、徽标 `margin-left:6px` |
| 修法     | 两处统一 8px（徽标改 `margin-left:auto` 见 S5）                                       |

---

## 3. 徽标与状态点（B 级，多数已对齐）

### 已对齐项（防止误改，仅列结论）

`.wengu-aipanel-badge` 基形 `height:19px; padding:0 7px; border-radius:4px; font-size:11px; letter-spacing:0.02em; gap:5px` ✔；各态配色/边框透明度（run 45%/done 40%/fail 45%/stop 45%/plain border）✔；`.wengu-aipanel-dot` 8px 基形与六态形态（run 实心+3px 光晕、stop 描边+光晕、skip 描边、queued **1.5px 虚线 42%**、cancel 描边 30%）✔。

### B1 徽标缺 500 字重（组数徽标同病）

| 项       | 内容                                                                                                                               |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.badge { font:500 11px/1 var(--mono); … }`                                                                                        |
| 现状实现 | `.wengu-aipanel-badge` 无 font-weight（继承 400）；且 `.wengu-aipanel-gcount { font-weight:400 }` 显式压成 400（aipanel.scss:127） |
| 修法     | 基形补 `font-weight:500; line-height:1`；`.wengu-aipanel-gcount` 的 400 覆写删除                                                   |

### B4 徽标底色浓度 14% ≠ 稿 18%

| 项       | 内容                                                                    |
| -------- | ----------------------------------------------------------------------- |
| 设计稿   | run/done/fail 底 = `--accent-dim / --ok-dim / --fail-dim`，全部 **18%** |
| 现状实现 | 三态底均 `color-mix(… 14%, transparent)`（aipanel.scss:85/91/97）       |
| 修法     | 三处 14% → 18%                                                          |

### B5 run/stop 点光晕浓度 24% ≠ 稿 18%

| 项       | 内容                                                                                 |
| -------- | ------------------------------------------------------------------------------------ |
| 设计稿   | `box-shadow:0 0 0 3px var(--accent-dim)`（18% 档）                                   |
| 现状实现 | `color-mix(in srgb, var(--b3-theme-primary) 24%, transparent)`（aipanel.scss:29/48） |
| 修法     | 24% → 18%（与 B4 同档，一套 dim 走天下）                                             |

### B6 转圈 11px ≠ 稿 12px

| 项       | 内容                                                                                                                                           |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.spin { width:12px; height:12px; border:1.6px solid var(--accent-dim); border-top-color:var(--accent); animation:spin 0.9s linear infinite }` |
| 现状实现 | `.wengu-aipanel-spin` 11px、环色 30% 混（aipanel.scss:106-114）；0.9s ✔、1.6px ✔、reduced-motion 关闭 ✔                                        |
| 修法     | 尺寸 11→12px；环底色 30%→18%（= accent-dim 档）                                                                                                |

---

## 4. 详情区（A/B 级）

### 已对齐项

`.wengu-aipanel-dhead { padding:12px 16px; border-bottom; gap:9px; flex-wrap }` ✔；`.wengu-aipanel-dtitle` 14px/600/-0.005em ✔（多出的 ellipsis 保留无妨）；`.wengu-aipanel-dbody` padding 13px 16px + min-height 120px ✔；`.wengu-aipanel-log li` grid `66px minmax(0,1fr)` + gap 12px + padding 6px 0 + 12.5px ✔、last-child 无边线 ✔；`.t` mono 11.5px/1.6 ✔；`em` normal + on-surface ✔；`.wengu-aipanel-dfoot` padding 11px 16px + border-top + 底色 35% mix ✔（稿 surface-3/0.35 落点）。

### A5 log-label 与时间戳的「第三档弱色」没做出来

| 项           | 内容                                                                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿       | `.log-label { font:500 11px/1 var(--mono); letter-spacing:0.08em; color:var(--faint); margin-bottom:9px }`；`.log .t { font:400 11.5px/1.6 var(--mono); color:var(--faint) }`——两处都是 **faint（muted 的 55%）** |
| 现状实现     | `.wengu-aipanel-logl` 缺 `font-weight:500`、色用 `--b3-theme-on-surface-light`（=muted 档）；`.wengu-aipanel-log .t` 同样用 muted 档                                                                              |
| 用户可见影响 | 标签与时间戳和正文摘要一样浓，「时间轴感」弱                                                                                                                                                                      |
| 修法         | 两处色改 `color-mix(in srgb, var(--b3-theme-on-surface-light) 55%, transparent)`；logl 补 `font-weight:500; line-height:1`                                                                                        |

### A6 日志行分割线档位

| 项       | 内容                                                                                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.log li { border-bottom:1px solid oklch(0.8891 0.0295 89.6 / 0.08) }`（fg 8%，极淡）                      |
| 现状实现 | `color-mix(in srgb, var(--b3-border-color) 60%, transparent)`（aipanel.scss:222）                          |
| 修法     | 改 `color-mix(in srgb, var(--b3-theme-on-surface) 8%, transparent)`（贴稿档；与 F4 分篇行分割线 10% 区分） |

### B7 own-note 虚线档位偏淡

| 项       | 内容                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.own-note { border:1px dashed var(--border-2); border-radius:var(--r)[6px]; padding:9px 11px; gap:9px; font-size:12.5px; color:var(--muted); line-height:1.6 }`——虚线用 **border-2（34% 档）**，比常规边线实 |
| 现状实现 | `border:1px dashed var(--b3-border-color)`（≈20% 档，aipanel.scss:294）；圆角 `var(--b3-border-radius)`（思源默认恰 6px，但主题改此变量会失真）；padding/gap/字号/行高 ✔；`.dot margin-top:5px` ✔             |
| 修法     | 虚线色改 `color-mix(in srgb, var(--b3-theme-on-surface) 34%, transparent)`；圆角写字面量 `6px`（钉死不受主题变量漂移）                                                                                        |

### A7 own-note 无加粗开头句、无关键词强调色

| 项           | 内容                                                                                                                                                                                                                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿       | `<b>这批转换由第 12 批 AI 流持有。</b>需要改动请到页内转换条的「<span class="at">停止整批转换</span>」`——首句 `<b>`（`.own-note b { color:var(--fg); font-weight:600 }`）+ 入口词 accent 色（`.at { color:var(--accent-text) }`）                                                                         |
| 现状实现     | `ownershipTextOf` 返回**纯文本一整串**（FlowOwnership.ts），own-note 里一个 `span` 到底，无 b 无强调色                                                                                                                                                                                                    |
| 用户可见影响 | 长说明无层次，重点（哪条流持有、去哪操作）不突出                                                                                                                                                                                                                                                          |
| 修法         | `ownershipTextOf` 改返回分段（照 `SessionLogSeg` 的做法：首句段 `bold:true`、入口词段 `accent:true`）；样式 `.wengu-aipanel-own b { color:var(--b3-theme-on-surface); font-weight:600 }`、`.wengu-aipanel-own .at { color:var(--b3-theme-primary) }`。i18n 模板按 `{n}` 占位拆段，同 log 的 `segsOf` 口径 |

### B8 详情头状态徽标字色口径

| 项       | 内容                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------ |
| 设计稿   | run/stop 徽标词色 = `--accent-text`（oklch L 0.82，比 accent 亮一档，暗底上更透）                |
| 现状实现 | 直接 `var(--b3-theme-primary)`（无亮档变量可用）                                                 |
| 修法     | 维持 primary（映射表既定落点），在 spec 标注「accent-text 以 primary 代」；不自行 mix 白发明新色 |

---

## 5. 横幅（aiflow.scss；结构差距见 S1，以下为数值差）

### 已对齐项（防止误改）

`.wengu-aiflow-row` flex/center/gap 14px/padding 11px 14px ✔；`.wengu-aiflow-id` gap 9px ✔；title strong 13.5px/600 ✔、span 11.5px/muted/ellipsis ✔；`.wengu-aiflow-prog` gap 6px/flex 1 1 auto/min 180px/max 420px ✔；stats 12px/muted + b mono 500 12px/on-surface ✔；seg/bar 6px/999px/gap 2px/轨道 16% mix ✔、六态分色全对（done 实/skip 42%/run·stop 主色/fail 实/cancel 26%/queued 14%）✔；counts 行 padding 0 14px 10px/gap 6px ✔；chip 20px 高/0 8px/4px 圆角/11.5px/边框 ✔、b mono 500 11.5px ✔、六态词色 ✔、is-zero 0.62+b 回弱色 ✔；list-head 11px mono/0.08em ✔；doc-row 五列 `22px 172px 188px minmax(0,1fr) 108px`/gap 12px/padding 7px 14px/12.5px ✔、is-queued/is-cancel 压暗+删除线 ✔、st-done/st-run(500)/st-fail ✔、dr-metric mono 11.5px 右对齐 ✔；左 3px 线两态同色 ✔。

### A8 分篇行分割线比稿深一档多

| 项       | 内容                                                                                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.doc-row { border-bottom:1px solid oklch(0.8891 0.0295 89.6 / 0.1) }`（fg **10%**）；取消行删除线装饰色 fg 50%                                                              |
| 现状实现 | `border-bottom:1px solid var(--b3-border-color)`（100% 实线，aiflow.scss:363）；删除线未设装饰色（默认当前色）                                                               |
| 修法     | 分割线改 `color-mix(in srgb, var(--b3-theme-on-surface) 10%, transparent)`；删除线补 `text-decoration-color:color-mix(in srgb, var(--b3-theme-on-surface) 50%, transparent)` |

### A9 当前行高亮底色

| 项       | 内容                                                                                                                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.doc-row.is-current { background:var(--accent-dim) }`（18% 档，低透）                                                            |
| 现状实现 | `.wengu-aiflow-row-item.is-current { background:var(--b3-theme-primary-light) }`（aiflow.scss:373，思源浅主色底，通常明显更饱和） |
| 修法     | 改 `color-mix(in srgb, var(--b3-theme-primary) 18%, transparent)`（与选中态/徽标底同一档）                                        |

### A10 横幅 stopped 徽标边框过实

| 项       | 内容                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.badge--stop { color:var(--accent-text); border-color:oklch(0.677 0.0876 44.8 / 0.45) }`（45% 透明边，无底）                                                              |
| 现状实现 | `.wengu-aiflow-badge.is-stopped { color:var(--b3-theme-primary); border-color:var(--b3-theme-primary) }`（100% 实边，aiflow.scss:257）                                     |
| 修法     | 边框改 `color-mix(in srgb, var(--b3-theme-primary) 45%, transparent)`；该 badge 基形同时缺 `gap:5px; letter-spacing:0.02em; font-weight:500`（与 aipanel 徽标同修，见 B1） |

### A11 缺 fb-list-foot 尾行

| 项       | 内容                                                                                                                                                                                                                      |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.fb-list-foot { padding:7px 14px; font-size:11.5px; color:var(--faint); background:oklch(0.3404 0.0242 234.5 / 0.35) }`——分篇清单尾的汇总行（「第 1–8 篇已完成 · …」）                                                   |
| 现状实现 | FlowBanner.svelte 未渲染任何 foot 元素                                                                                                                                                                                    |
| 修法     | 补 foot 行：i18n 键 + `padding:7px 14px; font-size:11.5px; color:color-mix(… 55% …); background:color-mix(in srgb, var(--b3-theme-background) 35%, transparent)`；文案按可确定数据组（「已 N 篇 · 剩 M 篇」），数不出不编 |

### B9 counts 行 lead 缺字距与 faint 档

| 项       | 内容                                                                                                     |
| -------- | -------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.counts .lead { font:11.5px var(--mono); letter-spacing:0.04em; color:var(--faint); margin-right:2px }` |
| 现状实现 | `.wengu-aiflow-lead` 无 letter-spacing、色用 on-surface-light（aiflow.scss:283）                         |
| 修法     | 补 `letter-spacing:0.04em`；色改 faint 档（55% mix）                                                     |

### B10 横幅 run 态底色档位

| 项       | 内容                                                                                                                                                                                                                                                                                                           |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | `.flow-banner { background:var(--surface-2) }`（比卡面亮一档）；stop 态换 `oklch(0.56 0.095 44.8 / 0.14)`（accent-solid 14% 暖底）                                                                                                                                                                             |
| 现状实现 | run 底 `var(--b3-theme-surface)`（=surface 档）；stop 底 `var(--b3-card-warning-background)`（aiflow.scss:32，思源暖警示底）                                                                                                                                                                                   |
| 修法     | run 底二选一：贴稿 `color-mix(in srgb, var(--b3-theme-surface) 90%, var(--b3-theme-on-surface) 10%)`，或务实维持 surface 同色（S1 改卡内后横幅已有 border-bottom+3px 左线分层，可接受，spec 标注）；stop 底 warning-background 语义可留，贴稿则 `color-mix(in srgb, var(--b3-theme-primary) 14%, transparent)` |

### B11 fb-list-head / dr-idx / dr-note 的 faint 档

| 项       | 内容                                                           |
| -------- | -------------------------------------------------------------- |
| 设计稿   | list-head、`.dr-idx`、`.dr-note` 均为 `var(--faint)`（55% 档） |
| 现状实现 | 三处均 on-surface-light（muted 档）                            |
| 修法     | 统一改 faint 档 55% mix（与 A5 同一口径）                      |

### C1（稿外新增，需拍板）抉择态横幅内的 keep/discard 两钮

| 项       | 内容                                                                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 设计稿   | 停止后横幅只有 stopped 徽标 + own-note 指路「页内转换条」抉择                                                                                                                               |
| 现状实现 | choosing 态横幅内直接给「保留/丢弃」两钮（#77 既有行为）                                                                                                                                    |
| 修法     | 功能取舍不在还原范围：保留则两钮样式走稿内 `b3-button`（30px 高/12px 圆角半径 6px/`--cancel` 红 描边钮体系），位置入 `.fb-actions`；不保留则删。建议保留（少跳一次），spec 标注为稿外扩展件 |

---

## 6. 修复优先级总表

| 级     | 条目                                          | 一句话                                             |
| ------ | --------------------------------------------- | -------------------------------------------------- |
| S1+S2  | 一体卡 + 横幅入卡                             | 「像不像」的第一根因，一次改造联动解决 S3/S4/A4/S8 |
| S5     | 树行尾三件化 + 徽标贴右                       | 40 条记录的扫视列齐不齐                            |
| S6     | 轮次行合并「轮次 N · 输入 X 字 → 输出 Y 题」  | 日志信息密度与稿对齐（不编数）                     |
| A1–A4  | 缩进 14/27/42、字号 12/12.5、字色三级、右边线 | 树的层级可读性                                     |
| A5–A7  | faint 第三档、own-note 档位与加粗结构         | 详情区「时间轴+说明」质感                          |
| A8–A11 | 横幅四处档位 + foot 行                        | 横幅与稿的浓淡差                                   |
| B1–B11 | 字重/浓度/尺寸小差                            | 顺手批量改（B1/B4/B5/B6 与徽标点一改全改）         |
| C1     | 抉择钮去留                                    | 拍板项，不影响还原度评分                           |

---

_配套施工图见同目录 `aipanel-spec.html` 第 06 节（完整 CSS 规格表 + 存量回退形态 + 新数据形态对照）。_
