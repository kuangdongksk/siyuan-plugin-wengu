import type { QuestionBank } from "../../bank/data/QuestionBank";
import { peekSetTypeUnion, setTypeUnion } from "../../bank/data/BankSets";
import { isEnglishTypes } from "../flow/AnnoScope";
import type { WenguQuestion } from "../../types";

/**
 * 卷级英语判定的**同步取用层 + 按卷缓存**（Issue #45，自 QuizView 拆出压
 * 500 行红线）：文档/题表可变，判定结果按「题集 id」缓存——selectionchange
 * 是高频回调，浮条要**当场**决定「标生词」出不出现，绝不能在那里 await
 * 题集题型并集。
 *
 * 反查链：选区起点所在卡（`data-qid`）→ 该题 rootId（= 源题集 id）→
 * 该卷题型并集含英语四类任一。**任何一环反查不到即 false**（宁缺勿错：
 * 放行标生词比误出更坏）。聚合「全部习题」混合刷天然按各卡各判。
 */

/** 判定宿主（QuizView 以自身实现：题表 + 题库）。 */
export interface AnnoScopeHost {
    questions(): WenguQuestion[];
    bankStore(): QuestionBank | undefined;
}

/** 每视图一份的判定控制器（缓存随题表/题集变更清空）。 */
export class AnnoScopeCtl {
    /** 题集 id → 是否英语卷。 */
    private readonly cache = new Map<string, boolean>();

    constructor(private readonly host: AnnoScopeHost) {}

    /** 题表/题集变更（装载、切题集、切模式、增量补生成后）作废旧判定。 */
    invalidate(): void {
        this.cache.clear();
    }

    /** 选区起点元素所在卷是否英语卷（false = 反查失败或非英语，均不放行）。 */
    englishAt(anchorEl: HTMLElement | null): boolean {
        const qid = anchorEl?.closest<HTMLElement>(".wengu-card")?.dataset.qid;
        const q = qid ? this.host.questions().find((x) => x.id === qid) : undefined;
        const setId = q?.rootId ?? "";
        if (!setId) return false;
        const cached = this.cache.get(setId);
        if (cached !== undefined) return cached;
        const bank = this.host.bankStore();
        if (!bank) return false;
        // 同步路径只**窥视**已装载数据（选段回调不能 await）：题库已装载
        // 即当场判定并落缓存；未装载时先按否收口（本次不放行）并起一次
        // 异步补正——下一次 selectionchange 就有正确结果（题表装载通常
        // 先于用户选段，这条只为时序死角）
        if (bank.peek()) {
            const english = isEnglishTypes(peekSetTypeUnion(bank, setId));
            this.cache.set(setId, english);
            return english;
        }
        void setTypeUnion(bank, setId).then((types) => this.cache.set(setId, isEnglishTypes(types)));
        return false;
    }
}
