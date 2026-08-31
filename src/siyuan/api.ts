/**
 * 思源内核 API 路径枚举（组织方式迁自 sy-lively 的 constant/API路径.ts，
 * 路径基于内核 openapi）。文件层统一从本枚举取路径，禁内联字符串散落。
 * 20260829 三轮审查：清掉零调用方的路由（笔记本组/rename·move·listDocs/
 * insert·prepend·delete·moveBlock/exportMdContent/transactions），并把
 * files.ts 特殊通道的 file 组路由收进来（原内联字符串违反本文件约定）。
 */
export enum EApi {
    // ── 文档（filetree）──
    CreateDocWithMd = "/api/filetree/createDocWithMd",
    RemoveDocById = "/api/filetree/removeDocByID",
    GetHPathById = "/api/filetree/getHPathByID",

    // ── 块 ──
    AppendBlock = "/api/block/appendBlock",
    UpdateBlock = "/api/block/updateBlock",
    DeleteBlock = "/api/block/deleteBlock",
    GetBlockKramdown = "/api/block/getBlockKramdown",
    GetChildBlocks = "/api/block/getChildBlocks",

    // ── 属性 ──
    SetBlockAttrs = "/api/attr/setBlockAttrs",
    GetBlockAttrs = "/api/attr/getBlockAttrs",

    // ── 查询 ──
    QuerySql = "/api/query/sql",

    // ── AI（agent/chat 是 SSE，一律独立会话走 ai/client——见其头注释）──
    AgentChat = "/api/ai/agent/chat",
    AgentSaveSession = "/api/ai/agent/saveSession",
    AgentRemoveSession = "/api/ai/agent/removeSession",

    // ── 网络（外网 JSON 经内核转发，见 MinerUClient）──
    ForwardProxy = "/api/network/forwardProxy",

    // ── 文件（工作区文件特殊通道：multipart/裸内容/信封混合，见 files.ts）──
    FileGet = "/api/file/getFile",
    FilePut = "/api/file/putFile",
    FileRemove = "/api/file/removeFile",
}
