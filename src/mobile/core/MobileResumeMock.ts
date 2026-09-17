import type { WenguDoc } from "../../types";

/**
 * 恢复链单测的共享夹具（`MobileDrill.test.ts` 用）：
 *
 * 题集清单的一条（`WenguDoc`）与「本轮断点时间」——恢复探测自 Issue #167
 * 起**扫全库取最近一条未完成轮**，用例要按 `startedAt` 摆出「未完成轮 +
 * 更新的已收卷轮」这类边界组合，故构造器单列一处免得两片各写一份。
 */

/** 造一条题集清单条目（dock 开刷面板的 `home.sets`）。
 *  这里的 `docId` 同时是「会话挂在哪一卷」的键（题集 id 即源文档 id）。 */
export function mockDoc(id: string, title: string): WenguDoc {
    return { id, title, total: 0, attempted: 0 } as unknown as WenguDoc;
}
