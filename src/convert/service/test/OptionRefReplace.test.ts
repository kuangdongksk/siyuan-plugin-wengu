import { describe, expect, it } from "vitest";
import { replaceDraftOptionRefs, replaceOptionRefs, replaceOptionRefsMap } from "../draft/OptionRefReplace";
import { parseDrafts, type DraftUnit } from "../draft/QuestionDraft";

/**
 * 解析选项引用标记（Issue #131 验收 2）：正常单选/多选连续标记、非法字母
 * 降级、无标记不动、数学环境内照常替换（标记即显式意图）、非解析部件
 * （材料正文）不动、英语域裸字母零改动。
 *
 * **字母表按部件上下文分组**（P1，20260915 审查）：多步题每步的选项组
 * 字母各自从 A 重新编，`step-k-*` 的标记只在该步组内定位——拍平进同一
 * 字母表会让 step-2 的 `〔opt:A〕` 换成 step-1 的选项文本（静默错内容）。
 * 分组口径与 `quiz/render/CardDisplayShuffle` 的逐步独立洗牌同源。
 */

const OPTS = ["保证全党服从中央", "加强思想教育和理论武装", "坚持以人民为中心", "全面从严治党"];

/** 造一道单选题（解析文本由调用方给）。 */
function draftOf(sol: string, type = "single"): DraftUnit {
    const lines = [`@@Q type=${type}`, "@@P stem", "下列说法正确的是（）"];
    for (const o of OPTS) lines.push("@@P opt", o);
    lines.push("@@P ans", "B", "@@P sol", sol, "@@END");
    return parseDrafts(lines.join("\n"))[0];
}

const solOf = (d: DraftUnit): string => d.parts.find((p) => p.name === "solution")?.text ?? "";

/** 多步题（steps）：两步各 3 选项——**两组的字母都从 A 起**，这正是
 *  「拍平进同一字母表」会错位的最小构造。
 *
 *  ⚠️ 契约现实：`resolvePart` 只认 `step-N-(stem|option|answer)`，
 *  `@@P step-1-solution` 会解析成空名被丢——逐步解析**当前不入协议**
 *  （整题解析是顶层 `@@P sol`）。故本构造里的逐步解析部件用**契约全名**
 *  `custom-plugin-wengu-part` 之外的行协议短名不受支持，测试改用
 *  `parts` 手工摆（`stepDraftOf` 直出零件数组），以便锁住分组口径本身。 */
function stepParts(sol: string, stepSols: string[] = []): DraftUnit {
    const stepOpts = [
        ["代入法", "画图法", "排除法"],
        ["2", "4", "8"],
    ];
    const parts: { name: string; text: string }[] = [{ name: "stem", text: "题干 〔opt:C〕 〔opt:B〕" }];
    stepOpts.forEach((opts, k) => {
        parts.push({ name: `step-${k + 1}-stem`, text: `第 ${k + 1} 步引导语` });
        for (const o of opts) parts.push({ name: `step-${k + 1}-option-0`, text: o });
        parts.push({ name: `step-${k + 1}-answer`, text: "A" });
    });
    if (sol) parts.push({ name: "solution", text: sol });
    stepSols.forEach((t, k) => parts.push({ name: `step-${k + 1}-solution`, text: t }));
    return { attrs: { type: "steps" }, parts, material: false };
}

const stepSolOf = (d: DraftUnit, k: number): string => d.parts.find((p) => p.name === `step-${k}-solution`)?.text ?? "";

