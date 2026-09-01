import { describe, expect, it } from "vitest";
import { loadPhoneticsRaw, phoneticsOf } from "./WordPhonetics";

/** 自带音标表（20260901 听音选义展示读音）：行集解析与归一化词头
 * 查询——大小写/空格/连字符/撇号差异不伤命中。 */

describe("phoneticsOf", () => {
    it("行集解析：key ipa 空格分隔，首行格式脏行跳过", () => {
        loadPhoneticsRaw("sympathise ˈsɪmpəθaɪz\n\nbad-line-no-space\nempty \nworld wɜːld");
        expect(phoneticsOf("sympathise")).toBe("ˈsɪmpəθaɪz");
        expect(phoneticsOf("world")).toBe("wɜːld");
        expect(phoneticsOf("empty")).toBeUndefined(); // 空音标不入表
        expect(phoneticsOf("bad-line-no-space")).toBeUndefined();
    });

    it("词头归一化对齐 wordKey：大小写/撇号/连字符不伤命中", () => {
        loadPhoneticsRaw("twoday ˈtuːdeɪ\noreilly ɒˈreɪli");
        expect(phoneticsOf("TwoDay")).toBe("ˈtuːdeɪ");
        expect(phoneticsOf("two-day")).toBe("ˈtuːdeɪ");
        expect(phoneticsOf("O'Reilly")).toBe("ɒˈreɪli");
        expect(phoneticsOf("unknown")).toBeUndefined();
    });
});
