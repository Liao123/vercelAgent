import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Electron 开发壳可能用 127.0.0.1，与 localhost 不同源，需放行 dev 资源 */
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  /** node-pty 为原生模块，需外部化 */
  serverExternalPackages: ["node-pty", "@modelcontextprotocol/sdk"],
  /** 仅桌面打包时启用（`npm run build:desktop` 会设置 BUILD_DESKTOP=1） */
  ...(process.env.BUILD_DESKTOP === "1" ? { output: "standalone" as const } : {}),
};

export default nextConfig;
