const key = process.env.OPENAI_API_KEY;
const base = process.env.OPENAI_API_BASE || "https://queqiao.online";
const url = `${base.replace(/\/$/, "")}/v1/chat/completions`;

// 1x1 red PNG
const img =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

for (const model of ["gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]) {
  const res = await fetch(url, {
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
            { type: "text", text: "Describe this image in one sentence." },
            { type: "image_url", image_url: { url: img, detail: "low" } },
          ],
        },
      ],
      max_tokens: 200,
    }),
  });
  const data = await res.json();
  const msg = data.choices?.[0]?.message;
  console.log("\n---", model, "status", res.status, "---");
  console.log("content:", JSON.stringify(msg?.content)?.slice(0, 300));
  console.log("refusal:", msg?.refusal);
  console.log("reasoning:", msg?.reasoning_content?.slice?.(0, 100));
  if (data.error) console.log("error:", data.error);
}
