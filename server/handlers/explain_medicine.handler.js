// server/handlers/explain_medicine.handler.js
const { getMedicineExplanationCard, answerMedicineField } = require("../services/explainMedicine.service");

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

    // User asked about ONE aspect (side effects / price / …) → short chat answer, no card.
    if (ctx.subField) {
      const { reply } = await answerMedicineField(target.name, ctx.subField);
      return {
        reply,               // no cardData → renders as a plain chat bubble
        primaryMedicine: target,
        extraSuggestions: [{
          intent: "explain_medicine",
          label: "View full details",
          text: `Show full details of ${target.name}`,
          action: { type: "card_explain", medicine: { id: target.id, name: target.name } }
        }]
      };
    }

    const cardData = await getMedicineExplanationCard(target.name, ctx.safetyContext);
    return {
      reply: `Here is the explanation for ${cardData.name}.`,
      cardData,
      primaryMedicine: target   // returned so the orchestrator knows what to focus
    };
  }
};
