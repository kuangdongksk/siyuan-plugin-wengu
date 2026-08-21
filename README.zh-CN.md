[English](https://github.com/kuangdongksk/siyuan-plugin-wengu/blob/main/README.md)

# 温故 (Wengu)

[思源笔记](https://github.com/siyuan-note/siyuan) 刷题插件：
导入结构化题集，按章节 / 考点 / 难度刷题，错题自动进入闪卡复习队列，
并通过块引用与讲义笔记双向联动。

> 温故而知新。

## 状态

早期开发中，目前为骨架阶段：顶栏入口 + dock 面板。

规划：

- [ ] 结构化题集导入（markdown / 解析后的题册）
- [ ] 刷题模式（按章节 / 考点 / 难度筛选，客观题自动判分）
- [ ] 错题本（思源闪卡间隔重复）
- [ ] 题目 ↔ 讲义块引用联动
- [ ] 数据库视图统计（分考点正确率、复习进度）

## 开发

```bash
pnpm install
pnpm build   # 产物在 dist/
```

将 `dist/` 拷贝到思源 `data/plugins/siyuan-plugin-wengu/` 即可安装。

## 许可

MIT
