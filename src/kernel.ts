import type * as kernel from "siyuan/kernel";

/**
 * 温故内核侧插件。
 *
 * 内核端目前只做生命周期日志；后续如需题库的 SQL 查询缓存、
 * 定时复习提醒等服务端逻辑，在 onload 中注册。
 */
class WenguKernelPlugin {
    private readonly siyuan: kernel.ISiyuan = siyuan;

    constructor() {
        this.siyuan.plugin.lifecycle.onload = this.onload.bind(this);
        this.siyuan.plugin.lifecycle.onunload = this.onunload.bind(this);
    }

    private async onload(): Promise<void> {
        await this.siyuan.logger.info("wengu kernel plugin loaded:", this.siyuan.plugin.name);
    }

    private async onunload(): Promise<void> {
        await this.siyuan.logger.info("wengu kernel plugin unloaded");
    }
}

new WenguKernelPlugin();
