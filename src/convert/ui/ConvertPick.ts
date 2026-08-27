import { extractBlockId, getDocInfo } from "../service/ConvertService";
import { openKnowPicker, parseKnowIds } from "../../ui/KnowPicker";

/**
 * 转换弹窗的文档动态联动（从 ConvertDialog 拆出保 ≤500 行）：
 * 选择器按钮（源文档/父文档共用）与知识点多选回显。wengu-pick 值按钮
 * 形态（§〇7）选中值直接进按钮文字（省略号+title 全量），空值还原
 * 占位「选择…」；父文档行仍是输入框+hint 槽回显。
 * fetchSyncPost 须串行——逐个 await。
 */

/** hint 槽写入：text 非空显示之；空则还原初始提示（无提示则隐藏）。 */
function setHint(el: HTMLElement | null, text: string): void {
    if (!el) return;
    if (el.dataset.orig === undefined) el.dataset.orig = el.textContent ?? "";
    if (text) {
        el.textContent = text;
        el.removeAttribute("hidden");
        return;
    }
    el.textContent = el.dataset.orig;
    if (!el.dataset.orig) el.setAttribute("hidden", "");
}

/** wengu-pick 触发按钮值回显：text 非空显示（title 同步全量），空还原占位。 */
export function setPickValue(btn: HTMLButtonElement | null, text: string, placeholder: string): void {
    if (!btn) return;
    btn.textContent = text || placeholder;
    btn.title = text || placeholder;
}

export interface DocLinkOpts {
    t: (key: string) => string;
    input: HTMLInputElement | null;
    btn: HTMLButtonElement | null;
    /** hint 槽回显（父文档行输入框形态用）。 */
    echo?: HTMLElement | null;
    /** 传了则选中值写进按钮自身（wengu-pick 值按钮形态），优先于 echo。 */
    placeholder?: string;
    /** 回显条件（父文档仅「指定」时显示）。 */
    active?: () => boolean;
    /** 选择器回填后回调。 */
    onPick?: () => void;
}

/** 单选联动：按钮开选择器、输入防抖回显标题路径；返回手动重查（条件变化时调）。 */
export function bindDocLink(o: DocLinkOpts): () => void {
    let seq = 0;
    let timer = 0;
    const show = (text: string): void => {
        if (o.placeholder !== undefined) setPickValue(o.btn, text, o.placeholder);
        else setHint(o.echo ?? null, text);
    };
    const resolve = (): void => {
        const raw = extractBlockId((o.input?.value ?? "").trim());
        const cur = ++seq;
        if (!raw || (o.active && !o.active())) {
            show("");
            return;
        }
        void getDocInfo(raw).then((info) => {
            if (cur !== seq) return; // 输入又变了/已重渲染
            show(info?.hPath || o.t("convertTargetNotFound"));
        });
    };
    o.input?.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(resolve, 300);
    });
    o.btn?.addEventListener("click", (ev) => {
        openKnowPicker({
            t: o.t,
            anchor: ev.currentTarget as HTMLElement,
            single: true,
            current: [extractBlockId((o.input?.value ?? "").trim())].filter(Boolean),
            onConfirm: (ids) => {
                if (o.input && ids[0]) {
                    o.input.value = ids[0];
                    resolve();
                    o.onPick?.();
                }
            },
        });
    });
    resolve();
    return resolve;
}

/** 知识点已选文档 → 标题路径串回显到触发按钮（空=占位「选择…」）。 */
export async function echoKnowTitles(
    t: (key: string) => string,
    input: HTMLInputElement | null,
    btn: HTMLButtonElement | null,
    placeholder: string
): Promise<void> {
    if (!btn) return;
    const rawVal = input?.value ?? "";
    const ids = parseKnowIds(rawVal);
    if (!ids.length) {
        setPickValue(btn, "", placeholder);
        return;
    }
    const titles: string[] = [];
    for (const id of ids) {
        const info = await getDocInfo(id);
        titles.push(info?.hPath || info?.title || id);
    }
    if ((input?.value ?? "") !== rawVal) return; // 选择又变了
    setPickValue(btn, titles.join("　"), placeholder);
}
