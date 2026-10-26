// CHTAVIED.NDA AI — server-side AI proxy.
// Keys live only here. The browser never sees them.

const EXPERTS = {
  master: {
    title: "MASTER AI",
    prompt:
      "You are MASTER AI, the router of CHTAVIED.NDA AI. Understand what the user actually needs, " +
      "then answer it fully and simply, choosing the right style (writing, teaching, coding, planning). " +
      "If the question is ambiguous, answer the most likely intent first and ask one short clarifying question at the end."
  },
  writer: {
    title: "Writer",
    prompt:
      "You are a warm, skilled Indian writer. Write clear, human prose in the user's language. " +
      "Give the final text first, then a short note on what you changed. Avoid clichés and filler."
  },
  tutor: {
    title: "Tutor",
    prompt:
      "You are a patient tutor for Indian students. Explain step by step, from basics, with one small " +
      "example and one practice question. Keep language simple and friendly."
  },
  coder: {
    title: "Coder",
    prompt:
      "You are a senior software engineer. Give working code first inside a fenced code block, " +
      "then a short explanation of the tricky parts, then edge cases. Prefer modern, standard APIs."
  },
  planner: {
    title: "Planner",
    prompt:
      "You are a practical planner. Turn the request into a clear plan with numbered steps, realistic " +
      "time estimates and a first action the user can take today."
  },
  translator: {
    title: "Translator",
    prompt:
      "You are an expert Hindi-English translator. Translate naturally, keeping the original tone and " +
      "meaning. Give only the translation, then a one-line note if a phrase had no exact match."
  },
  maths: {
    title: "Maths",
    prompt:
      "You are a maths teacher. Solve step by step, show the formula used, and state the final answer " +
      "clearly. Check your arithmetic before answering."
  },
  career: {
    title: "Career",
    prompt:
      "You are a friendly career guide for Indian job seekers. Give concrete, practical advice " +
      "(skills, resumes, interviews, salary context in rupees). Be honest about trade-offs."
  }
};

const DEFAULT_SYSTEM =
  "You are CHTAVIED.NDA AI, a helpful assistant for Indian users. " +
  "Reply in the language the user writes in (Hindi, Hinglish or English). Be accurate and concise. " +
  "If you are unsure, say so instead of guessing.";

const buckets = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 20;

function rateLimited(ip) {
  const now = Date.now();
  const entry = buckets.get(ip);
  if (!entry || now - entry.start > WINDOW_MS) {
    buckets.set(ip, { start: now, count: 1 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_PER_WINDOW;
}

function reply(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(body)
  };
}

function buildSystem(expertKey) {
  const expert = EXPERTS[expertKey] || EXPERTS.master;
  return DEFAULT_SYSTEM + "\n\nYour current role: " + expert.title + ". " + expert.prompt;
}

function cleanMessages(incoming) {
  return (Array.isArray(incoming) ? incoming : [])
    .filter((m) => m && (m.role === "user" || m.role === "assistant"))
    .slice(-20)
    .map((m) => ({
      role: m.role,
      text: typeof m.text === "string" ? m.text : "",
      images: Array.isArray(m.images)
        ? m.images.filter((u) => typeof u === "string" && u.startsWith("data:image/")).slice(0, 2)
        : []
    }));
}

function parseDataUrl(url) {
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(url);
  if (!match) return null;
  return { mimeType: match[1], base64: match[2] };
}

/* ------------------------------------------------------------------ OpenAI */
async function callOpenAI(key, model, system, messages) {
  const payload = {
    model,
    messages: [
      { role: "system", content: system },
      ...messages.map((m) => {
        if (!m.images.length) return { role: m.role, content: m.text };
        const content = [];
        if (m.text.trim()) content.push({ type: "text", text: m.text });
        m.images.forEach((img) => content.push({ type: "image_url", image_url: { url: img } }));
        return { role: m.role, content };
      })
    ],
    temperature: 0.7,
    max_tokens: 1500
  };

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data && data.error && data.error.message) || "OpenAI request fail hui (" + res.status + ")"
    );
  }
  const text = data.choices && data.choices[0] && data.choices[0].message.content;
  if (!text) throw new Error("AI ne khaali jawab diya.");
  return { text, model: data.model || model, provider: "openai" };
}

