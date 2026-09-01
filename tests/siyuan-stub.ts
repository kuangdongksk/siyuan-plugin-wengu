/**
 * vitest 的 "siyuan" 模块替身：真包只有类型无运行时入口（node 下
 * import 直接报 "No exports main defined"），webpack 侧是 external
 * （宿主注入全局）。测试只碰纯函数，这里的占位实现不应被真正调用——
 * 被调到即说明测试覆盖到了 IO，应改 mock 而非放行。
 */

export interface IWebSocketData {
    code: number;
    msg: string;
    data?: unknown;
}

export async function fetchSyncPost(url: string, data?: unknown): Promise<IWebSocketData> {
    throw new Error(`unexpected kernel call in test: ${url} ${JSON.stringify(data ?? null)}`);
}

export class Dialog {
    constructor(_options: unknown) {
        throw new Error("unexpected Dialog in test");
    }
}

export class Menu {
    constructor(_options?: unknown) {
        throw new Error("unexpected Menu in test");
    }
}

/** 内嵌编辑器（测试不应触碰）。 */
export const Protyle: unknown = undefined;
export const ProtyleMethod: Record<string, unknown> = {};

/** 思源通知浮层（宿主注入，见 src/ui/Notify.ts；测试环境静默放行）。 */
export function showMessage(_text: string, _timeout?: number, _type?: "info" | "error"): void {}
