const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch"); // npm i node-fetch@2

const INPUT = path.join(__dirname, "../data/uniqueIngredients.json");
const OUTPUT = path.join(__dirname, "../data/ingredientCodes.json");

const ingredients = JSON.parse(fs.readFileSync(INPUT, "utf8"));

// Get RxCUI for an ingredient
async function getRxCui(ingredient) {
  const url = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(
    ingredient
  )}`;
  const res = await fetch(url);
  const data = await res.json();
  return data.idGroup?.rxnormId?.[0] || null;
}

// Get ATC codes via RXClass endpoint
async function getAtcCodes(rxcui) {
  if (!rxcui) return [];

  const url = `https://rxnav.nlm.nih.gov/REST/rxclass/class/byRxcui.json?rxcui=${rxcui}&relaSource=ATC`;
  const res = await fetch(url);
  const data = await res.json();

  const infos = data.rxclassDrugInfoList?.rxclassDrugInfo || [];

  const atcCodes = infos.map(
    (i) => i.rxclassMinConceptItem?.classId
  ).filter(Boolean);

  // Deduplicate
  return [...new Set(atcCodes)];
}

(async () => {
  const result = {};
  let count = 0;

  for (const ingredient of ingredients) {
    count++;
    console.log(`[${count}/${ingredients.length}] ${ingredient}`);

    try {
      const rxcui = await getRxCui(ingredient);
      const atc = await getAtcCodes(rxcui);

      result[ingredient] = { rxcui, atc };
      console.log(`   → RxCUI: ${rxcui}, ATC: [${atc.join(", ")}]`);
    } catch (err) {
      console.error("Failed:", ingredient, err.message);
      result[ingredient] = { rxcui: null, atc: [] };
    }

    // Rate-limit to avoid hammering the API
    await new Promise((r) => setTimeout(r, 120));
  }

  fs.writeFileSync(OUTPUT, JSON.stringify(result, null, 2));
  console.log("✅ ingredientCodes.json created with ATC codes");
})();