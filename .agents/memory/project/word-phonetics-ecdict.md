---
name: word-phonetics-ecdict
description: 词头音标自带（20260901 听音选义展示读音）——ECDICT 生成表按 wordKey 惰性查询，词典 API
    本机网络不可达故离线打包；装机回验过、未提交
metadata:
    node_type: memory
    type: project
    originSessionId: sess_558de3be-6f4f-41c5-82c5-4ed9bfe1f383
---

20260901 用户要求听音选义展示读音，澄清**是音标文本不是语音**（TTS 朗读本就有，WordSpeak=speechSynthesis en-US 0.9x）。词典 API 方案实测否决：dictionaryapi.dev 在机器 B 完全不可达（见 [[machine-b-env-pitfalls]] 外网可达性），改按用户拍板**下载一份自带进插件**。

**实现链：**

- `scripts/gen-phonetics.mjs`：从 ECDICT(MIT, skywind3000/ECDICT) ecdict.csv（raw.github 63MB，jsdelivr 403 大文件）提取 word→英式IPA。口径=学习词标签(zk/gk/cet4/cet6/ky/toefl/ielts/gre) ∪ 有词频(bnc/frq>0) ∪ 内置书词全量兜底（内置 5737 词仅 47 个查不到）；音标归一 `'`→`ˈ`、`:`→`ː`；key=wordKey 同款归一（小写去空格/连字符/撇号）。重跑脚本即可刷新，勿手改生成文件。
- `src/word/data/phonetics-data.ts`：生成文件，单字符串每行 `key ipa`，~4.7 万条 / 0.9MB。
- `src/word/service/WordPhonetics.ts`：**惰性解析**——bundle 里只是字符串，首次展示才 split 建 Map（一次几十 ms）；`phoneticsReady()` + `phoneticsOf(word)`，未 ready 返 undefined。
- QuizCard 三处展示：听音卡喇叭下（词面仍隐藏不破坏题型）、英选中词面下、词条详情行内；**中选英/回想面不展示防泄底**。
- index.js 2.2→3.6MB，本地加载无感。

**Why:** 用户明确选了「下载自带」路线（词库按词头 id 查、零运行时网络）；本机网络决定了在线词典 API 类需求都要走离线自带或内核 forwardProxy。

**How to apply:** 词头相关的展示/查询复用 WordPhonetics（别再接在线 API）；改音标口径重跑生成脚本；新展示点注意中选英/回想面泄底问题。真机回验过（听音卡 ˈspeʃəˌlaɪz、详情行内），**改动未提交**——用户体验后说提交才提交。相关 [[word-ladder-final]]。

TTS 补充（20260901 实测）：speechSynthesis 在思源页面可用，但 **getVoices() 首次返 0**，等 voiceschanged 事件后才有（macOS 180 声音/41 个 en）——判「环境无 TTS」前必须等异步加载，别被首次空表骗成不可用。
