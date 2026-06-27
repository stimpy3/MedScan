// server/handlers/registry.js
// Add new intents here — no changes needed elsewhere.
const handlers = [
  require("./greetings.handler"),
  require("./unrelated.handler"),
  require("./explain_medicine.handler"),
  require("./find_alternatives.handler"),
  require("./compare_medicines.handler"),
  require("./schedule_medicine.handler")
];

module.exports = Object.fromEntries(handlers.map(h => [h.intent, h]));
