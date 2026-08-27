/**
 * 规则层兜底台词：人设 × 事件 的变体表（AI 不在/失败/被关时的即时反应）。
 *
 * 与 prompt 同例硬编码中文、不走 i18n（内容而非界面文案）；{n} 占位
 * 由 pickLine 替换。缺项回退链：本人设 → gentle → 省略号，保证任意
 * 人设 × 任意事件都拿得到一句话。
 */

/** 人设键（设置项 companionPersona 的取值）。 */
export type PersonaKey = "gentle" | "sharp" | "genki" | "calm";

export const PERSONA_KEYS: readonly PersonaKey[] = ["gentle", "sharp", "genki", "calm"];

/** 人设名（i18n key：personaGentle/personaSharp/…）。 */
export const PERSONA_I18N: Record<PersonaKey, string> = {
    gentle: "personaGentle",
    sharp: "personaSharp",
    genki: "personaGenki",
    calm: "personaCalm",
};

/** 人设的 AI 口吻基准（prompt 用）。 */
export const PERSONA_PROMPTS: Record<PersonaKey, string> = {
    gentle: "温柔鼓励的学伴，语气轻柔，多肯定少批评，偶尔心疼用户辛苦",
    sharp: "毒舌鞭策型学伴，嘴上嫌弃但真心为用户好，爱用反问和激将法，不真的伤人",
    genki: "元气满满的学伴，活力四射，多用感叹号和打气话术",
    calm: "理性简洁的学伴，语气平稳克制，重事实与数据，不煽情",
};

/** 规整人设（设置读入与测试用；未识别回落 gentle）。 */
export function normalizePersona(raw?: string): PersonaKey {
    return raw === "sharp" || raw === "genki" || raw === "calm" ? raw : "gentle";
}

/** 兜底台词的事件种类（AI 增强层触发时也复用同表选表情）。 */
export type LineEvent =
    | "greet"
    | "quiz-right"
    | "quiz-fast"
    | "quiz-wrong"
    | "wrong-streak"
    | "right-streak"
    | "round-done"
    | "word-know"
    | "word-fuzzy"
    | "word-no"
    | "word-done"
    | "doze";

