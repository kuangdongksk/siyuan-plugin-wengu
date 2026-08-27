import { describe, expect, it } from "vitest";
import { WenguExpr } from "./Expressions";
import {
    buildChatPrompt,
    buildExplainPrompt,
    buildReactPrompt,
    clampText,
    parseExprReply,
    plainOf,
    type ChatTurn,
    type SessionProfile,
    type UserProfile,
} from "./Prompt";

const s: SessionProfile = { answered: 12, correct: 8, wrongStreak: 3, rightStreak: 0, wordDone: 0, hardN: 2 };
const u: UserProfile = {
    rounds: 30,
    totalAnswered: 843,
    rate: 0.76,
    totalMin: 510,
    streakDays: 12,
    todayAnswered: 20,
    todayCorrect: 15,
    todayMin: 18,
    wordStreak: 5,
    wordLearned: 120,
    wordTodayNew: 6,
    wordTodayRev: 14,
};

describe("buildReactPrompt", () => {
    it("包含学伴名、人设描述、两层画像数字、事件句与两行协议", () => {
        const p = buildReactPrompt("团子", "温柔鼓励的学伴，语气轻柔", "连错 3 题（刚又错了一道）", s, u);
        expect(p).toContain("学伴「团子」");
        expect(p).toContain("温柔鼓励的学伴，语气轻柔");
        expect(p).toContain("843");
        expect(p).toContain("76%");
        expect(p).toContain("连续刷题 12 天");
        expect(p).toContain("今日答题 20 对 15");
        expect(p).toContain("连错 3 题");
        expect(p).toContain("EXPRESSION:");
        expect(p).toContain("LINE:");
        expect(p).toContain("idle|happy|proud|cheer|think|sad|push|doze|surprise");
    });

    it("自定义学伴名替换默认学伴", () => {
        const p = buildReactPrompt("语文老师", "一位语文老师", "连错 3 题", s, u);
        expect(p).toContain("学伴「语文老师」");
        expect(p).not.toContain("团子");
    });

    it("自定义人设（如「语文老师」）原样进入 prompt", () => {
        const p = buildReactPrompt("团子", "一位语文老师，擅长古诗文与阅读理解，讲解时爱引用典故", "连错 3 题", s, u);
        expect(p).toContain("一位语文老师，擅长古诗文与阅读理解");
    });
});

describe("parseExprReply", () => {
    it("标准两行解析", () => {
        const r = parseExprReply("EXPRESSION: happy\nLINE: 连错没事，下题追回来");
        expect(r?.expr).toBe(WenguExpr.Happy);
        expect(r?.line).toBe("连错没事，下题追回来");
    });

    it("表情别名规整、杂物行容忍", () => {
        const r = parseExprReply("好的！\nEXPRESSION: 恨铁不成钢\nLINE: 再错我可要念叨了。\n（完）");
        expect(r?.expr).toBe(WenguExpr.Push);
    });

    it("缺行/未知表情/空串返回 undefined", () => {
        expect(parseExprReply("EXPRESSION: happy")).toBeUndefined();
        expect(parseExprReply("LINE: 只有台词")).toBeUndefined();
        expect(parseExprReply("EXPRESSION: excited\nLINE: 嗨")).toBeUndefined();
        expect(parseExprReply("")).toBeUndefined();
    });

    it("台词超长被截断", () => {
        const long = "很".repeat(60);
        const r = parseExprReply(`EXPRESSION: happy\nLINE: ${long}`);
        expect(r?.line.length).toBeLessThanOrEqual(41);
    });
});

describe("buildChatPrompt / buildExplainPrompt", () => {
    const history: ChatTurn[] = [
        { role: "user", text: "今天状态不好" },
        { role: "ai", text: "没事，慢慢来" },
    ];

    it("聊天 prompt 含画像、近期对话与用户输入", () => {
        const p = buildChatPrompt("团子", "毒舌鞭策型学伴", s, u, history, undefined, "这章怎么学");
        expect(p).toContain("用户：今天状态不好");
        expect(p).toContain("团子：没事，慢慢来");
        expect(p).toContain("用户说：这章怎么学");
        expect(p).toContain("不超过120字");
    });

    it("近期对话轮的学伴名跟随当前配置", () => {
        const p = buildChatPrompt("阿圆", "温柔鼓励", s, u, history, undefined, "在吗");
        expect(p).toContain("阿圆：没事，慢慢来");
        expect(p).not.toContain("团子：");
    });

    it("带错题上下文时拼入题面/作答/正确答案", () => {
        const p = buildChatPrompt(
            "团子",
            "温柔鼓励",
            s,
            u,
            [],
            { kind: "quiz", stem: "x²=4 求 x", submitted: "2", answer: "±2" },
            "我哪错了"
        );
        expect(p).toContain("x²=4 求 x");
        expect(p).toContain("2");
        expect(p).toContain("±2");
    });

    it("讲解 prompt 含词头/释义/误认词与讲解要求", () => {
        const p = buildExplainPrompt("团子", "温柔鼓励", u, {
            kind: "word",
            word: "adapt",
            meaning: "v. 适应",
            confused: "adopt",
        });
        expect(p).toContain("adapt");
        expect(p).toContain("适应");
        expect(p).toContain("adopt");
        expect(p).toContain("记忆点");
    });
});

describe("工具", () => {
    it("plainOf 剥 md 记号并截断", () => {
        expect(plainOf("**bold** and `code`", 20)).toBe("bold and code");
        const long = plainOf("a".repeat(50), 10);
        expect(long.length).toBe(11);
        expect(long.endsWith("…")).toBe(true);
    });

    it("clampText 折叠空白并限长", () => {
        expect(clampText("  a \n b  ", 10)).toBe("a b");
        expect(clampText("x".repeat(30), 10).length).toBe(11);
    });
});
