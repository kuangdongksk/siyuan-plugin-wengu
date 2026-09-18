---
name: structure-repair-prefer-direct
description: 用户对体检/报障类功能偏好「直接修」而非推给人工逐步；结构损坏题改在体检弹窗内批量 AI 重生成（20260910）
metadata:
    node_type: memory
    type: feedback
    originSessionId: sess_08e1509d-ccc3-44b9-970b-270be8b8ed17
---

用户看到题库体检把「以下题目结构损坏，请在题卡用「重新生成」」列出来时，反馈「这些也应该直接修复」——即：工具报障后要能就地/一键修复，而不是把用户支去逐卡人工点击。

**Why:** 结构损坏（题干/答案缺失、答案越界、多步/完形残缺、解析失败、多选挤行不可推导）本质是内容缺失，无法确定性直修，只能靠 AI 重出补回内容——所以「直接修复」的正确落地是体检弹窗内批量 AI 重生成（勾选→点击即关窗→后台跑→track 进 AI 会话面板→终态通知），复用题卡单题重出机制（runRegen 带 quiet）。20260910 已落地（RepairDialog 结构损坏段改可勾选 + regenRecords 批量入口）。

**How to apply:** 遇到「检测出问题 + 提示用户去某处手动处理」这类功能，先判断损坏是否可确定性修复（能则勾选即修零 AI，如 [[review-cleanup-20260909]] 的引用/索引类）；不可确定性修（需补内容）就走弹窗内后台批量 AI，别再逐卡 push。机制复用「点击即关窗 + AI 会话面板 track 进度 + 终态通知」口径（见 [[ai-session-manager-panel]]）。
