export async function onRequestPost({ request, env }) {
  // Always return a controlled Response to avoid Worker exceptions (1101)
  const textHeaders = { "content-type": "text/plain; charset=utf-8" };

  // 1) Parse JSON body safely
  let text = "";
  let pms = [];
  try {
    const payload = await request.json();
    text = payload?.text ?? "";
    pms = Array.isArray(payload?.pms) ? payload.pms : [];
  } catch (e) {
    console.error("[api] Invalid JSON body:", e);
    return new Response("请求无效：需要有效的 JSON 请求体。", { status: 400, headers: textHeaders });
  }

  // 2) Basic validation
  if (!text || !pms.length) {
    return new Response("请求缺失参数：请提供占卜问题与卡牌数组。", { status: 400, headers: textHeaders });
  }

  // 3) Build new upstream URL: https://ai.fcic.cc/[question]
  const url = `https://ai.fcic.cc/${encodeURIComponent(text)}`;
  // Prepare body: pass all params via POST JSON as requested
  const body = { text, pms };
  const headers = {
    "content-type": "application/json",
    Accept: "text/plain, application/json"
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000); // 20s timeout
  let upstreamText = "";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);
    // Prefer text; if JSON and has 'content' field, use it
    let data = null;
    let textBody = "";
    try {
      textBody = await res.clone().text();
    } catch {}
    try {
      data = await res.json();
    } catch {}

    if (!res.ok) {
      console.error("[api] Upstream non-OK:", res.status, (textBody || "").slice(0, 512));
      return new Response(`服务暂时不可用（${res.status}）。请稍后重试。`, { status: 200, headers: textHeaders });
    }

    const content =
      (data && (data.content || data.message || data.text)) ||
      (typeof textBody === "string" ? textBody : "");

    if (content) {
      return new Response(content, { status: 200, headers: textHeaders });
    }

    return new Response("上游未返回内容。", { status: 200, headers: textHeaders });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err?.name === "AbortError";
    console.error("[api] Upstream fetch failed:", err);
    const msg = isAbort ? "请求超时，请稍后再试。" : "服务异常，请稍后重试。";
    return new Response(msg, { status: 200, headers: textHeaders });
  }
}
