import { replayConvertBar, showStatus } from "../../convert";
import type { ConvertProgress } from "../../convert/service/ConvertBatch";
import type { WenguMaterial, WenguQuestion } from "../../types";
import { fmt } from "../../ui/shared";

/**
 * 转换期间的页签渐进呈现（20260903 起落库=题库内存直写，无内核索引
 * 延迟）：onBatch 携带的题目视图直接应用到页签（与做题同界面渲染；
 * 完成前不作答——题集可能被「丢弃」回收，作答统计不能落在待定题上，
 * 作答屏蔽闸=本类的 active 旗，QuizShell 消费）。
 */
export class ProgressivePreview {
    private activeFlag = false;

    /** 是否处于渐进呈现中（页签按做题界面渲染但屏蔽作答位）。 */
    get active(): boolean {
        return this.activeFlag;
    }

    /** 渐进呈现开始（首批 onBatch 起）。 */
    begin(): void {
        this.activeFlag = true;
    }

    /** 结束渐进呈现（完成/丢弃/销毁）。 */
    clear(): void {
        this.activeFlag = false;
    }
}

/** 渐进呈现需要的视图能力（QuizView 组装）。 */
export interface PreviewHost {
    t(key: string): string;
    el: HTMLElement;
    /** 本轮刷题是否进行中（进行中先收卷再切预览）。 */
    isStarted(): boolean;
    /** 收卷（渐进呈现要接管页签；已答的逐题落库不受影响）。 */
    stopRound(): void;
    currentDocId(): string;
    /** 切到渐进题集（持久化 + 目录补位）。 */
    switchDoc(id: string, title: string, count: number): void;
    /** 应用题目列表与材料块并按做题界面重渲染。 */
    applyList(list: WenguQuestion[], materials?: WenguMaterial[]): void;
}

/** 一批落库后的页签呈现：切题集 → 应用内存题目视图 → 重放转换条。 */
export function showBatchPreview(prev: ProgressivePreview, host: PreviewHost, p: ConvertProgress): void {
    if (!p.setId) return;
    // 做着题时开始转换：收卷接管页签（用户点转换即以转换为当前焦点）
    if (host.isStarted()) host.stopRound();
    if (host.currentDocId() !== p.setId) host.switchDoc(p.setId, p.title ?? "", p.count);
    prev.begin();
    const status = () => {
        // 转换条（进度文案+停止/抉择按钮）优先；无条可放时退回纯文案
        if (replayConvertBar(host.el)) return;
        showStatus(
            host.el,
            fmt(host.t("convertPreviewStatus"), {
                b: String(p.batch),
                n: String(p.total),
                c: String(p.count),
            }),
            "muted"
        );
    };
    status();
    host.applyList(p.questions ?? [], p.materials ?? []);
    status(); // 重渲染会重置状态槽，重放一次
}
