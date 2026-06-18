/**
 * 从 DataTransfer（剪贴板或拖放）提取图片文件。
 */
export function getImageFilesFromDataTransfer(data: DataTransfer): File[] {
  const files: File[] = [];

  if (data.files?.length) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith("image/")) {
        files.push(normalizeClipboardImageFile(file));
      }
    }
  }

  if (files.length > 0) {
    return files;
  }

  for (const item of Array.from(data.items)) {
    if (item.kind !== "file") continue;
    if (!item.type.startsWith("image/")) continue;
    const file = item.getAsFile();
    if (file) {
      files.push(normalizeClipboardImageFile(file));
    }
  }

  return files;
}

function normalizeClipboardImageFile(file: File): File {
  if (file.type && file.name) return file;
  const ext = file.type?.split("/")[1] || "png";
  return new File([file], `clipboard-${Date.now()}.${ext}`, {
    type: file.type || "image/png",
  });
}

/** @deprecated 使用 getImageFilesFromDataTransfer */
export const getImageFilesFromClipboard = getImageFilesFromDataTransfer;

/** 拖放悬停时是否可能包含图片（items 在 drag 阶段可能为空）。 */
export function dataTransferMayHaveImageFiles(data: DataTransfer): boolean {
  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) return true;
    }
  }
  if (data.files?.length) {
    for (const file of Array.from(data.files)) {
      if (file.type.startsWith("image/")) return true;
    }
  }
  return Array.from(data.types).includes("Files");
}

export function clipboardHasImageOnly(clipboardData: DataTransfer): boolean {
  const items = Array.from(clipboardData.items);
  if (items.length === 0) return false;
  const imageItems = items.filter(
    (item) => item.kind === "file" && item.type.startsWith("image/"),
  );
  if (imageItems.length === 0) return false;
  const text = clipboardData.getData("text/plain").trim();
  return !text;
}