/** 兜底台词表（导出供单测遍历完整性：人设 × 事件必须齐）。 */
export const LINES: Record<PersonaKey, Partial<Record<LineEvent, string[]>>> = {
    gentle: {
        greet: ["我在呢，慢慢来，我陪着你。", "准备好就开刷，我在这儿。"],
        "quiz-right": ["对的，稳稳的。", "嗯嗯，又对一题。"],
        "quiz-fast": ["这么快就对了，好厉害。", "秒答正确，思路很清楚呢。"],
        "quiz-wrong": ["没事，错题才是提分的地方。", "没关系，记下来下次就认识了。"],
        "wrong-streak": ["连错 {n} 题了，要不歇口气再看？", "有点辛苦吧，我们先慢下来，一题一题来。"],
        "right-streak": ["连对 {n} 题了，状态很好哦。", "手感来了，继续保持～"],
        "round-done": ["这一轮收工，{n} 题里对了 {c} 题，辛苦啦。", "完成一轮，去伸个懒腰吧。"],
        "word-know": ["认识就好，这个词拿下了。", "嗯，记住了。"],
        "word-fuzzy": ["有点印象但没吃透，再看一眼。", "模糊也没关系，多见几次就熟了。"],
        "word-no": ["这个词还生，再来一次就熟一点。", "没事，生词才值得背。"],
        "word-done": ["这组过完了，{n} 个词收工。", "背完啦，今天也认真了。"],
        doze: ["我眯一会儿，你先刷着……", "（打了个哈欠）叫我哦。"],
    },
    sharp: {
        greet: ["行，我又来了。手别生就行。", "坐直了，开刷。"],
        "quiz-right": ["这有什么好夸的，下一题。", "对是对了，别飘。"],
        "quiz-fast": ["哟，脑子今天转得挺快。", "秒了？行，算你反应快。"],
        "quiz-wrong": ["就说让你细读题吧。", "错了，想想哪步想岔了？"],
        "wrong-streak": ["连错 {n} 题了，是状态不行还是真不会？自己说。", "再错下去我可要念叨了。"],
        "right-streak": ["连对 {n} 题，勉强像样。", "行，这波我认可。"],
        "round-done": ["一轮完了，{n} 对 {c}。错的自己心里有数吧？", "收工。错题不收拾，下轮还错。"],
        "word-know": ["认识，应该的。", "这个词归你了，别还回来。"],
        "word-fuzzy": ["模糊就是不会，别自我安慰。", "半生不熟最危险，再过一遍。"],
        "word-no": ["不认识就承认，现在记正好。", "又生了一个？行，记仇本上添一笔。"],
        "word-done": ["{n} 个词过完，错的可别当没看见。", "收工，明天的到期别忘了。"],
        doze: ["……你怎么也不动笔？", "醒醒，题可不会自己做完。"],
    },
    genki: {
        greet: ["来啦来啦！今天也一起冲！", "元气加载完毕，开刷开刷！"],
        "quiz-right": ["漂亮！！", "对啦对啦，就是这么答！"],
        "quiz-fast": ["秒答正确！！太快了吧！", "唰的一下就对了，帅！"],
        "quiz-wrong": ["哎呀差一点！下题追回来！", "没事没事，错一题换一个经验！"],
        "wrong-streak": ["连错 {n} 题有点上头！深呼吸，我们再来！", "停！先喝口水，缓一缓再战！"],
        "right-streak": ["连对 {n} 题！火力全开！", "这手感也太好了吧！！"],
        "round-done": ["一轮结束！{n} 题对 {c}，鼓掌！！", "收工收工！你超棒的！"],
        "word-know": ["认识！这个词通关！", "拿下！下一个！"],
        "word-fuzzy": ["有点眼熟对吧！再看一眼就熟啦！", "模糊是快学会了的意思！"],
        "word-no": ["哼，生词别嚣张！马上记住你！", "又认识一个新朋友（指单词）！"],
        "word-done": ["{n} 个词全部过完！任务达成！！", "背完啦！！给自己比个耶！"],
        doze: ["（小声）困了困了……你加油……", "Zzz……哦哦我在我在！"],
    },
    calm: {
        greet: ["开始吧，我记录进度。", "准备好了就说一声。"],
        "quiz-right": ["判定：正确。", "正确。节奏稳定。"],
        "quiz-fast": ["{sec} 秒答对，熟练度高。", "秒级作答，正确。"],
        "quiz-wrong": ["错误。建议回看题干条件。", "不正确，标记待复盘。"],
        "wrong-streak": ["连续错误 {n} 题，建议暂停调整。", "错误率上升，先复核同类知识点。"],
        "right-streak": ["连续正确 {n} 题，状态稳定。", "正确率维持高位。"],
        "round-done": ["本轮 {n} 题，正确 {c}。已记录。", "一轮完成，数据已入统计。"],
        "word-know": ["该词判定为已认识。", "确认认识，间隔已延长。"],
        "word-fuzzy": ["熟悉度不足，安排重现。", "判定模糊，本轮会再见。"],
        "word-no": ["未掌握，进入重现队列。", "判定陌生，稍后重出。"],
        "word-done": ["本组 {n} 词完成。", "收尾，剩余照常排队。"],
        doze: ["待机中。有事件我会响应。", "（静默待机）"],
    },
};

/** 选一条兜底台词：人设缺项回退 gentle；{n}/{c}/{sec} 占位替换。 */
export function pickLine(persona: PersonaKey, ev: LineEvent, n?: number, c?: number, sec?: number): string {
    const vars = LINES[persona]?.[ev] ?? LINES.gentle[ev] ?? ["……"];
    const raw = vars[Math.floor(Math.random() * vars.length)];
    return raw
        .replace(/\{n\}/g, String(n ?? ""))
        .replace(/\{c\}/g, String(c ?? ""))
        .replace(/\{sec\}/g, String(sec ?? ""));
}
