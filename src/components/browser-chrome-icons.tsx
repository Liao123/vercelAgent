"use client";

import type { ReactNode, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export function BrowserGlobeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <circle cx="8" cy="8" r="5.5" stroke="currentColor" strokeWidth="1.35" />
      <path
        d="M2.5 8h11M8 2.5c1.8 1.5 2.8 3.4 2.8 5.5S9.8 11.5 8 13M8 2.5C6.2 4 5.2 5.9 5.2 8s1 4 2.8 5.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
    </svg>
  );
}

export function BrowserPlusIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M8 3.5v9M3.5 8h9"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrowserExpandIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M5.5 3.5h-2v2M10.5 3.5h2v2M5.5 12.5h-2v-2M10.5 12.5h2v-2"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M6 6l4 4M10 6l-4 4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function BrowserListIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M3 4.5h10M3 8h7M3 11.5h5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <circle cx="12.5" cy="4.5" r="0.75" fill="currentColor" />
      <circle cx="11" cy="8" r="0.75" fill="currentColor" />
      <circle cx="9.5" cy="11.5" r="0.75" fill="currentColor" />
    </svg>
  );
}

export function BrowserBackIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M9 3.5L4.5 8 9 12.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrowserForwardIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M7 3.5L11.5 8 7 12.5"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrowserRefreshIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M11.5 2.5A5 5 0 1 0 13 8"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
      />
      <path
        d="M11.5 2.5V5.5h3"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrowserStarIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M8 3.2l1.35 2.74 3.05.44-2.2 2.14.52 3.03L8 10.6l-2.72 1.45.52-3.03-2.2-2.14 3.05-.44L8 3.2z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function BrowserMoreIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <circle cx="4" cy="8" r="0.9" fill="currentColor" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" />
    </svg>
  );
}

type BrowserChromeIconButtonProps = {
  title: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
};

/** 与 AgentRightRail Tab 按钮同尺度的图标按钮 */
export function BrowserChromeIconButton({
  title,
  onClick,
  disabled = false,
  active = false,
  children,
}: BrowserChromeIconButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition disabled:opacity-35 ${
        active
          ? "bg-zinc-200/90 text-zinc-900 dark:bg-zinc-700/90 dark:text-zinc-100"
          : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800/80 dark:hover:text-zinc-300"
      }`}
    >
      {children}
    </button>
  );
}
