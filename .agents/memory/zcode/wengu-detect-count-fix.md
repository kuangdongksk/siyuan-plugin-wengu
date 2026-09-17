---
name: wengu-detect-count-fix
description: 检测总数分段并行计数已修(b205197)已部署机器A待验收；chunkKramdown 已挪 ConvertService 供检测/生成分块共用
metadata:
  node_type: memory
  type: project
  originSessionId: sess_6672ac59-18f1-48fa-9d73-16ba463b9037
---

用户反馈「检测共多少题远小于习题数量」（2026-08-29）：根因是
ConvertDetect 旧实现只把源文档**前 12000 字符**发给 AI 数题，长卷
（几万字符模拟卷）AI 只能数可见前缀。修复 b205197（已并 dev、已推送、
已部署机器 A 待用户验收）：按空行边界以 12k 窗分段（复用
chunkKramdown——该原语已从 ConvertBatch 挪到 ConvertService 供两处
共用，ConvertBatch 因此回到 500 行内），各段走 agentChatOnce 独立会话
**并行计数**（池限 4），prompt 按题干起点归属本段（段首残题不计、段尾
未完照计），各段之和=全文题数；首段照旧产出 CAN_CONVERT/REASON。N+
只在有分段计数失败时出现（成功段之和的下限）；首段失败=检测失败
不阻断转换（原行为）。

**Why:** 单次调用的输入上限（内核 AI 超时约束）与「总数必须准」并存
的唯一解是分段求和；题干起点归属保证跨段题不重不漏。

**How to apply:** 验收方式=拿一篇长模拟卷转换，看「检测共 N 题」是否
接近实际题数（不再带 +）。若 AI 单段数得不准（如题号格式怪），调
windowPrompt 的归属规则，别回退到截断前缀。相关：
[[wengu-steps-design-intent]]、[[project-parallel-sessions]]
