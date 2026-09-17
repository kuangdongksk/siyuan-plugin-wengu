---
name: wengu-kernel-extra-traps
description: 思源 3.8.0 内核/工具坑三条（AGENTS.md 未记）：putFile 不吃 JSON、moveDocs 报 block
  not found、WindowsApps 前端源码 Git Bash 读不了
metadata:
  node_type: memory
  type: project
  originSessionId: sess_265f8127-992b-406c-9fe3-b3f644f5fb04
---

2026-08-22 真机（127.0.0.1:6806）实测的补充坑，尚未回填 AGENTS.md：

1. **`/api/file/putFile` 不吃 JSON body**：即使 payload 用文件传（排除 Git
   Bash 转义问题），任何 path 写法都返回 `{"code":400,"msg":"path must
   be empty"}`——该端点应为 multipart。**替代**：在插件内用
   `this.saveData("key", str)` 落盘，再从磁盘
   `data/storage/petal/<plugin>/<key>` 读回（临时 dump DOM 就这么干的）。
2. **`/api/filetree/moveDocs` 不可用**：fromPaths/toNotebook/toPath 均已
   核实正确，仍返回 `{"code":-1,"msg":"block not found"}`。挪错位的文档
   别指望搬运——删入回收站（`removeDocByID` 可用且进回收站）+ 重生成。
3. **WindowsApps 里的思源前端源码，Git Bash `cd` 进去直接 Permission
   denied**（AGENTS.md 机器A写的是可读）。需要看前端实现时先试别的
   途径；读不到就靠内核 API 探测（未知路由 200+空 body 可区分路由
   是否存在，这条 AGENTS.md 已记）。
4. **工作区 conf.json 实际在 `<工作区>/conf/conf.json`**（如
   `D:/data/思源/工作/conf/conf.json`），不在工作区根目录——AGENTS.md
   只说「工作区 conf.json」会找错地方。`/api/setting/getConf` HTTP
   调用返回空 body 不可用，读文件才可靠。行级公式开关的键是
   `editor.markdown.inlineMath`（用户已开 true）。
5. **`/api/filetree/getHPathByID` 可用且返回纯字符串标题路径**；定位
   文档父级一律用它（`getPathByID` 的 .sy 文件路径只作参考——内核按
   **标题**匹配 createDocWithMd 路径段，导入文档文件名≠标题时会自动
   重建空父链，契约文档已详记）。

**Why:** 三条都是花了不少回合试错才确认的死路，重复踩浪费时间。

**How to apply:** 涉及内核写文件/搬文档时直接选替代方案；给 AGENTS.md
回填时把这三条并入「内核坑」一节。相关：[[project-parallel-sessions]]
- 插件自定义 Dock(3.8.0):(this as any).addDock({type,config:{title,icon,index,hotkey},init(custom)}) 注册;激活:遍历 window.siyuan.layout.{leftDock,rightDock,bottomDock},data[插件名+type] 存在者 toggleModel(全type);npm 类型包 1.2.x 未收录需局部声明
6. **Windows node.exe 不认 Git Bash 的 /tmp 路径**（20260826 机器A）：
   `curl -o /tmp/x.json` 成功后 `node -e "require('/tmp/x.json')"` 报
   MODULE_NOT_FOUND——node 把 /tmp 解析到当前盘符根（D:\tmp）。用
   `cygpath -w /tmp/x.json` 转 Windows 路径再传给 node，或临时文件
   直接写 Windows 路径。
7. **机器A思源已换直装版、装机在 `D:\program\SiYuan\`**（20260829，
   `where SiYuan` 定位；AGENTS.md 机器A写的 WindowsApps 3.8.0 路径已
   失效）——前端源码在 `D:/program/SiYuan/resources/stage/build/app/`，
   可直接 Git Bash 读；common.*.js 仍是压缩单行，先 `tr ';{' '\n\n'`
   分行再 grep。读前端实现（如 Protyle disable/contenteditable 行为）
   走这里最快。
8. **内核 base.css 的窄屏媒体查询特异性陷阱**（20260829 机器A 3.8.1
   实证，用户截图「设置弹窗内容超出了」的根因）：`@media
   (max-width:750px){.config__item>.b3-text-field,.config__item>
   .b3-select,.config__item>.b3-button,…{width:100%;margin-top:8px}}`
   （特异性 0,2,0）在窗口 ≤750 CSS px（半屏分栏/DPI 缩放）盖过
   `.fn__size200{width:200px}`——插件设置弹窗「标签+定宽控件」横排行
   被拉成整行宽并溢出面板右缘。修法：复合选择器
   `.b3-label.wengu-formrow>.fn__size200{width:200px;margin-top:0}`
   抬 0,3,0 压回（1bb4ce1；6806 网页版 700px 视口复现+修复验证）。
   同族还有顶层 `.config-wrap>.fn__size200{flex:1 1 100%}`。教训：
   思源自家样式除主题外还有 media query 版特异性陷阱——「宽窗口正常、
   窄窗口炸」的布局问题先 grep base.css 的 @media。
