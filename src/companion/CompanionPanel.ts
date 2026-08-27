import type { QuizView } from "../quiz";
import { companionCtl } from "./index";
import type { CompanionProfile } from "./CompanionCtl";
import { formInput, formRow, formSelect, formOption, formSwitch, formTextarea } from "../ui/FormHtml";
import { bindModelPicker, modelPickHtml } from "../ui/ModelPicker";
import { esc } from "../ui/shared";

/**
 * 学伴管理工作区面板（设置页的管理职能整体搬来）：左列学伴卡片
 * （默认团子 + 各配置，使用中徽标），右列编辑器（名字/自定义 prompt/
 * 形象图片目录/模型），底部全局开关。点击卡片 = 激活并编辑；切换后
 * 立即调 ctl.loadImages() 换形象。改动即时落盘，面板就地重渲染。
 */

interface PanelCtx {
    t: (k: string) => string;
    settings: {
        companionEnabled?: boolean;
        companionPersona?: string;
        companionAi?: boolean;
        companionProfiles?: CompanionProfile[];
        companionActiveId?: string;
        save?: () => void;
    };
}

function profilesOf(s: PanelCtx["settings"]): CompanionProfile[] {
    return s.companionProfiles ?? [];
}

function activeOf(s: PanelCtx["settings"]): CompanionProfile | undefined {
    return profilesOf(s).find((p) => p.id === s.companionActiveId);
}

function profileId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function listHtml(ctx: PanelCtx): string {
    const { t, settings: s } = ctx;
    const cur = activeOf(s);
    const card = (pid: string, name: string) =>
        `<div class="wengu-ws-card${(cur?.id ?? "") === pid ? " wengu-ws-card-active" : ""}" data-pid="${esc(pid)}">
  <span class="wengu-ws-card-name">${esc(name)}</span>${(cur?.id ?? "") === pid ? `<span class="wengu-ws-card-badge">${esc(t("companionUseBadge"))}</span>` : ""}
</div>`;
    const cards =
        card("", t("companionDefaultOption")) +
        profilesOf(s)
            .map((p) => card(p.id, p.name || t("companionDefaultName")))
            .join("");
    return `<div class="wengu-ws-list">
  ${cards}
  <button type="button" class="b3-button b3-button--outline wengu-ws-newbtn" data-pact="new">${esc(
      t("companionNew")
  )}</button>
</div>`;
}

function editorHtml(ctx: PanelCtx): string {
    const { t } = ctx;
    const cur = activeOf(ctx.settings);
    if (!cur) return `<div class="wengu-ws-editor wengu-muted">${esc(t("companionDefaultHint"))}</div>`;
    return `<div class="wengu-ws-editor">
  ${formRow(t("companionNameLabel"), "", formInput("cpname", cur.name, "", "data-cp"))}
  <!-- 大文本域不走 formRow：主题 .fn__flex-1 零基宽的标题格会被
       width:100% 的 textarea 挤成 0×674 竖条（20260827 实测），
       改标签在上、文本域占满在下的堆叠布局 -->
  <div class="wengu-cp-stack">
    <div class="wengu-cp-lab">
      <span>${esc(t("companionPromptLabel"))}</span>
      <div class="b3-label__text">${esc(t("companionPromptDesc"))}</div>
    </div>
    <textarea class="b3-text-field" style="width:100%;box-sizing:border-box;height:auto;resize:vertical" rows="5" spellcheck="false" data-cp="cpprompt">${esc(
        cur.prompt
    )}</textarea>
  </div>
  ${formRow(
      t("companionImageDirLabel"),
      t("companionImageDirDesc"),
      formInput("cpimgdir", cur.imageDir, 'spellcheck="false" placeholder="assets/wengu/companion"', "data-cp")
  )}
  ${formRow(t("companionModelLabel"), t("companionModelHint"), modelPickHtml("cpmodel", cur.modelId, "data-cp"))}
  <div class="fn__flex" style="gap:8px;justify-content:flex-end;padding:8px 0">
    <button type="button" class="b3-button b3-button--text" data-pact="del">${esc(t("companionDelete"))}</button>
  </div>
</div>`;
}

function footHtml(ctx: PanelCtx): string {
    const { t, settings: s } = ctx;
    return `<div class="wengu-ws-foot">
  ${formRow(t("companionEnableLabel"), t("companionEnableDesc"), formSwitch("cpenabled", s.companionEnabled !== false, "data-cp"))}
  ${formRow(t("companionAiLabel"), t("companionAiDesc"), formSwitch("cpai", s.companionAi !== false, "data-cp"))}
  ${formRow(
      t("companionPersonaLabel"),
      t("companionPersonaDesc"),
      formSelect(
          "cppersona",
          formOption(
              "gentle",
              t("personaGentle"),
              s.companionPersona !== "sharp" && s.companionPersona !== "genki" && s.companionPersona !== "calm"
          ) +
              formOption("sharp", t("personaSharp"), s.companionPersona === "sharp") +
              formOption("genki", t("personaGenki"), s.companionPersona === "genki") +
              formOption("calm", t("personaCalm"), s.companionPersona === "calm"),
          "data-cp"
      )
  )}
</div>`;
}

