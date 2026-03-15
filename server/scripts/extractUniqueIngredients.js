// server/scripts/extractUniqueIngredients.js

const fs = require("fs");
const path = require("path");
const csv = require("csv-parser");

const uniqueIngredients = new Set();
const originalForms = new Set(); // NEW: Keep original forms too

const SALT_SUFFIXES = [
  // "mononitrate","hydrochloride","hcl","sulfate","sulphate","phosphate",
  // "citrate","gluconate","acetate","maleate","fumarate","succinate","tartrate",
  // "lactate","pantothenate","chloride","bromide","iodide","nitrate","oxide",
  // "carbonate","bicarbonate","stearate","palmitate","triturate","ip","usp","bp",
  // "furoate","propionate"
];

function normalizeIngredient(raw) {
  let ing = raw.toLowerCase();
  ing = ing.replace(/\(.*?\)/g, ""); // remove (30mg) etc

  SALT_SUFFIXES.forEach(suf => {
    ing = ing.replace(new RegExp(`\\b${suf}\\b`, "g"), "");
  });

  return ing.replace(/\s+/g, " ").trim();
}

function cleanOriginal(raw) {
  let ing = raw.trim();
  ing = ing.replace(/\s*\(.*?\)\s*/g, ""); // remove (30mg) etc
  ing = ing.replace(/\s+/g, " ").trim();
  return ing;
}

// FIX: Use correct path relative to script location
const CSV_PATH = path.join(__dirname, "../data/medicines.csv");
const OUTPUT_DIR = path.join(__dirname, "../data");

fs.createReadStream(CSV_PATH)
  .pipe(csv())
  .on("data", (row) => {
    if (isExcludedForm(row.name)) return;
  
    const ingredients = extractIngredients(row.salt_composition);
    if (ingredients.length === 0) return;
  
    console.log(`🔹 Processing medicine: ${row.name}`);
    console.log(`   Raw ingredients: ${row.salt_composition}`);
    console.log(`   Normalized: ${ingredients.join(", ")}`);
  
    const medIndex = results.length;
  
    const domains = getDomainsForIngredients(ingredients);
  
    results.push({
      name: row.name,
      price: Number(row.price) || 0,
      comp1: row.short_composition1 || "",
      comp2: row.short_composition2 || "",
      salt_composition: row.salt_composition || "",
      ingredients,
      domains,
  
      manufacturer: row.manufacturer_name || "",
      pack_size: row.pack_size_label || "",
  
      medicine_desc: row.medicine_desc || "",
      side_effects: row.side_effects || "",
      drug_interactions: row.drug_interactions || ""
    });
  
    // ✅ FIX: ingredients are already normalized, don't normalize again
    ingredients.forEach(ing => {
      if (!ingredientIndex.has(ing)) {
        ingredientIndex.set(ing, new Set());
      }
      ingredientIndex.get(ing).add(medIndex);
    });
   })
  .on("end", () => {
    console.log("Normalized ingredient count:", uniqueIngredients.size);
    console.log("Original form count:", originalForms.size);

    // Save normalized (legacy)
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "uniqueIngredients.json"),
      JSON.stringify([...uniqueIngredients].sort(), null, 2)
    );

    // Save originals (for RxNorm API calls)
    fs.writeFileSync(
      path.join(OUTPUT_DIR, "uniqueIngredientsOriginal.json"),
      JSON.stringify([...originalForms].sort(), null, 2)
    );

    console.log("✅ Saved uniqueIngredients.json (normalized)");
    console.log("✅ Saved uniqueIngredientsOriginal.json (with salts)");
  });