---
name: mineru-material-location
description: MinerU 题册素材目录与 markdown 结构要点（未来解析器输入，测试样例）
metadata:
    node_type: memory
    type: reference
    originSessionId: sess_3bdb5d2e-1541-4791-98ce-e871f3905338
---

题册素材根目录：`/Volumes/baiWeiNV7200/sasa/academic/post/MinerU/`（武忠祥高数、李永乐线代/660-数一、张宇概率、真橙自控经典/现代/300题/200题等，每书一目录，含分章 `.md` + `images/` 图片目录）。
《真橙控制777-自控强化300题》结构已细读并发现噪点：`### 习题N-M` 起题、`#### 答案 难度：★…` 收尾；中级标题 `## 自控强化习题详解` 重复出现（是题组分隔非章节）；个别答案正文被误判为 `##` 标题（如「## (2) 测速发电机 TG 代替人工的原理」）；选项分隔符 `A.` 与 `A、` 混用；答案可能多选（如 AD）；难度星数 1-5 颗混用 `★` 与 `\star`；题目含 `$...$`/`$$...$$` LaTeX 与相对路径图片 `![](images/xxx.jpg)` 需原样保留。

**How to apply:** 若日后重启输入解析（原 M1，已后移，见 [[pivot-to-ai-block-conversion]]），用第1章做样例与覆盖率基线；正文误判标题是重点过滤点。
