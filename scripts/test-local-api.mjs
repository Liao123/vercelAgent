import fs from "fs";

const buf = fs.readFileSync(
  "C:/Users/86173/.cursor/projects/d-vec-next/assets/c__Users_86173_AppData_Roaming_Cursor_User_workspaceStorage_3543b217970da4ccb3e3d508cbd7ccee_images_image-cede014e-a611-46f9-9ef8-b9707bb2aa24.png",
);
const dataUrl = `data:image/png;base64,${buf.toString("base64")}`;

const messages = [
  {
    role: "user",
    content: "这个图片的内容描述一些",
    images: [dataUrl],
  },
];

// mimic toApiMessages
const apiMessages = messages.map((msg) => {
  if (msg.role === "user" && msg.images?.length) {
    const parts = [{ type: "text", text: msg.content }];
    for (const url of msg.images) {
      parts.push({ type: "image_url", image_url: { url, detail: "auto" } });
    }
    return { role: "user", content: parts };
  }
  return { role: msg.role, content: msg.content };
});

const res = await fetch("http://localhost:3000/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ messages: apiMessages }),
});
console.log("status", res.status);
const data = await res.json();
console.log(JSON.stringify(data, null, 2).slice(0, 800));
