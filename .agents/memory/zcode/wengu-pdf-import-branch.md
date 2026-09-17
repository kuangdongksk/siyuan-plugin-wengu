---
name: wengu-pdf-import-branch
description: wengu/pdf-import——已并入 dev（03d9075，2026-08-24 全分支合流）；PDF 导入代码全绿但
    mineruToken 真机端到端验证仍待用户
metadata:
    node_type: memory
    type: project
    originSessionId: sess_5d6c2f17-72f9-4421-b118-a25c2a2ec98c
---

PDF 导入（MinerU）+ 转换原位替换 + 删错题闪卡死代码。
**2026-08-24 dev 并入（a7d9abf）后合回 dev（03d9075）并推送**。
合流要点：转换 prompt 规则重编号（8 插图/9 禁跳带图/10 材料组/
11 填空转选择/12 知识点标注/13 steps——原三方各占 9 号撞车）；
Flashcards.ts 按本分支判断删除（全仓无消费方死代码）；
ConvertDetect 补材料块 material 预览标签；writeExerciseDoc/removeDoc/
toConvertResult 移 ConvertService、appendStems 移 ConvertDetect 保
500 行红线。tsc/eslint/prettier/build 全绿。

**仍待用户验证（唯一遗留）**：①设置里填 mineruToken 后真机走通
PDF 导入（风险：OSS PUT 跨域、window.siyuan.config.api.token）；
②重转带图讲义验证禁跳带图题+插图自检警告。已定决策：原位默认+
另存开关；题库文档只作底座 id 可变；重转清零统计为已知取舍。

**Why:** 端到端未走通前不能宣布完成；代码层已全部合入。
**How to apply:** 验证发现问题直接在 dev 修（分支可清理，worktree
`siyuan-plugin-wengu-pdfimport` 保留）。相关：[[wengu-kernel-extra-traps]]、
[[user-kaoyan-exam-prep]]（MinerU 导入的原始场景）
