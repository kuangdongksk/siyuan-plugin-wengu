---
name: parallel-session-worktree-build
description: 机器B 另一会话半成品文件污染构建的处置——临时 worktree 只带自己改动干净构建再装机
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_1ceae321-81e1-49d2-829e-d74d44e655cd
---

20260831 交付数据自托管时，主仓工作区混入另一活跃会话的半成品（src/ai/data/AiSessions.ts、src/ai/core/、src/ai/client.ts +132 行，时间戳分钟级在变），其中 AiSessions.ts 有编译错误（字段与方法同名 ready），会挡住主仓 tsc/构建，且不能 stash 干扰对方正在编辑的工作区。

**Why:** 用户两台机器+多窗口并行开发是常态（见 [[git-remote-push]]），任何时刻主仓工作区都可能有别人的进行中文件；webpack 从入口打包会把被引用链上的半成品编进产物。

**How to apply:**

1. 构建交付物前先 `git status --porcelain` + 时间戳核对文件归属，识别非本会话文件（时间戳分钟级新鲜 + 未跟踪新目录 + diff 内容主题不符）。
2. 用 `git worktree add --detach /tmp/xxx HEAD` 建干净树，只拷自己的改动（M 清单 `git diff --name-only HEAD` 排除别人文件；?? 清单排除别人目录），`ln -s 主仓/node_modules`，在 worktree 里 tsc/vitest/webpack 全链验证后取 dist 装机，`git worktree remove --force` 清理。
3. zsh 坑：`for f in $VAR` 不词切分（SH_WORD_SPLIT 关），多行清单拷贝会整块当单文件名——必须 `| while read -r f` 管道逐行。
4. 产物 hash 比对（md5 主仓 dist vs worktree dist）可证明主仓构建未被污染；本例两处 md5 一致（webpack 时序恰好早于对方写入），但不可依赖运气，worktree 验证是确定性手段。
5. 20260901 补充（发布审查会话）：**只提交自己文件、不碰他人改动**是用户明确拍板的策略。同文件混入他人 hunks 时的精确剥离法：`git show HEAD:file > /tmp/f` → 手工应用自己的改动 → `BLOB=$(git hash-object -w /tmp/f)` → `git update-index --cacheinfo "100644,$BLOB,path"`（zsh 里 `$BLOB` 不能写成 `\$BLOB`，会被转义吞掉报 "cannot add $BLOB"）。也勿 import 他人未提交的新文件（本例 src/ui/Notify.ts 未跟踪时 C 修复改用它就得等对方先提交，否则 cherry-pick 自己提交到别处编译失败）。提交前 `git diff <file>` 逐文件核对纯净度。
6. 20260901 反向坑：**自己未提交的改动会被并行会话的提交顺带收编**——rail.scss 的 AI 行修复在工作区未提交，对方会话按「提交自己文件」提交 b84aab4 时把该文件整体带进了库。发现后不重做：diff 核对内容已在 HEAD 即可；想要归属干净就得趁早提交自己的批次（用户逐批说「提交吧」）。
7. 20260902 双向收编连环坑：**「该文件我也编辑过」≠「文件里的改动全是我的」**——AI 会话树分组提交时按自己的文件清单 `git add`，但对方会话在 ConvertBatch/ConvertRun/ConvertIncrement（恰好也是我改过的文件）上并行施工，hunks 被整体收编，提交引用了对方未提交的 SetWriter/BankSets 单独 checkout 编译不过（干净 worktree 一验才暴露——主仓工作区因为对方文件在场反而「看起来能编」）。教训：**提交前逐文件 `git diff <base> HEAD-staged -- <file>` 核对每一个 hunk 的归属，自己没写过的行（陌生 import/陌生字段）一律剥离**，不能只查 i18n/AGENTS 这类「共用文件」。拆分修复法（保留对方工作区现场零丢失）：备份活文件 → `git show <base>:file` 落回 → Edit 重放自己的 hunks → `git add` → 备份拷回工作区 → fix-commit 落顶（b1f7e2e 污染、b37f7a2 剥离即此例）。
8. 20260903 该「换入换出」法成功用于整文件级分离暂存（聚合刷题 86dbf33）：共享文件（i18n×2/CHANGELOG/AGENTS）与另一批未提交改动共存时——备份活文件 → 落「HEAD+仅自己增量」变体 → `git add` → 备份拷回，`git diff --cached` 验证暂存侧纯净、工作区侧完整。坑：备份/恢复两侧的文件名生成方式必须一致（node `replaceAll("/","__")` vs shell `tr / _` 不一致会漏还原 i18n，cp 报错虽打印但 `&&` 链已断需人工补拷）。构建装机可照常从含对方 WIP 的工作区做（产物含两批），但提交必须分离。
9. 20260903 晚间新形态：**对方会话开始有计划地收编并代为提交**——预览搜题功能我实现完未提交，对方在其提交（66c8f36）说明里明写「同时含并行『预览搜题』的新键（代码随下一提交落地）」，把我 i18n/CHANGELOG 先行入库，然后把我的 4 个代码文件连同它自己的样式收尾一起 stage 并提交（16f88d4，消息准确描述了我的功能）+推送。**处置顺序因此改变：动手拆分/提交前先 `git log -3` + `git status` 重查现场**——若自己的活已在 HEAD（`git show HEAD:file | grep 特征串`），核对 stat 与内容即可，不重做不拆分；「提交推送」类指令可能已被对方整个完成（含 push，`git rev-list --left-right --count origin/dev...dev` 验 0/0）。
10. 20260908 换入换出法两连拆（「索引」改造 5b6c05f 10 文件 / 门槛拆除 378ac30 3 文件），流程定型：备份混合文件（顺手 `md5 -q` 落清单）→ `git checkout --` 回 HEAD → Edit 重放自己的 hunks → 只 add 自己文件提交 → cp 备份恢复 + md5 对账逐字节验证工作区零丢失。四个新细节：①checkout 后文件必须重新 Read 才能 Edit（工具新鲜度检查拦截，报「modified since read」不是别人在动）；②重放的 old_string 要按 HEAD 上下文重写——不能沿用工作区版的匹配串（里面可能混着对方 hunks，如对方加的注释/格式化/代码段）；③提交独立性验证=临时 worktree detach 到提交 SHA + 软链主仓 node_modules 进去跑 tsc/svelte-check（零 pnpm install 零联网，几秒出结果）；④对方在我两次提交之间落了 ff19933——无参 checkout 跟的是当时 HEAD（已含它），重放自然基于新基、历史干净无需干预；对方 WIP 里的 eslint 错误（block.ts no-useless-assignment）不归属不动，但注意 `eslint && prettier` 链断会短路掉 prettier（实际没跑），prettier 要单独跑或别放 && 尾部。
