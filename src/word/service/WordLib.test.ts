import { describe, expect, it } from "vitest";
import { WordLib, type WordLibIo } from "./WordLib";
import { BUILTIN_BOOK, bookFromFile, bookToFile, wordKey, type WenguWordBookData } from "./WordBook";

/** 内存 IO：files 记录已写内容，remove 模拟删文件。 */
function memIo(): WordLibIo & { files: Map<string, string> } {
    const files = new Map<string, string>();
    return {
        files,
        read: async (p) => files.get(p),
        write: async (p, text) => {
            files.set(p, text);
        },
        remove: async (p) => {
            files.delete(p);
        },
    };
}

const EXTRA: WenguWordBookData = {
    version: 1,
    id: "bk-extra",
    title: "六级高频",
    words: [
        { w: "ability", m: "n. 能力" },
        { w: "zeal", m: "n. 热情" },
    ],
};

describe("WordLib 词书房", () => {
    it("首次 ensure：落盘内置书 + manifest，当前书=内置；重复 ensure 幂等", async () => {
        const io = memIo();
        const lib = new WordLib(io);
        await lib.ensure();
        expect(io.files.has("data/wengu/wordbooks/index.json")).toBe(true);
        expect(io.files.has(`data/wengu/wordbooks/${BUILTIN_BOOK.id}.json`)).toBe(true);
        expect(lib.currentMeta().id).toBe(BUILTIN_BOOK.id);
        expect(lib.curBook().words.length).toBe(BUILTIN_BOOK.words.length);
        io.files.delete("data/wengu/wordbooks/index.json");
        await lib.ensure(); // ready 已缓存，不重读不重写
        expect(io.files.has("data/wengu/wordbooks/index.json")).toBe(false);
    });

    it("坏 manifest 重新种子内置书", async () => {
        const io = memIo();
        io.files.set("data/wengu/wordbooks/index.json", "{}");
        const lib = new WordLib(io);
        await lib.ensure();
        expect(lib.currentMeta().id).toBe(BUILTIN_BOOK.id);
        expect(io.files.has(`data/wengu/wordbooks/${BUILTIN_BOOK.id}.json`)).toBe(true);
    });

    it("addBook/switchTo：切书换当前、词头→下标映射随之更新（同词跨书同词头）", async () => {
        const lib = new WordLib(memIo());
        await lib.ensure();
        const extra = await lib.addBook(EXTRA.title, EXTRA.words);
        expect(lib.listBooks().length).toBe(2);
        const bi = BUILTIN_BOOK.words.findIndex((e) => wordKey(e.w) === "ability");
        expect(lib.keyIndex("ability")).toBe(bi); // 还在内置书
        const book = await lib.switchTo(extra.id);
        expect(book?.title).toBe("六级高频");
        expect(lib.currentMeta().id).toBe(extra.id);
        expect(lib.keyIndex("ability")).toBe(0); // 同词换书共享同一词头
        expect(lib.keyIndex("zeal")).toBe(1); // zeal 内置书也有——换书后下标按新书
        await lib.switchTo(BUILTIN_BOOK.id);
        expect(lib.keyIndex("zeal")).toBe(BUILTIN_BOOK.words.findIndex((e) => wordKey(e.w) === "zeal"));
    });

    it("removeBook：删当前书自动切剩余；最后一本拒绝删", async () => {
        const lib = new WordLib(memIo());
        await lib.ensure();
        const extra = await lib.addBook(EXTRA.title, EXTRA.words);
        await lib.switchTo(extra.id);
        await lib.removeBook(extra.id);
        expect(lib.currentMeta().id).toBe(BUILTIN_BOOK.id);
        expect(lib.listBooks().length).toBe(1);
        await lib.removeBook(BUILTIN_BOOK.id); // 最后一本：兜底拒绝
        expect(lib.listBooks().length).toBe(1);
    });

    it("书文件往返：bookToFile → bookFromFile 保真", () => {
        const back = bookFromFile(bookToFile(EXTRA), EXTRA.id);
        expect(back?.id).toBe(EXTRA.id);
        expect(back?.title).toBe(EXTRA.title);
        expect(back?.words).toEqual(EXTRA.words);
        expect(bookFromFile("not json", "x")).toBeUndefined();
        expect(bookFromFile('{"words":[]}', "x")).toBeUndefined();
    });
});
