import type { ChatTurn } from "../rules/Prompt";

/**
 * 学伴聊天历史存储（每学伴一份）：插件 saveData("companion-chat")
 * 单文件 map——profileId（默认学伴=default）→ 最近 CHAT_MAX_TURNS 轮。
 *
 * 读一次性 hydrate 后内存直取；写走内部串行链（内核写并发互吞，
 * 见 AGENTS.md「fetchSyncPost 必须串行」），失败静默（内存为准，
 * 下次成功写覆盖）。删除学伴时 drop 清残留。
 */

/** 每学伴保留的聊天轮数（CompanionCtl.chatLog 同源上限）。 */
export const CHAT_MAX_TURNS = 24;

/** 默认学伴（小书童）的固定条目 id（学伴配置 id 为「时间戳36-随机段」格式，default 为固定保留字不冲突）。 */
export const DEFAULT_CHAT_KEY = "default";

function validTurns(v: unknown): ChatTurn[] {
    return Array.isArray(v)
        ? v.filter(
              (x): x is ChatTurn =>
                  !!x && typeof x === "object" && (x.role === "user" || x.role === "ai") && typeof x.text === "string"
          )
        : [];
}

export class ChatStore {
    private map: Record<string, ChatTurn[]> = {};
    private ready?: Promise<void>;
    private chain: Promise<unknown> = Promise.resolve();

    constructor(
        private readonly loadRaw: () => Promise<unknown>,
        private readonly saveRaw: (v: Record<string, ChatTurn[]>) => Promise<unknown>
    ) {}

    /** 首次加载（幂等，多次调用共享同一 Promise；坏数据按空处理）。 */
    hydrate(): Promise<void> {
        this.ready ??= (async () => {
            const data = await this.loadRaw().catch((): unknown => undefined);
            if (!data || typeof data !== "object") return;
            for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
                const turns = validTurns(v).slice(-CHAT_MAX_TURNS);
                if (turns.length > 0) this.map[k] = turns;
            }
            // 老版本空串 key（老版默认学伴）迁移到 DEFAULT_CHAT_KEY
            if (this.map[""]) {
                this.map[DEFAULT_CHAT_KEY] = [...(this.map[DEFAULT_CHAT_KEY] ?? []), ...this.map[""]].slice(
                    -CHAT_MAX_TURNS
                );
                delete this.map[""];
                this.flush();
            }
        })();
        return this.ready;
    }

    /** 某学伴的历史（副本；首次调用内部先等 hydrate）。 */
    async turnsOf(id: string): Promise<ChatTurn[]> {
        await this.hydrate();
        return [...(this.map[id] ?? [])];
    }

    /** 覆写某学伴历史（截断快照入内存，串行落盘）。 */
    put(id: string, turns: ChatTurn[]): void {
        this.map[id] = turns.slice(-CHAT_MAX_TURNS);
        this.flush();
    }

    /** 删除学伴时清其聊天残留。 */
    drop(id: string): void {
        delete this.map[id];
        this.flush();
    }

    private flush(): void {
        const snap = { ...this.map };
        this.chain = this.chain.then(async (): Promise<void> => {
            try {
                await this.saveRaw(snap);
            } catch (_) {
                // 落盘失败静默：内存为准，下次成功写覆盖
            }
        });
    }
}
