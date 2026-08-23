import {WordAiRunner} from "./WordAi";
import type {LookupConfCtl} from "./WordLookup";
import type {WordStartCtl} from "./WordStart";
import type {WenguWordProgress} from "./WordStore";
import {
    buildQueue,
    markFamiliar,
    toggleStar,
} from "./WordStore";

/**
 * data-act 动作分发（WordView 拆件）：switch 全集中在此，
 * 通过 WordViewApi 接口访问视图成员（WordView 公开实现）。
 */

/** 分发所需的视图能力面。 */
export interface WordViewApi {
    t: (k: string) => string;
    progress: WenguWordProgress | undefined;
    store: {save: (p: WenguWordProgress) => Promise<unknown>;};
    ai: WordAiRunner;
    mode: string;
    phase: "prompt" | "result";
    answered: {correct: boolean;} | undefined;
    hardList: number[];
    lookupSel: number | undefined;
    rebuildQueue(kind: "review" | "fresh" | "star"): void;
    paint(): void;
    finishCard(g: "no" | "fuzzy" | "know" | "easy"): void;
    finishMastered(): void;
    toggleStarCard(): void;
    submitSpell(): void;
    redoHard(): void;
    startCtl(): WordStartCtl;
    enterLookup(): void;
    lookupPick(idx: number): void;
    /** 查词详情的易混笔记控制器（保存手写辨析 / 复制提问）。 */
    confCtl: LookupConfCtl;
}

export function dispatchWordAct(v: WordViewApi, name: string, dataset?: DOMStringMap): void {
    switch (name) {
        case "goreview":
            v.mode = "card";
            v.rebuildQueue("review");
            v.paint();
            break;
        case "gofresh": {
            const {review} = buildQueue(v.progress!);
            if (review.length > 0) {
                v.mode = "askreview"; // 有到期复习 → 先弹「先复习」
            } else {
                v.mode = "card";
                v.rebuildQueue("fresh");
            }
            v.paint();
            break;
        }
        case "gofreshanyway":
            v.mode = "card";
            v.rebuildQueue("fresh");
            v.paint();
            break;
        case "gostar":
            v.mode = "card";
            v.rebuildQueue("star");
            v.paint();
            break;
        case "mastered":
            v.finishMastered();
            break;
        case "star":
            v.toggleStarCard();
            break;
        case "lookup":
            v.enterLookup();
            break;
        case "lookuppick":
            v.lookupPick(parseInt(dataset?.idx ?? "0", 10));
            break;
        case "lookupstar": {
            const i = parseInt(dataset?.idx ?? "0", 10);
            toggleStar(v.progress!, i);
            void v.store.save(v.progress!);
            v.paint();
            break;
        }
        case "lookupfamiliar": {
            const i = parseInt(dataset?.idx ?? "0", 10);
            markFamiliar(v.progress!, i, false);
            void v.store.save(v.progress!);
            v.paint();
            break;
        }
        case "stats":
            v.mode = "stats";
            v.paint();
            break;
        case "home":
            v.mode = "home";
            v.paint();
            break;
        case "showanswer":
            if (v.phase === "prompt") {
                v.phase = "result";
                v.paint();
            }
            break;
        case "submit":
            v.submitSpell();
            break;
        case "next":
            v.finishCard(v.answered?.correct ? "know" : "no");
            break;
        case "markwrong":
            v.finishCard("no");
            break;
        case "setstart":
            v.mode = "setstart";
            v.paint();
            break;
        case "applystart":
            v.startCtl().apply();
            v.mode = "home";
            v.paint();
            break;
        case "cancelset":
            v.mode = "home";
            v.paint();
            break;
        case "redohard":
            v.redoHard();
            break;
        case "aianalyze":
            if (v.progress) {
                void v.ai.run(
                    v.progress,
                    () => v.store.save(v.progress!),
                    () => {
                        v.mode = "home";
                    },
                    () => v.paint(),
                );
            }
            break;
        case "confask":
            v.confCtl.ask(parseInt(dataset?.idx ?? "0", 10));
            break;
        case "confsave":
            v.confCtl.saveNote(parseInt(dataset?.idx ?? "0", 10));
            break;
        case "setgroupsize": {
            const n = parseInt(dataset?.value ?? "0", 10);
            if (n >= 5 && n <= 20 && v.progress) {
                v.progress.groupSize = n;
                void v.store.save(v.progress);
            }
            break;
        }
    }
}
