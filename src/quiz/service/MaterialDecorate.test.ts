import { describe, expect, it } from "vitest";
import {
    colorMapOf,
    NO_WRAP_SELECTOR,
    NON_CANON_SELECTOR,
    isLiftSpan,
    pickNodeIndexes,
    planClueMarks,
} from "./MaterialDecorate";
import { buildCanonMap, remapCanon } from "./ClueCanon";
import { markSlots, mergeMarkSlots } from "../flow/ClueMark";

/**
 * 装饰出口的**判定链**（Issue #52 二期验收 4/5/6）：坐标优先 → 文本匹配
 * 降级 → 只出 chip 的三分支，以及「mark 包住联动 <u>」的嵌套顺序矩阵。
 *
 * 纯逻辑层可测（DOM 观测/施工在 `decorate`）：本文件不启 jsdom，
 * 喂的是与施工后节点表同形的文本数组。选择器口径（非权威区/落格守卫）
 * 用字符串断言锁死——多写一个类就等于把那几个字从权威串里挖掉。
 */

/** 一句英语材料装饰后的节点表：`Funding` 被词形联动包成 `<u>词</u>` + 上标。 */
function glossedNodes(): string[] {
    // [0]"Fund"（<u> 内，权威） [1]"1·补"（上标，非权威）
    // [2]"ing is crucial"（正文，权威） [3]"here."（正文，权威）
    return ["Fund", "1·补", "ing is crucial", "here."];
}

/** 权威表（装饰前）→ 装饰后重算（与 `decorate` 第 ④ 步同口径）。 */
function canonAfterGloss() {
    const base = buildCanonMap(["Funding is crucial", "here."], [0, 1]);
    const texts = glossedNodes();
    const isCanon = [true, false, true, true];
    return { map: remapCanon(base, texts, isCanon), texts };
}

describe("planClueMarks：降级链三分支（D6）", () => {
    it("主路径：坐标校验通过 ⇒ 按坐标落格，不依赖文本匹配", () => {
        const { map, texts } = canonAfterGloss();
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "crucial", range: { s: 11, e: 18 } }]);
        expect(plan[0].hits).toEqual([{ node: 2, start: 7, end: 14 }]);
        expect(resolved[0]).toEqual({ text: "crucial", range: { s: 11, e: 18 } });
    });

    it("坐标漂移（材料被增量重转）⇒ 校验拦下，降级文本匹配求坐标", () => {
        const { map, texts } = canonAfterGloss();
        // 存储 text 与切片不符（错位线索）⇒ 坐标作废、走文本匹配
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "here.", range: { s: 0, e: 5 } }]);
        expect(plan[0].hits.length).toBeGreaterThan(0);
        // 权威串 = "Funding is crucial" + "here."，here. 在权威偏移 18..23
        expect(resolved[0].range).toEqual({ s: 18, e: 23 });
    });

    it("无坐标的存量线索 ⇒ 文本匹配（#51 修复版）当场求坐标，用完即弃", () => {
        const { map, texts } = canonAfterGloss();
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "ing is" }]);
        expect(plan[0].hits).toEqual([{ node: 2, start: 0, end: 6 }]);
        expect(resolved[0]).toEqual({ text: "ing is", range: { s: 4, e: 10 } });
    });

    it("文本也匹配不上 ⇒ 只出 chip（hits 空、无坐标），不报错", () => {
        const { map, texts } = canonAfterGloss();
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "完全不存在的一段" }]);
        expect(plan[0].hits).toEqual([]);
        expect(resolved[0]).toEqual({ text: "完全不存在的一段" });
    });

    it("验收 3：有坐标 ⇒ 不依赖文本匹配也能落格（文本在节点表里根本不存在）", () => {
        const { map, texts } = canonAfterGloss();
        // 权威串含 "crucial"，但节点表被装饰切成 ["Fund","ing is crucial","here."]
        // ——坐标口径与文本匹配口径不同源，坐标命中不依赖当前节点边界
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "crucial", range: { s: 11, e: 18 } }]);
        expect(plan[0].hits).toEqual([{ node: 2, start: 7, end: 14 }]);
        expect(resolved[0].range).toEqual({ s: 11, e: 18 });
    });

    it("重复文本只算一次（与 planMarks 同口径），但 resolved 仍逐位对齐", () => {
        const { map, texts } = canonAfterGloss();
        const { plan, resolved } = planClueMarks(map, texts, [{ text: "here." }, { text: "here." }]);
        expect(plan.length).toBe(1);
        // 下标对齐是惰性升格的前提：错位即把坐标写到别的线索上
        expect(resolved.length).toBe(2);
        expect(resolved[1]).toEqual({ text: "here." });
    });
});

