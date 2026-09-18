---
name: wengu-clue-overlap-multicolor
description: #56并集合并(待跑)+#57改版=用户选色(标线索二级竖排色板菜单/独立ColorMenu组件/clueColors平行字段)body已更新待召唤；队列#52→#53→#56→#57
metadata:
    node_type: memory
    type: project
    originSessionId: sess_933ea852-fcdb-4da3-87cd-16c717406e4e
---

2026-09-13 用户贴真机卡 DOM 报：三条线索只出两个 mark（`proposal` 短条出了、`proposal might be regarded` 长条没出），要「长的覆盖短的」；另要线索 mark 多色、取思源主题配置。

**根因**：两线索同起点，`markSlots` 排序起点相同靠插入序稳定排→短条先落格，`splitText` 截短节点后长条区间 `end > text.length` 命中 `wrapRange` 保护性跳过——`markSlots` 注释明写的「重叠降级」路径，非 #51 回归。

**[#56](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/56)**：施工前并集合并（`mergeMarkSlots` 纯函数：同节点重叠/相接合并⇒永不再触发守卫；chips 与 mark 从此不 1:1，删除后重合并）。

**[#57](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/57)（20260913 改版，body 已更新）**：~~自动循环~~ → **用户选色**——浮条「标为线索」主钮保持一步默认黄不变 + 角标/邻钮触发**二级菜单**；菜单=独立可复用组件 `src/ui/ColorMenu.svelte`（**竖排**对齐思源原生、props colors+onPick、零业务依赖、零 `<style>`）；色板=思源 b3 卡片色 CSS 变量 `--b3-card-info/success/warning/error` + `-color` 前景（内联 `var()` 实时跟主题含 Neo，零配置读取）；存储加 `session.clueColors[qid]?: number[]`（与 clues 下标对齐、-1=默认黄、不 bump version、渲染不回写）；合并 mark 取最长线索选色；chips 可选同色圆点。

**队列**：#52 二期已完成（[PR #60](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/pulls/60) CI 绿待审查）→ #53 三期 → #56 → #57（#57 依赖 #56）。**同域必须串行**（20260913 冲突分析：#60 实改 ClueMarkDom/MaterialDecorate/AnnoFlow/english.scss/AGENTS.md 线索段，#56 改的 mark 施工、#57 的色板都长在 #60 产物上，谁后合并谁冲突）；#59 移动端异域可并行（[[feedback-npc-parallel-by-overlap]]）。

相关：[[wengu-english-clue-highlight-issue51]] [[wengu-clue-anchor-redesign]] [[wengu-dispatch-20260913]]
