import fs from "fs";

const key = process.env.OPENAI_API_KEY;
const base = "https://queqiao.online/v1/chat/completions";
const path =
  "C:/Users/86173/.cursor/projects/d-vec-next/assets/c__Users_86173_AppData_Roaming_Cursor_User_workspaceStorage_3543b217970da4ccb3e3d508cbd7ccee_images_image-cede014e-a611-46f9-9ef8-b9707bb2aa24.png";

const buf = fs.readFileSync(path);
const b64 = buf.toString("base64");
const dataUrl = `data:image/png;base64,${b64}`;
console.log("image size KB:", Math.round(buf.length / 1024), "dataUrl MB:", (dataUrl.length / 1024 / 1024).toFixed(2));

for (const model of ["gpt-5.4-mini", "gpt-5.4"]) {
  const res = await fetch(base, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "描述这张图片的内容" },
            { type: "image_url", image_url: { url: dataUrl, detail: "auto" } },
          ],
        },
      ],
      max_tokens: 500,
    }),
  });
  const text = await res.text();
  console.log("\n", model, "HTTP", res.status, "body len", text.length);
  try {
    const data = JSON.parse(text);
    const msg = data.choices?.[0]?.message;
    console.log("content len:", (msg?.content || "").length);
    console.log("content preview:", String(msg?.content).slice(0, 200));
    console.log("keys:", msg ? Object.keys(msg) : "no msg");
    if (data.error) console.log("error:", data.error);
  } catch {
    console.log("parse fail", text.slice(0, 200));
  }
}