describe("fallback 匹配源（D6）：与权威表不是一套口径", () => {
    it("上标属非权威（不进权威表）但**参与**匹配——两边各按各的名单", () => {
        // 节点表 [正文, 上标, 正文]；上标非权威。
        // 权威表：[0]abc [1]def（上标在后，权威串 "abcdef"）
        const base = buildCanonMap(["abc", "def"], [0, 2]);
        const texts = ["abc", "1·n.", "def"];
        const map = remapCanon(base, texts, [true, false, true]);
        // 匹配源名单（ClueMarkDom.SKIP_SELECTOR）里**没有**上标 ⇒ 全部节点都是源
        const srcIndexes = pickNodeIndexes([true, true, true]);
        // 文本匹配求得的坐标要按权威表算——上标那一段映射不出坐标
        const { resolved } = planClueMarks(map, texts, [{ text: "c1·n.d" }], srcIndexes);
        // 命中横跨上标（非权威）⇒ 端点落在权威表里才换得出坐标：
        // 权威串 "abcdef"，起点 = abc 内的 c(2)、终点 = def 内的 d(3)+1
        expect(resolved[0].range).toEqual({ s: 2, e: 4 });
    });

    it("非源节点（词表区/解析区）整片退出匹配源", () => {
        const isSrc = [true, false, false, true];
        expect(pickNodeIndexes(isSrc)).toEqual([0, 3]);
    });

    it("fallback 命中换回**全局**下标（构造施工与坐标回算共用一份）", () => {
        const base = buildCanonMap(["正文原文", "更多正文"], [0, 3]);
        const texts = ["正文原文", "词表条目", "1·n.", "更多正文"];
        const map = remapCanon(base, texts, [true, false, false, true]);
        const srcIndexes = pickNodeIndexes([true, false, false, true]);
        const { plan } = planClueMarks(map, texts, [{ text: "更多" }], srcIndexes);
        expect(plan[0].hits).toEqual([{ node: 3, start: 0, end: 2 }]);
    });

    it("未传 srcIndexes ⇒ 视为全部节点都是源（兼容旧调用）", () => {
        const { map, texts } = canonAfterGloss();
        expect(planClueMarks(map, texts, [{ text: "here." }]).plan[0].hits.length).toBeGreaterThan(0);
    });
});

describe("嵌套顺序矩阵：mark × gloss 词（二期验收 1/6）", () => {
    it("选段跨『联动词 + 上标 + 后半词』：mark 落在权威节点上，上标不参与", () => {
        const { map, texts } = canonAfterGloss();
        // 「Funding is」横跨 <u>内的 "Fund"、跳过上标（非权威）、继续 "ing is"
        const { plan } = planClueMarks(map, texts, [{ text: "Funding is", range: { s: 0, e: 10 } }]);
        expect(plan[0].hits).toEqual([
            { node: 0, start: 0, end: 4 },
            { node: 2, start: 0, end: 6 },
        ]);
        // 上标（节点 1）不在任何落格计划里 ⇒ mark 包不住它
        expect(plan[0].hits.some((h) => h.node === 1)).toBe(false);
    });

    it("跨 **加粗** 选段：两个权威节点各落一段（mark 可跨元素）", () => {
        const base = buildCanonMap(["位置**关键词**训练"], [0]);
        // 装饰后（加粗由渲染器切成节点）：位置 / 关键词 / 训练
        const texts = ["位置", "关键词", "训练"];
        const map = remapCanon(base, texts, [true, true, true]);
        const { plan } = planClueMarks(map, texts, [{ text: "置关键词训", range: { s: 1, e: 6 } }]);
        expect(plan[0].hits).toEqual([
            { node: 0, start: 1, end: 2 },
            { node: 1, start: 0, end: 3 },
            { node: 2, start: 0, end: 1 },
        ]);
        // 施工序：节点升序 + 节点内起点降序（同节点内靠后的段先切）
        const slots = markSlots(plan);
        expect(slots.map((s) => s.node)).toEqual([0, 1, 2]);
    });

    it("同一节点内两条线索：施工序自后向前（否则第二条静默不落格）", () => {
        const base = buildCanonMap(["Funding is crucial"], [0]);
        const texts = ["Funding is crucial"];
        const map = remapCanon(base, texts, [true]);
        const { plan } = planClueMarks(map, texts, [
            { text: "Funding", range: { s: 0, e: 7 } },
            { text: "crucial", range: { s: 11, e: 18 } },
        ]);
        const slots = markSlots(plan);
        expect(slots.map((s) => s.start)).toEqual([11, 0]);
    });

    it("抬升判定：坐标完整覆盖联动词形 <u> 时才包元素（否则包文本节点）", () => {
        // 完整覆盖 + 目标是联动词 ⇒ 抬升（mark 在外层，上标留外面）
        expect(isLiftSpan(true, true)).toBe(true);
        // 只覆盖词的一部分 ⇒ 只能包文本节点（不足以包住整个词形）
        expect(isLiftSpan(false, true)).toBe(false);
        // 覆盖整个节点但它不是联动词形 ⇒ 普通文本落格
        expect(isLiftSpan(true, false)).toBe(false);
    });
});

