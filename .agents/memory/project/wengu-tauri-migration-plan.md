---
name: wengu-tauri-migration-plan
description: Tauri 平迁方案已废弃（20260908 ce2d4bd 转思源深化）；决策台账 D1-D5 仅历史备查，勿再按「待开工」引用
metadata:
    node_type: memory
    type: project
    originSessionId: sess_81f5900f-23e3-4d11-87c6-2ac5f406bc44
---

**20260908 已废弃**：并行会话 ce2d4bd 明确「Tauri 方案废弃转思源深化」
（方向=3.8.3 自定义块渲染题目/标为线索等思源原生深化）。自定义块一期
+标为线索工具栏随后被 3669e76 revert 出 dev、锚定在
`feat/custom-block-clue` 分支继续做。**勿再把本方案当「待开工待拍板」，
docs/tauri-migration.md 只是历史文档。**

以下为 20260904 定稿时的决策台账（仅历史备查）：

D1 S3 进架构=M7、DejaVu 缩小版快照仓库（Local 目录与 S3 同权、
Rust ObjectStore trait、绝不裸同步 SQLite 活库；D2 编辑器 Vditor-only
IR——曾推翻「Vditor 编辑+MdRender 预览分离」建议；D3 资产 URI 单出口
+source_files 表（s3_key 预留）；D4/D5 默认可翻：块 id=内容哈希锚编码
冻结形态、同步最小闭环=快照导出/导入。

M0 四 spike 先决：S1 本地 cdn 白屏 / S2 `((id "标题"))` IR 往返完整 /
S3 哈希锚→BLOCK_REF→点击跳转全链路 / S4 b3-lite 渲染占位题。

勘察修正（防复述旧数，部分仍有效）：Dialog 12 处非 9；stats 不碰
KernelQuery；ProtyleHost 对思源唯一依赖只剩 ProtyleMethod.mathRender；
听音选义=speechSynthesis 零音频资产；agentPanel 整体退役。
