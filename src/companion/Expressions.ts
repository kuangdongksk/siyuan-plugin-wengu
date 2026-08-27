/**
 * 看板娘表情：枚举 + AI 输出别名规整 + 每表情的面部 SVG 片段。
 *
 * 规整三件套抄 types.ts 的题型模式（enum + ALIASES + normalize）：
 * AI 回复的表情字段什么都可能冒出来（大小写/中文变体），入口一律
 * normalize，认不出返回 undefined 由调用方兜底——保证程序永远不会
 * 因模型编造表情名而崩。
 *
 * 面部片段是 64×64 viewBox 下的 SVG 字符串（眼/嘴/附加物），在
 * CompanionApp.svelte 里以 {@html} 注入，团子身体由组件画。
 */

/** 表情（规则层与 AI 增强层共用的有限枚举）。 */
export enum WenguExpr {
    /** 平静待机。 */
    Idle = "idle",
    /** 开心。 */
    Happy = "happy",
    /** 得意。 */
    Proud = "proud",
    /** 欢呼庆祝。 */
    Cheer = "cheer",
    /** 思考/疑惑。 */
    Think = "think",
    /** 失落。 */
    Sad = "sad",
    /** 恨铁不成钢/打气。 */
    Push = "push",
    /** 打盹（久无事件）。 */
    Doze = "doze",
    /** 惊讶（秒答对等）。 */
    Surprise = "surprise",
}

/** 全量表情键（prompt 枚举清单与测试遍历用）。 */
export const EXPR_KEYS: readonly WenguExpr[] = Object.values(WenguExpr);

/** AI 输出的表情别名（中文变体 + 大小写由 toLowerCase 兜住）。 */
const EXPR_ALIASES: Record<string, WenguExpr> = {
    [WenguExpr.Idle]: WenguExpr.Idle,
    待机: WenguExpr.Idle,
    平静: WenguExpr.Idle,
    [WenguExpr.Happy]: WenguExpr.Happy,
    开心: WenguExpr.Happy,
    高兴: WenguExpr.Happy,
    [WenguExpr.Proud]: WenguExpr.Proud,
    得意: WenguExpr.Proud,
    自豪: WenguExpr.Proud,
    [WenguExpr.Cheer]: WenguExpr.Cheer,
    欢呼: WenguExpr.Cheer,
    庆祝: WenguExpr.Cheer,
    [WenguExpr.Think]: WenguExpr.Think,
    思考: WenguExpr.Think,
    怀疑: WenguExpr.Think,
    疑惑: WenguExpr.Think,
    [WenguExpr.Sad]: WenguExpr.Sad,
    失落: WenguExpr.Sad,
    难过: WenguExpr.Sad,
    [WenguExpr.Push]: WenguExpr.Push,
    鼓励: WenguExpr.Push,
    打气: WenguExpr.Push,
    恨铁不成钢: WenguExpr.Push,
    [WenguExpr.Doze]: WenguExpr.Doze,
    打盹: WenguExpr.Doze,
    瞌睡: WenguExpr.Doze,
    [WenguExpr.Surprise]: WenguExpr.Surprise,
    惊讶: WenguExpr.Surprise,
};

/** 规整表情；无法识别返回 undefined（调用方保底用 idle/规则台词）。 */
export function normalizeExpr(raw?: string): WenguExpr | undefined {
    return EXPR_ALIASES[(raw ?? "").trim().toLowerCase()];
}

/** 一张脸：眼/嘴 SVG 片段 + 可选附加物（泪珠/星星/Z 等）。 */
export interface ExprFace {
    eyes: string;
    mouth: string;
    extra?: string;
}

/** 每表情的面部（stroke=currentColor，色彩与线宽由 scss 控制）。 */
export const EXPR_FACES: Record<WenguExpr, ExprFace> = {
    [WenguExpr.Idle]: {
        eyes: '<circle cx="24" cy="30" r="2.4" fill="currentColor" stroke="none"/><circle cx="40" cy="30" r="2.4" fill="currentColor" stroke="none"/>',
        mouth: '<path d="M26 41q6 4 12 0"/>',
    },
    [WenguExpr.Happy]: {
        eyes: '<path d="M21 30q3-4 6 0"/><path d="M37 30q3-4 6 0"/>',
        mouth: '<path d="M25 39q7 7 14 0"/>',
    },
    [WenguExpr.Proud]: {
        eyes: '<path d="M21 29q3-3 6 0"/><path d="M37 29q3-3 6 0"/>',
        mouth: '<path d="M26 40q5 4 12-2"/>',
        extra: '<path d="M51 14l1.2 3 3 1.2-3 1.2-1.2 3-1.2-3-3-1.2 3-1.2z" fill="currentColor" stroke="none"/>',
    },
    [WenguExpr.Cheer]: {
        eyes: '<path d="M20 30q4-5 8 0"/><path d="M36 30q4-5 8 0"/>',
        mouth: '<path d="M25 38q7 9 14 0z" fill="currentColor" stroke="none"/>',
        extra: '<path d="M13 13l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="currentColor" stroke="none"/>',
    },
    [WenguExpr.Think]: {
        eyes: '<circle cx="24" cy="30" r="2.4" fill="currentColor" stroke="none"/><path d="M37 29q3-3 6 0"/>',
        mouth: '<path d="M26 41q3-2 6 0t6 0"/>',
        extra: '<circle cx="52" cy="14" r="1.7" fill="currentColor" stroke="none"/><circle cx="56" cy="18" r="1.7" fill="currentColor" stroke="none"/>',
    },
    [WenguExpr.Sad]: {
        eyes: '<path d="M21 29q3 3 6 0"/><path d="M37 29q3 3 6 0"/>',
        mouth: '<path d="M26 44q6-5 12 0"/>',
        extra: '<circle cx="46" cy="37" r="2" fill="currentColor" stroke="none"/>',
    },
    [WenguExpr.Push]: {
        eyes: '<path d="M20 25.5l7 2.5"/><path d="M44 25.5l-7 2.5"/><circle cx="24" cy="32" r="2.2" fill="currentColor" stroke="none"/><circle cx="40" cy="32" r="2.2" fill="currentColor" stroke="none"/>',
        mouth: '<path d="M27 42h10"/>',
        extra: '<path d="M52 20q4 3 0 6"/>',
    },
    [WenguExpr.Doze]: {
        eyes: '<path d="M21 30h6"/><path d="M37 30h6"/>',
        mouth: '<circle cx="32" cy="42" r="2.4"/>',
        extra: '<path d="M48 10h7l-7 7h7"/>',
    },
    [WenguExpr.Surprise]: {
        eyes: '<circle cx="24" cy="30" r="3.4"/><circle cx="40" cy="30" r="3.4"/>',
        mouth: '<circle cx="32" cy="42" r="4"/>',
    },
};
