import type { CompanionProfile } from "./CompanionCtl";
import type { CompanionPanelUi } from "./CompanionPanelUi";
import { DEFAULT_CHAT_KEY } from "./ChatStore";

/**
 * 学伴管理面板控制器（自旧 core/CompanionPanel.ts 的字符串模板 +
 * 逐控件绑定迁来，行为对齐）：配置 CRUD + 全局开关，每变更即时落盘。
 * 写 ui 即响应（消灭旧版「每改一项全面板重灌」）；两击确认态在
 * ui.delArmed，3s 定时器由 destroy 清理。
 *
 * 默认学伴（小书童）物化为 id=default 的正式条目（20260828 用户
 * 定稿：默认可删可改、与自定义同权，列表至少保留一个——仅剩一条
 * 时删除不可用）；老数据（无 default 条目/activeId 空）挂载时迁移。
 */

/** 面板可见的设置切片（QuizView.settingsOf 的 companion 相关字段）。 */
export interface CompanionPanelSettings {
    companionEnabled?: boolean;
    companionPersona?: string;
    companionAi?: boolean;
    companionProfiles?: CompanionProfile[];
    companionActiveId?: string;
    save?: () => void;
}

/** 面板控制器依赖（挂载编排注入，避免反向 import 域入口）。 */
export interface CompanionPanelDeps {
    t: (key: string) => string;
    settings: CompanionPanelSettings;
    /** 全局开关变化后让视图刷新（QuizView.applySettings，看板娘显隐即时生效）。 */
    applySettings: () => void;
    /** 生效形象可能变了（切换/新建/删除/目录变更后重探）。 */
    reloadImages: () => void;
    /** 生效学伴变了（切换/新建/删除）——看板娘换聊天历史。 */
    onActiveChange?: () => void;
    /** 学伴被删除（先于 onActiveChange）——清其聊天残留。 */
    onProfileRemoved?: (id: string) => void;
    /** 总开关切换——全局悬浮层显隐联动。 */
    onCompanionToggle?: () => void;
}

