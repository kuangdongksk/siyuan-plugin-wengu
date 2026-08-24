import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import * as echarts from "echarts/core";
import type { EChartsCoreOption, EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { WenguSession } from "./HistoryStore";
import type { RoundTrendItem } from "./StatsService";
import { mmss } from "./ui";

/**
 * 统计图表层：插件自带按需 echarts（echarts/core 注册最小集），
 * 不用 window.echarts——官方未向插件开放（issue #8516 关闭未采纳）。
 * option 组装为纯函数；实例生命周期（init/dispose/resize）由
 * StatsChartHost 统一管理，浮层关闭时必须 dispose 防泄漏。
 */

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer]);

type T = (k: string) => string;

/** 读思源 CSS 变量（打开面板时取一次，跟随明暗主题）。 */
function cssVar(name: string, fallback: string): string {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

function dateLabel(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(
        d.getHours()
    ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** 近 N 轮正确率趋势（总览页）：折线，y=%。 */
export function trendOption(items: RoundTrendItem[], t: T): EChartsCoreOption {
    const primary = cssVar("--b3-theme-primary", "#3575f0");
    const muted = cssVar("--b3-theme-on-surface", "#888888");
    return {
        grid: { left: 8, right: 16, top: 24, bottom: 24, containLabel: true },
        tooltip: {
            trigger: "axis",
            formatter: (ps: unknown) => {
                const p = (ps as { dataIndex?: number }[])[0];
                const it = items[p?.dataIndex ?? 0];
                if (!it) return "";
                return `${t("statsRoundN").replace("{n}", String(it.n))}<br/>${t("statsCorrectOf")
                    .replace("{c}", String(it.correct))
                    .replace(
                        "{a}",
                        String(it.answered)
                    )} · ${Math.round(it.rate * 100)}%<br/>${dateLabel(it.startedAt)}`;
            },
        },
        xAxis: {
            type: "category",
            data: items.map((it) => String(it.n)),
            axisLabel: { color: muted },
            axisLine: { lineStyle: { color: muted } },
            axisTick: { show: false },
        },
        yAxis: {
            type: "value",
            max: 100,
            axisLabel: { color: muted, formatter: "{value}%" },
            splitLine: { lineStyle: { color: muted, opacity: 0.15 } },
        },
        series: [
            {
                type: "line",
                data: items.map((it) => Math.round(it.rate * 100)),
                symbolSize: 6,
                itemStyle: { color: primary },
                lineStyle: { color: primary, width: 2 },
            },
        ],
    };
}

/** 文档轮次图（详情页）：柱=答题数（左轴），线=正确率%（右轴）。 */
export function roundsOption(rounds: WenguSession[], t: T): EChartsCoreOption {
    const primary = cssVar("--b3-theme-primary", "#3575f0");
    const ok = cssVar("--b3-card-info-color", "#65b84d");
    const muted = cssVar("--b3-theme-on-surface", "#888888");
    return {
        grid: { left: 8, right: 8, top: 32, bottom: 24, containLabel: true },
        legend: { data: [t("statsRoundAnswered"), t("statsRoundRate")], textStyle: { color: muted }, top: 0 },
        tooltip: {
            trigger: "axis",
            formatter: (ps: unknown) => {
                const arr = ps as { axisValue?: string; seriesName?: string; data?: number }[];
                const i = Number(arr[0]?.axisValue ?? 0) - 1;
                const r = rounds[i];
                if (!r) return "";
                return `${t("statsRoundN").replace("{n}", String(i + 1))}<br/>${t("statsCorrectOf")
                    .replace("{c}", String(r.correct))
                    .replace("{a}", String(r.answered))} · ${mmss(r.elapsedSec)}<br/>${dateLabel(r.startedAt)}`;
            },
        },
        xAxis: {
            type: "category",
            data: rounds.map((_, i) => String(i + 1)),
            axisLabel: { color: muted },
            axisLine: { lineStyle: { color: muted } },
            axisTick: { show: false },
        },
        yAxis: [
            {
                type: "value",
                minInterval: 1,
                axisLabel: { color: muted },
                splitLine: { lineStyle: { color: muted, opacity: 0.15 } },
            },
            { type: "value", max: 100, axisLabel: { color: muted, formatter: "{value}%" }, splitLine: { show: false } },
        ],
        series: [
            {
                name: t("statsRoundAnswered"),
                type: "bar",
                barMaxWidth: 24,
                itemStyle: { color: primary, opacity: 0.75 },
                data: rounds.map((r) => r.answered),
            },
            {
                name: t("statsRoundRate"),
                type: "line",
                yAxisIndex: 1,
                symbolSize: 6,
                itemStyle: { color: ok },
                lineStyle: { color: ok, width: 2 },
                data: rounds.map((r) => (r.answered > 0 ? Math.round((r.correct / r.answered) * 100) : 0)),
            },
        ],
    };
}

/** echarts 实例池：浮层内多图统一 resize/dispose。 */
export class StatsChartHost {
    private readonly charts: EChartsType[] = [];
    private readonly onResize = () => this.resizeAll();

    mount(el: HTMLElement, option: EChartsCoreOption): void {
        if (el.clientWidth <= 0) return;
        const c = echarts.init(el);
        c.setOption(option);
        this.charts.push(c);
    }

    startListen(): void {
        window.addEventListener("resize", this.onResize);
    }

    dispose(): void {
        window.removeEventListener("resize", this.onResize);
        for (const c of this.charts) c.dispose();
        this.charts.length = 0;
    }

    private resizeAll(): void {
        for (const c of this.charts) c.resize();
    }
}
