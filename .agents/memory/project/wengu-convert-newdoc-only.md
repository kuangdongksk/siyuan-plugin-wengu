---
name: wengu-convert-newdoc-only
description: 转换固定另存（原文档绝不动）+PDF导入/MinerU整体移除，20260901已部署两区待验收未提交
metadata:
    node_type: memory
    type: project
    originSessionId: sess_3a7ea4ea-ac32-43a5-8bcf-0bbcd3fe6e73
---

20260901 用户定夺「根据原文档保存一份自己的数据，完全不动原文档」：
删「转换方式」双模式（原位替换/另存）与「从 PDF 导入（MinerU）」整个
功能，落盘固定 newdoc——《标题·习题》渐进文档即成品。

- 删除面：ConvertService.replaceDocInPlace/hasChildDocs/
  ReplaceInplaceError/repointSourcePairs、ConvertRunCfg.writeMode、
  弹窗 busy 态（PDF 导入独占）与右上角 X 接管、PdfImport/
  MinerUClient/PdfImportRow 三文件、settings.mineruToken、fflate 依赖、
  EApi.ForwardProxy、i18n 双语 25 死键。
- 行为小变化（验收注意）：「生成位置」表单从 writeMode=newdoc 条件里
  解放常显；父文档输入行改仅选 custom 时显示（原常显误导）。
- 存量兼容：原位时代题集照常刷题/增量重转换；进度记录裸 kramdown
  （无 docId）形态续跑读回路径保留（首批前失败仍产出该形态）。
- 已部署两区（dist md5 fa7ed2a5 前缀）待验收；**已提交推送**
  （b48839d，push 走代理 7897 见 [[github-push-via-proxy-7897]]）；
  tsc/svelte/eslint/prettier/374 单测/build 全过。README 等大面积 M
  是 prettier 碰全仓的 CRLF 行尾幻影，git add -A 归一即消。
- 机器 A 思源已升 **3.8.2**（内核端口 49241，无 --workspace 参数只有
  --attach-ui；AGENTS.md 记的 3.8.1 过时）。
- 顺带修复：知识文档「转习题」入口（openConvertPrefilled 预填）此前
  writeMode 默认原位、忘切另存会替换掉知识文档的雷——固定另存后自愈。

相关：[[wengu-pdf-import-branch]]（PDF 导入历史分支，现已退役）、
[[user-kaoyan-exam-prep]]
