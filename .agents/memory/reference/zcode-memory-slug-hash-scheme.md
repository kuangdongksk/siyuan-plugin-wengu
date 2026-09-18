---
name: zcode-memory-slug-hash-scheme
description: ZCode 记忆槽位目录名 = 仓库名 + sha256(工作区绝对路径) 前 16 位 hex，可离线推算任意仓库的槽位
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_eb60440d-9624-43d6-bb91-a2831d93637a
---

# ZCode 记忆槽位命名规则（20260916 实测破解）

- 槽位目录：`~/.zcode/cli/memories/projects/<仓库名>-<hash>/memory/`，其中 **hash = sha256(仓库工作区绝对路径) 的前 16 个 hex 字符**。
- 实证：`/Volumes/baiWeiNV7200/sasa/siyuan/siyuan-plugin-wengu` → sha256 前 16 位 `63151ad643b40066`，与现有槽位 `siyuan-plugin-wengu-63151ad643b40066` 一致；另用 9 个既有槽位全部回验命中，零歧义。
- 用途：给「尚未有过会话」的仓库**预建**记忆槽位（mkdir -p + 写 memory/*.md + MEMORY.md），或从仓库路径反查它的记忆目录——不用先在那边开过会话。
- 新建槽位时 MEMORY.md 一并创建（至少含索引行）；老槽位追加索引行前先 grep 防重。
- ⚠️ zsh 坑（复发提醒）：`for x in $var` 不做词切分，多值循环用 `printf '%s\n' a b c | while read -r x`。

相关：[[cnb-quota-credits-cache]]（20260916 借此方案铺进 16 个 cnb 仓库的首例）
