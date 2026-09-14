import type { QuestionBank } from "../../bank/data/QuestionBank";
import { peekSetSubject, peekSetTypeUnion, setTypeUnion } from "../../bank/data/BankSets";
import { annoOwnerQid, isEnglishScope } from "../flow/AnnoScope";
import type { WenguQuestion } from "../../types";

/**
 * 卷级英语判定的**同步取用层 + 按卷缓存**（Issue #45，自 QuizView 拆出压
 * 500 行红线）：文档/题表可变，判定结果按「题集 id」缓存——selectionchange
 * 是高频回调，浮条要**当场**决定「标生词」出不出现，绝不能在那里 await
 * 题集题型并集。
 *
 * 反查链：选段所在卡（`data-qid`；组题材料面板按组内卡，见 annoOwnerQid）
 * → 该题 rootId（= 源题集 id）→ 该卷是否英语卷（Issue #83 两级口径
 * `isEnglishScope`：**有学科以学科为准、无学科回退题型并集**）。**任何
 * 一环反查不到即 false**（宁缺勿错：放行标生词比误出更坏）。聚合「全部
 * 习题」混合刷天然按各卡各判（本控制器按 setId 缓存即为此）。
 *
 * ⚠️ **只服务「标生词」这一个语言专属功能**：阅读面/题卡间距阶梯看**材料
 * 组结构**、全学科一致（`flow/ReadingScope`），**不经过本控制器**——两者
 * 曾经同源是 #81 修错方向的产物（#83 已切分）。
 */

/** 判定宿主（QuizView 以自身实现：题表 + 题库）。 */
export interface AnnoScopeHost {
    questions(): WenguQuestion[];
    bankStore(): QuestionBank | undefined;
}

/**
 * 组题材料面板（`.wengu-gmat`/`[data-mprotyle]`）的归属卡 qid（Issue #45）：
 * 材料面板是 `.wengu-gqs` 的**兄弟**、不在任何 `.wengu-card` 里，英语阅读/
 * 完形的正文正好落在那里——只认 `.wengu-card` 会让整片正文区判不出英语卷
 * （「标生词」消失）。
 *
 * 取组内**当前显示**的那张卡（`.wengu-card:not([hidden])`，与 MaterialFlow
 * 的可见卡口径同源）；DOM 未落定时回退组内首卡——同一组单元的卡必同源
 * 题集（材料 id 是题集内实体，见 SetWriter），卷级判定结果一致，不构成
 * 猜测。非组单元返回 undefined（调用方按反查失败收口）。
 */
function groupCardQid(el: HTMLElement | null): string | undefined {
    const unit = el?.closest<HTMLElement>(".wengu-gunit");
    if (!unit) return undefined;
    const card =
        unit.querySelector<HTMLElement>(".wengu-gqs .wengu-card:not([hidden])") ??
        unit.querySelector<HTMLElement>(".wengu-gqs .wengu-card");
    return card?.dataset.qid;
}

/** 每视图一份的判定控制器（缓存随题表/题集变更清空）。 */
export class AnnoScopeCtl {
    /** 题集 id → 是否英语卷。 */
    private readonly cache = new Map<string, boolean>();
    /** 缓存代数：`invalidate()` 自增，异步补正回来时对不上就丢弃
     *  （旧世代的判定不许写回新世代的缓存）。 */
    private gen = 0;

    constructor(private readonly host: AnnoScopeHost) {}

    /** 题表/题集变更（装载、切题集、切模式、增量补生成后）作废旧判定。 */
    invalidate(): void {
        this.gen++;
        this.cache.clear();
    }

    /** 选区起点所在卷是否英语卷（false = 反查失败或非英语，均不放行）。 */
    englishAt(anchorEl: HTMLElement | null): boolean {
        const qid = annoOwnerQid({
            cardQid: anchorEl?.closest<HTMLElement>(".wengu-card")?.dataset.qid,
            groupQid: groupCardQid(anchorEl),
        });
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
            const english = isEnglishScope(peekSetSubject(bank, setId), peekSetTypeUnion(bank, setId));
            this.cache.set(setId, english);
            return english;
        }
        const gen = this.gen;
        // 异步补正（题库整体未装载的时序死角）：题型并集要 await 查库，
        // 学科则先窥视一次（peek 为空即 undefined，按「无学科」走回退腿）
        const subject = peekSetSubject(bank, setId);
        void setTypeUnion(bank, setId).then((types) => {
            // 已换卷/切模式的旧世代结果丢弃
            if (gen === this.gen) this.cache.set(setId, isEnglishScope(subject, types));
        });
        return false;
    }
}
