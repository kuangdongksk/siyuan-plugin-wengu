import { mount, unmount } from "svelte";
import WORD_BOOK from "../word/service/WordBook";
import type { WordGrade } from "../word/core/WordStore";
import type { WenguQuestion } from "../types";
import CompanionApp from "./comp/CompanionApp.svelte";
import { CompanionCtl, type CompanionDeps, type CompanionEvent } from "./core/CompanionCtl";
import { plainOf, type ExplainCtx } from "./rules/Prompt";

/**
 * 伴学看板娘域入口：单例控制器 + 双宿主挂载（刷题页签/单词 dock）+
 * 各域一行接入的事件构造帮手。
 *
 * 宿主挂载沿用统计浮层的「重渲染重挂」舞步：刷题页签 renderList 会
 * innerHTML 全量覆盖（挂载层被断开），每次渲染后重调 attachCompanion
 * ——层还连在目标元素上则跳过，避免 Svelte 反复 mount；单词 dock 是
 * Svelte 树，由 WordApp.svelte 直接内嵌 CompanionApp，不走本挂载层。
 */

let ctlRef: CompanionCtl | undefined;

/** 插件 onload 调一次（i18n/settings 共享引用；history/word 惰性求值）。 */
export function initCompanion(deps: CompanionDeps): void {
    ctlRef = new CompanionCtl(deps);
}

export function companionCtl(): CompanionCtl | undefined {
    return ctlRef;
}

export type CompanionHostKind = "quiz" | "word";

const mounted = new Map<CompanionHostKind, { layer: HTMLDivElement; stop: () => void }>();

/** 把看板娘层挂到宿主元素右下角（enabled=false 时不挂/卸已有）。 */
export function attachCompanion(el: HTMLElement, host: CompanionHostKind): void {
    const prev = mounted.get(host);
    if (ctlRef?.enabled() && prev && prev.layer.isConnected && prev.layer.parentElement === el) return;
    detachCompanion(host);
    if (!ctlRef || !ctlRef.enabled()) return;
    const layer = document.createElement("div");
    layer.className = "wengu-companion";
    el.appendChild(layer);
    const app = mount(CompanionApp, { target: layer });
    mounted.set(host, { layer, stop: () => unmount(app) });
    ctlRef.loadImages(); // 设置里换了图片目录时随重挂重探（word 内嵌路径由 acquireUi 兜）
}

export function detachCompanion(host: CompanionHostKind): void {
    const m = mounted.get(host);
    if (!m) return;
    m.stop();
    m.layer.remove();
    mounted.delete(host);
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
    const w = WORD_BOOK.words[idx];
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
            confused: pf !== undefined && pf !== idx ? WORD_BOOK.words[pf]?.w : v.ui.confessedDraft.trim() || undefined,
        };
    }
    notifyCompanion({ kind: "word-grade", grade, correct: v.ui.answered?.correct, hardN: v.hardList.length, explain });
}

/** 单词收工（advanceAfterFinish 的 done 分支）。 */
export function notifyWordDone(hardN: number, total: number): void {
    notifyCompanion({ kind: "word-done", hardN, total });
}