/** 新配置 id（时间戳36 + 随机段）。 */
function profileId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class CompanionPanelCtl {
    private delTimer: ReturnType<typeof setTimeout> | undefined;
    private saveTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly ui: CompanionPanelUi,
        private readonly d: CompanionPanelDeps
    ) {
        this.ensureDefault();
        this.syncFromSettings();
    }

    destroy(): void {
        clearTimeout(this.delTimer);
        clearTimeout(this.saveTimer);
    }

    /** 保存按钮：组件从 DOM 收当前输入（未失焦的编辑 settings 里还没
     * 有），规整后直写条目落盘，并给「已保存」反馈 1.5s。 */
    saveNow(f: { name: string; prompt: string; imageDir: string }): void {
        const before = this.active()?.imageDir ?? "";
        this.mutateActive((p) => {
            p.name = f.name.trim().slice(0, 20);
            p.prompt = f.prompt.slice(0, 2000);
            p.imageDir = f.imageDir.trim();
        });
        if (before !== f.imageDir.trim()) this.d.reloadImages();
        this.ui.savedFlash = true;
        clearTimeout(this.saveTimer);
        this.saveTimer = setTimeout(() => (this.ui.savedFlash = false), 1500);
    }

    /** 当前编辑中的配置（物化后恒有值；空态仅为坏数据的防御显示）。 */
    active(): CompanionProfile | undefined {
        return this.ui.profiles.find((p) => p.id === this.ui.activeId);
    }

    /** 物化默认学伴：列表无 default 条目则补，activeId 空/悬空则归位。
     * （与聊天存储 DEFAULT_CHAT_KEY 同 id，历史天然衔接。） */
    private ensureDefault(): void {
        const list = this.d.settings.companionProfiles ?? [];
        let dirty = false;
        if (!list.some((p) => p.id === DEFAULT_CHAT_KEY)) {
            list.unshift({
                id: DEFAULT_CHAT_KEY,
                name: this.d.t("companionDefaultName"),
                prompt: "",
                imageDir: "",
                modelId: "",
            });
            this.d.settings.companionProfiles = list;
            dirty = true;
        }
        const activeId = this.d.settings.companionActiveId;
        if (!activeId || !list.some((p) => p.id === activeId)) {
            this.d.settings.companionActiveId = DEFAULT_CHAT_KEY;
            dirty = true;
        }
        if (dirty) this.d.settings.save?.();
    }

    /** 设置镜像同步进响应态（挂载时与列表结构性变化后）。 */
    private syncFromSettings(): void {
        this.ui.activeId = this.d.settings.companionActiveId ?? "";
        this.syncList();
    }

    private syncList(): void {
        this.ui.profiles = [...(this.d.settings.companionProfiles ?? [])];
    }

    /** 点卡片=切换编辑对象；生效形象/聊天历史即时换。 */
    activate(pid: string): void {
        this.d.settings.companionActiveId = pid || undefined;
        this.ui.activeId = pid;
        this.disarmDel();
        this.d.settings.save?.();
        this.d.reloadImages();
        this.d.onActiveChange?.();
    }

    /** 新建一套配置并立即进入编辑。 */
    newProfile(): void {
        const list = this.d.settings.companionProfiles ?? [];
        const p: CompanionProfile = {
            id: profileId(),
            name: `${this.d.t("companionNewNamePrefix")}${list.length + 1}`,
            prompt: "",
            imageDir: "",
            modelId: "",
        };
        list.push(p);
        this.d.settings.companionProfiles = list;
        this.d.settings.companionActiveId = p.id;
        this.disarmDel();
        this.syncFromSettings();
        this.d.settings.save?.();
        this.d.reloadImages();
        this.d.onActiveChange?.();
    }

    /** 删除两击：首击进确认态（按钮换确认文案 3s 自动复原），再击执行；
     * 至少保留一个（仅剩一条时按钮已禁用，此处兜底直接拒绝）。 */
    delClick(): void {
        if (this.ui.profiles.length <= 1) {
            this.disarmDel();
            return;
        }
        if (!this.ui.delArmed) {
            this.ui.delArmed = true;
            clearTimeout(this.delTimer);
            this.delTimer = setTimeout(() => (this.ui.delArmed = false), 3000);
            return;
        }
        this.disarmDel();
        const cur = this.active();
        if (!cur) return;
        const rest = this.ui.profiles.filter((p) => p.id !== cur.id);
        this.d.settings.companionProfiles = rest;
        this.d.settings.companionActiveId = rest[0]?.id;
        this.syncFromSettings();
        this.d.settings.save?.();
        this.d.reloadImages();
        this.d.onProfileRemoved?.(cur.id);
        this.d.onActiveChange?.();
    }

    private disarmDel(): void {
        clearTimeout(this.delTimer);
        this.ui.delArmed = false;
    }

    /* ── 编辑器字段写回（当前配置存在时才生效） ── */

    setName(v: string): void {
        this.mutateActive((p) => (p.name = v.trim().slice(0, 20)));
    }

    setPrompt(v: string): void {
        this.mutateActive((p) => (p.prompt = v.slice(0, 2000)));
    }

    setImageDir(v: string): void {
        this.mutateActive((p) => (p.imageDir = v.trim()));
        this.d.reloadImages();
    }

    setModel(v: string): void {
        this.mutateActive((p) => (p.modelId = v));
    }

    private mutateActive(fn: (p: CompanionProfile) => void): void {
        // 暗雷 §9：直写 settings 条目——经 ui 镜像的 $state 代理元素写
        // 不落底层（真机实证 prompt 编辑不落盘），settings 才是事实源
        const p = (this.d.settings.companionProfiles ?? []).find((x) => x.id === this.ui.activeId);
        if (!p) return;
        fn(p);
        this.syncList();
        this.d.settings.save?.();
    }

    /* ── 全局开关（底部） ── */

    toggleEnabled(on: boolean): void {
        this.d.settings.companionEnabled = on;
        this.d.settings.save?.();
        this.d.applySettings();
        this.d.onCompanionToggle?.();
    }

    toggleAi(on: boolean): void {
        this.d.settings.companionAi = on;
        this.d.settings.save?.();
        this.d.applySettings();
    }

    /** 人设预设档（自定义配置的 prompt 优先级更高，这里管全局档）。 */
    persona(): "gentle" | "sharp" | "genki" | "calm" {
        const v = this.d.settings.companionPersona;
        return v === "sharp" || v === "genki" || v === "calm" ? v : "gentle";
    }

    setPersona(v: string): void {
        this.d.settings.companionPersona = v === "sharp" || v === "genki" || v === "calm" ? v : "gentle";
        this.d.settings.save?.();
    }
}
