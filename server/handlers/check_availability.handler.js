const { checkAvailability } = require("../services/availability.service");

module.exports = {
  intent: "check_availability",
  prerequisites: { medicines: 1, pincode: true },
  generatesSuggestions: false,

  missingPrompt: () => "Which medicine would you like to check availability for?",
  pincodePrompt: (ctx) => {
    const name = ctx.medicines[0]?.name || "that medicine";
    return `What's your pincode? I'll check if **${name}** is available for delivery near you.`;
  },

  run: async (ctx) => {
    const target = ctx.focusedMedicine
      ? ctx.medicines.find(m => m.id === ctx.focusedMedicine.id) || ctx.medicines[0]
      : ctx.medicines[0];

    const result = await checkAvailability(target.name, ctx.pincode);

    if (!result) {
      return {
        reply: `I couldn't find **${target.name}** on 1mg. Try searching by the exact brand name.`,
        primaryMedicine: target,
        availabilityData: null
      };
    }

    let reply;
    if (result.available === true) {
      reply = `**${target.name}** is available on 1mg for delivery to pincode ${ctx.pincode}.`;
    } else if (result.available === false) {
      reply = `**${target.name}** is currently not available on 1mg for delivery to pincode ${ctx.pincode}.`;
    } else {
      // availability unknown — we still have the link
      reply = `Here's what I found for **${target.name}** on 1mg. Tap the link to check current stock for pincode ${ctx.pincode}.`;
    }

    return {
      reply,
      primaryMedicine: target,
      availabilityData: {
        medicineName: target.name,
        pincode: ctx.pincode,
        ...result
      }
    };
  }
};
