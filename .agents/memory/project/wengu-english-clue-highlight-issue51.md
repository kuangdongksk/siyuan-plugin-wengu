---
name: wengu-english-clue-highlight-issue51
description: 英语标线索不出高亮根因=SKIP_SELECTOR把gloss-link整棵跳掉致含联动词的选段匹配必败；Issue#51已开排队等#46
metadata:
    node_type: memory
    type: project
    originSessionId: sess_933ea852-fcdb-4da3-87cd-16c717406e4e
---

2026-09-13 用户报「英语标为线索还是不会高亮」。根因已代码级定位，[Issue #51](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/51) 已开（排队：#46 在跑，合后再召唤）。

**根因**：`ClueMarkDom.SKIP_SELECTOR` 含 `.wengu-gloss-link`——匹配用文本节点把词形联动标记整棵跳掉，而选段锚点=`getSelection().toString()` **含**联动词字母与上标「N·记号」字符；`locateAcrossNodes` 精确子串匹配 ⇒ 含联动词的选段 `indexOf` 必败 ⇒ 静默降级只出 chip。#30 互不嵌套约定隔施工是对的、隔匹配是错的——英语系统性必败（数学/政治无词表所以正常），#30 落地即暗病，非 #49 回归。

**修法方向**（Issue 内写全）：匹配口径放进联动标记、施工避开上标——SKIP_SELECTOR 移除 `.wengu-gloss-link`（保留 `.wengu-gloss` 词表区、**不加** `.wengu-gloss-sup` 因上标字符两边都得有）、wrap 循环跳过落在 `.wengu-gloss-sup` 内的 slot；GlossDom.SKIP_INNER 不动（单向嵌套：mark 可进 `<u>`、词表永不包 mark）；AGENTS.md 互不嵌套条目要改写。clues 存储 `string[]` 不动。

**通用教训**：文本锚点匹配体系里，SKIP 名单隔「施工」与隔「匹配」是两件事——匹配 haystack 若抠掉用户可见的任何字符，含该字符的选段必败。往后给 SKIP_SELECTOR 加条目前先问「用户选段会不会含这段字符」。

相关：[[wengu-dispatch-20260913]]
