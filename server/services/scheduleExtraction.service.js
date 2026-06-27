const { chatCompletionJson } = require("./groq.service");
const { SYSTEM_PROMPT } = require("../prompts/scheduleExtraction.prompt");
const { cleanLlmJsonResponse } = require("../utils/helpers");

async function extractScheduleParams(userText) {
  const llmPrompt = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: `User message: "${userText}"` }
  ];

  try {
    const responseText = await chatCompletionJson(llmPrompt);
    const cleanedText = cleanLlmJsonResponse(responseText);
    const resultJson = JSON.parse(cleanedText);
    return {
      frequency: resultJson.frequency || null,
      dosage: resultJson.dosage || null
    };
  } catch (error) {
    console.error("[ScheduleExtractionService] Error extracting schedule parameters:", error);
    return { frequency: null, dosage: null };
  }
}

module.exports = { extractScheduleParams };
