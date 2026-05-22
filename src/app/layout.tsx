/**
 * 根布局：包裹所有页面，定义全局 HTML 结构、字体与 SEO 元数据
 */
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

// 通过 next/font 优化加载，并注入 CSS 变量供 Tailwind 使用
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 页面 <head> 中的 title、description 等
export const metadata: Metadata = {
  title: "AI Chat | Vercel",
  description: "Next.js + OpenAI 兼容 API（GPT 中转 / DeepSeek）",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      {/* children 为各路由页面（如 page.tsx）渲染出的内容 */}
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
