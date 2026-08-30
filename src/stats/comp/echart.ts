import * as echarts from "echarts/core";
import type { EChartsCoreOption } from "echarts/core";

/**
 * echarts 的 Svelte action 壳（暗雷 §8：命令式 init/dispose + resize
 * 监听别声明式化，用 action 包住现有命令式代码）：`use:echart={option}`
 * ——节点进入 DOM 即 init+setOption，卸载即 dispose（旧 StatsChartHost
 * 实例池的等价物，生命周期交给 Svelte）；window resize 跟随重绘。
 * option 变化走 update 重新 setOption（tab 数据不重载场景兜底）。
 */
export function echart(
    node: HTMLElement,
    option: EChartsCoreOption
): { update(o: EChartsCoreOption): void; destroy(): void } {
    if (node.clientWidth <= 0) {
        // 隐藏容器（clientWidth 0）init 会得到 0 尺画布——跳过，等
        // 容器可见后由 tab 重挂触发（旧 StatsChartHost.mount 同守卫）
        return { update: (): void => undefined, destroy: (): void => undefined };
    }
    const chart = echarts.init(node);
    chart.setOption(option);
    const onResize = (): void => chart.resize();
    window.addEventListener("resize", onResize);
    return {
        update(o: EChartsCoreOption): void {
            chart.setOption(o);
        },
        destroy(): void {
            window.removeEventListener("resize", onResize);
            chart.dispose();
        },
    };
}
