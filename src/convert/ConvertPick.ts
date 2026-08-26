import { extractBlockId, getDocInfo } from "./ConvertService";
import { openKnowPicker, parseKnowIds } from "../ui/KnowPicker";

/**
 * 转换弹窗的文档动态联动（从 ConvertDialog 拆出保 ≤500 行）：
 * 单选选择器按钮 + 选中文档回显到行的 hint 槽（源文档/父文档共用），
 * 以及知识点多选的已选回显（fetchSyncPost 须串行——逐个 await）。
 * hint 槽显示选中值，清空还原行原有的说明文字。
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

export interface DocLinkOpts {
    t: (key: string) => string;
    input: HTMLInputElement | null;
    btn: HTMLButtonElement | null;
    echo: HTMLElement | null;
    /** 回显条件（父文档仅「指定」时显示）。 */
    active?: () => boolean;
    /** 选择器标题 i18n 键（缺省按单/多选取默认）。 */
    titleKey?: string;
    /** 选择器回填后回调。 */
    onPick?: () => void;
}

/** 单选联动：按钮开选择器、输入防抖回显标题路径；返回手动重查（条件变化时调）。 */
export function bindDocLink(o: DocLinkOpts): () => void {
    let seq = 0;
    let timer = 0;
    const resolve = (): void => {
        const raw = extractBlockId((o.input?.value ?? "").trim());
        const cur = ++seq;
        if (!o.echo) return;
        if (!raw || (o.active && !o.active())) {
            setHint(o.echo, "");
            return;
        }
        void getDocInfo(raw).then((info) => {
            if (cur !== seq || !o.echo) return; // 输入又变了/已重渲染
            setHint(o.echo, info?.hPath || o.t("convertTargetNotFound"));
        });
    };
    o.input?.addEventListener("input", () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(resolve, 300);
    });
    o.btn?.addEventListener("click", () => {
        openKnowPicker({
            t: o.t,
            single: true,
            ...(o.titleKey ? { titleKey: o.titleKey } : {}),
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

/** 知识点已选文档 → 标题路径串回显到 hint 槽（空=还原/隐藏）。 */
export async function echoKnowTitles(
    t: (key: string) => string,
    input: HTMLInputElement | null,
    echo: HTMLElement | null
): Promise<void> {
    if (!echo) return;
    const rawVal = input?.value ?? "";
    const ids = parseKnowIds(rawVal);
    if (!ids.length) {
        setHint(echo, "");
        return;
    }
    const titles: string[] = [];
    for (const id of ids) {
        const info = await getDocInfo(id);
        titles.push(info?.hPath || info?.title || id);
    }
    if ((input?.value ?? "") !== rawVal) return; // 选择又变了
    setHint(echo, titles.join("　"));
}
