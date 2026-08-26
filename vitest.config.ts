import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * 纯逻辑测试（判分/洗牌/切块/解析/归一化）：node 环境、不启 jsdom。
 * "siyuan" 别名到 tests/siyuan-stub.ts（真包无运行时入口，见该文件）。
 * 内核 IO（工厂层）不在单测范围——真机行为坑见 AGENTS.md「内核坑」。
 */
export default defineConfig({
    resolve: {
        alias: {
            siyuan: fileURLToPath(new URL("./tests/siyuan-stub.ts", import.meta.url)),
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
