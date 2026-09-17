---
name: wengu-related-dialog-upgrade
description: 相关题弹窗×刷题联动设计稿已过审(20260913)，落地为Issue#44+召唤青简，实现状态见dispatch-20260913
metadata:
  node_type: memory
  type: project
  originSessionId: sess_4482839f-2c9e-4f41-959d-e1f76daa9b53
---

20260913 用户过审定夺：**专题落侧栏清单但必须写清来源**（标题=`相关题·{来源文档标题}`）；**回顾=看历史错题及答案**（错题本 qidFilter 筛选口径，不重刷开轮）；AI 分析未表态按推荐落（弹窗内等待渲染 + track(kind="analyze") 兜底回看）。

已开 [Issue #44](https://cnb.cool/sasa1107/open-source/si-yuan/siyuan-plugin-wengu/-/issues/44) 并召唤青简（work-mode），实现进度与审查要点见 [[wengu-dispatch-20260913]]。本条保留设计稿核心结论备查：

- **一条专题通道供预览/开刷共用**：`col-related-{docId}` 确定性 id 活视图专题，`LiveCols` 新增 `nodeKey="related:{docId}"` 绑定，收集口径与 `questionsRelatedToDoc` 同源抽纯函数（弹窗列表=专题题单恒一致，题库变化回流）；预览=switchTo 后 `enterPreviewFor`；开刷=switchTo 后 `switchWorkspace("drill")`（`drillNode` 同链路）。
- **回顾** = `ReviewCtl.qidFilter?: Set<string>` + `enterReviewFor` opt 扩展 `qids`，头部「相关题筛选」徽标可取消。
- **AI分析** = `agentChatOnce` + `track(kind="analyze")`，输入三路：`sectionKramdown(kpId)` 小节正文 + 相关题作答统计 + `WeaknessStore.points` 命中 weakKeys 条目（零作答省略不谎报）。

⚠️ 口径坑（审查 PR 时重点核对）：`collectQids`（kp/kn/ch 键并集）≠ `questionsRelatedToDoc`（sourceDocId 命中 **或** kpRefs 命中）——**不能复用 `col-kp-{id}` 活视图**，会漏「源文档命中但无 kpRefs」的题；另 `questionsRelatedToDoc` 的 `slice(0,50)` 截断要移除（题单=列表全量）。
