import { parseBookFile, wordLib } from "../service/WordLib";
import type { WordView } from "../core/WordView";

/**
 * 词书管理编排（redesign §五，20260828；WordView 拆件压 500 行红线）：
 * 切书/删书/导入词书三入口 + 会话复位。进度按归一化词头跨书共享，
 * 切书不动进度——队列/统计按新书现场重算，会话态（窗口/队列/查词）
 * 复位回首页。书单本身（manifest/文件）在 service/WordLib。
 */

/** 切书：置当前+激活（WordLib 落盘 manifest），镜像响应态并复位会话。 */
export async function switchBookFor(v: WordView, id: string): Promise<void> {
    const lib = wordLib();
    await lib.ensure();
    if (lib.currentMeta().id === id) return;
    const book = await lib.switchTo(id);
    if (!book) return;
    v.ui.book = book;
    v.ui.books = lib.listBooks();
    resetSessionFor(v);
}

/** 删书（删当前书时 WordLib 自动切到剩余第一本；最后一本不可删）。 */
export async function removeBookFor(v: WordView, id: string): Promise<void> {
    const lib = wordLib();
    await lib.ensure();
    await lib.removeBook(id);
    v.ui.books = lib.listBooks();
    if (v.ui.book.id !== lib.curBook().id) {
        v.ui.book = lib.curBook();
        resetSessionFor(v);
    }
}

/** 导入词书（.json/.csv，格式见 WordLib.parseBookFile）：入库即切为
 * 当前书（起点面板导入的意图即启用）；结果文案走 ui.startMsg。 */
export async function importBookFor(v: WordView, file: File, input: HTMLInputElement): Promise<void> {
    const t = v.t;
    try {
        const parsed = await parseBookFile(file);
        if (parsed.words.length === 0) {
            v.ui.startMsg = t("wordBookImportEmpty");
        } else {
            const lib = wordLib();
            const meta = await lib.addBook(parsed.name, parsed.words);
            v.ui.startMsg = t("wordBookImported").replace("{a}", String(meta.count));
            await switchBookFor(v, meta.id);
        }
    } catch (e) {
        v.ui.startMsg = t("wordBookImportFailed") + String((e as Error)?.message ?? e).slice(0, 80);
    }
    input.value = "";
}

/** 会话复位（切书/删当前书后）：回首页、清窗口/队列/查词态。 */
function resetSessionFor(v: WordView): void {
    v.queue = [];
    v.pos = 0;
    v.freshWin = new Map();
    v.sessionNew = new Set();
    v.hardList = [];
    v.doneSet.clear();
    v.groupLog = [];
    v.finishCount = 0;
    v.ui.mode = "home";
    v.ui.lookupQuery = "";
    v.ui.lookupSel = undefined;
    v.syncAi();
}
