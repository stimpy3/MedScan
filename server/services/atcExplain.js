// services/atcExplain.js
const ATC_MAP = require("../data/atcMap.json");

function explainATC(atcCode) {
  const explanations = [];

  // ATC meaningful prefix lengths
  const levels = [1, 3, 4];

  for (const len of levels) {
    const prefix = atcCode.slice(0, len);
    if (ATC_MAP[prefix]) {
      explanations.push(ATC_MAP[prefix]);
    }
  }

  return explanations;
}

module.exports = { explainATC };