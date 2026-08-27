import type { AnsweredState, WordCardMode } from "../flow/WordQuiz";
import type { WenguWordProgress, WordGrade } from "./WordStore";

/** Svelte context 键：WordView 控制器经 context 注入子组件（静态依赖，
 *  避免作为 prop 传递触发 state_referenced_locally 警告）。 */
export const WORD_VIEW_CTX = Symbol("wenguWordView");

/**
 * 背单词的响应式 UI 状态形状（Svelte 化改造引入）：
 *
 * `$state` 代理只能在 Svelte 编译单元里创建，因此在 WordApp.svelte 里
 * `const ui: WordUi = $state(initialWordUi())` 生成一份深代理，控制器
 * （WordView）与组件同持该引用——控制器就地改字段，组件模板读到哪
 * 行哪行细粒度更新，替代旧的 innerHTML 全量 paint。队列本体等纯逻辑
 * 状态仍在控制器私有字段，只有渲染要读的才镜像进 ui。
 */

/** 控制器/组件共享的响应态（字段语义见 WordView 同名成员）。 */
export interface WordUi {
    /** 页面态（home/askreview/stats/lookup/card/setstart/done）。 */
    mode: "home" | "askreview" | "stats" | "lookup" | "card" | "setstart" | "done";
    phase: "prompt" | "result";
    cardMode: WordCardMode;
    answered: AnsweredState | undefined;
    /** 回想题正面已选档位（认识/模糊/忘记）；空翻（点卡/空格）未选为 undefined。 */
    selfGrade: WordGrade | undefined;
    /** 「记错了」已点：收尾强制按不认识批改，并常驻自述框。 */
    mistakeClaimed: boolean;
    /** 进度（深代理：逻辑层就地改，模板直接读）。 */
    progress: WenguWordProgress | undefined;
    /** 当前卡镜像（队列本体在控制器，换卡时同步）。 */
    idx: number;
    confIds: number[];
    cardSeq: number;
    /** 队列会话（review/star）的位置/长度；fresh 恒 0（滚动窗口无队列）。 */
    pos: number;
    queueLen: number;
    /** 「剩」：fresh=书级剩余未学（随毕业递减）/ 队列轨=会话剩余词数（去重）。 */
    remainWords: number;
    queueKind: "review" | "fresh" | "star";
    hardN: number;
    /** 查词态。 */
    lookupQuery: string;
    lookupSel: number | undefined;
    fromCard: boolean;
    /** AI 复盘镜像（WordAiRunner 是普通类，按钮/消息渲染读镜像）。 */
    aiRunning: boolean;
    aiMsg: string;
    aiPending: number;
    /** 起点设置面板：导入状态选择 + 导入结果文案（WordStartCtl 写）。 */
    importStatus: string;
    startMsg: string;
    /** spell 实时输入 /「认成了」自述草稿（作答瞬间由控制器读取）。 */
    spellLive: string;
    confessedDraft: string;
}

/** 初始态（$state 包装在 WordApp 内完成）。 */
export function initialWordUi(): WordUi {
    return {
        mode: "home",
        phase: "prompt",
        cardMode: "choiceEn",
        answered: undefined,
        selfGrade: undefined,
        mistakeClaimed: false,
        progress: undefined,
        idx: 0,
        confIds: [],
        cardSeq: 0,
        pos: 0,
        queueLen: 0,
        remainWords: 0,
        queueKind: "fresh",
        hardN: 0,
        lookupQuery: "",
        lookupSel: undefined,
        fromCard: false,
        aiRunning: false,
        aiMsg: "",
        aiPending: 0,
        importStatus: "auto",
        startMsg: "",
        spellLive: "",
        confessedDraft: "",
    };
}
