"use client";

type ChevronIconProps = {
  expanded?: boolean;
  /** tree：收起向右、展开向下；dropdown：收起向下、展开向上 */
  variant?: "tree" | "dropdown";
  className?: string;
};

/** 侧栏 / 文件树 / 下拉等展开箭头（比 Unicode 字符更清晰）。 */
export function ChevronIcon({
  expanded = false,
  variant = "tree",
  className = "h-4 w-4",
}: ChevronIconProps) {
  const rotation =
    variant === "tree"
      ? expanded
        ? "rotate-90"
        : ""
      : expanded
        ? "rotate-180"
        : "";

  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden
      className={`shrink-0 text-zinc-500 transition-transform duration-150 dark:text-zinc-400 ${rotation} ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {variant === "dropdown" ? (
        <path d="M4 6l4 4 4-4" />
      ) : (
        <path d="M6 4l4 4-4 4" />
      )}
    </svg>
  );
}