describe("选择器口径（多写一个类 = 权威串被挖掉几个字）", () => {
    it("非权威区含词表区/上标/选项区/解析区/公式占位与控件", () => {
        for (const cls of [
            ".wengu-gloss",
            ".wengu-gloss-sup",
            "button",
            ".wengu-static-sol",
            ".wengu-opts",
            ".wengu-option-fallback",
            "[data-type='inline-math']",
            "[data-type='NodeMathBlock']",
        ]) {
            expect(NON_CANON_SELECTOR).toContain(cls);
        }
    });

    it("联动词形 .wengu-gloss-link **不在**非权威表（<u> 包的就是原文本身）", () => {
        // 回归 Issue #51：排除它 ⇒ 含联动词的选段整段锚点失败
        expect(NON_CANON_SELECTOR).not.toContain(".wengu-gloss-link");
    });

    it("线索 mark **不在**非权威表（它是既有正文的透明包装，见文件头）", () => {
        // 回归本案：mark 入非权威表 ⇒ 被标过的字符从权威串消失 ⇒ 存量坐标
        // 校验必然失配（静默全量降级）+ 坐标→节点映射整体错位（亮错位置）
        expect(NON_CANON_SELECTOR).not.toMatch(/(^|,\s*)mark(\s*,|$)/);
    });

    it("落格守卫只挡『不许被包』：上标与词表区（不进匹配源口径）", () => {
        expect(NO_WRAP_SELECTOR).toContain(".wengu-gloss-sup");
        expect(NO_WRAP_SELECTOR).toContain(".wengu-gloss");
    });
});

describe("mark × gloss 交叉顺序矩阵（Issue #53 验收 1：施工序在出口内固定）", () => {
    /**
     * 装饰出口的施工序是**实现保证**（词表施工 ③ → 轮间重算映射 ④ →
     * 线索 mark 施工 ⑤），不再是「材料填充后」「词表后处理 → 线索后处理」
     * 的调用侧约定。故三种到达顺序（先标线索后出词表 / 先有词表后标线索
     * / 同节点内多线索 × 多联动词并存）在出口里归一到**同一条链**，本组
     * 用例按节点表口径锁死每种情形的施工计划。
     */

    /** 英语材料装饰后的节点表：`Funding`（联动词）+ 上标 + 其余正文。
     *  [0]"Fund"（<u> 内，权威） [1]"1·补"（上标，非权威）
     *  [2]"ing is crucial"（权威） [3]"here."（权威） */
    const texts = ["Fund", "1·补", "ing is crucial", "here."];
    const isCanon = [true, false, true, true];
    const base = () => buildCanonMap(["Funding is crucial", "here."], [0, 1]);
    const map = () => remapCanon(base(), texts, isCanon);

    it("先有词表后标线索：跨『联动词 + 上标 + 后半词』的选段落在两段权威文本上", () => {
        // 「Funding is」= <u>内的 "Fund" + 跳过的上标 + "ing is"
        const { plan } = planClueMarks(map(), texts, [{ text: "Funding is", range: { s: 0, e: 10 } }]);
        expect(plan[0].hits).toEqual([
            { node: 0, start: 0, end: 4 },
            { node: 2, start: 0, end: 6 },
        ]);
        expect(plan[0].hits.some((h) => h.node === 1)).toBe(false); // 上标不包 mark
    });

    it("同节点内多条线索 × 多联动词并存：施工序自后向前（节点升序 + 起点降序）", () => {
        const many = ["Fund", "1·补", "ing is crucial here."];
        const m = remapCanon(buildCanonMap(["Funding is crucial here."], [0]), many, [true, false, true]);
        const { plan } = planClueMarks(m, many, [
            { text: "Funding", range: { s: 0, e: 7 } },
            { text: "here.", range: { s: 18, e: 23 } },
        ]);
        // 节点升序 + 节点内起点降序：节点 2 里的两段靠后的先切
        // （"here." 在节点 2 内偏移 15，"ing is" 在 0）
        const slots = markSlots(plan);
        expect(slots.map((s) => s.node)).toEqual([0, 2, 2]);
        expect(slots[1].start).toBeGreaterThan(slots[2].start);
    });

    it("先标线索后出词表：线索坐标按权威串算，与词表施工无关（口径同源）", () => {
        const m = map();
        // 坐标来自装饰前的权威串（"Funding is crucial"+"here."），词表施工
        // 只是改了节点边界——同一坐标在装饰后照常落格（验收 3 的纯逻辑面）
        const { plan, resolved } = planClueMarks(m, texts, [{ text: "crucial", range: { s: 11, e: 18 } }]);
        expect(plan[0].hits).toEqual([{ node: 2, start: 7, end: 14 }]);
        expect(resolved[0]).toEqual({ text: "crucial", range: { s: 11, e: 18 } });
    });

    it("嵌套抬升：坐标完整覆盖联动词形时包 <u>（mark 外层、上标留外面）", () => {
        // "Funding"（权威 0..7）恰好完整覆盖 <u> 内的 "Fund"
        const m = map();
        const { plan } = planClueMarks(m, texts, [{ text: "Funding", range: { s: 0, e: 7 } }]);
        // 命中仍在权威节点上（抬升是落格期行为，由 isLiftSpan 判定）
        expect(plan[0].hits).toEqual([
            { node: 0, start: 0, end: 4 },
            { node: 2, start: 0, end: 3 },
        ]);
        expect(isLiftSpan(plan[0].hits[0].start === 0, true)).toBe(true);
    });
});

