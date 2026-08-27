import { runWordImport } from "../service/WordImport";
import type { WenguWordProgress } from "../core/WordStore";
import type { WordUi } from "../core/WordUi";

/**
 * 起点面板控制器（Svelte 化后渲染在 comp/StartScreen）：
 * 每组单词数即时生效（组件 onchange 直调），进度导入（PDF/txt）的
 * 状态选择与结果文案走响应态 ui.importStatus / ui.startMsg。
 * 无手动起点——未导入时从词书第一个词开始；导入后按进度来
 * （cursor 自动对齐书序第一个未学词，未学的新学、学过的到期复习、
 * 标熟的不再出现）。
 */
export class WordStartCtl {
    constructor(
        private readonly ui: WordUi,
        private readonly t: (k: string) => string,
        private readonly getProgress: () => WenguWordProgress,
        private readonly save: (p: WenguWordProgress) => Promise<unknown>
    ) {}

    apply(): void {
        // 无手动起点：不重置任何数据，「开始背」= 进入背词
    }

    /** 每组单词数（AI 复盘粒度，5~20，即时生效）。 */
    setGroupSize(n: number): void {
        if (n >= 5 && n <= 20) this.setField("groupSize", n);
    }

    /** 新学窗口容量（3~10，redesign §二.3；下一张选卡即生效）。 */
    setWindowCap(n: number): void {
        if (n >= 3 && n <= 10) this.setField("windowCap", n);
    }

    private setField(field: "groupSize" | "windowCap", n: number): void {
        const p = this.getProgress();
        if (p[field] === n) return;
        p[field] = n;
        void this.save(p);
    }

    async importFile(file: File, input: HTMLInputElement): Promise<void> {
        const p = this.getProgress();
        const status = this.ui.importStatus as Parameters<typeof runWordImport>[1];
        this.ui.startMsg = this.t("wordImportRunning");
        try {
            const r = await runWordImport(file, status, p);
            await this.save(p);
            this.ui.startMsg =
                r.error === "noTextLayer"
                    ? this.t("wordImportNoText")
                    : r.error === "noMatch"
                      ? this.t("wordImportNoMatch")
                      : this.t("wordImportResult").replace("{a}", String(r.hit)).replace("{b}", String(r.miss)) +
                        (r.missSample.length > 0 ? `（${r.missSample.join(", ")}）` : "");
        } catch (e) {
            this.ui.startMsg = this.t("wordImportFailed") + String((e as Error)?.message ?? e).slice(0, 80);
        }
        input.value = "";
    }
}

/** 由视图依赖装配（WordView.startCtl 的拆出体，压 500 行红线）。 */
export function makeStartCtl(v: {
    ui: WordUi;
    t: (k: string) => string;
    store: { save(p: WenguWordProgress): Promise<unknown> };
}): WordStartCtl {
    return new WordStartCtl(
        v.ui,
        v.t,
        () => v.ui.progress!,
        (p) => v.store.save(p)
    );
}
