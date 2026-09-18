---
name: companion-overlay-direction-aware
description: 看板娘全局悬浮层定位定稿（远端 8dd7c9b「团子恒锚」）：锚随朝向换轴+按朝向分轴钳位；早期「只钳团子放弃容器钳位」的 WIP 方案已废弃（20260831 确认 stash drop）
metadata:
    node_type: memory
    type: project
    originSessionId: sess_ad1d1d85-0150-480b-b8c9-0da0f0c5b21a
---

看板娘全局悬浮层定位连修多个坑（30b7ab4 修左右拖 / ed8b8e3 修右缘挤出 / 0c2e37e 方向感知 / 8dd7c9b 团子恒锚重写定稿），根源都是——**absolute 容器同一方向的「默认锚 + 内联覆盖」会同时生效**，叠加内容从团子单向展开、余量静态猜不准。

**Why:** 静态钳位必漏角落；但「点开聊天团子被推开」的病根不是容器实测钳位本身，而是锚定方式——固定 right/bottom 锚时，朝左/上展开等于把团子从锚上推开。**让锚随朝向换轴**后，展开物永远朝屏内生长、团子恒定不动，容器实测钳位就能安全保留（20260828 曾误判「必须放弃容器钳位」，本地 WIP 只钳团子 64px、放任展开物溢出——已被远端超越，stash 于 20260831 drop）。

**How to apply（CompanionApp.svelte 远端定稿形态，src/companion/component/）：**

- 位置存 **`right/bottom` 锚**（r/b=团子右/下边到视口右/下缘距离，可辨贴边方向；onUp 反算 left/top 落盘，设置契约不变）。
- `orient`：r/b 小=贴右/下侧；`anchorStyle` **内联锚随朝向换轴**——贴右/下用 `right/bottom`，贴左/上换算成 `left/top`（vw-r-FW）——团子恒落 (视口-r-64, 视口-b-64)，展开物向屏内生长、永不推挤团子。
- `clampPos` **按朝向分轴**：贴右/下（朝屏内展开方向余量在右/下）钳容器实测 w/h `[8, 视口-容器-8]`；贴左/上改钳团子让位给展开物 `[容器-FW+8, 视口-FW-8]`。ResizeObserver 回钳保留。
- `bind:this` 变量必须 `$state` 声明否则 svelte-check 报 non_reactive_update。

相关 [[companion-mascot-plan-deferred]]（companion 域架构速查）