describe("施工前合并重叠区间（Issue #56：主路径不许静默丢 mark）", () => {
    // 用户真机：同一题干三条线索 `proposal` / `proposal might be regarded` /
    // `to Paragraph`。前两条**同起点**——逐条独立算计划 ⇒ 短的那条先落格
    // （markSlots 同起点按插入序稳定排序），长的那条随后越界被 wrapRange
    // 静默跳过（chips 三条、mark 只一个）。装饰出口的坐标路径必须同样过
    // `mergeMarkSlots`，只修 fallback 等于用户主路径带病。
    const slot = (node: number, start: number, end: number, text: string) => ({ node, start, end, text });

    it("同起点短 + 长（坐标路径产出的计划）：合并成一条覆盖长区间", () => {
        const plan = [
            { text: "proposal", hits: [{ node: 0, start: 4, end: 12 }] },
            { text: "proposal might be regarded", hits: [{ node: 0, start: 4, end: 30 }] },
        ];
        const merged = mergeMarkSlots(markSlots(plan));
        expect(merged).toEqual([slot(0, 4, 30, "proposal might be regarded")]);
    });

    it("第三条不相交线索照常独立出 mark（验收 1）", () => {
        const plan = [
            { text: "proposal", hits: [{ node: 0, start: 4, end: 12 }] },
            { text: "proposal might be regarded", hits: [{ node: 0, start: 4, end: 30 }] },
            { text: "to Paragraph", hits: [{ node: 1, start: 0, end: 12 }] },
        ];
        const merged = mergeMarkSlots(markSlots(plan));
        expect(merged).toEqual([slot(0, 4, 30, "proposal might be regarded"), slot(1, 0, 12, "to Paragraph")]);
    });

    it("验收 4：删掉被覆盖的短线索 ⇒ 剩余线索重新合并（长的那条仍单独出）", () => {
        // 删除被覆盖的 `proposal` 后只剩长的那条 ⇒ 合并结果与单条线索一致；
        // 反之（删长的）则短的照常独立出 mark
        const long = { text: "proposal might be regarded", hits: [{ node: 0, start: 4, end: 30 }] };
        const short = { text: "proposal", hits: [{ node: 0, start: 4, end: 12 }] };
        expect(mergeMarkSlots(markSlots([long]))).toEqual([slot(0, 4, 30, "proposal might be regarded")]);
        expect(mergeMarkSlots(markSlots([short]))).toEqual([slot(0, 4, 12, "proposal")]);
    });

    it("合并只影响施工计划：`resolved` 仍与 anchors 逐位对齐（惰性升格不许错位）", () => {
        // 合并发生在 markSlots 之后（施工计划层），`planClueMarks` 的
        // resolved 逐位对齐口径不受影响——否则升格会把坐标写到别的线索上
        const { map, texts } = canonAfterGloss();
        const anchors = [
            { text: "Fund", range: { s: 0, e: 4 } },
            { text: "crucial", range: { s: 11, e: 18 } },
        ];
        const { plan, resolved } = planClueMarks(map, texts, anchors);
        expect(resolved.map((r) => r.text)).toEqual(["Fund", "crucial"]);
        expect(resolved.map((r) => r.range)).toEqual([
            { s: 0, e: 4 },
            { s: 11, e: 18 },
        ]);
        // 两条不相交 ⇒ 合并后计划长度不变（合并零副作用）
        expect(mergeMarkSlots(markSlots(plan))).toHaveLength(2);
    });

    it("部分重叠（坐标跨 <u> 抬升段）：合并后按并集落格，不再逐段越界", () => {
        // 坐标路径：一条覆盖 "Funding"，另一条覆盖 "ing is"（起点落在 <u> 之后）
        const plan = [
            {
                text: "Funding",
                hits: [
                    { node: 0, start: 0, end: 4 },
                    { node: 1, start: 0, end: 3 },
                ],
            },
            { text: "ing is", hits: [{ node: 1, start: 0, end: 6 }] },
        ];
        const merged = mergeMarkSlots(markSlots(plan));
        // 节点 1 的两段合并成 [0,6)；节点 0 保持独立（跨节点不合并）
        expect(merged).toEqual([slot(0, 0, 4, "Funding"), slot(1, 0, 6, "ing is")]);
    });
});

