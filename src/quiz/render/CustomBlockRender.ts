import type { QuestionBank } from "../../bank/data/QuestionBank";
import { recordOf } from "../../bank/data/BankRegen";
import { parseQuestionKramdown } from "../../bank/data/BankParse";
import { fallbackQuestionHtml, renderMathWhenVisible } from "../service/ProtyleHost";
import { svgIcon } from "../../ui/FormHtml";
import { esc } from "../../ui/shared";
import { typeKey } from "./CardParts";

/**
 * 自定义块渲染器（思源 3.8.3 `customBlockRenders`，issue #8418）：
 * 块 content = 题库 qid，渲染器从题库取题只读渲染——块纯视图、数据
 * 仍在题库（「题库即唯一内容真相」不动摇），插件不可用/未注册时思源
 * 回退显示原始 qid 文本，配合题库反查不悬空。作答与判分仍走温故页签
 * 主流程（编辑器内交互作答是后续阶段）。
 *
 * 语法（面包屑按钮插入）：
 *   ;;;siyuan-plugin-wengu/question
 *   {qid}
 *   ;;;
 */

/** 块类型名（思源按 `包名/类型` 路由回本插件，注册键用本地类型）。 */
export const QUESTION_BLOCK_TYPE = "question";

export interface QuestionBlockDeps {
    t: (key: string) => string;
    /** 题库（插件 bank() 单例）。 */
    bank(): QuestionBank | undefined;
    /** 打开温故页签刷该题所在题集（index.ts 顶栏按钮同款编排）。 */
    openDoc(docId: string): void;
}

/** 生成自定义块 markdown（面包屑插入与选择弹窗共用）。 */
export function questionBlockMd(pluginName: string, qid: string): string {
    return `;;;${encodeURIComponent(pluginName)}/${QUESTION_BLOCK_TYPE}\n${qid}\n;;;`;
}

/** 渲染器工厂：注册进 plugin.customBlockRenders[QUESTION_BLOCK_TYPE]。 */
export function makeQuestionBlockRender(deps: QuestionBlockDeps) {
    return ({
        element,
        content,
    }: {
        element: HTMLElement;
        content: string;
        setContent: (content: string) => boolean;
    }): void | (() => void) => {
        void renderQuestionBlock(element, content.trim(), deps);
    };
}

/** 异步取题渲染（竞态安全：装载返回时块可能已卸载重渲）。 */
async function renderQuestionBlock(element: HTMLElement, qid: string, deps: QuestionBlockDeps): Promise<void> {
    const t = deps.t;
    element.classList.add("wengu-qblock");
    const bank = deps.bank();
    if (!qid || !bank) {
        element.innerHTML = placeholderHtml(t, qid || "-");
        return;
    }
    const rec = await recordOf(bank, qid);
    if (!element.isConnected) return; // 装载窗口内块被卸载/重渲
    const parsed = rec ? (bank.parsedOf(qid, rec.hash) ?? parseQuestionKramdown(rec.kramdown, qid)) : undefined;
    if (!rec || !parsed) {
        element.innerHTML = placeholderHtml(t, qid);
        return;
    }
    element.innerHTML =
        `<div class="wengu-qblock-head"><span class="wengu-qblock-type">${esc(t(typeKey(parsed.type)))}</span>` +
        `<button class="b3-button b3-button--small wengu-qblock-open" data-doc="${esc(rec.sourceDocId)}">` +
        `${svgIcon("iconWengu")}<span>${esc(t("qblockOpen"))}</span></button></div>` +
        fallbackQuestionHtml(parsed);
    renderMathWhenVisible(element);
    element.querySelector(".wengu-qblock-open")?.addEventListener("click", () => deps.openDoc(rec.sourceDocId));
}

/** 占位（题库未装载/qid 不存在/解析失败同形——数据只读不猜）。 */
function placeholderHtml(t: (key: string) => string, qid: string): string {
    return `<div class="wengu-qblock-missing">${esc(t("qblockMissing"))} <code>${esc(qid)}</code></div>`;
}
