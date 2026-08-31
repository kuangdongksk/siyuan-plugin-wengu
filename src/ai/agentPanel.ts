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
 * 「优先在智能体面板开新会话发 prompt（可追问、markdown 渲染），面板
 * 自动化失配时降级页内拉取纯文本」——轮次报告与统计面板的 AI 按钮
 * 共用。文案键由调用方解析传入（loading/空回复/失败前缀）。
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
    out.textContent = opts.loadingText;
    out.removeAttribute("hidden");
    try {
        // 独立会话，页内降级路径（登记进 AI 会话面板，标题取 prompt 前缀）
        const text = await agentChatOnce(opts.prompt, opts.modelId, AI_TIMEOUT.quick, undefined, { kind: "ask" });
        out.textContent = text.trim() || opts.emptyText;
    } catch (e) {
        out.textContent = `${opts.failPrefix}${String((e as Error)?.message ?? e)}`;
    } finally {
        btn.disabled = false;
    }
}
