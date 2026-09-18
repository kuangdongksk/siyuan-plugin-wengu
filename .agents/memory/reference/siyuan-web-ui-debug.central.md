---
name: siyuan-web-ui-debug
description: 用 control-browser 开思源 Web 端实测插件 UI——锁屏密码在 conf.json
    accessAuthCode，dock 定位与只读布局测量技法
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_d3ef15b2-3a92-4e9a-9d16-f600790f5fa6
---

2026-08-27 验证通过的插件 UI 浏览器级调试路径（不用麻烦用户看桌面端）：

- **URL 必须用 `http://127.0.0.1:6806/stage/build/desktop/`（桌面版构建）**——内核根路径 `/` 重定向到的 `/stage/build/app/` 是另一个构建，在浏览器里永远卡 loading 罩起不来（「点 击 刷 新」），20260827 两轮实测；锁屏时该页显示 Auth failed 对话框正常，浏览器里先解锁。
- 内核 `http://127.0.0.1:6806` 直接提供完整 Web UI；用 control-browser skill 打开即可操作真实插件。
- Web 端有锁屏时密码就是工作区 `conf/conf.json` 里的 **`accessAuthCode: "awsd31302"`**（同文件还存 `api.token`）；填「请输入锁屏密码」框点「解锁访问」。有时页面会随桌面端会话自动解锁，快照到主界面就不用解。
- ⚠️ **petal 重载（setPetalEnabled off/on）不会刷新已打开 Web 页签里的插件 JS/DOM**——旧模块继续跑、旧 DOM 残留（20260827 实测：重载后面板结构不变但新 CSS 全局生效，造成「改了一半生效」假象）。浏览器验证新代码必须先 `tab.reload()` 硬刷新整页再操作。
- 定位思源 dock 图标首选属性选择器 `[aria-label*="背单词"]`（aria-label 是长说明串，getByRole name 正则不一定匹配上）。坑：petal 重载后面板复位 / dock 收起时该元素可能整体查不到（count=0 超时）——此时 fallback 先 evaluate 列 `.dock__item` 的 `data-type` 清单找含插件 type 片段的项（温故页签/面板都是 `wengu*` type），再用 `.dock__item[data-type="…"]` 点开；页面没锁也没面板时 domSnapshot 会显示全部 dock 图标的长 aria-label 可核对。
- 布局测量用 playwright 只读 evaluate（JSON.stringify 包一层才不丢返回值）：遍历容器子树比 `scrollWidth > clientWidth` 找溢出元素 + 取关键节点 computed style；`overflow-y:auto` 的容器 overflow-x 会被连带成 auto，横向滚动条常这么来。省略号元素的 scrollWidth>clientWidth 属正常特征别误报。
- 截图前先 clip 到目标面板 rect（evaluate 读 getBoundingClientRect），整页截图太大。
- **dock 图标 playwright click 可能超时**（元素在、actionability 判 hidden）：fallback 用 evaluate 读图标中心 getBoundingClientRect → `tab.cua.click({x,y})` 坐标点。dock 是 toggle——动之前先 evaluate 探 `.wengu-word` 等标志节点在不在，别盲点（盲点会把开着的面板点关）。
- ⚠️ **浏览器验证会写真实用户数据**：刷卡 finishCard 落盘、计入当日新学配额与误认本（一轮验证实测耗掉 ~4 张卡并多了 enrol 误认记录）；进卡截图不做答则零写入。验视觉优先选「进卡→截图→回首页」，需要真实反馈行时明确知道在消耗配额。
- ⚠️ **playwright.evaluate 的页面函数不能引用 Node 侧局部变量**——函数体序列化到页面执行，引用即 `ReferenceError: xxx is not defined` 且同 cell 后续步骤全断（一次会话连踩三次）：要么纯页面侧常量，要么把 Node 侧结果用 nodeRepl.write 分开输出。
- **截图管道会周期性卡死**：报「A previous screenshot … still completing / capture failed for guest / surface preparation timed out」——等 5~12s 重试，仍不行重开标签页；期间用 evaluate 读几何替代视觉验证（getBoundingClientRect + 与可视容器比较算 inView）。
- petal 重载（setPetalEnabled off/on）后已打开的温故页签会**整体消失**（页签 LI 查不到），点顶栏「温故」按钮重开；重开后恢复上次工作区（rail active 记忆）。收起/展开目录、rail 切换等按钮在隐藏容器时 getByRole 点不到，用 evaluate 按/title 找到后 `.click()`。

相关：[[siyuan-data-location]]、[[work-rules-siyuan-plugin]]、[[svelte-migration-dead-selectors]]。
