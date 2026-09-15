# src/siyuan/ —— 内核 API 工厂

- `api.ts`：路径枚举 `EApi`；`KernelBlock` / `KernelDoc` / `KernelNotebook` /
  `KernelQuery`（SQL）。薄封装，迁自 sy-lively 构建工厂。
- `KernelQuery`：rows 泛型收窄 / rowsMap；**rowsAll/rowsMapAll 自动
  LIMIT/OFFSET 分页——全量查询一律走它，别手写循环**。
- 2026-08-26 已把全仓 ~33 处散落内核调用收拢进来。
- 两类特殊通道例外：SSE、putFile multipart。工作区文件读写/删在
  `files.ts`：getFile 裸内容 / putFile multipart / removeFile 信封——词书
  等非块文件走它。
- `attrs.ts`：题目契约属性常量。
- **新增内核调用先走工厂，别散落 fetchSyncPost。**
