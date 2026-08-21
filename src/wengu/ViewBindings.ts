/**
 * 视图通用事件绑定（从 QuizView 拆出）：头部按钮（刷新/转换/设置/
 * 目录开合）与目录文档项点击。题号、开刷面板、卡片事件在各自模块。
 */
export interface ViewBindCtx {
    el: HTMLElement;
    reload(): void;
    openConvert(): void;
    openSettings?(): void;
    /** 收起/展开目录（含持久化与重渲染）。 */
    toggleSide(collapsed: boolean): void;
    /** 反映转换中状态到目录底部按钮。 */
    updateConvertBtn(): void;
    /** 切换刷题文档（结算旧文档用时）。 */
    switchDoc(docId: string): void;
}

export function bindViewEvents(ctx: ViewBindCtx): void {
    const q = (sel: string) => ctx.el.querySelector(sel);
    q("[data-act='refresh']")?.addEventListener("click", () => ctx.reload());
    ctx.updateConvertBtn();
    q("[data-act='convert']")?.addEventListener("click", () => ctx.openConvert());
    q("[data-act='settings']")?.addEventListener("click", () => ctx.openSettings?.());
    q("[data-act='side-toggle']")?.addEventListener("click", () => ctx.toggleSide(false));
    q("[data-act='side-fold']")?.addEventListener("click", () => ctx.toggleSide(true));
    for (const node of ctx.el.querySelectorAll<HTMLElement>("[data-docid]")) {
        node.addEventListener("click", () => ctx.switchDoc(node.dataset.docid ?? ""));
    }
}
