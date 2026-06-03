"use client";

import { useEffect, useState } from "react";
import { isDesktopApp } from "@/lib/desktop-bridge";

/**
 * 挂载后再判断是否 Electron，避免 SSR/首屏与客户端 hydration 不一致。
 */
export function useDesktopApp(): boolean {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    setDesktop(isDesktopApp());
  }, []);

  return desktop;
}
