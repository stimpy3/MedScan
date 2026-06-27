// server/handlers/explain_medicine.handler.js
const { getMedicineExplanationCard } = require("../services/explainMedicine.service");

module.exports = {
  intent: "explain_medicine",
  prerequisites: { medicines: 1 },
  generatesSuggestions: true,

  missingPrompt: () => "Which medicine would you like me to explain?",

  run: async (ctx) => {
    // Prefer the focused medicine if it's already in the list; otherwise take the first.
    const target = ctx.focusedMedicine
      ? ctx.medicines.find(m => m.id === ctx.focusedMedicine.id) || ctx.medicines[0]
      : ctx.medicines[0];

    const cardData = await getMedicineExplanationCard(target.name);
    return {
      reply: `Here is the explanation for ${cardData.name}.`,
      cardData,
      primaryMedicine: target   // returned so the orchestrator knows what to focus
    };
  }
};
