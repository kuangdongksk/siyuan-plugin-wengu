import {Dialog} from "siyuan";
import {
    defaultAgentModelId,
    listAiModels,
} from "./AgentClient";
import type {
    WenguRevealMode,
    WenguTimingMode,
} from "./types";
import {
    clampMinutes,
    esc,
} from "./ui";

/**
 * 设置页共享的设置对象形状（index.ts 持有，转换弹窗也读它）。
 * 语义（design-review P1-3）：设置页=**默认值**（开刷面板/转换弹窗的
 * 初始选择）；「上次临时用的」归 prefs，不写回这里。
 */
export interface WenguSettingsShape {
    showNums: boolean;
    showAttempts?: boolean;
    showWrong?: boolean;
    /** 默认计时方式。 */
    defaultTiming?: WenguTimingMode;
    /** 默认答案展示方式。 */
    defaultReveal?: WenguRevealMode;
    /** 默认倒计时分钟数。 */
    defaultCountdownMin?: number;
    /** 默认 AI 模型（空=跟随智能体设置）。 */
    convertModelId?: string;
    /** 默认「填空转选择」（转换时把填空题改写为单选）。 */
    fillToChoice?: boolean;
    /** 默认「大题拆多步」（转换时把可分解的工科大题改写为多步引导题）。 */
    bigToSteps?: boolean;
    save?: () => void;
}

/**
 * 温故设置页：仿思源原生设置的外观——左侧分类导航 + 右侧分组条目。
 * 纯用思源内置 config__* / b3-* 类名（与主程序设置页同款观感），
 * 不引入自定义样式。分类：刷题（显示题号）/ AI 转换（默认模型）/ 关于。
 */
export function openWenguSetting(opts: {
    i18n: Record<string, string>;
    pluginName: string;
    version: string;
    settings: WenguSettingsShape;
    onSettingsChange: () => void;
}): void {
    const t = (k: string) => opts.i18n[k] || k;

    const models = listAiModels();
    const def = models.find((m) => m.id === defaultAgentModelId());
    const saved = opts.settings.convertModelId ?? "";
    const modelOptions = `<option value="">${esc(t("modelDefault"))}${
        def ? `（${esc(def.provider)} · ${esc(def.name)}）` : ""
    }</option>${
        models
            .map((m) =>
                `<option value="${esc(m.id)}"${saved === m.id ? " selected" : ""}>${esc(m.provider)} · ${
                    esc(m.name)
                }</option>`
            )
            .join("")
    }`;

    const tab = (id: string, icon: string, label: string, focus = false) =>
        `<li class="b3-list-item${focus ? " b3-list-item--focus" : ""}" data-tab="${id}">
  <svg class="b3-list-item__graphic"><use xlink:href="#${icon}"></use></svg>
  <span class="b3-list-item__text">${esc(label)}</span>
</li>`;
    const item = (title: string, desc: string, control: string) =>
        `<div class="fn__flex b3-label config__item">
  <div class="fn__flex-1 fn__flex-center">${esc(title)}
    <div class="b3-label__text">${esc(desc)}</div>
  </div>
  <div class="fn__space"></div>
  ${control}
</div>`;

    const dialog = new Dialog({
        title: `${opts.pluginName} · ${t("settingsTitle")}`,
        width: "780px",
        height: "520px",
        content: `<div class="fn__flex config__panel" style="height:100%;max-width:none">
  <div class="config__side b3-list b3-list--background">
    <ul class="config__tab-scroll">
      ${tab("drill", "iconList", t("setTabDrill"), true)}
      ${tab("convert", "iconSparkles", t("setTabConvert"))}
      ${tab("about", "iconInfo", t("setTabAbout"))}
    </ul>
  </div>
  <div class="config__tab-wrap">
    <div class="config__tab-container" data-panel="drill">
      <div class="config-group">
        <div class="config-title">${esc(t("setGroupDisplay"))}</div>
        <div class="config-items">
          ${
            item(
                t("settingShowNums"),
                t("settingShowNumsDesc"),
                `<input class="b3-switch fn__flex-center" type="checkbox" data-set="shownums"${
                    opts.settings.showNums ? " checked" : ""
                }>`,
            )
        }
          ${
            item(
                t("settingShowAttempts"),
                t("settingShowAttemptsDesc"),
                `<input class="b3-switch fn__flex-center" type="checkbox" data-set="showattempts"${
                    opts.settings.showAttempts !== false ? " checked" : ""
                }>`,
            )
        }
          ${
            item(
                t("settingShowWrong"),
                t("settingShowWrongDesc"),
                `<input class="b3-switch fn__flex-center" type="checkbox" data-set="showwrong"${
                    opts.settings.showWrong !== false ? " checked" : ""
                }>`,
            )
        }
        </div>
      </div>
      <div class="config-group">
        <div class="config-title">${esc(t("setGroupDefaults"))}</div>
        <div class="config-items">
          ${
            item(
                t("setDefaultTiming"),
                t("setDefaultHint"),
                `<select class="b3-select fn__flex-center fn__size200" data-set="deftiming">
<option value="countUp"${
                    opts.settings.defaultTiming !== "countdown" && opts.settings.defaultTiming !== "perQuestion" &&
                        opts.settings.defaultTiming !== "none" ?
                        " selected" :
                        ""
                }>${esc(t("timingCountUp"))}</option>
<option value="countdown"${opts.settings.defaultTiming === "countdown" ? " selected" : ""}>${
                    esc(t("timingCountdown"))
                }</option>
<option value="perQuestion"${opts.settings.defaultTiming === "perQuestion" ? " selected" : ""}>${
                    esc(t("timingPerQuestion"))
                }</option>
<option value="none"${opts.settings.defaultTiming === "none" ? " selected" : ""}>${esc(t("timingNone"))}</option>
</select>`,
            )
        }
          ${
            item(
                t("setDefaultReveal"),
                t("setDefaultHint"),
                `<select class="b3-select fn__flex-center fn__size200" data-set="defreveal">
<option value="instant"${opts.settings.defaultReveal !== "after" ? " selected" : ""}>${esc(t("revealInstant"))}</option>
<option value="after"${opts.settings.defaultReveal === "after" ? " selected" : ""}>${esc(t("revealAfter"))}</option>
</select>`,
            )
        }
          ${
            item(
                t("setDefaultCountdownMin"),
                t("setDefaultCountdownMinDesc"),
                `<input class="b3-text-field fn__flex-center fn__size200" type="number" min="1" max="600" data-set="defminutes" value="${
                    opts.settings.defaultCountdownMin ?? 20
                }">`,
            )
        }
        </div>
      </div>
    </div>
    <div class="config__tab-container fn__none" data-panel="convert">
      <div class="config-group">
        <div class="config-title">${esc(t("setGroupConvert"))}</div>
        <div class="config-items">
          ${
            item(
                t("setModelLabel"),
                t("setModelHint"),
                `<select class="b3-select fn__flex-center fn__size200" data-set="model">${modelOptions}</select>`,
            )
        }
          ${
            item(
                t("fillToChoice"),
                t("fillToChoiceDesc"),
                `<input class="b3-switch fn__flex-center" type="checkbox" data-set="fillchoice"${
                    opts.settings.fillToChoice ? " checked" : ""
                }>`,
            )
        }
          ${
            item(
                t("bigToSteps"),
                t("bigToStepsDesc"),
                `<input class="b3-switch fn__flex-center" type="checkbox" data-set="bigsteps"${
                    opts.settings.bigToSteps ? " checked" : ""
                }>`,
            )
        }
        </div>
      </div>
    </div>
    <div class="config__tab-container fn__none" data-panel="about">
      <div class="b3-label">
        <div class="fn__block">${esc(opts.pluginName)} v${esc(opts.version)}
          <div class="b3-label__text">${esc(t("setAboutText"))}</div>
          <div class="fn__hr"></div>
        </div>
      </div>
    </div>
  </div>
