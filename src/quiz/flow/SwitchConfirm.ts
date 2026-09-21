import { openWenguDialog, dialogIconHtml, type WenguDialogAction } from "../../ui/Dialog";
import { esc, fmt, mmss } from "../../ui/shared";
import type { WenguSession } from "../service/HistoryStore";

/**
 * 切换题集二次确认弹窗（Issue #137 / 差距清单 §7.d + 设计稿
 * `design/UI/刷题/wengu-sidebar-redesign.html` §5）。
 *
 * **触发判据**（三条同时成立，判定收口在 {@link needsSwitchConfirm}）：
 *   ① 刷题模式（review 点文档只是筛选错题本、preview 只读，都不该拦）；
 *   ② 点击的是**另一**个上下文（同一行早退在最前面——见函数内注释）；
 *   ③ 当前有**进行中轮次**：`session && !session.endedAt && answered > 0`
 *      ——判据与开刷面板「未完成轮」同源（endedAt 才收卷），`answered > 0`
 *      防空轮骚扰（刚翻开、一题没答时切走不该弹）。
 *
 * **落点**：侧栏两路入口（树内 `onOpenDoc` / 专题与聚合行 `onOpenCollection`）
 * 在**视图层**汇闸——组件层没有会话知识。确认后才执行调用方的切换动作。
 *
 * **主钮论证**（§7.d，改文案/位序前先读）：主钮（右起第一）= 「留在本卷」
 * ——拦截的存在理由是防误中断，主钮承载安全默认；「继续切换」不可逆
 * （中断计时与卷内视口），故放次钮抬高点击成本。**Esc / 点遮罩 = 留在
 * 本卷**（b3-dialog 默认即纯关闭，贴合安全默认，无需另挂手势）。
 */

/** 判定输入：视图在点击那一刻的**最小快照**（不持视图引用，纯函数可测）。 */
export interface SwitchGuard {
    /** 当前模式（`QuizView.mode`）。 */
    mode: string;
    /** 当前会话（`QuizView.currentSession()`）。 */
    session?: WenguSession;
    /** 点击目标的上下文标识（docId 或 `col:<id>`）；与 currentId 相同即早退。 */
    targetId: string;
    /** 当前上下文标识（`QuizView.docIdOf()`）。 */
    currentId: string;
}

/** 是否需要在切换前弹二次确认（判据见文件头）。 */
export function needsSwitchConfirm(g: SwitchGuard): boolean {
    // 同 id 早退**在最前**：点当前已选中行在任何模式下都无上下文损失
    if (!g.targetId || g.targetId === g.currentId) return false;
    if (g.mode !== "quiz") return false; // 复习筛选 / 预览只读都不拦
    const s = g.session;
    return !!s && !s.endedAt && s.answered > 0;
}

/** 确认弹窗的取词（调用方喂 QuizView.t）。 */
export interface SwitchConfirmDeps {
    t(key: string): string;
    /** 目标上下文名（专题/聚合/文档标题；由调用方解析，弹窗不查库）。 */
    targetName: string;
    /** 进行中会话快照（answered / 范围题数 / 用时）。 */
    session: WenguSession;
    /** 本卷题数（进度实况的分母）。 */
    total: number;
    /** 用户点了「继续切换」。**唯一**会真的切上下文的分支。 */
    onGo(): void;
    /** 「留在本卷」的钩子（安全默认）。可省——关闭弹窗本身即无副作用：
     *  切换动作只挂在 `onGo` 上，故 Esc/遮罩/关闭钮天然等于「留在本卷」。 */
    onStay?(): void;
}

/** 正文：进度实况（已答 n/N、计时）+ 目标名。文案键 `switchConfirmBody`
 *  带 `{n}`/`{N}`/`{time}`/`{name}` 四占位（中英同集，字典门禁守）。
 *
 *  ⚠️ 目标名**单独成 span**（稿「缺失形态」：超长目标名在正文内省略 +
 *  `title` 保全名）——先整体 fmt 再包 span 等于往可变文案里塞结构，
 *  翻译一改就散；故先把 `{name}` 换成哨兵占位、按它切段转义后再插回。 */
function bodyText(t: (k: string) => string, d: SwitchConfirmDeps): string {
    const raw = t("switchConfirmBody");
    const merged = fmt(raw, {
        n: String(d.session.answered),
        N: String(d.total),
        time: mmss(d.session.elapsedSec),
        name: PLACEHOLDER,
    });
    return merged
        .split(PLACEHOLDER)
        .map((seg) => esc(seg))
        .join(`<span class="wengu-switch-name">${esc(d.targetName)}</span>`);
}

/** 目标名占位符：模板里的 `{name}` 先落成它，切段后逐段 `esc`（哨兵串
 *  用 NUL 包夹——正文译文里不可能出现，`{n}` 是 `{name}` 前缀也不会误切）。 */
const PLACEHOLDER = "\u0000wengu-switch-name\u0000";

/** 打开二次确认弹窗：它是「先问再切」的闸——调用方只在 `onGo` 里执行
 *  真正的切换动作。 */
export function openSwitchConfirm(d: SwitchConfirmDeps): void {
    const { t } = d;
    const actions: WenguDialogAction[] = [
        { id: "sw-go", label: t("switchConfirmGo"), variant: "outline" },
        // 右起第一 = 唯一主操作（规范 §2.2；位序即语义，勿调换）
        { id: "sw-stay", label: t("switchConfirmStay"), variant: "primary" },
    ];
    const { root, destroy } = openWenguDialog({
        title: t("switchConfirmTitle"),
        width: "sm", // §5.1 收敛档：min(480px, calc(100vw - 32px))
        extraCls: "wengu-switch-confirm",
        body: `${dialogIconHtml("iconInfo")}
      <div class="wengu-switch-body">${bodyText(t, d)}</div>`,
        actions,
    });
    const stay = (): void => {
        destroy();
        d.onStay?.();
    };
    // 超长目标名在正文内省略（稿件明列的「缺失形态」），全名挂 title 保真
    const nameEl = root.querySelector<HTMLElement>(".wengu-switch-name");
    if (nameEl) nameEl.title = d.targetName;
    root.querySelector("[data-act='sw-go']")?.addEventListener("click", () => {
        destroy();
        d.onGo();
    });
    root.querySelector("[data-act='sw-stay']")?.addEventListener("click", stay);
    // ⚠️ Esc / 点遮罩 / 右上角关闭 = b3-dialog 的默认关闭路径（不经过任何
    // 按钮回调）——**不需要**额外挂事件兜底：切换动作只挂在 `sw-go` 的
    // 回调上，弹窗一关就是「什么都没发生」＝留在本卷，安全默认由构造成立。
    // （上一版挂的 `dialog.element` 上的 "destroy" 事件在思源 `Dialog`
    // 里无任何依据——`siyuan.d.ts` 无此事件、全仓也只此一处用过——属凭空
    // 发明的事件名，一旦宿主改实现就静默失效；它想兜的语义本来就已成立。）
}