describe("选色归属（Issue #57：合并取最长那条的色，与 chips 主从一致）", () => {
    it("色号按下标进计划（坐标路径与降级路径都带 clue）", () => {
        const { map, texts } = canonAfterGloss();
        const anchors = [
            { text: "Funding", range: { s: 0, e: 7 }, color: 0 },
            { text: "crucial", color: 3 }, // 降级路径（无坐标）
        ];
        const { plan } = planClueMarks(map, texts, anchors);
        expect(plan.map((p) => p.clue)).toEqual([0, 1]);
        expect(colorMapOf(plan).get(0)).toBe(0);
        expect(colorMapOf(plan).get(1)).toBe(3);
    });

    it("重叠合并后 mark 的颜色 = 区间最长那条线索的选色（验收 5）", () => {
        // 同起点：短的选蓝（0）、长的选红（3）——合并成一段后必须取红
        const plan = [
            { text: "proposal", hits: [{ node: 0, start: 4, end: 12 }], clue: 0, color: 0 },
            { text: "proposal might be regarded", hits: [{ node: 0, start: 4, end: 30 }], clue: 1, color: 3 },
        ];
        const colors = colorMapOf(plan);
        const merged = mergeMarkSlots(markSlots(plan));
        expect(merged).toHaveLength(1);
        expect(merged[0].clue).toBe(1);
        expect(colors.get(merged[0].clue!)).toBe(3);
    });

    it("最长那条没选色（默认黄）时，合并段回默认黄——不是捡短的色", () => {
        const plan = [
            { text: "proposal", hits: [{ node: 0, start: 4, end: 12 }], clue: 0, color: 2 },
            { text: "proposal might be regarded", hits: [{ node: 0, start: 4, end: 30 }], clue: 1 },
        ];
        const colors = colorMapOf(plan);
        const merged = mergeMarkSlots(markSlots(plan));
        expect(merged[0].clue).toBe(1);
        // colorMapOf 只收「显式带色」的位（缺省=不建键 ⇒ 调用侧落默认黄）
        expect(colors.has(1)).toBe(true);
        expect(colors.get(1)).toBe(-1);
    });

    it("去重跳过重复文本时，clue 指向首次出现的锚点下标（不许按 text 反查）", () => {
        const { map, texts } = canonAfterGloss();
        const anchors = [{ text: "crucial" }, { text: "crucial", color: 3 }];
        const { plan } = planClueMarks(map, texts, anchors);
        // 第二条与第一条同文本 ⇒ 只施工一次，归属取首次出现的下标 0
        expect(plan).toHaveLength(1);
        expect(plan[0].clue).toBe(0);
    });
});

describe("三期收拢：名单与依赖方向（Issue #53 验收 4/5）", () => {
    it("装饰层不再自带词表解析/HTML 生成（词表区契约在 GlossDom）", async () => {
        const mod = await import("./MaterialDecorate");
        // 词表区 HTML 只从 GlossDom 转出，装饰层不再有第二份实现
        expect("glossTableHtml" in mod).toBe(false);
        const gloss = await import("./GlossDom");
        expect(typeof gloss.dataGlossTableHtml).toBe("function");
        // 词形施工（wrap）只剩装饰层一处
        expect(typeof mod.applyGlossLinks).toBe("function");
        expect("applyGloss" in gloss).toBe(false);
    });
});
