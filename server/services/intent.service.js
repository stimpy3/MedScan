const { SYSTEM_PROMPT } = require("../prompts/intent.prompt");
const { DRIFT_CHECK_SYSTEM_PROMPT } = require("../prompts/driftCheck.prompt");
const { chatCompletionJson } = require("./groq.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");

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
    if (!action) return "unclear";
    const VALID_DRIFT_ACTIONS = ["continue", "switch", "unclear"];
    return VALID_DRIFT_ACTIONS.includes(action) ? action : "switch";
  } catch (err) {
    console.error("Error checking intent drift:", err);
    return "unclear";
  }
}

module.exports = { classifyIntent, checkIntentDrift };
