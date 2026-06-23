/** 三栏布局：右侧栏显示/隐藏切换图标（对齐 Cursor 右侧面板按钮）。 */
export function TripleRightPanelToggleIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.35"
      aria-hidden
    >
      <rect x="2.5" y="3" width="11" height="10" rx="1.2" />
      <path d="M11.5 3v10" strokeLinecap="round" />
    </svg>
  );
}