/* --------------------------------------------------------------- Anthropic */
async function callAnthropic(key, model, system, messages) {
  const payload = {
    model,
    max_tokens: 1500,
    system,
    messages: messages.map((m) => {
      if (!m.images.length) return { role: m.role, content: m.text };
      const content = [];
      if (m.text.trim()) content.push({ type: "text", text: m.text });
      m.images.forEach((img) => {
        const parsed = parseDataUrl(img);
        if (parsed) {
          content.push({
            type: "image",
            source: { type: "base64", media_type: parsed.mimeType, data: parsed.base64 }
          });
        }
      });
      return { role: m.role, content };
    })
  };

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(
      (data && data.error && data.error.message) || "Claude request fail hui (" + res.status + ")"
    );
  }
  const parts = Array.isArray(data.content) ? data.content : [];
  const text = parts.filter((p) => p.type === "text").map((p) => p.text).join("\n").trim();
  if (!text) throw new Error("AI ne khaali jawab diya.");
  return { text, model: data.model || model, provider: "anthropic" };
}

/* ------------------------------------------------------------------ Gemini */
async function callGemini(key, model, system, messages) {
  const contents = messages.map((m) => {
    const parts = [];
    if (m.text.trim()) parts.push({ text: m.text });
    m.images.forEach((img) => {
      const parsed = parseDataUrl(img);
      if (parsed) parts.push({ inline_data: { mime_type: parsed.mimeType, data: parsed.base64 } });
    });
    return { role: m.role === "assistant" ? "model" : "user", parts };
  });

  const payload = {
    systemInstruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { temperature: 0.7, maxOutputTokens: 1500 }
  };

  const res = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/models/" +
      encodeURIComponent(model) +
      ":generateContent?key=" +
      encodeURIComponent(key),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    }
  );
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error && data.error.message;
    throw new Error(msg || "Gemini request fail hui (" + res.status + ")");
  }
  const candidates = data.candidates || [];
  const parts = (candidates[0] && candidates[0].content && candidates[0].content.parts) || [];
  const text = parts.map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("AI ne khaali jawab diya.");
  return { text, model, provider: "gemini" };
}

/* ------------------------------------------------------------------ handler */
exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return reply(405, { error: "Sirf POST allowed hai." });

  const ip =
    (event.headers["x-nf-client-connection-ip"] || event.headers["client-ip"] || "unknown") + "";
  if (rateLimited(ip)) {
    return reply(429, { error: "Bahut zyada messages. Ek minute ruk kar dobara try karein." });
  }

  let body;
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return reply(400, { error: "Request theek nahi thi (invalid JSON)." });
  }

  const messages = cleanMessages(body.messages);
  if (!messages.length) return reply(400, { error: "Koi message nahi mila." });

  const expertKey = EXPERTS[body.expert] ? body.expert : "master";
  const system = buildSystem(expertKey);
  const requested = String(body.model || "auto");

  const keys = {
    openai: process.env.OPENAI_API_KEY || "",
    anthropic: process.env.ANTHROPIC_API_KEY || "",
    gemini: process.env.GEMINI_API_KEY || ""
  };

  let provider = requested;
  if (requested === "auto") {
    if (keys.openai) provider = "openai";
    else if (keys.gemini) provider = "gemini";
    else if (keys.anthropic) provider = "anthropic";
    else provider = "openai";
  }

  if (!keys[provider]) {
    const names = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", gemini: "GEMINI_API_KEY" };
    return reply(503, {
      error:
        "Is model ki key set nahi hai. Netlify → Site configuration → Environment variables mein " +
        names[provider] +
        " add karein, phir site redeploy karein."
    });
  }

  try {
    if (provider === "openai") {
      const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
      const out = await callOpenAI(keys.openai, model, system, messages);
      return reply(200, { reply: out.text, model: out.model, provider: out.provider });
    }
    if (provider === "anthropic") {
      const model = process.env.ANTHROPIC_MODEL || "claude-3-5-sonnet-latest";
      const out = await callAnthropic(keys.anthropic, model, system, messages);
      return reply(200, { reply: out.text, model: out.model, provider: out.provider });
    }
    const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const out = await callGemini(keys.gemini, model, system, messages);
    return reply(200, { reply: out.text, model: out.model, provider: out.provider });
  } catch (err) {
    return reply(502, { error: err.message || "AI se jawab nahi aaya." });
  }
};
