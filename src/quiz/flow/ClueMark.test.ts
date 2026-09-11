import { describe, expect, it } from "vitest";
import { renderClueRow } from "./MaterialFlow";
import {
    clueOwnerQid,
    isGroupCurrentPick,
    clickClueChip,
    disarmClueChip,
    findInText,
    locateAcrossNodes,
    markSlots,
    newClueDeleteState,
    normForMatch,
    planMarks,
} from "./ClueMark";

/**
 * 线索标注纯逻辑（Issue #28）：选段定位（空白不敏感 + 跨标签降级）、
 * 高亮计划、chips 两击删除状态机。
 */

describe("normForMatch / findInText", () => {
    it("空白差异不影响定位（跨行选段）", () => {
        const hay = "第一行文字\n  第二行文字";
        expect(findInText(hay, "第一行文字 第二行文字")).toEqual({ start: 0, end: hay.length });
    });

    it("返回原串坐标（含前导空白，归一后等于选段）", () => {
        const hay = "  定位句在这里";
        const hit = findInText(hay, "定位句");
        expect(hit).not.toBeNull();
        expect(normForMatch(hay.slice(hit!.start, hit!.end))).toBe("定位句");
    });

    it("多处出现取首个命中", () => {
        const hay = "abc abc";
        expect(findInText(hay, "abc")).toEqual({ start: 0, end: 3 });
    });

    it("未命中返回 null；空选段不命中", () => {
        expect(findInText("甲乙丙", "丁")).toBeNull();
        expect(findInText("甲乙丙", "   ")).toBeNull();
    });

    it("needle 比 haystack 长直接判否", () => {
        expect(findInText("ab", "abc")).toBeNull();
    });

    // 回归（Issue #28 复审 P0）：归一串与坐标映射曾不同源——归一串里
    // 折叠出的空格占了位，映射表却只记非空白字符，**含中间空白的选段
    // 整段错位**（英文正文里几乎每条线索都带空格，真机表现是高亮落在
    // 隔壁词上）。以下每条都断言「切出的原文归一后 === 选段」。
    it("含中间空白的选段切出的原文与选段一致（英文正文回归）", () => {
        const hay = "The quick brown fox jumps over the lazy dog.";
        for (const needle of ["quick brown", "brown fox jumps", "fox", "the lazy dog", "The quick"]) {
            const hit = findInText(hay, needle);
            expect(hit, needle).not.toBeNull();
            expect(normForMatch(hay.slice(hit!.start, hit!.end))).toBe(normForMatch(needle));
        }
    });

    it("前导/中间/尾随空白混杂时仍精确切出选段", () => {
        const hay = "  前文 The quick brown fox 后文  ";
        const hit = findInText(hay, "The quick brown fox");
        expect(hit).not.toBeNull();
        expect(normForMatch(hay.slice(hit!.start, hit!.end))).toBe("The quick brown fox");
    });

    it("选段自带首尾空白也命中同一区间", () => {
        const hay = "定位句在这里";
        expect(findInText(hay, "  定位句  ")).toEqual(findInText(hay, "定位句"));
    });
});

/** 把命中区间切出来拼回去、去掉空白，验证覆盖的正是选段（跨节点口径）。 */
const sliceJoin = (nodes: string[], hits: { node: number; start: number; end: number }[]): string =>
    hits
        .map((h) => nodes[h.node].slice(h.start, h.end))
        .join("")
        .replace(/\s+/g, "");

