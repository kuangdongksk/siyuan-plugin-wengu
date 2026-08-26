/**
 * 思源内核 API 路径枚举（组织方式迁自 sy-lively 的 constant/API路径.ts，
 * 路径基于内核 openapi）。文件层统一从本枚举取路径，禁内联字符串散落。
 */
export enum EApi {
    // ── 笔记本 ──
    ListNotebooks = "/api/notebook/lsNotebooks",
    GetNotebookConf = "/api/notebook/getNotebookConf",

    // ── 文档（filetree）──
    CreateDocWithMd = "/api/filetree/createDocWithMd",
    RemoveDocById = "/api/filetree/removeDocByID",
    RenameDoc = "/api/filetree/renameDoc",
    MoveDocsById = "/api/filetree/moveDocsById",
    ListDocsByPath = "/api/filetree/listDocsByPath",
    GetHPathById = "/api/filetree/getHPathByID",

    // ── 块 ──
    InsertBlock = "/api/block/insertBlock",
    PrependBlock = "/api/block/prependBlock",
    AppendBlock = "/api/block/appendBlock",
    UpdateBlock = "/api/block/updateBlock",
    DeleteBlock = "/api/block/deleteBlock",
    MoveBlock = "/api/block/moveBlock",
    GetBlockKramdown = "/api/block/getBlockKramdown",
    GetChildBlocks = "/api/block/getChildBlocks",

    // ── 属性 ──
    SetBlockAttrs = "/api/attr/setBlockAttrs",
    GetBlockAttrs = "/api/attr/getBlockAttrs",

    // ── 查询 / 导出 ──
    QuerySql = "/api/query/sql",
    ExportMdContent = "/api/export/exportMdContent",

    // ── 事务（闪卡/DOM 插入等前端同款通道）──
    Transactions = "/api/transactions",
}
