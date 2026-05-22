/** 判断用户是否在请求「生成图片」而非普通聊天 */
export function isImageGenerationRequest(text: string): boolean {
  const t = text.trim();
  if (!t) return false;

  return (
    /(?:生成|画|绘制|做|来|弄|出)(?:一[张个幅]|些)?.*?(?:图|图片|图像)/i.test(t) ||
    /(?:图|图片|图像).*(?:生成|画|绘制)/i.test(t) ||
    /generate\s+(?:an?\s+)?image/i.test(t) ||
    (/draw\s+/i.test(t) && /(?:picture|image|photo)/i.test(t))
  );
}

/** 从中文描述里抽出绘图主体，并附上常用画风后缀 */
export function buildImagePrompt(userText: string): string {
  let subject = userText
    .trim()
    .replace(/^(请|帮我?|给我?)?/i, "")
    .replace(/^(生成|画|绘制|做|弄|来|出)(?:一[张个幅])?/i, "")
    .replace(/(?:的)?(?:图|图片|图像)$/i, "")
    .trim();

  if (!subject) subject = userText.trim();

  // 常见物体简单英文化，提升备用绘图通道效果
  const map: Record<string, string> = {
    皮鞋: "black leather dress shoes",
    球鞋: "sneakers",
    猫: "a cute cat",
    狗: "a cute dog",
  };
  for (const [cn, en] of Object.entries(map)) {
    if (subject.includes(cn)) {
      return `${en}, professional product photography, studio lighting, high detail, white background`;
    }
  }

  return `${subject}, high quality, detailed, professional photography`;
}
