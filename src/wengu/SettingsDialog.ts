import {Dialog} from "siyuan";
import {modelOptionsHtml} from "./AgentClient";
import {
    formInput,
    formOption,
    formRow,
    formSelect,
    formSwitch,
    svgIcon,
} from "./FormHtml";
import type {
    WenguRevealMode,
    WenguTimingMode,
} from "./types";
import {
    clampMinutes,
    esc,
    fmt,
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
    /** 默认 AI 模型（空=弹窗预选智能体设置的默认模型）。 */
    convertModelId?: string;
    /** 默认「填空转选择」（转换时把填空题改写为单选）。 */
    fillToChoice?: boolean;
    /** 默认「大题拆多步」（转换时把可分解的工科大题改写为多步引导题）。 */
    bigToSteps?: boolean;
    /** 默认转换并发批数（1=串行；>1 走内置直连通道）。 */
    convertParallel?: number;
    /** 默认生成位置：same=原文档同目录；custom=指定父文档下面。 */
    convertTargetMode?: "same" | "custom";
    /** 指定父文档 id 或 siyuan:// 链接（convertTargetMode=custom 时用）。 */
    convertTargetId?: string;
    /** MinerU API Token（mineru.net 注册获取，PDF 导入用）。 */
    mineruToken?: string;
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

    const saved = opts.settings.convertModelId ?? "";
    const tabIcon = (id: string, icon: string, label: string, focus = false) =>
        `<li class="b3-list-item${focus ? " b3-list-item--focus" : ""}" data-tab="${id}">
  ${svgIcon(icon, "b3-list-item__graphic")}
  <span class="b3-list-item__text">${esc(label)}</span>
</li>`;

    const dialog = new Dialog({
        title: `${opts.pluginName} · ${t("settingsTitle")}`,
        width: "780px",
        height: "520px",
        content: `<div class="fn__flex config__panel" style="height:100%;max-width:none">
  <div class="config__side b3-list b3-list--background">
    <ul class="config__tab-scroll">
      ${tabIcon("drill", "iconList", t("setTabDrill"), true)}
      ${tabIcon("convert", "iconSparkles", t("setTabConvert"))}
      ${tabIcon("about", "iconInfo", t("setTabAbout"))}
    </ul>
  </div>
  <div class="config__tab-wrap">
    <div class="config__tab-container" data-panel="drill">
      <div class="config-group">
        <div class="config-title">${esc(t("setGroupDisplay"))}</div>
        <div class="config-items">
          ${
            formRow(
                t("settingShowNums"),
                t("settingShowNumsDesc"),
                formSwitch("shownums", opts.settings.showNums, "data-set"),
            )
        }
          ${
            formRow(
                t("settingShowAttempts"),
                t("settingShowAttemptsDesc"),
                formSwitch("showattempts", opts.settings.showAttempts !== false, "data-set"),
            )
        }
          ${
            formRow(
                t("settingShowWrong"),
                t("settingShowWrongDesc"),
                formSwitch("showwrong", opts.settings.showWrong !== false, "data-set"),
            )
        }
        </div>
      </div>
      <div class="config-group">
        <div class="config-title">${esc(t("setGroupDefaults"))}</div>
        <div class="config-items">
          ${
            formRow(
                t("setDefaultTiming"),
                t("setDefaultHint"),
                formSelect(
                    "deftiming",
                    formOption(
                        "countUp",
                        t("timingCountUp"),
                        opts.settings.defaultTiming !== "countdown" && opts.settings.defaultTiming !== "perQuestion" &&
                            opts.settings.defaultTiming !== "none",
                    ) +
                        formOption("countdown", t("timingCountdown"), opts.settings.defaultTiming === "countdown") +
                        formOption(
                            "perQuestion",
                            t("timingPerQuestion"),
                            opts.settings.defaultTiming === "perQuestion",
                        ) +
                        formOption("none", t("timingNone"), opts.settings.defaultTiming === "none"),
                    "data-set",
                ),
            )
        }
          ${
            formRow(
                t("setDefaultReveal"),
                t("setDefaultHint"),
                formSelect(
                    "defreveal",
                    formOption("instant", t("revealInstant"), opts.settings.defaultReveal !== "after") +
                        formOption("after", t("revealAfter"), opts.settings.defaultReveal === "after"),
                    "data-set",
                ),
            )
        }
          ${
            formRow(
                t("setDefaultCountdownMin"),
                t("setDefaultCountdownMinDesc"),
                formInput(
                    "defminutes",
                    String(opts.settings.defaultCountdownMin ?? 20),
                    "type='number' min='1' max='600'",
                    "data-set",
                ),
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
            formRow(
                t("setModelLabel"),
                t("setModelHint"),
                formSelect("model", modelOptionsHtml(saved), "data-set"),
            )
        }
          ${
            formRow(
                t("fillToChoice"),
                t("fillToChoiceDesc"),
                formSwitch("fillchoice", opts.settings.fillToChoice === true, "data-set"),
            )
        }
          ${
            formRow(
                t("bigToSteps"),
                t("bigToStepsDesc"),
                formSwitch("bigsteps", opts.settings.bigToSteps === true, "data-set"),
            ) +
            formRow(
                t("setConvertParallel"),
                t("setConvertParallelDesc"),
                formSelect(
                    "defparallel",
                    formOption("1", t("convertParallel1"), (opts.settings.convertParallel ?? 1) <= 1) +
                        formOption("2", fmt(t("convertParallelN"), {n: "2"}), opts.settings.convertParallel === 2) +
                        formOption("3", fmt(t("convertParallelN"), {n: "3"}), opts.settings.convertParallel === 3) +
                        formOption("4", fmt(t("convertParallelN"), {n: "4"}), opts.settings.convertParallel === 4),
                    "data-set",
                ),
            )
        }
          ${
            formRow(
                t("convertTarget"),
                t("convertTargetHint"),
                formSelect(
                    "targetmode",
                    formOption("same", t("convertTargetSame"), opts.settings.convertTargetMode !== "custom") +
                        formOption("custom", t("convertTargetCustom"), opts.settings.convertTargetMode === "custom"),
                    "data-set",
                ),
            )
        }
          ${
            formRow(
                t("convertTargetDoc"),
                t("convertTargetDocHint"),
                formInput(
                    "targetid",
                    opts.settings.convertTargetId ?? "",
                    `spellcheck="false" placeholder="${esc(t("docIdPlaceholder"))}"`,
                    "data-set",
                ),
            )
        }
          ${
            formRow(
                t("mineruTokenLabel"),
                t("mineruTokenDesc"),
                formInput(
                    "minerutoken",
                    opts.settings.mineruToken ?? "",
                    'spellcheck="false" placeholder="mineru.net API Token"',
                    "data-set",
                ),
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
    root.querySelector<HTMLSelectElement>("[data-set='defparallel']")?.addEventListener("change", (ev) => {
        const n = Number((ev.target as HTMLSelectElement).value);
        opts.settings.convertParallel = n >= 2 && n <= 4 ? n : 1;
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
    root.querySelector<HTMLSelectElement>("[data-set='targetmode']")?.addEventListener("change", (ev) => {
        opts.settings.convertTargetMode = (ev.target as HTMLSelectElement).value === "custom" ? "custom" : "same";
        opts.settings.save?.();
    });
    root.querySelector<HTMLInputElement>("[data-set='targetid']")?.addEventListener("change", (ev) => {
        opts.settings.convertTargetId = (ev.target as HTMLInputElement).value;
        opts.settings.save?.();
    });
    root.querySelector<HTMLInputElement>("[data-set='minerutoken']")?.addEventListener("change", (ev) => {
        opts.settings.mineruToken = (ev.target as HTMLInputElement).value.trim();
        opts.settings.save?.();
    });
}