/** 学伴管理面板渲染入口（WorkspaceShell 调；root=工作区主区）。 */
export function renderCompanionPanelInto(v: QuizView, root: HTMLElement): void {
    const settings = v.settingsOf();
    const ctx: PanelCtx = { t: v.t, settings: settings ?? {} };
    root.innerHTML = `<div class="wengu-ws-page">
  <div class="wengu-ws-title">${esc(v.t("companionPanelTitle"))}</div>
  ${footHtml(ctx)}
  <div class="wengu-ws-cols">${listHtml(ctx)}${editorHtml(ctx)}</div>
</div>`;
    bindCompanionPanel(v, root, ctx);
}

function bindCompanionPanel(v: QuizView, root: HTMLElement, ctx: PanelCtx): void {
    const { t, settings: s } = ctx;
    const save = s.save?.bind(s);
    const rerender = (): void => renderCompanionPanelInto(v, root);
    const withProfile = (fn: (p: CompanionProfile) => void): void => {
        const cur = activeOf(s);
        if (cur) fn(cur);
    };
    const q = <T extends HTMLElement>(sel: string): T | null => root.querySelector<T>(sel);
    let delArmed = false;
    let delTimer: ReturnType<typeof setTimeout> | undefined;

    for (const card of root.querySelectorAll<HTMLElement>("[data-pid]")) {
        card.addEventListener("click", () => {
            s.companionActiveId = card.dataset.pid || undefined;
            save?.();
            companionCtl()?.loadImages();
            rerender();
        });
    }
    q<HTMLInputElement>("[data-cp='cpname']")?.addEventListener("change", (ev) => {
        withProfile((p) => (p.name = (ev.target as HTMLInputElement).value.trim().slice(0, 20)));
        save?.();
    });
    q<HTMLTextAreaElement>("[data-cp='cpprompt']")?.addEventListener("change", (ev) => {
        withProfile((p) => (p.prompt = (ev.target as HTMLTextAreaElement).value.slice(0, 2000)));
        save?.();
    });
    q<HTMLInputElement>("[data-cp='cpimgdir']")?.addEventListener("change", (ev) => {
        withProfile((p) => (p.imageDir = (ev.target as HTMLInputElement).value.trim()));
        save?.();
        companionCtl()?.loadImages();
    });
    bindModelPicker(q<HTMLButtonElement>("[data-cp='cpmodel']"), {
        t,
        onPick: (value) => {
            withProfile((p) => (p.modelId = value));
            save?.();
        },
    });
    q<HTMLButtonElement>("[data-pact='new']")?.addEventListener("click", () => {
        const list = profilesOf(s);
        const p: CompanionProfile = {
            id: profileId(),
            name: `${t("companionNewNamePrefix")}${list.length + 1}`,
            prompt: "",
            imageDir: "",
            modelId: "",
        };
        list.push(p);
        s.companionProfiles = list;
        s.companionActiveId = p.id;
        save?.();
        companionCtl()?.loadImages();
        rerender();
    });
    q<HTMLButtonElement>("[data-pact='del']")?.addEventListener("click", (ev) => {
        const btn = ev.target as HTMLButtonElement;
        if (!delArmed) {
            delArmed = true;
            btn.textContent = t("collectConfirm");
            delTimer = setTimeout(() => {
                delArmed = false;
                btn.textContent = t("companionDelete");
            }, 3000);
            return;
        }
        clearTimeout(delTimer);
        delArmed = false;
        const cur = activeOf(s);
        if (!cur) return;
        s.companionProfiles = profilesOf(s).filter((p) => p.id !== cur.id);
        if (s.companionProfiles.length === 0) s.companionProfiles = undefined;
        s.companionActiveId = undefined;
        save?.();
        companionCtl()?.loadImages();
        rerender();
    });
    q<HTMLInputElement>("[data-cp='cpenabled']")?.addEventListener("change", (ev) => {
        s.companionEnabled = (ev.target as HTMLInputElement).checked;
        save?.();
        v.applySettings();
    });
    q<HTMLInputElement>("[data-cp='cpai']")?.addEventListener("change", (ev) => {
        s.companionAi = (ev.target as HTMLInputElement).checked;
        save?.();
        v.applySettings();
    });
    q<HTMLSelectElement>("[data-cp='cppersona']")?.addEventListener("change", (ev) => {
        const val = (ev.target as HTMLSelectElement).value;
        s.companionPersona = val === "sharp" || val === "genki" || val === "calm" ? val : "gentle";
        save?.();
    });
}
