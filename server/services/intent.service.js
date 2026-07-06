const { SYSTEM_PROMPT } = require("../prompts/intent.prompt");
const { DRIFT_CHECK_SYSTEM_PROMPT } = require("../prompts/driftCheck.prompt");
const { chatCompletionJson } = require("./groq.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");

// The only sub-aspects of explain_medicine that get a targeted chat answer instead of the
// full card. Anything else the LLM emits is coerced to null → full card (today's behavior).
const VALID_SUBFIELDS = ["side_effects", "composition", "uses", "price", "manufacturer", "pack_size"];

async function classifyIntent(message, history) {
  // Format chat history for Groq API
  const formattedHistory = (history || []).map(msg => ({
    role: msg.sender === "user" ? "user" : "assistant",
    content: msg.text
  }));

 

  const messages = [
    { role: "system", content: SYSTEM_PROMPT },
    ...formattedHistory,
    { role: "user", content: message }
  ];


  const responseText = await chatCompletionJson(messages);
  console.log('[raw] Groq response text', responseText);
  const cleanedResponseText = cleanLlmJsonResponse(responseText);
  console.log('[cleaned] Groq response text', cleanedResponseText);
  const resultJson = JSON.parse(cleanedResponseText);
  console.log('[parsed] Groq JSON', resultJson);

  // subField is trusted only when whitelisted AND the intent is explain_medicine.
  resultJson.subField =
    resultJson.intent === "explain_medicine" && VALID_SUBFIELDS.includes(resultJson.subField)
      ? resultJson.subField
      : null;

  return resultJson;
}

async function checkIntentDrift(activeIntent, message) {
  const prompt = DRIFT_CHECK_SYSTEM_PROMPT.replace("{activeIntent}", activeIntent);
  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: message }
  ];

  try {
    const responseText = await chatCompletionJson(messages);
    const cleanedResponseText = cleanLlmJsonResponse(responseText);
    const resultJson = JSON.parse(cleanedResponseText);
    const action = resultJson.action;
    const VALID_DRIFT_ACTIONS = ["continue", "switch", "unclear"];
    // subField only means something on "continue" of explain_medicine — validated here so the
    // controller can trust it blindly.
    const subField =
      action === "continue" && activeIntent === "explain_medicine" && VALID_SUBFIELDS.includes(resultJson.subField)
        ? resultJson.subField
        : null;
    if (!action) return { action: "unclear", subField: null };
    return { action: VALID_DRIFT_ACTIONS.includes(action) ? action : "switch", subField };
  } catch (err) {
    console.error("Error checking intent drift:", err);
    return { action: "unclear", subField: null };
  }
}

module.exports = { classifyIntent, checkIntentDrift };
