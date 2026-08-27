import type { CompanionProfile } from "./CompanionCtl";
import type { CompanionPanelUi } from "./CompanionPanelUi";

/**
 * 学伴管理面板控制器（自旧 core/CompanionPanel.ts 的字符串模板 +
 * 逐控件绑定迁来，行为对齐）：配置 CRUD + 全局开关，每变更即时落盘。
 * 写 ui 即响应（消灭旧版「每改一项全面板重灌」）；两击确认态在
 * ui.delArmed，3s 定时器由 destroy 清理。
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
}

/** 新配置 id（时间戳36 + 随机段）。 */
function profileId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export class CompanionPanelCtl {
    private delTimer: ReturnType<typeof setTimeout> | undefined;

    constructor(
        private readonly ui: CompanionPanelUi,
        private readonly d: CompanionPanelDeps
    ) {
        this.syncFromSettings();
    }

    destroy(): void {
        clearTimeout(this.delTimer);
    }

    /** 当前编辑中的配置（undefined=内置团子）。 */
    active(): CompanionProfile | undefined {
        return this.ui.profiles.find((p) => p.id === this.ui.activeId);
    }

    /** 设置镜像同步进响应态（挂载时与列表结构性变化后）。 */
    private syncFromSettings(): void {
        this.ui.activeId = this.d.settings.companionActiveId ?? "";
        this.syncList();
    }

    private syncList(): void {
        this.ui.profiles = [...(this.d.settings.companionProfiles ?? [])];
    }

    /** 点卡片=切换编辑对象（含默认团子卡）；生效形象即时换。 */
    activate(pid: string): void {
        this.d.settings.companionActiveId = pid || undefined;
        this.ui.activeId = pid;
        this.disarmDel();
        this.d.settings.save?.();
        this.d.reloadImages();
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
    }

    /** 删除两击：首击进确认态（按钮换确认文案 3s 自动复原），再击执行。 */
    delClick(): void {
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
        this.d.settings.companionProfiles = rest.length > 0 ? rest : undefined;
        this.d.settings.companionActiveId = undefined;
        this.syncFromSettings();
        this.d.settings.save?.();
        this.d.reloadImages();
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
        const cur = this.active();
        if (!cur) return;
        fn(cur);
        this.syncList();
        this.d.settings.save?.();
    }

    /* ── 全局开关（底部） ── */

    toggleEnabled(on: boolean): void {
        this.d.settings.companionEnabled = on;
        this.d.settings.save?.();
        this.d.applySettings();
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
