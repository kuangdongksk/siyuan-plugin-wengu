# 内置词书《你还在背单词吗》(刘晓艳·2026) 数据说明

## 数据形态

* `src/wengu/data/words-p01..p16.ts`:词条分片,`[单词, 释义][]`,每片 ≤400 词条(行数 <500,满足仓库红线)。
* `src/wengu/data/words-index.ts`:拼接全部分片。
* `src/wengu/data/wordbook-meta.ts`:单元元数据 `[单元号, 起始下标, 词数, 标题][]`。
* `src/wengu/WordBook.ts`(手写):类型 + 拼装,以上三个生成物只读不手改。

词条总数 **6016**,单元分布:U1:311 U2:284 U3:298 U4:278 U5:250 U6:301
U7:329 U8:342 U9:270 U10:305(词群串记,PART01);U11:1187 U12:1186(基础词,
PART02 = Lesson 41-60 按课数对半);U13:675(扩词量,PART03)。

## 来源与生成管线(可复现)

词序与释义来自 [busiyiworld/maimemo-export](https://github.com/busiyiworld/maimemo-export)
的《2026考研英语你还在背单词吗(新版).csv》(墨墨词库导出,6016 词条,顺序即书的
词群顺序);单元边界由书本身(PDF 扫描件)OCR 交叉验证得出。完整管线脚本在
`D:\code\siyuan\wengu-ocr\gen-wordbook.mjs`(本机临时工程,不在仓库内):

1. `render.mjs`:pdfjs-dist + @napi-rs/canvas 把 354 页扫描件渲成 200dpi PNG
   (扫描图是 JPEG2000,需 `wasmUrl` 指到 pdfjs-dist/wasm);
2. `ocr.mjs`:tesseract.js(chi_sim+eng,fast 模型本地 traineddata)4 并行跑全书;
3. `gen-wordbook.mjs`:
   * maimemo csv 解析为有序词条(权威词序+释义);
   * 书末印刷索引页(附录V,`word /页码` 格式)解析出 word→书页映射(约 1900 词);
   * 目录敲定的单元书页区间 + 滑窗众数平滑,在 maimemo 词序上找相邻已索引词的
     单元跳变 → U2-U10 边界(与视觉抽查吻合:U7 首词群 fantasy@书p166);
   * U11/U13 = 后半两段字母序 a-z 的起点,U12 = PART02 中点;
   * 输出三组生成物到 `src/wengu/data/`。

已知局限:U11/U12 中点切分按课数对半,与真实 Lesson 51 边界可能有几十词出入;
释义为墨墨版(与书内刘晓艳精简释义措辞不同,语义一致)。若要更高保真(音标/
例句/助记),可用 MinerU API 重跑扫描件——需注册 token。

## 版权

词表+释义为教辅出版物内容,**仅限自用**;插件如公开发布(思源集市)须先移除
内置词表、改为用户自备数据导入。

## 误认词 AI(2026-08-23 增)

答「不认识」自动累计进误认本(`words.json` 的 `mistakes`);头部/完成页的
iconSparkles 按钮把**未分析的误认词**批量(≤20/批,串行队列)交给思源内置
智能体(模型取智能体设置的默认),每词返回 `W/T/D` 三行——记忆提示存入
`mistakes[].note`(卡片翻面后展示),建议天数(1-30,clamp)覆盖该词到期
时间。再次答错会清空旧提示、重回待分析队列。调用走 AgentClient.agentChat,
与 AiJudge 同款串行队列避内核并发坑。

## Dock 面板与三模式出题(2026-08-23 二增)

* **Dock**:3.8.0 运行时有 `Plugin.addDock`(类型包未收录,index.ts 里按运行时
  形状局部声明);面板 type 复用 `wengu-words`,顶栏按钮优先激活 Dock——
  遍历 `window.siyuan.layout.{leftDock,rightDock,bottomDock}`,谁的
  `data[插件名+type]` 存在就 `toggleModel(全type)`;未注册/未布局时回退页签。
  Dock 与页签共享同一个 `WordStore` 单例(进度缓存同源)。
* **三模式轮换**(仿不背单词):看单词选意思(四选一,干扰项取同单元、按
  下标做种子稳定抽样)/看英文回想/看中文回想;每题提示页→结果页两段,
  结果页固定展示 单词+释义+AI提示,回想模式给三档自评,选择题给
  下一个(对→know/错→no)与记错了(强制 no 入误认本)。
  键盘:提示页 Space=显示答案、1-4=选项;结果页 1/2/3=自评、Space/Enter=下一个。

## 学习节奏调整(2026-08-23 三改)

* 不按单元分组学:书序连续刷,单元仅作标签/起点锚点/选择题干扰项池;
* 无每日上限:队列 = 全部到期复习 + 全部未学新词,学多少停多少随你;
* 头部实时显示「明天 N」(dueTomorrowCount:到期落在现在~明天结束的词数,
  每次批改后刷新)。
