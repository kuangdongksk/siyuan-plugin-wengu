---
name: feedback-opendesign-for-visual-compare
description: 视觉对比/还原差距分析不要自己粗糙看几眼——丢给 OpenDesign 逐元素对比并给出该怎么改（20260914 用户明确批评后定的工作方式）
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_7d7ff9d5-1179-4f64-a078-840c06e65317
---

20260914 用户对我「实现 vs 设计稿」的对比明确批评：「你看的实在是有点太粗糙了，差距这么大你居然只看出来那么点儿差距，你可以丢给 open design 让他去对比然后给出你该怎么改」。

**Why**：我自己浏览器截图+读代码的对比是印象式的，只列出三四条结构性差距；而设计稿 CSS 里每个元素都有精确值（grid 模板/292px 树宽/三级缩进 14/27/42px/badge 19px/mono 11.5px），实现侧 scss 是逐条可 diff 的——代码级逐元素对比才能把差距钉死到「改成什么值」，人眼粗看只会停在「布局不像」。且用户此前同日已说过「让 UI 图画的更清楚一点这样改起来也好改」——细化稿+精确差距清单是一体的交付。

**How to apply**：

- 凡「实现与设计稿差距」类任务：派 OpenDesign run（[[wengu-opendesign-mcp]]），prompt 给双方文件路径（稿 HTML + 实现 scss/组件 + 真机截图路径 + 本地静态服务 URL），要求产出 ①差距清单（每项三列：稿精确值/现状值/修法，按用户可见影响排序）②细化版设计稿（施工规格表逐值钉死+缺失形态示意），达到「照抄即可」精度，然后再开 Issue 派 NPC 照稿施工。
- 我自己只做：截图确认现状形态、提取稿的 CSS 规格确认根因方向——不下「差距不大/差不多」的结论。
- 同模式适用于后续移动端视觉还原（[[wengu-mobile-drill]]：101 区块稿 vs src/mobile 功能腿）。

**已实操验证（20260914 AI 会话面板对比）**：产出的 gap-list.md 质量远超人眼粗看——S/A/B/C 分级、每项三列精确到 px、附 oklch→b3 唯一令牌映射表；钉出 S1「横幅与面板不是一张卡」这类我完全漏判的结构级根因。细化稿（施工规格表+存量回退形态示意）直接达到「照抄即可」精度，已据此开出精修 Issue #92。两份产物已入仓 `design/UI/AI面板/aipanel-gap-list.md` 与 `design/UI/转换/convert-stop-redesign-spec.html`，后续同类对比可参考其结构。

相关：[[wengu-dispatch-20260914]]