</div>`,
    });

    const root = dialog.element;
    for (const li of root.querySelectorAll<HTMLElement>("[data-tab]")) {
        li.addEventListener("click", () => {
            root.querySelectorAll("[data-tab]").forEach((n) => n.classList.remove("b3-list-item--focus"));
            li.classList.add("b3-list-item--focus");
            root.querySelectorAll<HTMLElement>("[data-panel]").forEach((p) => {
                p.classList.toggle("fn__none", p.dataset.panel !== li.dataset.tab);
            });
        });
    }
    const bindSwitch = (
        key: "shownums" | "showattempts" | "showwrong" | "fillchoice" | "bigsteps",
        apply: (v: boolean) => void,
    ) => {
        root.querySelector<HTMLInputElement>(`[data-set='${key}']`)?.addEventListener("change", (ev) => {
            apply((ev.target as HTMLInputElement).checked);
            opts.settings.save?.();
            opts.onSettingsChange();
        });
    };
    bindSwitch("shownums", (v) => opts.settings.showNums = v);
    bindSwitch("showattempts", (v) => opts.settings.showAttempts = v);
    bindSwitch("showwrong", (v) => opts.settings.showWrong = v);
    bindSwitch("fillchoice", (v) => opts.settings.fillToChoice = v);
    bindSwitch("bigsteps", (v) => opts.settings.bigToSteps = v);
    root.querySelector<HTMLSelectElement>("[data-set='deftiming']")?.addEventListener("change", (ev) => {
        const v = (ev.target as HTMLSelectElement).value;
        opts.settings.defaultTiming = v === "countdown" || v === "perQuestion" || v === "none" ? v : "countUp";
        opts.settings.save?.();
    });
    root.querySelector<HTMLSelectElement>("[data-set='defreveal']")?.addEventListener("change", (ev) => {
        opts.settings.defaultReveal = (ev.target as HTMLSelectElement).value === "after" ? "after" : "instant";
        opts.settings.save?.();
    });
    root.querySelector<HTMLInputElement>("[data-set='defminutes']")?.addEventListener("change", (ev) => {
        opts.settings.defaultCountdownMin = clampMinutes(Number((ev.target as HTMLInputElement).value));
        opts.settings.save?.();
    });
    root.querySelector<HTMLSelectElement>("[data-set='model']")?.addEventListener("change", (ev) => {
        opts.settings.convertModelId = (ev.target as HTMLSelectElement).value;
        opts.settings.save?.();
    });
}
