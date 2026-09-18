---
name: machine-b-env-pitfalls
description: 机器B pnpm 崩溃已根治（全局对齐锁定版）与 node_modules/.cache 损坏卡死 webpack 的绕法
metadata:
    node_type: memory
    type: project
    originSessionId: sess_1ceae321-81e1-49d2-829e-d74d44e655cd
---

机器 B 外置卷仓库的工具链坑与处置：

1. **pnpm 崩溃已根治（20260901 定论，不再是绕法）**：曾报
   `TypeError: Cannot set property message … only has a getter
at RetryOperation`——根因链：全局 pnpm 11.17.0 与 package.json
   `packageManager: pnpm@11.4.0` 不一致 → 每次 pnpm 启动经版本托管
   联网拉 registry 元数据（本机网络时好时坏，[[mineru-material-location]]
   同款外网环境）→ 抓取超时抛 DOMException(AbortError)，其 message
   是原型 getter-only，而 11.17.0 错误脱敏**赋值** `error.message`
   （ESM 严格模式赋值即抛），真网络错误被二次崩溃掩盖；11.4.0 同
   路径只读不赋值无此雷。**修复 = `pnpm add -g pnpm@<锁定版>` 对齐
   （已装 11.4.0）**——版本托管短路、启动零联网，编辑器保存触发的
   格式化任务也不再有此崩溃。**铁律：bump packageManager 时必须
   同步升级全局 pnpm**，否则坏网络下复发。**20260902 复发一次（反向
   违反）**：全局被升到 11.25.0 而锁定版仍 11.4.0，项目内任何 pnpm
   命令（含 `pnpm --version`）都挂死或崩；离线修复法：用 store 里
   已缓存的 11.4.0 入口在**无 packageManager 字段的目录**（$HOME）跑
   `node /Volumes/baiWeiNV7200/pnpm/global/store/v11/links/@/pnpm/
11.4.0/<hash>/node_modules/pnpm/bin/pnpm.cjs add -g pnpm@11.4.0`
   ——不走版本托管零联网，2s 修好；store 路径下多版本共存（10/11.x
   都有）可直接取用。复发时的旧绕法仍有效：
   `node_modules/.bin/<tsc|vitest|webpack|eslint|prettier|svelte-check>`
   直调全部等效。
2. **webpack 永久卡死**：`node_modules/.cache` 损坏后 webpack 进程 CPU 0%、累计 4 秒不动（管道 tail 下无输出），杀进程 + `rm -rf node_modules/.cache` 后 1.5 秒编完。外置卷（/Volumes/baiWeiNV7200）IO 慢是常态，但「CPU 零且分钟级无进展」= 卡死而非慢。**先分清 watch 假象（20260914）**：webpack.config.js 有 `watch: !production`——不带 `--mode production` 跑就是 watch 模式，编完也不退出（0% CPU 挂 kevent），不是卡死；且单跑 app 段会因 CopyPlugin 找不到 `dist/kernel.js` 报 glob error——**完整链 = `NODE_OPTIONS= node_modules/.bin/run-s build:kernel build:app`**。
3. **外置卷瞬时 EIO（20260903 一次，暂无复发）**：内核报
   `sync …/petal/siyuan-plugin-wengu/ai-sessions92j3x6t.tmp: input/output error`——思源内核对插件存储是**原子写**（完整写
   `{name}{随机}.tmp` → rename 替换），那次在 rename/刷盘阶段撞
   OS 层 EIO，tmp 完整可读但改名失败 → 残留孤儿。**瞬时性判定法**：事发后主文件 mtime 仍持续前进（bank/ai-sessions 都在更新）+ 盘容量充足（805G 空）= USB/NVMe 盒子瞬断类一次性故障；**复发才查盘**（磁盘工具 S.M.A.R.T./急救，先排 USB 线与供电）。孤儿 tmp
   会累积（8/25 的 historyg2vy9zi.tmp 同款）且随思源同步带到云端/另一台机。**内核侧落盘失败对插件不可见**：saveData 的
   fetchPost 回调对任何内核响应都 resolve → 插件无浮层报警 ≠ 没有写失败；原子写保住主文件不损坏，代价只是防抖窗口内的尾笔
   （ai-sessions 600ms / bank 2s，那次丢了一条 AI 会话登记）。**删孤儿前可比对 tmp 与主文件内容**——孤儿里可能兜着主文件
   没有的尾笔（该次一条 10:14:08 的登记只在 tmp、7 秒窗口丢失），确认无价值再删（0903 两个孤儿经用户确认已清）。

