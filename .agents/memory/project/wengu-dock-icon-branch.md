---
name: wengu-dock-icon-branch
description: dock-icon 已并 dev(8779c6d)、worktree已清——图标稳定id+官方path、选择器下拉化、UI标准§〇4-9；§〇4图标钮 wengu-iconbtn；svg巨幅坑已于20260905根修(svgIcon自带14×14,清单退役为保险层)
metadata:
    node_type: memory
    type: project
    originSessionId: sess_5f3a9cc2-61f3-4e4e-a1c6-8ecc56597c81
---

2026-08-26 图标与 UI 修复分支：六提交**已全部并入 dev**（merge 8779c6d，
冲突仅在两侧各自删头部切换器的重叠处，按 dev 三按钮入口口径取齐），
worktree 与分支已清理，合并后已从 dev 重建部署并重载——真机验收待用户。

- 3293da5：图标直接引内置 sprite id——**已证伪**（uiLayout 存量引用
  打穿 + iconLanguage 非核心图标，见 [[siyuan-builtin-icon-sprite]]）
- 2273425（定稿）：**稳定 id + 官方 path**——addIcons 注册
  iconWengu/iconWenguWords，path 抄 litheness 官方原始 path；
  ModelPicker 官方风格模型搜索下拉；§〇 6/7/8 初版
- 6a19cfc：删头部「做题|复习」切换器（复习入口只剩侧栏右键，契约
  review-mode.md §二 D1 v3；switchMode 内部机制保留）
- 305881c：文档选择器（源/父/知识点「选择…」）大 Dialog 改官方风格
  可搜索下拉（KnowPicker 重写：单选即点即回、多选勾选+清空/确定，
  用户点名「模仿官方带搜索下拉改文件选择」）
- 9efa558：**action 按钮间距选择器修正（后又证伪一次）**——后代选择器
  不命中是对的，但 `:has(> .wengu-dialog)` 从 container 下探**也不命中**
  （3.8.1 实际结构 container>body>(content.wengu-dialog+action)，
  wengu-dialog 不是 container 直接子节点）。**20260826 终版：
  `.wengu-dialog ~ .b3-dialog__action` 兄弟组合器**，已网页版实测
  gap=8px 生效；同日发现 hidden 属性被 `.b3-button{display:inline-flex}`
  压过（作者层 display 盖 UA [hidden]，终止生成/查看进行中的转换常驻
  露出），补 `.b3-dialog__action .b3-button[hidden]{display:none}`，
  固化为 §〇9；§〇4 按钮用色分级（outline/cancel/text/危险两击确认/
  status条带）、§〇6 间距表
- 1bee56f：「更多选项」折叠行 iconRight chevron 随开合旋转 + 隐藏
  原生三角 marker + 悬停变色（用户贴 summary 元素点名）

UI 标准已成体系（design-review §〇 4/6/7/8）：按钮用色分级 / 间距表
（基数4px）/ 长列表官方风格搜索浮层（ModelPicker+KnowPicker 两个标准
实现）/ 插件图标稳定 id——后续 UI 改动按此执行，别再自造样式。

**How to apply:** 图标 id 永不再改（uiLayout
存量引用），换图标只换 path；新写弹窗记得 action 用兄弟组合器
`.wengu-dialog ~ .b3-dialog__action` 控间距、hidden 切换的元素要么类
不设 display 要么补 [hidden] 兜底（§〇9）。并 dev 已完成（8779c6d），
间距/hidden 双修已部署网页版实测通过，**未提交**（等用户过目），
桌面版需重开思源看最新。**追加（同日第二轮）**：formRow 行容器
wengu-formrow 垂直居中治按钮拉伸（模型钮 200×64/PDF 钮 126×64），
「选择…」触发钮统一 `fn__size200 wengu-pick` 值按钮（选中值入按钮、
空值占位，wengu-model-pick 已改名），父文档行保留输入框+hint 槽——
已部署，浏览器面板挂死未能截图复验，待用户目检。**第三轮（用户点名
开刷面板按钮行后全库审计）**：§〇6 立总则「横向并排 ≥2 按钮的行一律
gap:8px」；wengu-start-actions 补 gap、side-actions 6→8 归一，特例
2px（side-headbtns 图标微行）/12px（word-actions 大按钮区）入表——
用户明确不满逐点补救（「不是让你出个标准吗」），后续 UI 问题先全库
扫同类再动手。
**第四轮（20260826 晚，用户点名单词页头部图标钮带框）**：§〇4 纯图标
钮落定通用类 **`wengu-iconbtn`**（base.scss，与 wengu-side-iconbtn 共用
配方：border:0/淡色/hover 浅底，新增 :disabled 态；panels.scss 全局
svg 14px 清单已收）。起因：单词域 Svelte 头部用 `b3-button
b3-button--icon`，Neo 主题下渲染出边框。6 个 word 组件换类
（WordHead/NavExtras/AiButton/LookupScreen/CardScreen/QuizCard 星标
角标），spec §〇4 已注明**禁用 b3-button--icon**。已部署+重载，
**20260826 晚随 3a9ef28 批量提交入库**（图标钮/时间线 svg 两修均含）。

**追加（20260905，svg 巨幅渲染三犯后根修）**：「新 svgIcon 用点必须进
panels.scss 全局 14px 清单」的规矩**已退役**——FormHtml.svgIcon 现在
直接输出 `width="14" height="14"` 属性（3d33baa，已提交推送+部署两区），
新容器裸插即安全、特殊尺寸 CSS 覆写属性即可；panels.scss 清单降级为
保险层，design-review §〇3 已改写。此前同坑三犯：相关题弹窗大放大镜
（20260901）、复习时间线裸 svg 300×150、预览搜题框搜索图标（20260905
用户点名「说了很多遍」）——以后别再按旧清单规矩办事。

相关：[[siyuan-builtin-icon-sprite]]、[[siyuan-web-ui-debug]]、[[wengu-neo-theme-traps]]
