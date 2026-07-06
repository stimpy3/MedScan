// server/handlers/compare_medicines.handler.js
const { getComparison } = require("../services/compareMedicines.service");

module.exports = {
  intent: "compare_medicines",
  prerequisites: { medicines: 2 },
  generatesSuggestions: true,

  missingPrompt: (ctx) => {
    if (ctx.medicines.length === 1) {
      return `Which other medicine would you like to compare with ${ctx.medicines[0].name}?`;
    }
    // If a focusedMedicine is set from a previous intent, anchor the prompt to it.
    if (ctx.focusedMedicine) {
      return `Which medicine would you like to compare with ${ctx.focusedMedicine.name}?`;
    }
    return "Which two medicines would you like to compare?";
  },

  run: async (ctx) => {
    // Build the pair: prefer [focusedMedicine, other] so the context anchor stays on the left.
    let pair;
    if (
      ctx.focusedMedicine &&
      ctx.medicines.some(m => m.id === ctx.focusedMedicine.id) &&
      ctx.medicines.length >= 2
    ) {
      const focused = ctx.medicines.find(m => m.id === ctx.focusedMedicine.id);
      const other = ctx.medicines.find(m => m.id !== ctx.focusedMedicine.id);
      pair = [focused, other];
    } else {
      pair = ctx.medicines.slice(0, 2);
    }

    const [medA, medB] = pair;
    // Guard: never compare a medicine against itself or a missing second medicine.
    if (!medA || !medB || medA.id === medB.id || medA.name === medB.name) {
      return {
        reply: `I need two different medicines to compare. Which medicine would you like to compare ${medA?.name || "it"} with?`
      };
    }
    const comparisonData = await getComparison(medA.name, medB.name, ctx.safetyContext || null);

    return {
      reply: `Here is the comparison for ${medA.name} and ${medB.name}.`,
      comparisonData,
      primaryMedicine: medA   // the "anchor" medicine for the next focused transition
    };
  }
};