describe("locateAcrossNodes（Issue #36 跨节点定位）", () => {
    it("单节点：区间落在该节点内", () => {
        const nodes = ["The quick brown fox"];
        expect(locateAcrossNodes(nodes, "quick brown")).toEqual([{ node: 0, start: 4, end: 15 }]);
    });

    it("跨两节点：逐节点取交集（选段横跨元素边界）", () => {
        // <p>洛必达<strong>法则</strong></p>：选段拖过加粗边界
        const nodes = ["洛必达", "法则"];
        expect(locateAcrossNodes(nodes, "洛必达法则")).toEqual([
            { node: 0, start: 0, end: 3 },
            { node: 1, start: 0, end: 2 },
        ]);
    });

    it("跨三节点：中间节点整段命中", () => {
        const nodes = ["前文 ", "中间那句", " 后文"];
        const hits = locateAcrossNodes(nodes, "前文 中间那句 后文");
        expect(hits.map((h) => h.node)).toEqual([0, 1, 2]);
        expect(sliceJoin(nodes, hits)).toBe("前文中间那句后文");
    });

    it("跨段（节点间无空白）：段落边界不影响命中", () => {
        // DOM 里 </p><p> 拖选得到的是换行，拼接串是零空白——归一化两侧都折叠
        const nodes = ["第一段落结尾", "第二段落开头"];
        const hits = locateAcrossNodes(nodes, "段落结尾\n第二段落");
        expect(sliceJoin(nodes, hits)).toBe("段落结尾第二段落");
    });

    it("归一空白折叠：节点内换行/缩进与选段单空格等价", () => {
        const nodes = ["The quick\n   brown fox"];
        const hits = locateAcrossNodes(nodes, "quick brown");
        expect(sliceJoin(nodes, hits)).toBe("quickbrown");
    });

    it("跨节点处的空白折叠：节点间零空白与选段单空格等价", () => {
        // 拖选跨段得到的是换行，节点拼接串是零空白——归一化两侧都折叠
        const nodes = ["甲乙丙", "丁戊己"];
        expect(sliceJoin(nodes, locateAcrossNodes(nodes, "丙\n丁"))).toBe("丙丁");
    });

    it("节点内空白只有落在选段内的部分被包进 mark", () => {
        const nodes = ["甲乙丙 ", "丁戊己"];
        const hits = locateAcrossNodes(nodes, "丙 丁");
        expect(sliceJoin(nodes, hits)).toBe("丙丁");
        // 末段是「丁」所在节点：末字符的闭区间，不含其后字符
        expect(hits[hits.length - 1].end).toBe(1);
    });

    it("匹配不上返回空数组（降级：只留 chip，不硬造高亮）", () => {
        expect(locateAcrossNodes(["甲乙丙"], "完全无关")).toEqual([]);
        expect(locateAcrossNodes(["甲乙丙"], "   ")).toEqual([]);
        expect(locateAcrossNodes(["甲乙丙", "丁"], "丙戊")).toEqual([]);
    });

    it("多处出现取首个命中（宁缺勿错）", () => {
        const nodes = ["abc abc"];
        expect(locateAcrossNodes(nodes, "abc")).toEqual([{ node: 0, start: 0, end: 3 }]);
    });

    it("空节点表不命中", () => {
        expect(locateAcrossNodes([], "甲乙")).toEqual([]);
        expect(locateAcrossNodes(["  ", "  "], "甲")).toEqual([]);
    });
});

describe("planMarks", () => {
    it("逐条算计划，未命中的 hits 为空数组", () => {
        const plan = planMarks(["定位句在此", "无关文本"], ["定位句", "找不到的话"]);
        expect(plan[0].hits).toEqual([{ node: 0, start: 0, end: 3 }]);
        expect(plan[1].text).toBe("找不到的话");
        expect(plan[1].hits).toEqual([]);
    });

    it("去重且丢掉空选段，保持原始顺序", () => {
        const plan = planMarks(["ab"], ["ab", " ab ", "", "   "]);
        expect(plan.map((p) => p.text)).toEqual(["ab"]);
    });

    it("多词选段命中自身区间（高亮不落隔壁词）", () => {
        const nodes = ["The quick brown fox jumps over the lazy dog."];
        const plan = planMarks(nodes, ["quick brown", "lazy dog"]);
        for (const p of plan) {
            expect(p.hits, p.text).not.toHaveLength(0);
            expect(normForMatch(sliceJoin(nodes, p.hits))).toBe(normForMatch(p.text).replace(/\s+/g, ""));
        }
    });

    it("跨节点选段的计划带多个节点区间", () => {
        const nodes = ["洛必达", "法则"];
        const plan = planMarks(nodes, ["洛必达法则"]);
        expect(plan[0].hits.map((h) => h.node)).toEqual([0, 1]);
    });

    it("多条线索共用同一份未改动节点表（偏移互不干扰）", () => {
        const nodes = ["甲乙丙丁戊", "己庚辛"];
        const plan = planMarks(nodes, ["乙丙", "己庚", "丁戊"]);
        for (const p of plan) expect(normForMatch(sliceJoin(nodes, p.hits))).toBe(normForMatch(p.text));
    });
});

