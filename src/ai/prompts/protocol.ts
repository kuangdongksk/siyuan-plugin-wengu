/** 行协议格式约定（生成 prompt 共用：转换/增量/单题重生成/出题）。
 *  20260910 自 convert/service/QuestionDraft.ts 迁入 prompt 集中地
 *  （bank 域 import convert 域的层级倒挂随之消解）。 */
export function protocolSpec(): string {
    return `行协议格式（标记行必须顶格、独占一行；内容行原样书写，公式与图片行不需要任何转义）：
@@Q type=题型 knowledge=考点 chapter=章节
@@P stem
题干文字（公式行内 $...$、块级 $$...$$ 独占一行；空行分段，也可写多个 @@P stem）
@@P opt
选项内容（只写内容不写字母——字母由系统按顺序自动编 A、B、C…；正确项写在最前，之后是干扰项，每个选项一个 @@P opt）
@@P ans
答案（单选/多选写字母如 B、AD；判断写 √ 或 ×；填空用 | 分隔多个可接受答案；简答/作文写要点或范文）
@@P sol
解析文字
@@END
其它部件：材料块正文 @@P body、参考译文 @@P trans；多步引导题（type=steps）每步依次 @@P step（步引导语）、@@P step-opt（该步选项）、@@P step-ans（该步答案），步号自动递增，整题解析仍用 @@P sol；完形/新题型每空依次 @@P slot-opt、@@P slot-ans，空号自动递增。@@Q 行还可带：difficulty=1~5（有明确难度线索才写）、steps=method|result|…（steps 题必带，按序声明每步类型）、group=prev（材料组小题，材料=文中紧邻其前的材料块）、material=1（共享材料块，搭配 @@P body/trans）。`;
}
