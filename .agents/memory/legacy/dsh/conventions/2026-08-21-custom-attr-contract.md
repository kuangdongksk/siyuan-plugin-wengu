# custom-attr-contract

# 温故题目块属性契约(长期约定)

权威来源:`docs/question-block-contract.md`,插件常量实现 `src/wengu/attrs.ts`(两处必须保持一致,改契约先改文档)。

转换必打属性(前缀 `custom-plugin-wengu-`):

- `q = 1`(转换完成标记,必填)
- `type` = single | multiple | judge | fill | brief(必填,决定判分方式)
- `answer` = 正确答法(客观题必填;brief 留空;fill 用 `|` 分隔可接受答案)
- `knowledge` / `chapter` = 知识点/章节(推荐,用于分组抽题)
- `difficulty` = 1~5(推荐)
- `source` = 真题来源(可选)

插件运行时写入:容器块的 `attempts`(整数)、`last-answer`、`right`(0/1/空)。
子块定位:解析子块带 `custom-plugin-wengu-part = "answer"`,用于闪卡卡背与解析定位。
