import { showStatus } from "./ConvertHost";
import { listMaterials } from "./MaterialService";
import { listQuestions } from "./QuestionService";
import type { WenguMaterial, WenguQuestion } from "./types";
import { fmt } from "./ui";

/**
 * 转换期间的页签渐进呈现：每批渐进落盘后，把新文档的题目列表
 * 应用到页签（与做题同界面渲染；完成前不作答——文档每批都在
 * 删除重建，块 id 会变，作答状态无法保留）。
 *
 * 每批重建产生新文档 id，内核 attributes 索引有数秒延迟——轮询
 * 直到新 id 可查出题目再应用；串号（seq）丢弃过期的轮询，避免
 * 旧批结果覆盖新批。材料块随题目一起拉（E0 材料组预览）；
 * group="prev" 占位在渐进期间不解析（文档每批重建，装载终态才解析）。
 */
export class ProgressivePreview {
    private activeFlag = false;
    private seq = 0;

    /** 是否处于渐进呈现中（页签按做题界面渲染但屏蔽作答位）。 */
    get active(): boolean {
        return this.activeFlag;
    }

    /** 新一批已落盘：应用该文档的题目列表（非空才应用，空=索引未可见）。 */
    begin(docId: string, apply: (list: WenguQuestion[], materials: WenguMaterial[]) => void): void {
        this.activeFlag = true;
        const seq = ++this.seq;
        void this.poll(docId, seq, apply, 0);
    }

    /** 结束渐进呈现（完成/丢弃/销毁）：进行中的轮询作废。 */
    clear(): void {
        this.activeFlag = false;
        this.seq++;
    }

    private async poll(
        docId: string,
        seq: number,
        apply: (list: WenguQuestion[], materials: WenguMaterial[]) => void,
        attempt: number
    ): Promise<void> {
        if (seq !== this.seq || !this.activeFlag) return;
        let list: WenguQuestion[];
        let materials: WenguMaterial[] = [];
        try {
            list = await listQuestions(docId);
            if (list.length > 0) materials = await listMaterials(docId).catch((): WenguMaterial[] => []);
        } catch (_) {
            list = [];
        }
        if (seq !== this.seq || !this.activeFlag) return;
        if (list.length > 0) {
            apply(list, materials);
            return;
        }
        // 新文档 id 刚建，索引未可见：1s 间隔重试（上限 30s——文档随批
        // 长大、重建后重索引更慢；超时等下一批补上）
        if (attempt < 30) {
            window.setTimeout((): void => void this.poll(docId, seq, apply, attempt + 1), 1000);
        }
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
    /** 切到渐进文档（持久化 + 目录补位）。 */
    switchDoc(id: string, title: string, count: number): void;
    /** 应用题目列表与材料块并按做题界面重渲染。 */
    applyList(list: WenguQuestion[], materials?: WenguMaterial[]): void;
}

/** 一批渐进落盘后的页签呈现：切文档 → 状态行 → 应用题目列表。 */
export function showBatchPreview(
    prev: ProgressivePreview,
    host: PreviewHost,
    docId: string,
    title: string,
    count: number,
    batch: number,
    total: number
): void {
    // 做着题时开始转换：收卷接管页签（用户点转换即以转换为当前焦点）
    if (host.isStarted()) host.stopRound();
    if (host.currentDocId() !== docId) host.switchDoc(docId, title, count);
    const status = () =>
        showStatus(
            host.el,
            fmt(host.t("convertPreviewStatus"), { b: String(batch), n: String(total), c: String(count) }),
            "muted"
        );
    status();
    prev.begin(docId, (list, materials) => {
        host.applyList(list, materials);
        status(); // 重渲染会重置状态槽，重放一次
    });
}
