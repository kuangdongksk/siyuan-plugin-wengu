import { EXPR_KEYS, WenguExpr } from "./Expressions";

/**
 * 自定义形象图片：用户把图片放进工作区某目录（设置里指定，如
 * assets/wengu/companion），**按文件名匹配表情**——happy.png、开心.jpg
 * 都认（英文名=枚举键，中文名=表情别名），未命中的表情回退内置形象 SVG。
 *
 * 探测：对每个表情按候选名 × 扩展名 GET 工作区静态资源（内核同源
 * 直出 /assets/…），响应 ok 且 content-type 是图片即命中；结果挂到
 * ui.imgExpr 供组件切换 <img>/SVG。探测只在目录变化时跑一次。
 */

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "svg"] as const;

/** 中文别名表（文件名候选的第二梯队；英文名在 Expressions 的枚举键）。 */
const CN_NAMES: Record<WenguExpr, string[]> = {
    [WenguExpr.Idle]: ["待机", "平静"],
    [WenguExpr.Happy]: ["开心", "高兴"],
    [WenguExpr.Proud]: ["得意", "自豪"],
    [WenguExpr.Cheer]: ["欢呼", "庆祝"],
    [WenguExpr.Think]: ["思考", "疑惑"],
    [WenguExpr.Sad]: ["失落", "难过"],
    [WenguExpr.Push]: ["打气", "鼓励"],
    [WenguExpr.Doze]: ["打盹", "瞌睡"],
    [WenguExpr.Surprise]: ["惊讶"],
};

/** 某表情的候选文件名（不含扩展名，英文枚举键优先）。 */
export function exprImageNames(expr: WenguExpr): string[] {
    return [expr, ...CN_NAMES[expr]];
}

/** 工作区相对目录 + 文件名 → 资源 URL（逐段 encodeURIComponent，中文文件名可命中）。 */
export function imageUrl(dir: string, name: string, ext: string): string {
    const clean = dir.replace(/^\/+|\/+$/g, "");
    return `/${clean.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(name)}.${ext}`;
}

/** 目录下九表情的命中 URL 表；目录为空返回空表（内置 SVG 模式）。 */
export async function probeExprImages(dir: string): Promise<Partial<Record<WenguExpr, string>>> {
    const out: Partial<Record<WenguExpr, string>> = {};
    if (!dir.trim()) return out;
    await Promise.all(
        EXPR_KEYS.map(async (expr) => {
            for (const name of exprImageNames(expr)) {
                for (const ext of IMAGE_EXTS) {
                    const url = imageUrl(dir, name, ext);
                    try {
                        const resp = await fetch(url);
                        const ctype = resp.headers.get("Content-Type") ?? "";
                        if (resp.ok && (ctype.startsWith("image/") || ctype.includes("octet-stream"))) {
                            out[expr] = url;
                            return;
                        }
                    } catch (_) {
                        // 单个候选探测失败继续试下一个
                    }
                }
            }
        })
    );
    return out;
}
