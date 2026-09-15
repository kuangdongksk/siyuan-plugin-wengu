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
