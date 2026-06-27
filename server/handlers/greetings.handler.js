// server/handlers/greetings.handler.js

module.exports = {
  intent: "greetings",
  prerequisites: { medicines: 0 },
  generatesSuggestions: false,
  missingPrompt: () => null,
  run: async () => ({
    reply: "What would you like help with? I can explain a medicine, find alternatives, compare two medicines, or set up a schedule."
  })
};
