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

  // 3) Compose upstream request body
  const body = {
    messages: [
      {
        role: "system",
        content:
          `现在你是塔罗牌大师，根据我所选的牌去根据问题去解析，使用的是22张大阿尔克那牌，{"0": "愚者","1": "魔术师","2": "女祭司","3": "皇后","4": "皇帝","5": "教皇","6": "恋人","7": "战车","8": "力量","9": "隐士","10": "命运之轮","11": "正义","12": "倒吊人","13": "死神","14": "节制","15": "恶魔","16": "塔","17": "星星","18": "月亮","19": "太阳","20": "审判","21": "世界"}，下面我将以数组的形式给你卡牌，其中isReversed代表是否为逆位，no为从 0 到 21 对应的22张大阿尔克那牌，你在解析的时候，需要把0-21用22张大阿尔克那牌对应的名称回答，你只需要解释卡牌的含义及解析，最后结尾用百分比表示问题的概率，不用回答多余的话`
      },
      {
        role: "user",
        content: `卡牌数组是：${JSON.stringify(pms)}，问题是：'${text}？'，请帮我解析`
      }
    ],
    stream: false,
    model: "glm-4-flash",
    temperature: 0,
    presence_penalty: 0,
    frequency_penalty: 0,
    top_p: 1
  };

  // 4) Call upstream with timeout and safe parsing
  const apiKey = env?.AI_API_KEY || env?.NAS_AI_API_KEY || ""; // Prefer env var; avoid hard-coding secrets
  const headers = {
    "content-type": "application/json",
    // Fallback to legacy key only if env is not provided (discouraged but prevents hard failures)
    authorization:
      `Bearer ${apiKey || "sk-L8W2WtnCtdwG6nctF975D0E770144dE5Be3123Fa16720a03"}`
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000); // 20s timeout
  let upstreamText = "";

  try {
    const res = await fetch("https://nas-ai.4ce.cn/v1/chat/completions", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    clearTimeout(timer);

    // Attempt JSON first; if fail, fallback to text
    let data = null;
    try {
      data = await res.clone().json();
    } catch (e) {
      // Not JSON, try text
      upstreamText = await res.text();
    }

    if (data) {
      const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text;
      if (content) {
        return new Response(content, { status: 200, headers: textHeaders });
      }
      // Return a compact dump to aid debugging (do not throw)
      return new Response(
        `上游服务未返回有效内容。\n${JSON.stringify({ status: res.status, data }, null, 2)}`,
        { status: 200, headers: textHeaders }
      );
    }

    // Non-JSON or error HTML
    if (!res.ok) {
      console.error("[api] Upstream non-OK:", res.status, upstreamText?.slice(0, 512));
      return new Response(
        `服务暂时不可用（${res.status}）。请稍后重试。`,
        { status: 200, headers: textHeaders }
      );
    }

    // OK but text body
    if (upstreamText) {
      return new Response(upstreamText, { status: 200, headers: textHeaders });
    }

    return new Response("未获取到上游响应。", { status: 200, headers: textHeaders });
  } catch (err) {
    clearTimeout(timer);
    const isAbort = err?.name === "AbortError";
    console.error("[api] Upstream fetch failed:", err);
    const msg = isAbort ? "请求超时，请稍后再试。" : "服务异常，请稍后重试。";
    return new Response(msg, { status: 200, headers: textHeaders });
  }
}
