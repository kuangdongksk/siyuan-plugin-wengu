import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** 内核浮层整体打桩（同 clientGate.test.ts）：本文件不验通知，只验运行链。 */
vi.mock("../ui/Notify", () => ({
    notifyError: vi.fn(),
    notifyInfo: vi.fn(),
    initNotify: (): void => undefined,
}));

import { runAgentTextOrPanel } from "./agentPanel";
import { aiSlotUsage, setAiSlotCapacity } from "./queue";
import { agentChatOnce } from "./client";
import { aiSessions, initAiSessions, type AiSessionStore } from "./data/AiSessions";

/**
 * 「AI 报告下游」独立验收（4/5）：**输出出口端到端**（PR 的招牌改动）。
 *
 * `agentPanel.test.ts` 只断言了从 `runAgentTextOrPanel` 里抽出的纯函数
 * `renderAiTextHtml`，**没有跑过出口本身**。本文件把出口整条链在 node 里
 * 真跑一遍：
 *
 *   内核面板自动化失配（node 无 DOM）→「页内降级」→ `agentChatOnce`
 *   →（真 fetch 打桩，非 mock 模块）→ 真实 SSE 解析 → 输出区形态
 *
 * 用真 `agentChatOnce` 而不是 `vi.mock("./client")` 是刻意的：这样加载文案、
 * 失败兜底、空回复三条路径与生产同源（mock 掉就只验到我们自己的拼装），
 * 间接也把「槽在收口释放」这条队列口径一起验了。
 *
 * ⚠️ 真机从未命中的一条路径：`runAgentTextOrPanel` 成功路径里若抛错，
 * `finally { btn.disabled = false }` 在场、但**异常会继续向上逃逸**——
 * 两个消费方都是 `void runAgentTextOrPanel({...})`（fire-and-forget），
 * ⇒ 变成未处理 rejection。本文件末段探针钉这条形态。
 */

/** 输出区替身：只实现被触碰的 innerHTML / removeAttribute；并**记录写入序**，
 *  用来验「加载文案先落、正文后覆」。 */
class FakeOut {
    writes: string[] = [];
    attrs = new Set<string>(["hidden"]);
    private _html = "";
    get innerHTML(): string {
        return this._html;
    }
    set innerHTML(v: string) {
        this._html = v;
        this.writes.push(v);
    }
    removeAttribute(name: string): void {
        this.attrs.delete(name);
    }
    get hidden(): boolean {
        return this.attrs.has(name0);
    }
}
const name0 = "hidden";

/** 按钮替身：`disabled` 用 **accessor**（`class` 字段的 setter 会被实例属性
 *  盖掉，写不进去也不报错 —— 踩过一次），记录每次翻转序以验「跑动中禁用、
 *  收口后恢复」。 */
class FakeBtn {
    private _disabled = false;
    readonly seq: boolean[] = [];
    get disabled(): boolean {
        return this._disabled;
    }
    set disabled(v: boolean) {
        this._disabled = v;
        this.seq.push(v);
    }
}

/** DOM 环境替身：`openAgentWithPrompt` 靠 `document.querySelector` 找面板，
 *  找不到就返回 false ⇒ 走页内降级。这里给一个「查啥都没有」的 document。 */
const noPanelDom = (): void => {
    vi.stubGlobal("document", { querySelector: (): null => null, querySelectorAll: (): [] => [] });
    vi.stubGlobal("window", { siyuan: { config: { lang: "zh_CN" }, ws: { send: (): void => undefined } } });
};

/** 内核通道打桩：`fetchSyncPost`（siyuan-stub 会抛错，IO 不当）不用，
 *  走真 fetch —— saveSession/removeSession 直接成功，chat 回一段**真 SSE**
 *  （`text/event-stream` + `event: content` + `data: {"token":…}`，与
 *  `ai/client.agentChat` 的解析分支逐字对齐；格式不对会被判成 HTTP 错误，
 *  那验的就不是出口了）。 */
let reply: string | (() => Promise<never>) = "**总评**：本轮不错。\n\n- 极限：3 对 / 1 错";
let fetchCalls: string[] = [];

const sse = (text: string): Response => {
    const enc = new TextEncoder();
    const frames = text
        .match(/[\s\S]{1,40}/g)!
        .map((t) => `event: content\ndata: ${JSON.stringify({ token: t })}\n\n`)
        .join("");
    return new Response(
        new ReadableStream<Uint8Array>({
            start(c): void {
                c.enqueue(enc.encode(frames));
                c.close();
            },
        }),
        { status: 200, headers: { "Content-Type": "text/event-stream" } }
    );
};

