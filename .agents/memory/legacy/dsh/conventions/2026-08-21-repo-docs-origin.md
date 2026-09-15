# repo-docs-origin

# 仓库文档来源区分(避免误读)

温故仓库从官方 `siyuan-note/plugin-sample` 派生,保留了样板文件,读文档时注意区分:

- `CHANGELOG.md`:官方 plugin-sample 的变更记录(条目都链接到 siyuan-note 仓库的 issue/PR),**不是**温故自己的 changelog;温故版本号见 `package.json` / `plugin.json`(当前 0.1.0);
- `docs/superpowers/plans|specs/`:官方「kernel plugin demo」的设计文档(2026-05-09),演示内核插件 API 用,与温故业务无关;
- `src/kernel.ts`:初始骨架,只做生命周期日志,是为未来服务端逻辑预留的,不是业务代码;
- 温故业务文档只有 `docs/question-block-contract.md`。

后续若写温故自己的 changelog,应新建文件而不是继续往 CHANGELOG.md 里追加官方条目。