describe("markSlots（施工序列，Issue #36 复审）", () => {
    // 回归：PR #38 首版按「线索序 + 线索内倒序」施工，**同一文本节点里的
    // 第二条线索区间越界被静默跳过**（真机表现：一段话里只高亮第一条）。
    // 施工必须按「节点升序 + 节点内起点降序」全局排。
    it("同一节点内多段按起点降序（后段先切，前段偏移不被截短）", () => {
        const plan = [
            { text: "quick brown", hits: [{ node: 0, start: 4, end: 15 }] },
            { text: "lazy dog", hits: [{ node: 0, start: 35, end: 43 }] },
        ];
        expect(markSlots(plan).map((s) => s.start)).toEqual([35, 4]);
    });

    it("跨节点按节点升序（各节点持自己的引用，互不干扰）", () => {
        const plan = [
            { text: "法则", hits: [{ node: 1, start: 0, end: 2 }] },
            { text: "洛必达", hits: [{ node: 0, start: 0, end: 3 }] },
        ];
        expect(markSlots(plan).map((s) => s.node)).toEqual([0, 1]);
    });

    it("不丢段：拍平后段数等于全部命中数，且带回归属线索原文", () => {
        const plan = [
            {
                text: "甲乙",
                hits: [
                    { node: 0, start: 0, end: 2 },
                    { node: 1, start: 0, end: 2 },
                ],
            },
            { text: "丙", hits: [] },
        ];
        const slots = markSlots(plan);
        expect(slots).toHaveLength(2);
        expect(slots.map((s) => s.text)).toEqual(["甲乙", "甲乙"]);
    });

    it("空计划零动作", () => {
        expect(markSlots([])).toEqual([]);
        expect(markSlots([{ text: "找不到", hits: [] }])).toEqual([]);
    });
});

describe("chips 两击删除状态机", () => {
    it("首击 arm、再击同一下标确认", () => {
        const st = newClueDeleteState();
        expect(clickClueChip(st, 1)).toBe("first");
        expect(st.armed).toBe(1);
        expect(clickClueChip(st, 1)).toBe("second");
        expect(st.armed).toBeUndefined();
    });

    it("点别的 chip 把待确认挪过去", () => {
        const st = newClueDeleteState();
        clickClueChip(st, 0);
        expect(clickClueChip(st, 2)).toBe("first");
        expect(st.armed).toBe(2);
    });

    it("disarm 后再次点击回到首击", () => {
        const st = newClueDeleteState();
        clickClueChip(st, 0);
        disarmClueChip(st);
        expect(clickClueChip(st, 0)).toBe("first");
    });
});

describe("clueOwnerQid（chip 归属题反查）", () => {
    it("卡上 chip 取该卡 qid（长卷全卡常驻，非当前题也要删对）", () => {
        expect(clueOwnerQid({ cardQid: "q7", currentQid: "q1" })).toBe("q7");
    });

    it("组题行在 .wengu-gunit 里、无卡 qid 时回落当前题", () => {
        expect(clueOwnerQid({ cardQid: undefined, currentQid: "q1" })).toBe("q1");
    });

    it("两侧都没有则 undefined", () => {
        expect(clueOwnerQid({ cardQid: undefined, currentQid: undefined })).toBeUndefined();
    });
});

