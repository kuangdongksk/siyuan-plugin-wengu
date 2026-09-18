import { esc, errText } from "./../ui/shared";
import { renderMdHtml } from "../ui/MdRender";
import { agentChatOnce } from "./client";
import { AI_TIMEOUT } from "./timeouts";

/**
 * 思源内置智能体面板的 DOM 自动化（2026-08-27 从 quiz/RoundReport 抽离，
 * stats 原跨域借用）＋「面板优先、页内降级」的按钮运行帮手。
 */

/**
 * 打开思源内置智能体面板、开新会话并填入 prompt 发送。DOM 自动化
 * （插件 API 无官方入口，选择器按 3.8.0 真机 dump 校准）；任何一步
 * 失配都返回 false，调用方降级页内分析。
 */
export async function openAgentWithPrompt(prompt: string, marker = "你是刷题"): Promise<boolean> {
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const visible = (): HTMLElement | null => {
        for (const el of document.querySelectorAll<HTMLElement>(".agent-chat")) {
            if (el.offsetHeight > 0) return el;
        }
        return null;
    };
    try {
        let panel = visible();
        if (!panel) {
            const dockItem = document.querySelector<HTMLElement>('.dock__item[data-type="agentChat"]');
            if (!dockItem) return false;
            dockItem.click(); // 单击展开（再点是最小化，仅在不可见时点）
            await sleep(400);
            panel = visible();
        }
        if (!panel) return false;
        panel.querySelector<HTMLElement>('[data-type="new-session"]')?.click(); // 新会话
        const wysiwyg = panel.querySelector<HTMLElement>(".agent-chat__composer-host .protyle-wysiwyg");
        const send = panel.querySelector<HTMLButtonElement>(".agent-chat__send");
        if (!wysiwyg || !send) return false;
        wysiwyg.focus();
        // 以纯文本粘贴喂给 Protyle（自带粘贴解析；execCommand 不处理多行）
        const dt = new DataTransfer();
        dt.setData("text/plain", prompt);
        wysiwyg.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
        await sleep(150);
        // 粘贴校验：marker 取 prompt 的稳定前缀（判卷/统计两类调用方共用
        // 「你是刷题」；写死完整角色名曾与调用方措辞漂移导致恒 false——
        // 20260828 审查，每次点击都留下未发送粘贴+空会话后误降级）
        if (!wysiwyg.textContent?.includes(marker)) return false; // 未粘上
        send.click();
        return true;
    } catch (_) {
        return false;
    }
}

/**
 * 页内输出区的一次形态渲染（Issue #177）：**AI 正文走 markdown，加载/
 * 空回复/失败文案走纯文本**。
 *
 * 纯函数（只依赖入参与 renderMdHtml），无 DOM 依赖 ⇒ 单测环境（node、
 * 无 jsdom）可直接断言 —— 这也是把「html 还是文本」的判断从组件/API
 * 副作用里拆出来单独锁死的原因。
 *
 * ⚠️ **纯文本一路必须 esc 后再换行转 `<br>`**：改成 innerHTML 后
 * `errText(e)` 的宿主原文（可能含 `<`）会当 HTML 解掉；且 pre-wrap 已随
 * markdown 渲染退役（容器里再 pre-wrap 会把渲染产物的换行双倍撑开），
 * 纯文本的换行必须显式补 `<br>`，否则多行错误信息挤成一行。
 */
export function renderAiTextHtml(kind: "loading" | "empty" | "fail" | "body", text: string): string {
    return kind === "body" ? renderMdHtml(text) : esc(text).replace(/\n/g, "<br>");
}

/**
 * 「优先在智能体面板开新会话发 prompt（可追问、markdown 渲染），面板
 * 自动化失配时降级页内拉取、同样按 markdown 渲染」——轮次报告与统计
 * 面板的 AI 按钮共用。文案键由调用方解析传入（loading/空回复/失败前缀）。
 *
 * 输出形态自 Issue #177 起统一：`out.innerHTML = renderAiTextHtml(...)`
 * （此前 `textContent` ⇒ AI 散文里 `**总评**:` 字面星号裸奔、列表挤成一段）。
 * md 渲染产物含 `div.p`/列表等标准标签，容器侧基线样式在共享片
 * `scss/ai-md.scss`（design-spec §13.3 登记）。
 * 公式（数学卷解析里的 `$…$`）MdRender 已出思源同款占位，KaTeX 补渲需要
 * 内核 ProtyleMethod，本通道（页内降级、跨域共享）不接 —— 登记说明。
 */
export async function runAgentTextOrPanel(opts: {
    prompt: string;
    btn: HTMLButtonElement;
    out: HTMLElement;
    modelId: string;
    loadingText: string;
    emptyText: string;
    failPrefix: string;
}): Promise<void> {
    if (await openAgentWithPrompt(opts.prompt)) return;
    const { btn, out } = opts;
    btn.disabled = true;
    out.innerHTML = renderAiTextHtml("loading", opts.loadingText);
    out.removeAttribute("hidden");
    try {
        // 独立会话，页内降级路径（登记进 AI 会话面板，标题取 prompt 前缀）
        const text = await agentChatOnce(opts.prompt, opts.modelId, AI_TIMEOUT.quick, undefined, { kind: "ask" });
        const body = text.trim();
        out.innerHTML = body ? renderAiTextHtml("body", body) : renderAiTextHtml("empty", opts.emptyText);
    } catch (e) {
        out.innerHTML = renderAiTextHtml("fail", `${opts.failPrefix}${errText(e)}`);
    } finally {
        btn.disabled = false;
    }
}
