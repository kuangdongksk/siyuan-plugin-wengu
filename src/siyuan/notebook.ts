import { fetchSyncPost, type IWebSocketData } from "siyuan";
import { EApi } from "./api";

/** 笔记本级内核操作（迁自 sy-lively 的 SY笔记本）。 */
export class KernelNotebook {
    /** 全部笔记本（含未打开——调用方按 closed 自行过滤）。 */
    static list(): Promise<IWebSocketData> {
        return fetchSyncPost(EApi.ListNotebooks);
    }

    /** 笔记本配置（dailyNoteSavePath 等）。 */
    static conf(notebook: string) {
        return fetchSyncPost(EApi.GetNotebookConf, { notebook });
    }
}