describe("replaceOptionRefs · 纯函数", () => {
    it("单选：标记 → 该选项文本（全角引号包裹）", () => {
        expect(replaceOptionRefs("〔opt:B〕正确。", OPTS)).toBe("「加强思想教育和理论武装」正确。");
    });

    it("多选连续标记：自然连排、各自独立换", () => {
        expect(replaceOptionRefs("〔opt:A〕与〔opt:C〕均错误，〔opt:B〕〔opt:D〕正确。", OPTS)).toBe(
            "「保证全党服从中央」与「坚持以人民为中心」均错误，「加强思想教育和理论武装」「全面从严治党」正确。"
        );
    });

    it("非法字母（超出选项数 / 非 A-H）降级为裸字母，不丢信息", () => {
        expect(replaceOptionRefs("〔opt:E〕错。", OPTS)).toBe("E错。");
        expect(replaceOptionRefs("〔opt:Z〕错。", OPTS)).toBe("Z错。");
    });

    it("无标记的裸字母一律不动（英语域保护）", () => {
        const en = "Plan A works, option B is wrong, and vitamin A matters. Students' A is fine.";
        expect(replaceOptionRefs(en, OPTS)).toBe(en);
    });

    it("数学/代码环境内的标记照常替换（标记即显式意图）", () => {
        expect(replaceOptionRefs("$x_A$ 与 〔opt:A〕 不同", OPTS)).toBe("$x_A$ 与 「保证全党服从中央」 不同");
    });

    it("空文本/无标记：原样返回", () => {
        expect(replaceOptionRefs("", OPTS)).toBe("");
        expect(replaceOptionRefs("没有引用", OPTS)).toBe("没有引用");
    });
});

describe("replaceDraftOptionRefs · 草稿单元", () => {
    it("解析与题干都换；非法字母降级", () => {
        const src = draftOf("〔opt:B〕正确，〔opt:A〕错，〔opt:X〕不存在。");
        const d = replaceDraftOptionRefs(src);
        expect(solOf(d)).toBe("「加强思想教育和理论武装」正确，「保证全党服从中央」错，X不存在。");
    });

    it("纯函数：不改入参（原对象逐字不变）", () => {
        const src = draftOf("〔opt:B〕正确。");
        const d = replaceDraftOptionRefs(src);
        expect(d).not.toBe(src);
        expect(solOf(src)).toBe("〔opt:B〕正确。"); // 调用方手里的 draft 未被污染
    });

    it("无标记：返回原对象（引用相等，零开销）", () => {
        const src = draftOf("没有引用。");
        expect(replaceDraftOptionRefs(src)).toBe(src);
    });

    it("answer 部件不受影响（答案是字母，不是解析）", () => {
        const d = replaceDraftOptionRefs(draftOf("〔opt:B〕正确。"));
        expect(d.parts.find((p) => p.name === "answer")?.text).toBe("B");
    });

    it("无选项组（判断题）时零动作", () => {
        const src = parseDrafts(
            ["@@Q type=judge", "@@P stem", "判断", "@@P ans", "√", "@@P sol", "〔opt:A〕对", "@@END"].join("\n")
        )[0];
        expect(replaceDraftOptionRefs(src)).toBe(src);
        expect(solOf(src)).toBe("〔opt:A〕对"); // 无选项可指，标记原样留着（可见即知协议没被遵守）
    });

    it("材料块（material=1）跳过", () => {
        const src = parseDrafts(["@@Q material=1", "@@P body", "正文 〔opt:A〕", "@@END"].join("\n"))[0];
        expect(replaceDraftOptionRefs(src)).toBe(src);
    });
});

