/**
 * 审查 Tab 空态文案（A132 · 对齐 Cursor 审查上下文）。
 */
export type ReviewEmptyContext = {
  pendingApprovalCount: number;
  gitDirtyCount: number;
  autoApplyEnabled: boolean;
  defaultAcceptMode?: boolean;
};

export function buildReviewEmptyHint(ctx: ReviewEmptyContext): string {
  if (ctx.defaultAcceptMode) {
    if (ctx.gitDirtyCount > 0) {
      return "正在加载工作区 diff…";
    }
    return "暂无文件变更。Agent 写入后会在此展示 diff，悬停文件可撤销更改。";
  }
  if (ctx.pendingApprovalCount > 0) {
    return "有待确认的变更，正在加载 diff…若长时间空白请点「刷新」。";
  }
  if (ctx.gitDirtyCount > 0) {
    return "当前无 Agent 待审项。可在「文件」Tab 查看路径，或提交前在此预览 Git 工作区 diff（只读）。";
  }
  if (ctx.autoApplyEnabled) {
    return "暂无待审查 diff。文件变更通常会自动写入；关闭输入框 ⚙「自动应用」后，新变更会出现在此处待确认。";
  }
  return "暂无待审查 diff。Agent 产生文件变更后，将在此展示 split diff；可点「应用更改」写盘。";
}

/** Cursor 对齐：审查区主操作文案 */
export const REVIEW_ACTION_APPLY = "应用更改";
export const REVIEW_ACTION_APPLY_BUSY = "应用中…";
export const REVIEW_ACTION_DISCARD = "放弃更改";

/** 中栏变更卡（与审查区一致） */
export const TURN_CHANGE_APPLY = REVIEW_ACTION_APPLY;
export const TURN_CHANGE_APPLY_BUSY = REVIEW_ACTION_APPLY_BUSY;
export const TURN_CHANGE_DISCARD = REVIEW_ACTION_DISCARD;
