// server/services/suggestions.service.js
const { SUGGESTIONS_SYSTEM_PROMPT } = require("../prompts/suggestions.prompt");
const { chatCompletionJson } = require("./groq.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");

async function generateSuggestions(context) {
  const {
    lastIntent: activeIntent,
    activeMedicines = [],
    focusedMedicine = null,
    lastAlternatives = []
  } = context || {};

  const medicines = activeMedicines;
  const medicinesList = Array.isArray(medicines) && medicines.length > 0
    ? medicines.map(m => m.name).join(", ")
    : "the medicine";

  // After find_alternatives: Explain/Compare already live on each card — skip LLM,
  // just return the one action the cards don't cover: scheduling the original medicine.
  if (activeIntent === "find_alternatives") {
    const originalName = focusedMedicine?.name || (medicines[0]?.name ?? "the medicine");
    console.log(`[SuggestionsService] find_alternatives — returning schedule-only bubble for "${originalName}"`);
    return [{
      intent: "schedule_medicine",
      label: `Schedule ${originalName}`,
      text: `I want to schedule ${originalName}`
    }];
  }

  // Build a short note that steers per-medicine fan-out and alternatives suppression.
  let contextNote = "";
  if (activeIntent === "compare_medicines" && medicines.length >= 2) {
    contextNote =
      `Two medicines are in context: ${medicines.map(m => m.name).join(" and ")}. ` +
      `For per-medicine actions (like explaining), create a SEPARATE suggestion for EACH medicine by name ` +
      `(e.g. "Explain ${medicines[0].name}" and "Explain ${medicines[1].name}"), not one generic suggestion.`;
  } else if (activeIntent === "find_alternatives") {
    const altNote = lastAlternatives.length
      ? `The alternatives already shown (${lastAlternatives.join(", ")}) each have their own Explain and Compare buttons on their cards. `
      : "";
    contextNote =
      altNote +
      `DO NOT suggest "explain_medicine" or "compare_medicines" here — those actions already live on the alternative cards. ` +
      `Prefer higher-level actions like scheduling ${focusedMedicine?.name || medicinesList} or asking a new question.`;
  } else if (focusedMedicine) {
    contextNote = `The focused medicine is ${focusedMedicine.name}; use it as the default subject for follow-ups.`;
  }

  console.log(`[SuggestionsService] Generating suggestions for intent: "${activeIntent}", meds: "${medicinesList}"`);

  const prompt = SUGGESTIONS_SYSTEM_PROMPT
    .replace("{activeIntent}", activeIntent)
    .replace("{medicinesList}", medicinesList)
    .replace("{contextNote}", contextNote || "None.");

  const messages = [
    { role: "system", content: prompt },
    { role: "user", content: "Generate the 3 follow-up suggestions." }
  ];

  try {
    const responseText = await chatCompletionJson(messages);
    const cleanedText = cleanLlmJsonResponse(responseText);
    let result = JSON.parse(cleanedText);
    let suggestions = result.suggestions || result;
    
    // Support LLM returning an object/dictionary instead of an array
    if (!Array.isArray(suggestions) && typeof suggestions === "object" && suggestions !== null) {
      suggestions = Object.values(suggestions);
    }

    if (Array.isArray(suggestions) && suggestions.length >= 1 && suggestions.length <= 4) {
      return suggestions.slice(0, 4);
    }
    console.warn(`[SuggestionsService] LLM returned an unusable suggestion count: ${suggestions ? suggestions.length : 0}`);
  } catch (error) {
    console.error("[SuggestionsService] Error generating suggestions:", error);
  }

  // Graceful fallback suggestions
  const allIntents = ["compare_medicines", "explain_medicine", "find_alternatives", "schedule_medicine"];
  let otherIntents = allIntents.filter(i => i !== activeIntent);
  // After alternatives, Explain/Compare already live on the cards — drop them from global bubbles.
  if (activeIntent === "find_alternatives") {
    otherIntents = otherIntents.filter(i => i !== "explain_medicine" && i !== "compare_medicines");
  }
  const fallbackLabels = {
    compare_medicines: "Compare Medicine",
    explain_medicine: "Explain Medicine",
    find_alternatives: "Find Alternatives",
    schedule_medicine: "Schedule Medicine"
  };
  const fallbackTexts = {
    compare_medicines: `Compare ${medicinesList} with another medicine`,
    explain_medicine: `Can you explain the usage of ${medicinesList}?`,
    find_alternatives: `Find generic alternatives for ${medicinesList}`,
    schedule_medicine: `I want to set a reminder schedule for ${medicinesList}`
  };

  return otherIntents.slice(0, 3).map(intent => ({
    intent,
    label: fallbackLabels[intent],
    text: fallbackTexts[intent]
  }));
}

module.exports = { generateSuggestions };
