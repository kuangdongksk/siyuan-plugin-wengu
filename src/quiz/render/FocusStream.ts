import type { QuestionTimer } from "../service/QuizTimer";

/**
 * 焦点卡边框流光（Issue #182 R2/R4，设计稿 v6 `14c6f55`）。
 *
 * 生长式引线：已过段恒留（尾端锚在计时起点不动），只有头部沿边框推进；
 * 一圈 60s 走满、进圈从起点重长（圈数另有 chip 记）。几何＝卡框圆角矩形
 * 内缩 0.5px、圆角 11.5px（卡圆角 12px 的中心线）。
 *
 * 为什么不塞进组件：流光要逐帧改 `stroke-dasharray` 与珠子平移，且必须在
 * **判分重绘后仍活着**——它挂在卡片 DOM 的兄弟 overlay 上（卡内重绘不动它），
 * 由本岛按 qid 持有与释放（`dispose` 随卡卸载）。样式在
 * `scss/focus-timer.scss`（共享片，§13.1①：`.wengu-gtx-*` 由本文件拼串）。
 */

/** 一圈 = 60000ms（设计稿 JS 常量 LAP 同值）。 */
export const LAP_MS = 60000;

/** 卡片圆角（= `--b3-border-radius-b` 12px）的中心线半径。 */
const RADIUS = 11.5;

interface Stream {
    gt: HTMLElement;
    svg: SVGSVGElement;
    track: SVGPathElement;
    halo: SVGPathElement;
    head: SVGPathElement;
    mark: SVGGElement;
    pill: SVGRectElement;
    text: SVGTextElement;
    path: string;
    len: number;
    host: HTMLElement;
}

