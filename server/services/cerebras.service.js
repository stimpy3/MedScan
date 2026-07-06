// server/services/cerebras.service.js
// Cerebras inference API (OpenAI-compatible). Two roles here, selected via config/llmProviders.js:
//   - zai-glm-4.7  → personalized safety checks (JSON mode; reasoning model, grounded judgments)
//   - gemma-4-31b  → vision/OCR extraction (default VISION_PROVIDER; Gemini remains the backup)
// Free-tier pool on this key (verified live): 5 RPM · 150 req/hr · 2,400 req/day · 1M tokens/day,
// shared across all models — keep calls deliberate and cached where possible.
const axios = require("axios");

const ENDPOINT = "https://api.cerebras.ai/v1/chat/completions";
const MODEL_SAFETY = "zai-glm-4.7";
const MODEL_VISION = "gemma-4-31b";

// Reuse the exact OCR extraction prompt Gemini uses so the two vision providers are drop-in
// interchangeable (same JSON contract, same client handling).
const { EXTRACTION_PROMPT } = require("./gemini.service");

function apiKey() {
  const key = process.env.CEREBRAS_API_KEY;
  if (!key) throw new Error("CEREBRAS_API_KEY is not defined in the environment variables");
  return key;
}

async function callCerebras(body, timeoutMs) {
  const response = await axios.post(ENDPOINT, body, {
    headers: { "Authorization": `Bearer ${apiKey()}`, "Content-Type": "application/json" },
    timeout: timeoutMs
  });
  return response.data?.choices?.[0]?.message?.content ?? "";
}

// JSON-mode chat on GLM 4.7. Mirrors groq.service's contract: takes messages, returns the raw
// content string (caller parses). max_completion_tokens is bounded because GLM is a reasoning
// model — its hidden trace ran ~1.2K tokens on a representative safety check, so 3K leaves room
// without letting a runaway call eat the shared daily token pool.
function chatCompletionJson(messages, { timeoutMs = 30000 } = {}) {
  console.log({ provider: "cerebras", model: MODEL_SAFETY, messageCount: messages.length });
  return callCerebras({
    model: MODEL_SAFETY,
    messages,
    temperature: 0,
    response_format: { type: "json_object" },
    max_completion_tokens: 3000
  }, timeoutMs);
}

// Vision extraction on Gemma 4 — same input/output contract as gemini.service.extractFromImage.
async function extractFromImage(base64, mimeType = "image/jpeg") {
  console.log({ provider: "cerebras", model: MODEL_VISION, task: "ocr-extract" });
  const text = await callCerebras({
    model: MODEL_VISION,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: EXTRACTION_PROMPT },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64}` } }
        ]
      }
    ]
  }, 45000);

  try {
    return JSON.parse(text);
  } catch (err) {
    console.error("[CerebrasService] Could not parse OCR JSON, raw text:", text);
    return { documentType: "unrelated", medicines: [], rawText: text };
  }
}

module.exports = { chatCompletionJson, extractFromImage };
