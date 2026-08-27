import { describe, expect, it } from "vitest";
import { FRESH_GAP, pickFreshCard, type WinEntry } from "./WindowSched";

/** 窗口仿真（驱动 pickFreshCard + 调用方收尾约定，规则见 §二.3）。 */
class Sim {
    win = new Map<number, WinEntry>();
    seq = 0;
    cursor = 0;
    log: string[] = [];

    constructor(
        public cap: number,
        public bookN: number
    ) {}

    nextNew = (): number | undefined => (this.cursor < this.bookN ? this.cursor : undefined);

    /** 出一张卡（ok=「认识」）并按滚动窗口收尾规则结算。 */
    play(ok: boolean): void {
        const pick = pickFreshCard(this.win, this.seq, this.cap, this.nextNew);
        if (pick.kind === "done") {
            this.log.push("done");
            return;
        }
        if (pick.kind === "new") {
            this.win.set(pick.idx, { step: 0, lastSeq: this.seq, errs: 0 });
            this.cursor = pick.idx + 1;
        }
        const e = this.win.get(pick.idx)!;
        this.log.push(`${pick.idx}${"①②③④"[e.step] ?? "?"}`);
        e.lastSeq = this.seq;
        if (ok) {
            e.step += 1;
            if (e.step >= 4) this.win.delete(pick.idx); // 毕业
        } else {
            e.step = 0;
            e.errs += 1; // 整梯清零
        }
        this.seq++;
    }
}

describe("滚动窗口调度", () => {
    it("开局冷启动：窗口未满连出新词①（cap 5 → 前 5 张连教）", () => {
        const s = new Sim(5, 20);
        for (let i = 0; i < 5; i++) s.play(true);
        expect(s.log).toEqual(["0①", "1①", "2①", "3①", "4①"]);
        expect(s.cursor).toBe(5);
    });

    it("满窗后轮转：推进最久未出镜的在学词，一轮覆盖全部 5 词", () => {
        const s = new Sim(5, 20);
        for (let i = 0; i < 10; i++) s.play(true);
        // 第 6~10 张：都是 ②（各词第二轮），按最久未出镜顺序覆盖 0~4
        expect(s.log.slice(5)).toEqual(["0②", "1②", "2②", "3②", "4②"]);
    });

    it("出镜间隔：同一词两次出镜至少隔 FRESH_GAP 张卡", () => {
        const s = new Sim(5, 20);
        for (let i = 0; i < 40; i++) s.play(true);
        const lastAt = new Map<number, number>();
        s.log.forEach((c, at) => {
            const idx = Number(c.replace(/\D/g, ""));
            const prev = lastAt.get(idx);
            if (prev !== undefined && at - prev < FRESH_GAP) expect.fail(`词 ${idx} 出镜间隔不足: ${s.log}`);
            lastAt.set(idx, at);
        });
    });

    it("毕业补位：词0 走完④后，下一张是新词5①", () => {
        const s = new Sim(5, 20);
        for (let i = 0; i < 17; i++) s.play(true);
        const grad4 = s.log.indexOf("0④");
        const new5 = s.log.indexOf("5①");
        expect(grad4).toBeGreaterThanOrEqual(0);
        expect(new5).toBe(grad4 + 1);
    });

    it("答错整梯清零：②上答错后，该词下次出镜回到①", () => {
        const s = new Sim(5, 20);
        for (let i = 0; i < 6; i++) s.play(true); // 5 新词 + 0②
        s.play(false); // 第 7 张是词1的②，答错 → 清零
        expect(s.win.get(1)).toMatchObject({ step: 0, errs: 1 });
        for (let i = 0; i < 8; i++) s.play(true);
        expect(s.log.slice(6)).toContain("1①"); // 重现从①再来
    });

    it("书尽收尾：窗口排空且无新词 → done；尾部小窗垫场放宽间隔", () => {
        const s = new Sim(2, 2);
        expect(pickFreshCard(new Map(), 0, 5, () => undefined).kind).toBe("done");
        for (let i = 0; i < 9; i++) s.play(true);
        // cap2：0① 1① 之后无新可进（size=cap 但 nextNew undefined），
        // 间隔不足时垫场兜底（最久未出镜），两词交替走完四步毕业
        expect(s.log[0]).toBe("0①");
        expect(s.log[1]).toBe("1①");
        expect(s.log[s.log.length - 1]).toBe("done");
        expect(s.win.size).toBe(0);
    });

    it("重进恢复：持久步数建窗后，续新词/续推进都基于原步数", () => {
        const win = new Map<number, WinEntry>([
            [7, { step: 2, lastSeq: 0, errs: 0 }],
            [8, { step: 0, lastSeq: 0, errs: 1 }],
        ]);
        const cap = 3;
        const nextNew = (): number | undefined => 9;
        // 窗口未满（2<3）→ 先补新词
        expect(pickFreshCard(win, 0, cap, nextNew)).toEqual({ kind: "new", idx: 9 });
        win.set(9, { step: 0, lastSeq: 0, errs: 0 });
        // 满窗且均未到间隔下限… seq=3 后词7（步2<4）就绪，最久未出镜优先
        const p2 = pickFreshCard(win, 3, cap, nextNew);
        expect(p2).toEqual({ kind: "advance", idx: 7 });
    });
});