/** 圆角矩形路径（内缩 0.5px，与稿 `rrect(0.5, 0.5, w-1, h-1, 11.5)` 同源）。 */
function rrect(w: number, h: number): string {
    const x = 0.5;
    const y = 0.5;
    const rw = Math.max(0, w - 1);
    const rh = Math.max(0, h - 1);
    const r = Math.min(RADIUS, rw / 2, rh / 2);
    return (
        `M ${x + r} ${y}` +
        ` H ${x + rw - r}` +
        ` A ${r} ${r} 0 0 1 ${x + rw} ${y + r}` +
        ` V ${y + rh - r}` +
        ` A ${r} ${r} 0 0 1 ${x + rw - r} ${y + rh}` +
        ` H ${x + r}` +
        ` A ${r} ${r} 0 0 1 ${x} ${y + rh - r}` +
        ` V ${y + r}` +
        ` A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
    );
}

/** `mm:ss`（与既有头部标签同口径，不引第二份格式化）。 */
function mmss(sec: number): string {
    const s = Math.max(0, Math.floor(sec));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

const ns = "http://www.w3.org/2000/svg";

function el<K extends keyof SVGElementTagNameMap>(tag: K, cls: string): SVGElementTagNameMap[K] {
    const n = document.createElementNS(ns, tag);
    n.setAttribute("class", cls);
    return n;
}

/** 卡片 frame（overlay 宿主）与已建流的表（模块级，组件卸载时释放）。 */
const streams = new Map<string, Stream>();

/** 量卡并把流光谱从当前位置铺好（尺寸变了要重量，否则流光错开边框）。 */
function measure(s: Stream): boolean {
    const w = s.host.clientWidth;
    const h = s.host.clientHeight;
    if (!w || !h) return false;
    s.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    s.path = rrect(w, h);
    for (const p of [s.track, s.halo, s.head]) p.setAttribute("d", s.path);
    s.len = s.head.getTotalLength();
    return s.len > 0;
}

function setLabel(s: Stream, label: string): void {
    if (s.text.textContent === label) return;
    s.text.textContent = label;
    const w = Math.max(34, 15 + label.length * 7.4);
    s.pill.setAttribute("x", (-w / 2).toFixed(1));
    s.pill.setAttribute("width", w.toFixed(1));
}

/** 渲染到「圈内相位」p（0..1）；生长式：画 [0, p] 段，尾端锚在起点。 */
function render(s: Stream, p: number, label: string): void {
    if (!s.len && !measure(s)) return;
    const phase = ((p % 1) + 1) % 1;
    const grew = (phase * s.len).toFixed(2);
    const rest = (s.len - phase * s.len).toFixed(2);
    for (const path of [s.halo, s.head]) {
        path.setAttribute("stroke-dasharray", `${grew} ${rest}`);
        path.setAttribute("stroke-dashoffset", "0");
    }
    const pt = s.head.getPointAtLength(phase * s.len);
    s.mark.setAttribute("transform", `translate(${pt.x.toFixed(2)} ${pt.y.toFixed(2)})`);
    setLabel(s, label);
}

/**
 * 按 qid 建/取一张卡的流光层（`cardEl` 是 `.wengu-card`，overlay 挂它之后）。
 * 返回的 handle 由调用方在卡卸载/换卡时 `dispose`。
 */
export function streamFor(qid: string, cardEl: HTMLElement): StreamHandle {
    const host = cardEl.parentElement ?? cardEl;
    let s = streams.get(qid);
    if (!s || !s.gt.isConnected) {
        const gt = document.createElement("div");
        gt.className = "wengu-gtx";
        gt.dataset.gtx = qid;
        const svg = el("svg", "wengu-gtx-svg") as SVGSVGElement;
        const track = el("path", "wengu-gtx-track");
        const halo = el("path", "wengu-gtx-halo");
        const head = el("path", "wengu-gtx-head");
        const mark = el("g", "wengu-gtx-mark") as SVGGElement;
        const pill = el("rect", "wengu-gtx-pill");
        pill.setAttribute("x", "-18");
        pill.setAttribute("y", "-9");
        pill.setAttribute("width", "36");
        pill.setAttribute("height", "18");
        pill.setAttribute("rx", "9");
        const text = el("text", "wengu-gtx-label");
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("y", "3.6");
        mark.append(pill, text);
        svg.append(track, halo, head, mark);
        gt.appendChild(svg);
        host.appendChild(gt);
        s = { gt, svg, track, halo, head, mark, pill, text, path: "", len: 0, host: cardEl };
        streams.set(qid, s);
    }
    return new StreamHandle(qid, s);
}

/** 单卡的流光句柄（组件持有；卸载时装配 `dispose`）。 */
export class StreamHandle {
    private raf = 0;
    private last = "";
    private lastLap = 0;

    constructor(
        private readonly qid: string,
        private readonly s: Stream
    ) {}

    /** 卡片与 overlay 几何对齐（overlay 是卡的兄弟，绝对定位在卡框上）。 */
    layout(): void {
        const { gt, host } = this.s;
        gt.style.left = `${host.offsetLeft}px`;
        gt.style.top = `${host.offsetTop}px`;
        gt.style.width = `${host.offsetWidth}px`;
        gt.style.height = `${host.offsetHeight}px`;
        this.s.len = 0; // 尺寸变了要重量（否则流光错开边框）
    }

    /** 焦点且未提交 → 亮起并持续走圈；否则熄灭。 */
    setOn(on: boolean): void {
        this.s.gt.classList.toggle("wengu-gtx--on", on);
        if (!on) {
            this.s.gt.classList.remove("wengu-gtx--done");
            this.stop();
        }
    }

    /** R4 提交：定格在当前相位 → 按停格/淡出档淡出，不再回来。 */
    freeze(sec: number): void {
        const ms = sec * 1000;
        this.layout();
        render(this.s, (ms % LAP_MS) / LAP_MS, mmss(sec));
        this.s.gt.classList.remove("wengu-gtx--on");
        this.s.gt.classList.add("wengu-gtx--done");
        this.stop();
    }

    /** 逐帧驱动（`requestAnimationFrame`；每秒只在整秒处改两处读数）。 */
    play(): void {
        this.stop();
        const tick = (): void => {
            const live = this.timer ? this.timer.live() : 0;
            const label = mmss(live / 1000);
            render(this.s, (live % LAP_MS) / LAP_MS, label);
            if (label !== this.last) {
                this.last = label;
                this.onLabel?.(label);
            }
            const lap = Math.floor(live / LAP_MS) + 1;
            if (lap !== this.lastLap) {
                this.lastLap = lap;
                this.onLap?.(lap);
            }
            this.raf = requestAnimationFrame(tick);
        };
        this.raf = requestAnimationFrame(tick);
    }

    stop(): void {
        if (this.raf) cancelAnimationFrame(this.raf);
        this.raf = 0;
    }

    /** 卸载：停帧、摘 overlay、退表（组件 `$effect` 清理调）。 */
    dispose(): void {
        this.stop();
        this.s.gt.remove();
        if (streams.get(this.qid) === this.s) streams.delete(this.qid);
    }

    /** 读数/圈数回调由使用方注入（卡内 chip 与题号栏环共用一份用时）。 */
    timer?: QuestionTimer;
    onLabel?: (label: string) => void;
    onLap?: (lap: number) => void;
    /** 卡片尺寸观察（判分揭示/窗口缩放）。 */
    observe(): void {
        if (typeof ResizeObserver === "undefined") return;
        const ro = new ResizeObserver(() => {
            this.layout();
            render(this.s, 0, this.last || "0:00");
        });
        ro.observe(this.s.host);
        this.ro = ro;
    }
    private ro?: ResizeObserver;
    /** 拆卸尺寸观察（`dispose` 里连带）。 */
    unobserve(): void {
        this.ro?.disconnect();
        this.ro = undefined;
    }
}

/** 模块级清空（整壳重建前调，防 overlay 跟着旧 DOM 残留）。 */
export function disposeAllStreams(): void {
    for (const s of streams.values()) s.gt.remove();
    streams.clear();
}
