import type { ConvertProgressRecord } from "../service/ConvertBatch";
import type { ConvertRunSnapshot } from "../service/ConvertRun";

/**
 * 转换管理面板的响应态形状（四件套之一）。运行中快照经
 * subscribeConvertRun 订阅推入；未完成记录在动作后重拉。
 */

export interface ConvertPanelUi {
    /** ConvertRun 单例快照（undefined=无运行也无待抉择）。 */
    snap: ConvertRunSnapshot | undefined;
    /** 未完成进度记录（prefs 持久，跨重启仍在）。 */
    records: { srcDocId: string; rec: ConvertProgressRecord }[];
    /** 「丢弃进度」两击确认中的 srcDocId（3s 自动复位）。 */
    armedDoc: string | undefined;
}

/** 初始态（$state 包装在 ConvertPanelApp 内完成）。 */
export function initialConvertPanelUi(): ConvertPanelUi {
    return { snap: undefined, records: [], armedDoc: undefined };
}
