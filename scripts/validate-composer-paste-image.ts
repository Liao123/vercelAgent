/**
 * A122/A123：Composer 剪贴板粘贴与拖放截图。
 *
 * 运行：npm run validate:composer-paste-image
 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  clipboardHasImageOnly,
  dataTransferMayHaveImageFiles,
  getImageFilesFromDataTransfer,
} from "../src/lib/composer-clipboard-image";

class MockDataTransferItem {
  kind: string;
  type: string;
  private file: File | null;

  constructor(file: File) {
    this.kind = "file";
    this.type = file.type;
    this.file = file;
  }

  getAsFile(): File | null {
    return this.file;
  }
}

class MockDataTransfer {
  items: MockDataTransferItem[] = [];
  files: FileList;

  constructor(files: File[]) {
    this.items = files.map((file) => new MockDataTransferItem(file));
    const list = {
      length: files.length,
      item: (index: number) => files[index] ?? null,
      [Symbol.iterator]: function* () {
        for (const file of files) yield file;
      },
    } as FileList;
    for (let i = 0; i < files.length; i += 1) {
      Object.defineProperty(list, String(i), { value: files[i] });
    }
    this.files = list;
  }

  getData(_type: string): string {
    return "";
  }
}

async function main(): Promise<void> {
  const png = new File([Uint8Array.from([137, 80, 78, 71])], "shot.png", {
    type: "image/png",
  });
  const text = new File(["hello"], "note.txt", { type: "text/plain" });

  const fromFiles = getImageFilesFromDataTransfer(
    new MockDataTransfer([png, text]) as unknown as DataTransfer,
  );
  assert.equal(fromFiles.length, 1);
  assert.equal(fromFiles[0]?.type, "image/png");
  assert.ok(fromFiles[0]?.name.includes("shot.png"));

  const fromItems = getImageFilesFromDataTransfer(
    new MockDataTransfer([png]) as unknown as DataTransfer,
  );
  assert.equal(fromItems.length, 1);

  assert.equal(
    clipboardHasImageOnly(
      new MockDataTransfer([png]) as unknown as DataTransfer,
    ),
    true,
  );

  const composer = await fs.readFile(
    `${process.cwd()}/src/components/agent-composer.tsx`,
    "utf8",
  );
  const panel = await fs.readFile(
    `${process.cwd()}/src/components/agent-panel.tsx`,
    "utf8",
  );
  assert.ok(composer.includes("onPaste={onPaste}"));
  assert.ok(composer.includes("onImageDrop"));
  assert.ok(composer.includes("getImageFilesFromDataTransfer"));
  assert.ok(panel.includes("onPasteReferenceImages"));
  assert.ok(panel.includes('addReferenceImagesFromFiles(files, "drop")'));
  assert.ok(panel.includes("已粘贴"));
  assert.ok(panel.includes("已拖入"));

  assert.equal(
    dataTransferMayHaveImageFiles(
      new MockDataTransfer([png]) as unknown as DataTransfer,
    ),
    true,
  );

  console.log("validate-composer-paste-image: passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