describe("多步题：字母表按部件上下文分组（P1）", () => {
    it("拍平口径会得到错答案——本条锁住不再回退", () => {
        // 拍成同一字母表时 step-2 的 〔opt:B〕 会命中第 2 个**已拍平**的
        // 选项（第一步的「画图法」）；分组后必须命中第二步自己的「4」。
        const d = replaceDraftOptionRefs(stepParts("", ["第一步解析 〔opt:B〕。", "第二步解析 〔opt:B〕。"]));
        expect(stepSolOf(d, 2)).toBe("第二步解析 「4」。");
        expect(stepSolOf(d, 2)).not.toContain("画图法");
        expect(stepSolOf(d, 1)).toBe("第一步解析 「画图法」。");
    });

    it("各步的 A 各指自家首项（不串步）", () => {
        const d = replaceDraftOptionRefs(stepParts("", ["〔opt:A〕得中间结果。", "〔opt:A〕即首项。"]));
        expect(stepSolOf(d, 1)).toBe("「代入法」得中间结果。");
        expect(stepSolOf(d, 2)).toBe("「2」即首项。");
    });

    it("步组的 C 合法、顶层无 option 时顶层解析的 C 保留标记", () => {
        // 顶层组为空 ⇒ 顶层解析的标记不猜组、原样留（可见即知协议没被遵守）
        const d = replaceDraftOptionRefs(stepParts("顶层解析 〔opt:A〕。", ["步解析 〔opt:C〕。"]));
        expect(stepSolOf(d, 1)).toBe("步解析 「排除法」。");
        expect(solOf(d)).toBe("顶层解析 〔opt:A〕。");
    });

    it("顶层有选项组时：顶层与各步各认自己的字母表（B 两处不同结果）", () => {
        const d = stepParts("顶层解析 〔opt:B〕。", ["〔opt:A〕步解析 〔opt:B〕。"]);
        d.parts.unshift({ name: "option-0", text: "整题选项乙" });
        d.parts.unshift({ name: "option-0", text: "整题选项甲" });
        const out = replaceDraftOptionRefs(d);
        expect(solOf(out)).toBe("顶层解析 「整题选项乙」。"); // 顶层组
        expect(stepSolOf(out, 1)).toBe("「代入法」步解析 「画图法」。"); // 步组，与顶层无关
    });

    it("题干按顶层组解析（step 组不参与）", () => {
        const d = stepParts("");
        d.parts.unshift({ name: "option-0", text: "整题选项乙" });
        d.parts.unshift({ name: "option-0", text: "整题选项甲" });
        d.parts.push({ name: "stem", text: "题干 〔opt:B〕" });
        const out = replaceDraftOptionRefs(d);
        // 顶层 B ⇒「整题选项乙」；若误用步组字母表会得到「画图法」
        expect(out.parts[out.parts.length - 1].text).toBe("题干 「整题选项乙」");
    });

    it("该步无选项组时标记原样保留（不误用别组字母表）", () => {
        const d: DraftUnit = {
            material: false,
            attrs: { type: "steps" },
            parts: [
                { name: "step-1-option-0", text: "甲" },
                { name: "step-1-option-0", text: "乙" },
                { name: "step-1-answer", text: "A" },
                { name: "step-1-solution", text: "步解析 〔opt:A〕。" },
                { name: "step-2-solution", text: "无选项步的解析 〔opt:A〕。" },
            ],
        };
        const out = replaceDraftOptionRefs(d);
        expect(stepSolOf(out, 1)).toBe("步解析 「甲」。");
        expect(stepSolOf(out, 2)).toBe("无选项步的解析 〔opt:A〕。"); // 无组不猜，原样留
    });

    it("行协议里逐步解析尚不入协议（resolvePart 丢空名）——锁住这条现实", () => {
        // 契约现实：@@P step-1-solution 会解析成空名被丢（逐步解析当前不
        // 入协议，整题解析统一写 @@P sol = 顶层组）。上面的 step-k-* 分支
        // 因此是前瞻实现——本条断言它今天确实拿不到行协议输入，防止测试
        // 读者误以为逐步解析已落地。
        const parsed = parseDrafts(
            [
                "@@Q type=steps steps=method|result",
                "@@P stem",
                "题干",
                "@@P step",
                "第一步",
                "@@P step-opt",
                "甲",
                "@@P step-option",
                "乙",
                "@@P step-answer",
                "A",
                "@@P step-1-solution",
                "步解析",
                "@@END",
            ].join("\n")
        )[0];
        expect(parsed.parts.map((p) => p.name)).not.toContain("step-1-solution");
        expect(parsed.parts.some((p) => p.name.includes("solution"))).toBe(false);
    });
});

describe("replaceOptionRefsMap · 整批", () => {
    it("逐单元替换", () => {
        const [d] = replaceOptionRefsMap([draftOf("〔opt:D〕正确。")]);
        expect(solOf(d)).toBe("「全面从严治党」正确。");
    });

    it("幂等：替换后再跑一遍不产生二次变化（标记已无）", () => {
        const [once] = replaceOptionRefsMap([draftOf("〔opt:A〕错。")]);
        const [twice] = replaceOptionRefsMap([once]);
        expect(solOf(twice)).toBe(solOf(once));
        expect(twice).toBe(once); // 无标记 ⇒ 原对象
    });
});
