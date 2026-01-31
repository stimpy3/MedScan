const fs = require("fs");
const csv = require("csv-parser");

const uniqueIngredients = new Set();

const SALT_SUFFIXES = [
  "hydrochloride","hcl","sulfate","sulphate","phosphate",
  "citrate","acetate","maleate","fumarate","ip","bp","usp"
];

function normalizeIngredient(raw) {
  let ing = raw.toLowerCase();
  ing = ing.replace(/\(.*?\)/g, ""); // remove (30mg) etc

  SALT_SUFFIXES.forEach(suf => {
    ing = ing.replace(new RegExp(`\\b${suf}\\b`, "g"), "");
  });

  return ing.replace(/\s+/g, " ").trim();
}

fs.createReadStream("data/medicines.csv")
  .pipe(csv())
  .on("data", row => {
    if (!row.salt_composition) return;

    const parts = row.salt_composition.split("+");

    for (const part of parts) {
      const normalized = normalizeIngredient(part);
      if (normalized) uniqueIngredients.add(normalized);
    }
  })
  .on("end", () => {
    console.log("Unique ingredient count:", uniqueIngredients.size);

    fs.writeFileSync(
      "uniqueIngredients.json",
      JSON.stringify([...uniqueIngredients], null, 2)
    );

    console.log("Saved uniqueIngredients.json");
  });