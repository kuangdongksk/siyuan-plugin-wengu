# src/word/ —— 单词域（`index.ts`=mountWordView 挂载编排，控制器在 `WordView.ts`）

- **UI 是 Svelte 组件**（word/component/，2026-08-26 起）：渲染走 $state 深代理
  细粒度更新，控制器经 context 注入组件；Svelte 5 编译器原生支持组件内 `lang="ts"`，
  无需 svelte-preprocess。词库数据在 word/data/。
- **词头音标**（20260901，听音选义展示读音）：自带 ECDICT(MIT) 提取的音标表
  （data/phonetics-data.ts 生成文件勿手改，scripts/gen-phonetics.mjs 重跑刷新；
  学习词∪有词频∪内置书兜底 ≈4.7 万条），service/WordPhonetics 惰性解析按 wordKey
  查（与进度 key 同归一），听音卡/英选词面/词条详情三处展示，零网络。
- **多词书**（2026-08-28 redesign §五）：词书=`data/wengu/wordbooks/{id}.json`+
  manifest（service/WordLib，内置书首启动落盘与导入同权）。**进度 key=归一化词头**
  （schema v3，同词跨书共享；v2 下标 key 的一次性迁移已随存量确认于 20260829 移除）。
  队列统计一律当前书口径。
- **AI 复盘判档供给方可插拔**（20260921，#185）：配置了 Jev key 时「选哪一档」
  由 `service/WordAiJev.ts`（模式：一批评词、每词 choice 选档 + noul 探手滑）
  供给，没 key / 总开关关 / 判定抛错**一律回落**生成式 W/L/C/T 通道——
  `applyAiReview` 的 FSRS 公式与落盘动作一行没动。三个别踩的点：
    1. **choice 的选项原文就是档位描述**（`JEV_ACT_CRITERIA`），回取按描述反查
       （`actOfOption`）——基建 `ai/jev/client.ts` 的 choice 组装是
       `criteria[opt]=opt`（线格式已按生产实证收口，不许动），参数只有选项字符串
       一个口，故描述只能当选项下发，内部代号 `up/keep/down` **不上线**；
    2. **低置信（choice <0.5）逐词跳过**（不给条目 = 稳定度不动），不是整批放弃；
    3. Jev 路**不产 `C:`/`T:`**（易混推断归可试档 C1），`confusables` 不被写。
       settings 经 `DockHost.settings` → `mountWordView` → `WordApp` → `WordView`
       → `WordAiRunner.setJevDeps` 注入，**取用时读活引用**，不新增设置项/持久化字段。
