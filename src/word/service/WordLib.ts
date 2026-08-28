import { kernelReadText, kernelRemoveFile, kernelWriteText } from "../../siyuan/files";
import {
    BUILTIN_BOOK,
    bookFromFile,
    bookToFile,
    wordKey,
    type WenguWordBookData,
    type WenguWordEntry,
} from "./WordBook";

/**
 * 多词书房（redesign §五，20260828）：词书文件存工作区
 * data/wengu/wordbooks/{id}.json（ getFile/putFile 特殊通道，见
 * siyuan/files.ts），manifest（index.json）记书单与当前书；内置书首次
 * 启动落盘一份，与导入书同权管理。第一版为单层书列表+切换（考试
 * 分层缓行，见 redesign §五 简化建议）。
 *
 * 进度按归一化词头共享（WordStore v3），切书不动进度；本模块只管
 * 书本身的增删改查与「当前书」态。模块单例（与 WordStore 同生命周期，
 * 插件 onload 前的兜底 IO 用内核通道，纯逻辑单测注入内存 IO）。
 */

/** 词书条目 IO（注入便于单测；线上实现走内核文件通道）。 */
export interface WordLibIo {
    read(path: string): Promise<string | undefined>;
    write(path: string, text: string): Promise<void>;
    remove(path: string): Promise<void>;
}

/** 书单里的一本（manifest 与 UI 共用形状）。 */
export interface WordBookMeta {
    id: string;
    name: string;
    count: number;
}

interface Manifest {
    version: 1;
    current: string;
    books: WordBookMeta[];
}

const DIR = "data/wengu/wordbooks";
const MANIFEST_PATH = `${DIR}/index.json`;
const fileOf = (id: string): string => `${DIR}/${id}.json`;

const builtinMeta = (): WordBookMeta => ({
    id: BUILTIN_BOOK.id,
    name: BUILTIN_BOOK.title,
    count: BUILTIN_BOOK.words.length,
});

export class WordLib {
    private manifest: Manifest = { version: 1, current: BUILTIN_BOOK.id, books: [builtinMeta()] };
    private active: WenguWordBookData = BUILTIN_BOOK;
    /** 每次换书递增：外部按词书派生的缓存（易混索引/字母桶）据此失效。 */
    private stamp = 0;
    private keyIdx?: Map<string, number>;
    private ready?: Promise<void>;

    constructor(private readonly io: WordLibIo) {}

    /** 载入（幂等）：manifest 缺失/损坏时落盘内置书种子。 */
    ensure(): Promise<void> {
        this.ready ??= this.load();
        return this.ready;
    }

    private async load(): Promise<void> {
        let m: Manifest | undefined;
        try {
            const text = await this.io.read(MANIFEST_PATH);
            const raw = text ? (JSON.parse(text) as Partial<Manifest>) : undefined;
            if (raw && Array.isArray(raw.books) && raw.books.length > 0) {
                m = { version: 1, current: raw.current ?? raw.books[0].id, books: raw.books };
            }
        } catch (_) {
            // 坏 manifest 按无处理，走种子
        }
        if (!m) {
            await this.seed();
            return;
        }
        this.manifest = m;
        if (!m.books.some((b) => b.id === m!.current)) m.current = m.books[0].id;
        const book = (await this.loadBook(m.current)) ?? (await this.firstReadable());
        if (book) {
            this.setActive(book);
        } else {
            // 书单在、书文件全丢：回种子内置书并修 manifest
            await this.seed();
        }
    }

    /** 内置书落盘 + manifest 归一（首次启动/书全丢时的兜底）。 */
    private async seed(): Promise<void> {
        this.manifest = { version: 1, current: BUILTIN_BOOK.id, books: [builtinMeta()] };
        this.setActive(BUILTIN_BOOK);
        await this.persist(async () => {
            await this.io.write(fileOf(BUILTIN_BOOK.id), bookToFile(BUILTIN_BOOK));
            await this.io.write(MANIFEST_PATH, JSON.stringify(this.manifest));
        });
    }

    private async loadBook(id: string): Promise<WenguWordBookData | undefined> {
        const text = await this.io.read(fileOf(id));
        return text ? bookFromFile(text, id) : undefined;
    }

    private async firstReadable(): Promise<WenguWordBookData | undefined> {
        for (const b of this.manifest.books) {
            const book = await this.loadBook(b.id);
            if (book) {
                this.manifest.current = b.id;
                return book;
            }
        }
        return undefined;
    }

    /** manifest 落盘（尽力而为，失败不阻断会话——内存态为准）。 */
    private async persist(fn: () => Promise<void>): Promise<void> {
        try {
            await fn();
        } catch (e) {
            console.warn(`[wengu] wordbook manifest 写入失败：${e instanceof Error ? e.message : String(e)}`);
        }
    }

    /* ── 当前书（会话内同步读；ensure 之后才可靠） ── */

    curBook(): WenguWordBookData {
        return this.active;
    }

    /** 词头 → 当前书下标（不在书内 undefined；缓存随换书失效）。 */
    keyIndex(key: string): number | undefined {
        this.keyIdx ??= new Map(this.active.words.map((e, i) => [wordKey(e.w), i]));
        return this.keyIdx.get(key);
    }

    /** 当前书下标 → 词头 key。 */
    keyOf(idx: number): string {
        return this.active.words[idx] ? wordKey(this.active.words[idx].w) : "";
    }

    bookStamp(): number {
        return this.stamp;
    }

    private setActive(book: WenguWordBookData): void {
        this.active = book;
        this.keyIdx = undefined;
        this.stamp++;
    }