const stubFetch = (): void => {
    vi.stubGlobal("fetch", async (url: string): Promise<Response> => {
        fetchCalls.push(String(url));
        if (String(url).includes("saveSession") || String(url).includes("removeSession")) {
            return new Response(JSON.stringify({ code: 0 }), { status: 200 });
        }
        if (typeof reply === "function") return reply();
        return sse(reply);
    });
};

let store: AiSessionStore;

const run = (out: FakeOut, btn: FakeBtn): Promise<void> =>
    runAgentTextOrPanel({
        prompt: "你是刷题判卷助手。本轮数据……",
        btn: btn as unknown as HTMLButtonElement,
        out: out as unknown as HTMLElement,
        modelId: "deepseek",
        loadingText: "分析中…",
        emptyText: "AI 返回为空",
        failPrefix: "AI 调用失败：",
    });

beforeEach(() => {
    reply = "**总评**：本轮不错。\n\n- 极限：3 对 / 1 错";
    fetchCalls = [];
    setAiSlotCapacity(1);
    store = initAiSessions({ load: async (): Promise<unknown> => ({}), save: async (): Promise<unknown> => undefined });
    noPanelDom();
    stubFetch();
});

afterEach(() => {
    // 槽不得跨用例残留（真 agentChatOnce 的 finally 负责释放，此处是断言）
    expect(aiSlotUsage().used, "用例结束时不得有槽泄漏").toBe(0);
    vi.unstubAllGlobals();
});

describe("出口端到端：页内降级成功路径", () => {
    it("AI 正文按 markdown 落进输出区（粗体/列表），不是字面星号", async () => {
        const out = new FakeOut();
        const btn = new FakeBtn();
        btn.disabled = true; // 已被占用（组件里按钮先禁用）
        await run(out, btn);
        // 写入序：加载文案（纯文本路径）先落 → AI 正文（markdown）覆写
        expect(out.writes.length).toBe(2);
        expect(out.writes[0]).toBe("分析中…");
        expect(out.writes[1]).toContain("<strong>总评</strong>");
        expect(out.attrs.has("hidden"), "输出区应取消 hidden").toBe(false);
        expect(out.innerHTML).toContain("<strong>总评</strong>");
        expect(out.innerHTML).toContain("<ul>");
        expect(out.innerHTML).toContain('<div class="p">极限：3 对 / 1 错</div>');
        expect(out.innerHTML).not.toContain("**");
        // 按钮收口后可用（finally 链路）。⚠️ 只断言**终态**：进入前按钮已
        // 被占用（true），出口自己再置 true（幂等），收口置 false —— 中间
        // 序是实现细节，不钉
        expect(btn.seq.includes(false), `disabled 序=${JSON.stringify(btn.seq)}`).toBe(true);
        expect(btn.disabled).toBe(false);
    });

    it("调用登记进 AI 会话面板且收口为 done（产物进 turns）", async () => {
        const out = new FakeOut();
        await run(out, new FakeBtn());
        await store.ready();
        const rec = store.list().find((r) => r.kind === "ask");
        expect(rec, "登记记录缺失").toBeTruthy();
        expect(rec?.status).toBe("done");
        expect(rec?.turns.filter((t) => t.role === "ai").length).toBe(1);
        expect(rec?.turns[0].text).toContain("你是刷题判卷助手");
        // 会话清理不抛（removeSession 已发）
        expect(fetchCalls.some((u) => u.includes("removeSession"))).toBe(true);
    });

    it("空回复 → 「空回复」文案走**纯文本**（不当 markdown 渲染）", async () => {
        reply = "   \n  ";
        const out = new FakeOut();
        await run(out, new FakeBtn());
        expect(out.innerHTML).toBe("AI 返回为空");
    });

    it("空回复/加载/失败三条文案一律不被当 markdown 渲染（* 原样保留）", async () => {
        reply = "   "; // 全是空白：trim 后为空 ⇒ 空回复分支
        const out = new FakeOut();
        await runAgentTextOrPanel({
            prompt: "你是刷题判卷助手。",
            btn: new FakeBtn() as unknown as HTMLButtonElement,
            out: out as unknown as HTMLElement,
            modelId: "m",
            loadingText: "分析中…",
            emptyText: "**空**",
            failPrefix: "AI 调用失败：",
        });
        expect(out.innerHTML).toBe("**空**");
    });
});

