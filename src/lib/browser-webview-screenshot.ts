/** 桌面 WebView capturePage → JPEG base64（仅 Electron 渲染进程）。 */

type CaptureImage = {
  getSize: () => { width: number; height: number };
  toJPEG: (quality: number) => Uint8Array | Buffer;
};

export type WebviewCaptureElement = HTMLElement & {
  capturePage?: () => Promise<CaptureImage>;
};

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function captureWebviewScreenshot(
  webview: WebviewCaptureElement,
  options?: { quality?: number; maxBytes?: number },
): Promise<{
  jpegBase64: string;
  width: number;
  height: number;
  bytes: number;
} | null> {
  if (typeof webview.capturePage !== "function") return null;

  const quality = options?.quality ?? 62;
  const maxBytes = options?.maxBytes ?? 220_000;

  try {
    const image = await webview.capturePage();
    const size = image.getSize();
    const raw = image.toJPEG(quality);
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    if (bytes.length === 0 || bytes.length > maxBytes) return null;

    return {
      jpegBase64: uint8ToBase64(bytes),
      width: size.width,
      height: size.height,
      bytes: bytes.length,
    };
  } catch {
    return null;
  }
}