    /* ── 书单管理（UI 调；均需先 ensure） ── */

    /** 当前书 meta。 */
    currentMeta(): WordBookMeta {
        return this.manifest.books.find((b) => b.id === this.manifest.current) ?? builtinMeta();
    }

    /** 书单（书序）。 */
    listBooks(): WordBookMeta[] {
        return this.manifest.books;
    }

    /** 切书：置当前+落盘 manifest+激活；书不存在/读不出返回 undefined。 */
    async switchTo(id: string): Promise<WenguWordBookData | undefined> {
        await this.ensure();
        if (id === this.manifest.current) return this.active;
        if (!this.manifest.books.some((b) => b.id === id)) return undefined;
        const book = await this.loadBook(id);
        if (!book) return undefined;
        this.manifest.current = id;
        this.setActive(book);
        await this.persist(() => this.io.write(MANIFEST_PATH, JSON.stringify(this.manifest)));
        return book;
    }

    /** 新增词书（id 自造唯一；不切当前，由调用方决定）。 */
    async addBook(name: string, words: WenguWordEntry[]): Promise<WordBookMeta> {
        await this.ensure();
        const id = `bk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        const meta: WordBookMeta = { id, name, count: words.length };
        this.manifest.books.push(meta);
        await this.persist(async () => {
            await this.io.write(fileOf(id), bookToFile({ version: 1, id, title: name, words }));
            await this.io.write(MANIFEST_PATH, JSON.stringify(this.manifest));
        });
        return meta;
    }

    // 注：renameBook（改书名）已移除——零调用方的死代码，且只写
    // manifest 不写书文件，重启后书名回旧值（20260829 单词域审查挂账）。

    /** 删书（不删进度；最后一本不可删——UI 禁用、此处兜底拒绝）。
     * 删的是当前书时自动切到剩余第一本并激活。先落 manifest 再删文件：
     * manifest 是事实源，文件删失败只是无害残留，反过来则删除半途
     * manifest 不落盘、重启后幽灵书复活。 */
    async removeBook(id: string): Promise<void> {
        await this.ensure();
        if (this.manifest.books.length <= 1) return;
        const wasCurrent = this.manifest.current === id;
        this.manifest.books = this.manifest.books.filter((b) => b.id !== id);
        if (wasCurrent) this.manifest.current = this.manifest.books[0].id;
        const next = wasCurrent ? await this.loadBook(this.manifest.current) : undefined;
        await this.persist(async () => {
            await this.io.write(MANIFEST_PATH, JSON.stringify(this.manifest));
            await this.io.remove(fileOf(id));
        });
        if (wasCurrent && next) this.setActive(next);
    }
}

/* ── 导入解析（.json/.csv → 词书；redesign §五 导入格式） ── */

/** 解析导入文件：json 收 [{w,m}] / [[w,m]]，csv 收「词,释义」UTF-8
 * （每行首个逗号切分，英文词形之外的行跳过）；书名取文件名去后缀。 */
export async function parseBookFile(file: File): Promise<{ name: string; words: WenguWordEntry[] }> {
    const name = file.name.replace(/\.(json|csv)$/i, "").trim() || "导入词书";
    const text = new TextDecoder("utf-8").decode(new Uint8Array(await file.arrayBuffer()));
    if (/\.json$/i.test(file.name)) {
        let raw: unknown;
        let badJson: unknown;
        try {
            raw = JSON.parse(text);
        } catch (e) {
            badJson = e;
        }
        if (badJson !== undefined) throw new Error("bad json");
        const arr = Array.isArray(raw) ? raw : [];
        const words = arr
            .map((e): [string, string] | undefined =>
                Array.isArray(e) && typeof e[0] === "string"
                    ? [e[0], String(e[1] ?? "")]
                    : e && typeof e === "object" && typeof (e as { w?: unknown }).w === "string"
                      ? [(e as { w: string }).w, String((e as { m?: unknown }).m ?? "")]
                      : undefined
            )
            .filter((e): e is [string, string] => Boolean(e))
            .map(([w, m]) => ({ w: w.trim(), m: m.trim() }))
            .filter((e) => e.w);
        return { name, words };
    }
    const words: WenguWordEntry[] = [];
    for (const line of text.split(/\r?\n/)) {
        const s = line.trim();
        if (!s || !s.includes(",")) continue;
        const at = s.indexOf(",");
        const w = s.slice(0, at).trim();
        const m = s.slice(at + 1).trim();
        if (!w || !/^[A-Za-z][A-Za-z'\- ]*$/.test(w) || !m) continue;
        words.push({ w, m });
    }
    return { name, words };
}

/* ── 模块单例（插件 onload 初始化；纯逻辑单测自建实例不走这里） ── */

let libSingleton: WordLib | undefined;

/** 内核通道 IO（默认实现）。 */
export function kernelWordLibIo(): WordLibIo {
    return {
        read: (p) => kernelReadText(p),
        write: (p, text) => kernelWriteText(p, text),
        remove: (p) => kernelRemoveFile(p),
    };
}

/** 取词书房单例（未初始化时用内核 IO 兜底建，挂载时序不靠它兜底）。 */
export function wordLib(): WordLib {
    libSingleton ??= new WordLib(kernelWordLibIo());
    return libSingleton;
}

/** 插件 onload 显式初始化（当前与兜底等价，占位给将来带依赖的构造）。 */
export function initWordLib(io?: WordLibIo): WordLib {
    libSingleton = new WordLib(io ?? kernelWordLibIo());
    return libSingleton;
}