4. **装机 bundle 校验探针要用属性名**（20260903）：minify 会改写**函数名**（`errText`/`isLifecycleGone` 装机后 grep 不到，误判未部署）；属性名/方法名不被 mangle——用 `branchByKey`/`removeIds`/`armRemoveIds` 这类属性探针 grep 装机 index.js 验证新功能在位，再配 md5 双确认。另：**思源关闭状态下部署，冷启动自动加载新构建，无需 petal 重载**。

5. **插件 JS 是窗口级注入，重装/重开页签不换运行中脚本（20260914 实锤）**：用户卸载重装后复测仍见旧行为——根因是运行中的思源窗口还挂着旧插件实例，重装文件、甚至关开温故页签都不会重新加载 index.js。**强制换脚本 = `POST /api/petal/setPetalEnabled` false→true 循环（各 sleep 1~2s）或整个重开思源窗口**；给用户交代验证步骤前先做这一步。连带：卸载会**整目录删除** `data/plugins/siyuan-plugin-wengu/` 并清空 conf 的 pets——全新重装要补全 `plugin.json+icon.png+dist/index.js+dist/index.css+i18n/{zh-CN,en}.json`（仓库根与 dist 的 plugin.json 内容一致）；对已卸载的插件单发 `enabled:true` 即重新注册（返回体带 petal 对象、`loadPetals` 可查真态），conf.json 落盘是异步的、盘上 pets 短暂仍空属正常。⚠️ `setPetalEnabled` 的参数名是 **`packageName`**（传 `id` 报 `Field [packageName] is required`）。

6. **外置卷 node_modules 整目录蒸发（20260916 新形态）**：主仓 `node_modules/` 直接 `No such file or directory`（或列目录 0 项），`pnpm install --force` 先报 `Already up to date` 不恢复（强 force 后补回链接），**几分钟后又消失**——卷级抖动，不是 pnpm 的问题。**worktree 审查的根治解法 = 依赖与外置卷解耦**：`mkdir /tmp/wengu-deps && cp package.json pnpm-lock.yaml /tmp/wengu-deps/ && cd /tmp/wengu-deps && pnpm install --frozen-lockfile`（本机盘，pnpm 从 store 硬链秒装），四个审查 worktree 的 `node_modules` symlink 全指 `/tmp/wengu-deps/node_modules`——审查期间卷再抖也不中断。直调 `.bin/` 的老坑依旧（worktree 里 pnpm verify-deps 崩）。

**How to apply:** 机器 B 上工具链命令异常先判归属——pnpm 报「Cannot set property message」先查全局与锁定版是否一致（`pnpm -v` 对 package.json），不一致就 `pnpm add -g pnpm@<锁定版>`；webpack 零进展先清 cache 再重试；`node_modules/.bin/vitest run` 与 `pnpm test` 等效。存储目录出现 `{name}{随机}.tmp` 残留 = 内核原子写被打断的孤儿，确认主文件 mtime 仍在前进后可直接删。

**外网可达性（20260901 选词典源时实测）**：dictionaryapi.dev 完全不可达（curl http=000 15s 超时、浏览器 fetch 同挂）——运行时在线词典 API 类方案在本机不成立；baidu/zhihu/jsdelivr/raw.githubusercontent 可达，其中 raw.github 63MB 大文件可下，jsdelivr 对 gh 仓 >20MB 文件 403（小文件正常）。要下大文件走 raw.githubusercontent.com。
