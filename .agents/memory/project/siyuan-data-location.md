---
name: siyuan-data-location
description: 本机真实思源数据目录位置、插件部署目标、.sy 块文件加密限制
metadata:
    node_type: memory
    type: project
    originSessionId: sess_3bdb5d2e-1541-4791-98ce-e871f3905338
---

2026-08-21 用户提供的本机真实思源数据目录：`/Volumes/baiWeiNV7200/data/思源/工作/`（含 `conf/`、`data/`、`history/`、`repo/`、`temp/`）。

- **插件部署目标**：`工作/data/plugins/siyuan-plugin-wengu/`（与其它已装插件同级，布局为 plugin.json + index.js/index.css/i18n + kernel.js）。改代码后 `pnpm build` → 覆盖拷贝 `dist/` 到该目录 → 思源重载插件实测。
- ⚠️ **i18n 必须拷 `dist/i18n/`，不是仓库根 `i18n/`**（20260915 踩坑：面板全变英文键名）：`pnpm build`（production）只把 `src/i18n/` 拷进 `dist/i18n/`；仓库根 `i18n/`（.gitignore 的 `/i18n`）只在 **dev 构建分支**才刷新——长期陈旧。拷错后插件取词 `i18n[k] || k` 缺键回落键名，UI 直接显示 `aiLogLabel` 这类裸键名。正确部署=根放 `dist/index.js` + `dist/index.css` + `dist/i18n/*` + `plugin.json` + `icon.png`。部署后探针别只查 index.js 字符串，**要 grep 部署后的 i18n JSON 里最新加的键**。
- **i18n 副本**：2026-08-25 曾发现 `i18n/` 子目录和根目录各一套 zh-CN/en.json（两处都拷）；**20260903 实测根目录副本已不存在**（目录仅剩 i18n/ 子目录）。插件目录是扁平布局：index.js/index.css/plugin.json 在根、**无 dist/ 子目录**——`cp dist/… $DEST/dist/` 会报 Not a directory，直接拷到根。
- Web 端锁屏密码 = conf/conf.json 的 `accessAuthCode: "awsd31302"`（2026-08-27 实测用于浏览器调试，见 [[siyuan-web-ui-debug]]）。
- **`.sy` 块文件是 AES 加密的**，离线直读会得到二进制/编码错误，无法在磁盘上验证存储结构；验证块属性、SQL 查询只能靠思源运行时 API（`/api/query/sql`、`/api/attr/*`，见 [[siyuan-api-patterns]]）。
- 2026-08-21 时点库内 **0 道** `custom-plugin-wengu` 题目块（离线扫 `.sy` 命中 0），刷题页签因此显示"暂无可刷"属预期，等用户转换后才出列表。

**20260916 API 坑**：`/api/petal/setPetalEnabled` 的插件标识参数是 **`packageName`** 不是 `id`（传 id 报 `Field [packageName] is required`）；`loadPetals` 也必带 **`frontend:"desktop"`**（缺参同款报错且 grep 无输出易误判 petal 不存在）；disable→enable 循环（各 sleep 3s）换新脚本足够，返回体带 `"enabled":true` 即成功。

**20260914 卸载后重装实录（用户在思源里卸载了插件）**：`data/plugins/siyuan-plugin-wengu/` 目录整个消失 + `conf/conf.json` 的 `conf.pets` 清空。干净重装 = 重建目录（扁平：`plugin.json` + `icon.png` + `dist/index.js` + `dist/index.css` + `i18n/{zh-CN,en}.json`；仓库根 plugin.json 与 dist/plugin.json 内容相同）→ `setPetalEnabled enabled:true` 重新登记（返回体带 petal 对象即成功）→ `loadPetals` 验证 enabled。⚠️ **插件 JS 是窗口级注入**：重开页签不会换脚本，更新/重装后必须 disable→enable 循环（各 sleep 2s）或重开思源窗口，否则跑的还是旧脚本——「修了没生效」假报警的常见根因（当日本例：#73 面板停止被报无效，实为旧脚本在跑）。

**How to apply:** 需要实测/部署时直接用的路径；别再用离线文本读取 `.sy` 做验证。相关：[[pivot-to-ai-block-conversion]]。