describe("renderClueRow 入参契约（Issue #28 复审 P0）", () => {
    /** 最小行元素替身：只实现 renderClueRow 与 syncChipArmState 触到的面。 */
    const rowStub = (): { el: HTMLElement; html: () => string; hidden: () => boolean } => {
        const el = {
            innerHTML: "",
            setAttribute: (k: string): void => {
                if (k === "hidden") (el as unknown as Record<string, boolean>).__hidden = true;
            },
            removeAttribute: (k: string): void => {
                if (k === "hidden") (el as unknown as Record<string, boolean>).__hidden = false;
            },
            querySelectorAll: (): unknown[] => [],
            hasAttribute: (k: string): boolean =>
                k === "hidden" && !!(el as unknown as Record<string, boolean>).__hidden,
        } as unknown as HTMLElement;
        return {
            el,
            html: () => (el as unknown as { innerHTML: string }).innerHTML,
            hidden: () => el.hasAttribute("hidden"),
        };
    };

    // 回归：chips 槽本身**就是**行元素（ClueFlow.clueSlotOf 取的是
    // [data-clues] 那个 div）。旧实现按「容器」语义在入参里再找一次
    // 后代 [data-clues]，传槽自身时永远找不到 ⇒ 静默早退，chips 与
    // 「AI 复核」按钮整条链不渲染（真机表现为标完线索卡里什么都不出）。
    it("入参是行元素本身时渲染 chips 与复核按钮", () => {
        const { el, html, hidden } = rowStub();
        renderClueRow(el, (k) => k, ["第一段线索", "第二段线索"]);
        expect(html()).toContain("wengu-clue-chip");
        expect(html()).toContain('data-act="clue-judge"');
        expect(html()).toContain("第一段线索");
        expect(hidden()).toBe(false);
    });

    it("空线索：清空并隐藏该行", () => {
        const { el, html, hidden } = rowStub();
        renderClueRow(el, (k) => k, []);
        expect(html()).toBe("");
        expect(hidden()).toBe(true);
    });

    it("chip 带删除提示（两击删除的文案入口）", () => {
        const { el, html } = rowStub();
        renderClueRow(
            el,
            (k) => ({ clueChips: "线索：", clueChipTitle: "{c}｜{h}", clueChipDeleteHint: "再点删除" })[k] ?? k,
            ["选段"]
        );
        expect(html()).toContain("再点删除");
    });
});

describe("isGroupCurrentPick（组内共享槽的刷新归属）", () => {
    // 组题的材料面板与底部 chips 槽组内共享（一次只显示一题）：非当前题刷
    // 会覆盖当前题的 chips/mark —— 整壳全量补齐按题表遍历时，最后一道有
    // 线索的组内题会赢。
    it("非组题卡各自独占槽位，恒可刷", () => {
        expect(isGroupCurrentPick({ grouped: false, visible: false, groupQi: 3, myQi: 0 })).toBe(true);
    });

    it("组内当前题可刷、非当前题不可刷", () => {
        expect(isGroupCurrentPick({ grouped: true, visible: true, groupQi: 1, myQi: 1 })).toBe(true);
        expect(isGroupCurrentPick({ grouped: true, visible: false, groupQi: 1, myQi: 0 })).toBe(false);
    });

    it("组运行态优先于 DOM（切题同一拍内 hidden 还没落）", () => {
        // GroupUnitApp.step：先改 qi 再 onActive；此刻 DOM 仍显示旧卡
        expect(isGroupCurrentPick({ grouped: true, visible: false, groupQi: 1, myQi: 1 })).toBe(true);
    });

    it("无运行态记录时退回 DOM 可见性", () => {
        expect(isGroupCurrentPick({ grouped: true, visible: true, groupQi: undefined, myQi: undefined })).toBe(true);
        expect(isGroupCurrentPick({ grouped: true, visible: false, groupQi: undefined, myQi: undefined })).toBe(false);
    });

    it("两侧都读不到时不拦（宁可不拦，别把正常刷新掐掉）", () => {
        expect(isGroupCurrentPick({ grouped: true, visible: undefined, groupQi: undefined, myQi: undefined })).toBe(
            true
        );
        // 只有一个下标可读（单题组/答案缺失）同样不拦
        expect(isGroupCurrentPick({ grouped: true, visible: undefined, groupQi: 0, myQi: undefined })).toBe(true);
    });
});
