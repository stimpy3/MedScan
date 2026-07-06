// server/config/llmProviders.js
// Single place to flip LLM providers — edit the values here, no env vars involved.
//
// VISION_PROVIDER — which model reads OCR images (medicine labels / prescriptions):
//   "gemma4"  → Cerebras gemma-4-31b   (default: bigger free allowance — 2,400 req/day pool)
//   "gemini"  → Google AI Studio gemini-2.5-flash (kept intact as backup; small free quota)
//
// SAFETY_PROVIDER — which model runs personalized safety checks (profile vs medicine):
//   "cerebras-glm" → Cerebras zai-glm-4.7 (only option wired for now)
//
// Note: all Cerebras models on this key share one pool: 5 req/min · 150 req/hr · 2,400 req/day ·
// 1M tokens/day — so OCR (gemma) and safety checks (glm) draw from the same budget.
module.exports = {
  VISION_PROVIDER: "gemma4",
  SAFETY_PROVIDER: "cerebras-glm"
};
