import { wordLib } from "../word/service/WordLib";
import type { WordGrade } from "../word/core/WordStore";
import type { WenguQuestion } from "../types";
import type { QuizView } from "../quiz";
import CompanionApp from "./components/CompanionApp.svelte";
import CompanionPanelApp from "./components/CompanionPanelApp.svelte";
import { CompanionCtl, type CompanionDeps, type CompanionEvent } from "./core/CompanionCtl";
import type { CompanionPanelDeps } from "./core/CompanionPanelCtl";
import { plainOf, type ExplainCtx } from "./rules/Prompt";
import { mountSvelteApp } from "../ui/mountApp";

/**
 * 伴学看板娘域入口：单例控制器 + 全局悬浮层（挂 body，fixed 可拖动，
 * 20260828 用户定稿）+ 各域一行接入的事件构造帮手 + 学伴管理工作区
 * 面板的 Svelte 挂载编排。
 *
 * 全局层随插件 onload/onunload 生灭，与页签渲染解耦——刷题页签
 * renderList 随便 innerHTML 重灌都不影响它（旧双宿主「重渲染重挂」
 * 舞步随之消灭）；单词 dock 的内嵌份已摘除（全局层全覆盖）。挂件
 * 本体拖动换位（松手落盘、视口钳制），右键菜单可关闭（面板/设置
 * 开关重开）。管理面板仍在页签内：renderQuizShellFor 开头
 * detachCompanionPanel 先卸，WorkspaceShell 再重挂（模式见
 * docs/svelte-migration.md）。
 */

let ctlRef: CompanionCtl | undefined;

/** 插件 onload 调一次（i18n/settings 共享引用；history/word 惰性求值）。 */
export function initCompanion(deps: CompanionDeps): void {
    ctlRef = new CompanionCtl(deps);
}

export function companionCtl(): CompanionCtl | undefined {
    return ctlRef;
}

let globalApp: ReturnType<typeof mountSvelteApp> | undefined;

/** 全局悬浮层：组件根即 fixed 容器，mount 到 body（幂等）。 */
export function mountCompanionGlobal(): void {
    if (globalApp || !ctlRef) return;
    globalApp = mountSvelteApp(CompanionApp, document.body);
    ctlRef.loadImages();
}

/** 卸全局层（插件 onunload）+ 控制器收尾。 */
export function unmountCompanionGlobal(): void {
    globalApp?.unmount();
    globalApp = undefined;
    ctlRef?.dispose();
}

/* ── 学伴管理工作区面板（Svelte 四件套，模式见 docs/svelte-migration.md） ── */

let panelApp: { unmount(): void } | undefined;

/** 挂载学伴管理面板（WorkspaceShell 调；root=工作区主区，重挂前先卸旧）。 */
export function mountCompanionPanel(v: QuizView, root: HTMLElement): void {
    detachCompanionPanel();
    const settings = v.settingsOf() ?? {};
    const deps: CompanionPanelDeps = {
        t: v.t,
        settings,
        applySettings: () => v.applySettings(),
        reloadImages: () => ctlRef?.loadImages(),
        onActiveChange: () => ctlRef?.reloadActive(),
        onProfileRemoved: (id) => ctlRef?.dropChat(id),
        onCompanionToggle: () => ctlRef?.syncEnabled(),
    };
    panelApp = mountSvelteApp(CompanionPanelApp, root, { t: v.t, deps });
}

/** 卸载面板（renderQuizShellFor 全量重灌前 + QuizView.destroy 兜底调）。 */
export function detachCompanionPanel(): void {
    panelApp?.unmount();
    panelApp = undefined;
}

function notifyCompanion(e: CompanionEvent): void {
    ctlRef?.onEvent(e);
}

/* ── 事件构造帮手（各域收口处一行调用；结构化入参避免循环依赖） ── */

/** 刷题全域答题收口（QuizView.recordAnswer；多步/slots 的 qid#k 拆基座）。 */
export function notifyQuizAnswer(
    v: { list: WenguQuestion[] },
    qid: string,
    submitted: string,
    ok: boolean,
    sec: number
): void {
    const q = v.list.find((x) => x.id === qid.split("#")[0]);
    let explain: ExplainCtx | undefined;
    if (!ok && q) {
        explain = {
            kind: "quiz",
            stem: plainOf(q.stemMd ?? "", 160),
            submitted: plainOf(submitted, 60),
            answer: plainOf(q.answer ?? "", 80),
        };
    }
    notifyCompanion({ kind: "quiz-answer", ok, sec: sec > 0 ? sec : undefined, explain });
}

/** 整卷完成（QuizView.roundComplete）。 */
export function notifyRoundDone(v: { currentSession(): { answered: number; correct: number } | undefined }): void {
    const s = v.currentSession();
    if (s) notifyCompanion({ kind: "quiz-round-done", answered: s.answered, correct: s.correct });
}

/** 词卡三档收口（WordView.finishCard；客观题对错与误认实证一并带出）。 */
export function notifyWordGrade(
    v: {
        ui: { answered?: { correct?: boolean; pickFrom?: number }; confessedDraft: string };
        hardList: number[];
    },
    grade: WordGrade,
    idx: number
): void {
    const w = wordLib().curBook().words[idx];
    const wrong = v.ui.answered?.correct === false;
    const pf = wrong ? v.ui.answered?.pickFrom : undefined;
    let explain: ExplainCtx | undefined;
    if (grade === "no" && w) {
        explain = {
            kind: "word",
            word: w.w,
            meaning: String(w.m ?? "")
                .split("\n")[0]
                .trim()
                .slice(0, 80),
            confused:
                pf !== undefined && pf !== idx
                    ? wordLib().curBook().words[pf]?.w
                    : v.ui.confessedDraft.trim() || undefined,
        };
    }
    notifyCompanion({ kind: "word-grade", grade, correct: v.ui.answered?.correct, hardN: v.hardList.length, explain });
}

/** 单词收工（advanceAfterFinish 的 done 分支）。 */
export function notifyWordDone(hardN: number, total: number): void {
    notifyCompanion({ kind: "word-done", hardN, total });
}
