// server/handlers/schedule_medicine.handler.js

module.exports = {
  intent: "schedule_medicine",
  prerequisites: { medicines: 1 },
  generatesSuggestions: true,

  missingPrompt: () => "Which medicine would you like to schedule?",

  run: async (ctx) => {
    // Prefer the focused medicine if it's in the list; otherwise take the first.
    const target = ctx.focusedMedicine
      ? ctx.medicines.find(m => m.id === ctx.focusedMedicine.id) || ctx.medicines[0]
      : ctx.medicines[0];
    return {
      reply: `Set up your schedule for ${target.name}`,
      scheduleFormData: {
        medicineName: target.name
      },
      primaryMedicine: target
    };
  }
};
