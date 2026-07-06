const axios = require("axios");

// Two model tiers on Groq. FAST (gpt-oss-20b) is the DEFAULT for nearly everything — intent
// classification, drift/subField detection, medicine extraction, card/answer writing, suggestions,
// schedule extraction, lazy-enrichment query building. SMART (gpt-oss-120b) is reserved for the
// small number of call sites that do real semantic judgment 20b has been observed to get wrong
// (see chatCompletionJsonSmart callers). Keep it that way: on this account's plan gpt-oss-120b and
// gpt-oss-20b share the SAME 8K-tokens-per-minute / 30-RPM free-tier cap (verified against Groq's
// rate-limit docs — 120b is not separately quota-privileged), but each 120b call burns MORE of that
// shared budget per call (bigger reasoning trace, slower, pricier), so it still must stay a
// deliberate, low-frequency choice, not a blanket upgrade.
const MODEL_FAST = "openai/gpt-oss-20b";
const MODEL_SMART = "openai/gpt-oss-120b";

async function callGroq(messages, model, reasoningEffort, maxCompletionTokens) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not defined in the environment variables");
  }

  console.log({ model, messageCount: messages.length, reasoningEffort });

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model,
      messages,
      response_format: { type: "json_object" },
      reasoning_effort: reasoningEffort,
      // gpt-oss models emit a separate reasoning trace. JSON mode requires "parsed" or "hidden" —
      // "raw" (reasoning inlined as <think> tags in content) is REJECTED by Groq alongside JSON mode.
      // We only ever want the final JSON, so "hidden" keeps message.content pure and parseable.
      reasoning_format: "hidden",
      // Bounded explicitly: an uncapped reasoning trace can occasionally consume the whole
      // completion budget before ever emitting the JSON content, which Groq then rejects as
      // "failed to validate JSON" (observed on gpt-oss-120b at reasoning_effort "high"). Both
      // models share an 8K-tokens-per-minute cap on this plan, so a runaway single call also
      // eats disproportionately into that per-minute budget.
      max_completion_tokens: maxCompletionTokens
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  console.log('groq status', response.status);
  console.log('[GroqService] raw response content', response.data?.choices?.[0]?.message?.content);

  return response.data.choices[0].message.content;
}

// Default tier — constrained, few-shot-guided tasks (classification, extraction, summarization,
// writing from already-grounded facts). Low reasoning effort: fast, and these don't need deliberation.
function chatCompletionJson(messages) {
  return callGroq(messages, MODEL_FAST, "low", 1024);
}

// Smart tier — reserved for tasks needing deeper semantic judgment (see call sites for why each one
// qualifies). "medium" effort, not "high": high effort was observed to occasionally burn the entire
// completion budget on reasoning before emitting the JSON, causing intermittent failures — medium is
// still meaningfully deeper than the fast tier's "low" but far more reliable under json_object mode.
// Use sparingly: gpt-oss-120b and gpt-oss-20b currently share the SAME free-tier 8K TPM / 30 RPM cap
// on this account, so 120b isn't quota-privileged — it just spends that shared budget faster per call
// (bigger reasoning trace, slower, pricier). Callers already fall back gracefully on any LLM error.
function chatCompletionJsonSmart(messages) {
  return callGroq(messages, MODEL_SMART, "medium", 2048);
}

module.exports = { chatCompletionJson, chatCompletionJsonSmart };
