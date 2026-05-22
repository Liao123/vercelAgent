import { compressImageFile } from "@/lib/compress-image";

const MAX_SIZE_MB = 8;
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === "string") resolve(result);
      else reject(new Error("读取文件失败"));
    };
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.readAsDataURL(blob);
  });
}

/** 压缩并转为 data URL，供 vision API 使用 */
export async function readImageFile(file: File): Promise<string> {
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("仅支持 JPG、PNG、GIF、WebP");
  }
  if (file.size > MAX_SIZE_MB * 1024 * 1024) {
    throw new Error(`单张图片不能超过 ${MAX_SIZE_MB}MB`);
  }

  const compressed = await compressImageFile(file);
  return blobToDataUrl(compressed);
}
