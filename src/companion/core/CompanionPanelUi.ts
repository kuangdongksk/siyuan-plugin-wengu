import type { CompanionProfile } from "./CompanionCtl";

/**
 * 学伴管理面板的响应态形状（四件套之一，模式见 docs/svelte-migration.md；
 * 面板为单层扁平表单，组件树无深层子组件，不需要 context Symbol——
 * 控制器与组件同在 CompanionPanelApp.svelte 组装）。
 *
 * settings 本体不进响应态（暗雷 §9：插件全局对象只镜像渲染要读的
 * 字段；表单值非受控直写 settings 后 save，面板外代码零感知）。
 */

/** 控制器写、组件读的响应态。 */
export interface CompanionPanelUi {
    /** 当前编辑中的配置 id（空串=内置团子）。 */
    activeId: string;
    /** 配置列表镜像（字段变更后整体重赋值触发列表重绘）。 */
    profiles: CompanionProfile[];
    /** 删除按钮已进入两击确认态（3s 自动复位，控制器持定时器）。 */
    delArmed: boolean;
}

/** 初始态（$state 包装在 CompanionPanelApp 内完成）。 */
export function initialCompanionPanelUi(): CompanionPanelUi {
    return { activeId: "", profiles: [], delArmed: false };
}
