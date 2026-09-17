---
name: wengu-clue-anchor-redesign
description: 线索锚点改造：#52二期已合并(PR#60→d95bc6f)已部署工作区；我独立审查与NPC自审5缺陷互证(选项行丢失/CanonMap别名错位/匹配源污染)；#53三期与#56/#57同域串行待派
metadata:
    node_type: memory
    type: project
    originSessionId: sess_933ea852-fcdb-4da3-87cd-16c717406e4e
---

2026-09-13 用户质疑「渲染方案不对」→ 讨论定调（思源行内标记哲学：markup 唯一生产者 + 标记时刻一次求坐标）→ 设计稿过审 → [#52 二期](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/52)/[#53 三期](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/53)（词表迁入，纯收拢）开 Issue。

**#52 二期已合并并部署**（20260913）：[PR #60](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/pulls/60) merge d95bc6f → dev，工作区已部署+petal 重载（测试区只拷了文件，内核未开着）。交付：`ClueCanon.ts`（权威坐标系纯函数）+ `MaterialDecorate.ts`（唯一装饰出口 `decorateMaterial`）+ `session.clueRanges[qid]?: {s,e}[]`（optional 不 bump version）；挂载点 GroupUnitApp/QuizCard 题干/ProtyleHost.mountStatic 全换单出口；`GlossDom` 退为纯转出（三期删）；设计稿落库 `docs/clue-anchor-render-redesign.md`。964 测试全过；quiz/index.ts 572 行。

**审查战果（双轮互证，值得复用）**：我独立审出首版 3 缺陷（①QuizCard 换 decorateMaterial 时把 fallbackQuestionHtml 的**选项行 .wengu-opts 丢了**——题干≠fallbackQuestionHtml 全文；②resolveRangeAnchor 用当前节点表下标查 mark 施工**前**缓存的 CanonMap → 每条先前的 mark 使后续节点 +2 错位，纯函数复现「选 CCCC 返回 DDDD 区间」且自洽过校验；③fallback 匹配源没剔选项/解析区），NPC 同时自审复核出 **5 缺陷**（上述 3 + NON_CANON 漏剔 .wengu-gloss-sup/误剔 mark + 惰性升格首版其实没写入坐标），force-push 重写分支修补。修复版要点：`canonMapOf` **每次现场重算不许缓存**（mark splitText 使任何存表 nodeIndex 立即失效）；mark 对权威串**透明**（不在 NON_CANON）；选项/解析拆 `optionsHtml`/`solutionHtml` 在装饰外拼回；嵌套抬升=mark 包 `<u>` 元素本身（`LIFT_SELECTOR`）；clearClueMarks 按子节点搬出不许 textContent 重建（会拍平 `<u>`）。

**方案骨架**：D1 权威原文=装饰前渲染产物可见文本；D2 锚点浮条 pointerdown 一次求取；D3 clues 不动+平行 clueRanges（惰性升格=用户再操作该题线索时写回）；D4 MaterialDecorate 单出口+轮间重算映射；D5 施工前切片校验防漂移自愈；D6 降级链四层（坐标+校验→文本匹配(#51 版)→只 chip）——**文本匹配是 fallback 地基不得删除**。三套选择器名单分立：`NON_CANON_SELECTOR`（权威源）/`NO_WRAP_SELECTOR`（落格守卫）/`ClueMarkDom.SKIP_SELECTOR`（fallback 匹配源，上标参与匹配、mark 要跳）——**别合并成一份**。

待办：#53 三期（词表 wrap 旧路径删除+SKIP 清理）与 #56（重叠并集）/#57（选色）同域串行；真机待验=线索标/删/嵌套/上标不包 + iOS sup user-select（NPC 标记待观察）+ 数学卷公式区降级零回归。

相关：[[wengu-english-clue-highlight-issue51]] [[wengu-dispatch-20260913]] [[wengu-clue-overlap-multicolor]] [[feedback-npc-parallel-by-overlap]]
