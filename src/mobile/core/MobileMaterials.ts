import { decorateMaterial } from "../../quiz/service/MaterialDecorate";
import type { WenguMaterial } from "../../types";

/**
 * 材料面板渲染（移动端，设计稿屏 ③）：**复用桌面材料装饰的唯一出口**
 * （`quiz/service/MaterialDecorate.decorateMaterial`）——词形联动与线索
 * mark 的施工口径与桌面完全一致，移动端不复制第二份装饰链。
 *
 * 只在**材料展开时**才渲染正文：屏 ③ 默认收起（只留摘要行），展开是
 * 用户显式动作；收起时零 DOM 成本（长材料卷不在折叠态白付渲染）。
 */

/** 摘要行（收起态）：材料正文首句，纯文本截断（markdown 记号先剥）。 */
export function materialSummary(md: string | undefined, limit = 64): string {
    const text = (md ?? "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/[#*_>~[\]()]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/** 材料正文 HTML：过装饰出口后再取 innerHTML（词表/线索与桌面同链）。
 *  用 detached 容器承载施工现场——直接拼 markdown 字符串会绕过
 *  decorateMaterial（词形联动与线索 mark 全丢）。 */
export function materialHtml(material: WenguMaterial | undefined): string {
    if (!material?.bodyMd) return "";
    if (typeof document === "undefined") return "";
    const host = document.createElement("div");
    decorateMaterial(host, { md: material.bodyMd });
    return host.innerHTML;
}
