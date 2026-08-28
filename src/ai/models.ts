/**
 * 思源 AI 模型清单（读 window.siyuan.config.ai，2026-08-27 从
 * convert/AgentClient 抽离）：模型候选与默认模型的唯一来源，设置页、
 * 转换弹窗（ui/ModelPicker）与各 AI 调用点共用。
 */

/** 用户在 设置→AI 配置的可选模型（提供商 × 模型）。 */
export interface WenguAiModel {
    /** 模型 id（agent/chat 的 model 参数）。 */
    id: string;
    name: string;
    provider: string;
}

interface SiyuanAiModelConf {
    id?: string;
    name?: string;
    displayName?: string;
    enabled?: boolean;
}
interface SiyuanAiProviderConf {
    id?: string;
    displayName?: string;
    enabled?: boolean;
    models?: SiyuanAiModelConf[];
}
interface SiyuanAiConf {
    agent?: { modelId?: string };
    providers?: SiyuanAiProviderConf[];
}
interface SiyuanWindow {
    siyuan?: { config?: { ai?: SiyuanAiConf } };
}

function aiConf(): SiyuanAiConf {
    return (window as unknown as SiyuanWindow).siyuan?.config?.ai ?? {};
}

/** 列出用户配置的全部可用模型（启用的提供商 × 启用的模型）。 */
export function listAiModels(): WenguAiModel[] {
    const out: WenguAiModel[] = [];
    for (const p of aiConf().providers ?? []) {
        if (!p.enabled) continue;
        for (const m of p.models ?? []) {
            if (!m.enabled) continue;
            const name = m.displayName || m.name;
            if (name) out.push({ id: m.id || m.name, name, provider: p.displayName || p.id || "?" });
        }
    }
    return out;
}

/** 智能体设置里的默认模型 id（空串表示未配置）。 */
export function defaultAgentModelId(): string {
    return aiConf().agent?.modelId ?? "";
}

/** 校正模型 id 后再送内核：不在当前可用清单（被删/停用/旧格式存量）
 *  回落默认，默认也无效则空串（省略 model 让内核用自己的默认）。
 *  3.8.1 模型 id 是内核生成的时戳格式，删改配置后存量选择全部失效，
 *  内核对未知 id 一律报「请先参考用户指南 [人工智能] 章节进行配置」
 *  （20260829 用户「已配置好却一用 AI 就报」——学伴档案存了已删模型）。 */
export function resolveModelId(preferred: string): string {
    const models = listAiModels();
    if (preferred && models.some((m) => m.id === preferred)) return preferred;
    const def = defaultAgentModelId();
    return models.some((m) => m.id === def) ? def : "";
}
