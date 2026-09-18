---
name: wengu-wordbook-pipeline
description: 单词本词表(你还在背单词吗)的生成管线位置与再生成方法
metadata:
    node_type: memory
    type: project
    originSessionId: sess_cfd7a5f5-10a8-4edd-8f56-6d63a53e7f52
---

温故插件内置词书《你还在背单词吗(刘晓艳)》数据由一次性管线生成(2026-08-23):
词序+释义来自 maimemo-export 的《2026考研英语你还在背单词吗(新版).csv》,单元边界由
PDF 扫描件(pdfjs 渲染 200dpi → tesseract.js chi_sim+eng → 书末印刷索引 word→书页 +
目录单元区间在词序上找跳变)交叉验证。管线脚本在 `D:\code\siyuan\wengu-ocr\`
(render.mjs / ocr.mjs / gen-wordbook.mjs),不在插件仓库内;生成物落仓库
`src/wengu/data/`,来源说明见 `docs/wordbook-lxy.md`。

**Why:** 重跑词表/换词书时不用重新摸索提取方法;机器 B 或换 PDF 后直接复用。

**How to apply:** 再生成顺序 render → ocr(4 并行)→ gen-wordbook;词书进度存
saveData("words"),词表不打思源块。若用户给了 MinerU API token,可换 MinerU 做
高保真版(音标/例句/助记),管线见 [[wengu-kernel-extra-traps]] 同目录备注。

**bbcd 进度回填(2026-08-26 已跑一次)**:用户会从不背单词导出同书的四桶 PDF
(标题自带桶名:未学习/复习中/已标熟/复习完成)→ `wengu-ocr/bbcd-sync.mjs`
解析(PDF 有文本层不走 OCR;**未学习桶无英文词形,用另外三桶对全书 6016 词
做补集**;双栏版式按 x<300 分列 + WordMeaning 头翻节)→ 回填插件 words 存储:
复习中→[2,未来30天均匀摊到期],已标熟+复习完成→familiar+[6,+32d],
已有插件条目/mistakes/starred/cursor 一律保留。顺序必须:
先 setPetalEnabled(false)(卸载会落盘)→ --apply → enable。存储文件在
工作区 `data/storage/petal/siyuan-plugin-wengu/words`(无扩展名),写前自动
备份 .bak-时间戳。首次结果:复习中1686/熟1549/未学2757,6 词不在词书。
**脚本已升级支持任意子集**(2026-08-26): `node bbcd-sync.mjs <pdf...> [--apply]`,
桶别从 PDF 标题自动识别,缺的桶不写(只增不改);增量同步只导「复习中」一份
即可补新词;唯一做不到降级更新(词在 bbcd 毕业到复习完成但插件已有复习条目
时保持原档),要全量刷新状态须三桶齐导重跑。