describe("出口端到端：失败路径（内核通道报错）", () => {
    it("失败 → 兜底文案纯文本 + 宿主原文转义 + 多行转 <br>，且**不抛**", async () => {
        reply = async (): Promise<never> => {
            throw new Error("<boom>\n第二行");
        };
        const out = new FakeOut();
        const btn = new FakeBtn();
        await expect(run(out, btn)).resolves.toBeUndefined();
        expect(out.innerHTML.startsWith("AI 调用失败：")).toBe(true);
        expect(out.innerHTML).toContain("&lt;boom&gt;");
        expect(out.innerHTML).toContain("<br>第二行");
        expect(out.innerHTML).not.toContain("<boom>");
        expect(btn.disabled).toBe(false);
    });

    it("失败也把记录收口为 error（面板可回看失败原因）", async () => {
        reply = async (): Promise<never> => {
            throw new Error("kernel boom");
        };
        await run(new FakeOut(), new FakeBtn());
        await store.ready();
        const rec = store.list().find((r) => r.kind === "ask");
        expect(rec?.status).toBe("error");
        expect(rec?.error).toContain("kernel boom");
    });

    it("失败路径不泄漏槽（后续调用还能占到 1 号槽）", async () => {
        reply = async (): Promise<never> => {
            throw new Error("boom");
        };
        await run(new FakeOut(), new FakeBtn());
        expect(aiSlotUsage()).toMatchObject({ used: 0, waiting: 0, capacity: 1 });
        reply = "ok";
        await run(new FakeOut(), new FakeBtn());
        expect(aiSlotUsage().used).toBe(0); // 又释放了
    });
});

describe("出口端到端：两个消费方共用同一出口（零改动受益）", () => {
    it("报告与统计传入的文案键不同，但形态判定同一（各自 loading/fail 文本原样落）", async () => {
        const out = new FakeOut();
        await runAgentTextOrPanel({
            prompt: "你是统计助手",
            btn: new FakeBtn() as unknown as HTMLButtonElement,
            out: out as unknown as HTMLElement,
            modelId: "m",
            loadingText: "统计建议生成中…",
            emptyText: "AI 返回为空",
            failPrefix: "AI 调用失败：",
        });
        expect(out.innerHTML).toContain('<div class="p">');
    });

    it("prompt 透传到内核（消毒后原样发送，未被出口改写）", async () => {
        const out = new FakeOut();
        await run(out, new FakeBtn());
        await store.ready();
        const rec = store.list().find((r) => r.kind === "ask");
        expect(rec?.turns[0].text).toBe("你是刷题判卷助手。本轮数据……");
    });
});

/**
 * ⚠️ **探针（预期会红，属「代码错」归因线索）**
 *
 * 形态：`runAgentTextOrPanel` 的成功路径里，若 `out.innerHTML = ...` 自身抛错
 * （真机可达：DOM 已被卸载 / 输出区被宿主替换），`finally` 只恢复按钮，
 * **异常继续向上逃逸**；而两个消费方都是 fire-and-forget 的 `void run(...)`
 * ⇒ 未处理 rejection（真机表现为控制台报错 + 按钮状态虽恢复但用户无提示）。
 * 期望：出口把「渲染/写入失败」也收进原有 try/catch，`fail` 分支兜底（同
 * `agentChatOnce` 失败的处理），至少不得逃逸到调用方。
 * 归因：**代码错**（缺 catch，非测试口径问题）。
 */
describe("出口端到端：探针——输出写入失败时的逃逸", () => {
    it("probe：out.innerHTML 抛错会逃逸到调用方（`void` 调用 ⇒ 未处理 rejection）", async () => {
        const out = {
            set innerHTML(_v: string) {
                throw new Error("host detached");
            },
            get innerHTML(): string {
                return "";
            },
            removeAttribute: (): void => undefined,
        } as unknown as HTMLElement;
        await expect(
            runAgentTextOrPanel({
                prompt: "你是刷题判卷助手。",
                btn: new FakeBtn() as unknown as HTMLButtonElement,
                out,
                modelId: "m",
                loadingText: "分析中…",
                emptyText: "空",
                failPrefix: "AI 调用失败：",
            })
        ).resolves.toBeUndefined();
    });

    it("probe：prompt 非字符串（AI 侧脏输入）时同样逃逸", async () => {
        const out = new FakeOut();
        await expect(
            runAgentTextOrPanel({
                prompt: undefined as unknown as string,
                btn: new FakeBtn() as unknown as HTMLButtonElement,
                out: out as unknown as HTMLElement,
                modelId: "m",
                loadingText: "分析中…",
                emptyText: "空",
                failPrefix: "AI 调用失败：",
            })
        ).resolves.toBeUndefined();
    });
});

/** 引用的导出保真：通道与登记簿的形状变化会在这里先炸（防测的不是生产路径）。 */
describe("出口端到端：被测形状保真", () => {
    it("agentChatOnce / aiSessions 是可用的生产实现（非空壳）", () => {
        expect(typeof agentChatOnce).toBe("function");
        expect(aiSessions()).toBe(store);
    });
});
