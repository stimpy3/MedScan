// server/handlers/unrelated.handler.js

module.exports = {
  intent: "unrelated",
  prerequisites: { medicines: 0 },
  generatesSuggestions: false,
  missingPrompt: () => null,
  run: async () => ({
    reply: "I can help you with medicines — explaining what a medicine does, finding cheaper alternatives, comparing two medicines, or scheduling when to take one. What would you like to do?"
  })
};
