// server/services/medicineSearch.js
const fs = require("fs");
const csv = require("csv-parser");
const levenshtein = require("fast-levenshtein");

let medicines = [];
let ingredientIndex = new Map(); // ingredient → Set of medicine indices
let loaded = false;

// Common ingredient descriptions
const INGREDIENT_DESCRIPTIONS = {
  "vitamin b12": "Supports nerve function and red blood cell formation",
};

const EXCLUDE_FORMS = [
  "accuhaler", "addshe-kit", "adsorbed", "androgel", "divicap", "dol-kit", "dologel", "douche", "dpicaps",
  "dr", "er", "evohaler", "inhalation", "inhaler", "injection", "innospray", "instacap", "instacaps", "ir",
  "kit", "kwikpen", "multihaler", "novocart", "octacap", "octacaps", "oestrogel", "oxipule", "pen", "penfill",
  "pulmicaps", "rapitab", "readymix", "redicaps", "redimed", "redimix", "respicap", "respicaps", "respule",
  "respules", "rheocap", "rotacap", "rotacaps", "solostar", "spray", "spray/drop", "spray/solution",
  "starhaler", "suppositories", "suppository", "suppressant", "syringe", "tears", "transcaps", "transgel",
  "transhaler", "transpules", "turbuhaler", "ultigel", "vaccine", "vomispray", "wash", "xr", "infusion", "shot",
  "ampoule", "iv", "im"
];

// Load the normalization map and ingredient codes
const ingredientNormalization = JSON.parse(
  fs.readFileSync("data/ingredientNormalization.json", "utf8")
);

const rawIngredientCodes = JSON.parse(
  fs.readFileSync("data/ingredientCodes.json", "utf8")
);

// Normalize an ingredient using the ingredientNormalization map
function normalizeIngredient(raw) {
  const cleaned = raw.toLowerCase().trim();

  // Use the normalization map (which already handles PIN mapping)
  const normalized = ingredientNormalization[cleaned] || cleaned;

  // ✅ FIX 1: Force lowercase for consistency
  return normalized.toLowerCase();
}

// Build ingredient codes lookup with normalized keys
const ingredientCodes = {};
for (const key in rawIngredientCodes) {
  const data = rawIngredientCodes[key];

  // For combinations, we don't normalize the key (keep as-is)
  // For single ingredients, use the baseIngredient as the key
  if (data.isCombination) {
    ingredientCodes[key.toLowerCase()] = data;
  } else {
    const normalizedKey = (data.baseIngredient || key).toLowerCase();
    ingredientCodes[normalizedKey] = data;
  }
}

function isExcludedForm(name) {
  const n = name.toLowerCase();
  return EXCLUDE_FORMS.some(f => n.includes(f));
}

// Extract and normalize ingredients from salt composition
function extractIngredients(saltComposition) {
  if (!saltComposition) return [];

  // Split by + or comma
  const parts = saltComposition.split(/[+,]/).map(s => s.trim()).filter(Boolean);

  const normalizedParts = [];

  for (const part of parts) {
    // ✅ FIX: Remove dosage information (anything in parentheses)
    const withoutDosage = part.replace(/\s*\([^)]*\)/g, '').trim();

    const normalized = normalizeIngredient(withoutDosage);

    // Check if this ingredient itself is a combination in our codes
    const data = ingredientCodes[normalized];

    if (data?.isCombination && data.components?.length > 0) {
      // It's a combination - expand it to individual components
      for (const component of data.components) {
        if (component.pin) {
          normalizedParts.push(component.pin.toLowerCase());
        } else if (component.cleaned) {
          normalizedParts.push(normalizeIngredient(component.cleaned));
        }
      }
    } else {
      // It's a single ingredient
      normalizedParts.push(normalized);
    }
  }

  // Remove duplicates
  return [...new Set(normalizedParts)];
}

// Get ATC domains for a list of ingredients
function getDomainsForIngredients(ingredients) {
  const domains = new Set();

  for (const ing of ingredients) {
    // ✅ FIX 2: ingredients are already normalized, don't normalize again
    const data = ingredientCodes[ing];

    // Check if it's a combination
    if (data?.isCombination && data.components?.length > 0) {
      // Get ATC codes from all components
      for (const component of data.components) {
        if (component.atc) {
          component.atc.forEach(code => domains.add(code));
        }
      }
    } else if (data?.atc) {
      // Single ingredient
      data.atc.forEach(code => domains.add(code));
    }
  }

  return [...domains];
}

// --------------------------
// Load CSV with logs
// --------------------------
async function loadMedicines() {
  return new Promise((resolve, reject) => {
    if (loaded) return resolve();

    const results = [];

    console.log("📥 Starting CSV load...");

    fs.createReadStream("data/medicines.csv")
      .pipe(csv())
      // Replace the .on("data") section with this heavily instrumented version:

      .on("data", (row) => {
        if (isExcludedForm(row.name)) return;

        const ingredients = extractIngredients(row.salt_composition);
        if (ingredients.length === 0) return;

        // 🔍 DEBUG: Log every medicine with ambroxol
        if (row.salt_composition && row.salt_composition.toLowerCase().includes('ambroxol')) {
          console.log(`\n🔍 FOUND AMBROXOL MEDICINE:`);
          console.log(`   Name: ${row.name}`);
          console.log(`   Raw salt_composition: "${row.salt_composition}"`);
          console.log(`   Extracted ingredients: [${ingredients.join(", ")}]`);
        }

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

        // ✅ FIX 3: ingredients are already normalized, use them directly
        ingredients.forEach(ing => {
          // 🔍 DEBUG: Log when adding ambroxol to index
          if (ing.includes('ambroxol')) {
            console.log(`   📍 Adding "${ing}" to index for medicine #${medIndex} (${row.name})`);
          }

          if (!ingredientIndex.has(ing)) {
            ingredientIndex.set(ing, new Set());
          }
          ingredientIndex.get(ing).add(medIndex);
        });
      })
      .on("end", () => {
        medicines = results;
        loaded = true;
        console.log(`\n✅ Loaded ${medicines.length} medicines`);
        console.log(`📊 Ingredient index has ${ingredientIndex.size} unique ingredients`);

        // 🔍 DEBUG: Show ALL keys in index that contain 'ambroxol'
        console.log("\n🔍 ALL INDEX KEYS CONTAINING 'ambroxol':");
        let foundAny = false;
        for (const [key, value] of ingredientIndex.entries()) {
          if (key.includes('ambroxol')) {
            console.log(`   "${key}" -> ${value.size} medicines`);
            foundAny = true;
          }
        }
        if (!foundAny) {
          console.log("   ❌ NO KEYS FOUND WITH 'ambroxol'");
        }

        // 🔍 DEBUG: Show first 10 keys in the index to see the format
        console.log("\n🔍 First 10 keys in index (to see format):");
        let count = 0;
        for (const [key, value] of ingredientIndex.entries()) {
          console.log(`   "${key}" -> ${value.size} medicines`);
          if (++count >= 10) break;
        }

        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Error loading CSV:", err);
        reject(err);
      });
  });
}

function findSimilar(queryIngredients) {
  if (!loaded) return [];

  const normalizedQuery = queryIngredients.map(normalizeIngredient);
  console.log("\n🔎 Query ingredients normalized:", normalizedQuery);

  // 🔍 DEBUG: Show what we're actually looking for in the index
  console.log("🔍 Looking in index for these exact keys:");
  normalizedQuery.forEach(ing => {
    console.log(`   "${ing}" - exists in index: ${ingredientIndex.has(ing)}`);
  });

  const baseDomains = getDomainsForIngredients(normalizedQuery);
  console.log("🔹 Query domains:", baseDomains);

  // Rest of function stays the same...

  // Find medicines that contain ALL query ingredients (intersection)
  let candidateIndices = null;

  for (const ing of normalizedQuery) {
    const medicinesWithThisIngredient = ingredientIndex.get(ing) || new Set();
    console.log(`   Ingredient "${ing}" found in ${medicinesWithThisIngredient.size} medicines`);

    if (candidateIndices === null) {
      // First ingredient - start with all medicines that have it
      candidateIndices = new Set(medicinesWithThisIngredient);
    } else {
      // Subsequent ingredients - keep only medicines that ALSO have this ingredient (intersection)
      candidateIndices = new Set(
        [...candidateIndices].filter(idx => medicinesWithThisIngredient.has(idx))
      );
    }
  }

  if (!candidateIndices || candidateIndices.size === 0) {
    console.log("⚠️  No medicines found containing ALL query ingredients");
    return [];
  }

  console.log(`✅ Found ${candidateIndices.size} medicines with ALL ${normalizedQuery.length} query ingredients`);

  const results = [];

  for (const idx of candidateIndices) {
    const med = medicines[idx];

    // At this point, we KNOW the medicine has all query ingredients
    const queryIngredientsInMed = normalizedQuery.filter(i =>
      med.ingredients.includes(i)
    ).length;

    const medIngredientsInQuery = med.ingredients.filter(i =>
      normalizedQuery.includes(i)
    ).length;

    // This will always be 1.0 now, since all query ingredients are in the medicine
    const ingredientOverlap = 1.0;

    let substitutionType = "UNSAFE";

    if (
      med.ingredients.length === normalizedQuery.length &&
      queryIngredientsInMed === normalizedQuery.length &&
      medIngredientsInQuery === med.ingredients.length
    ) {
      // Exact match - same ingredients, same count
      substitutionType = "EXACT";
    } else if (
      queryIngredientsInMed === normalizedQuery.length &&
      med.ingredients.length > normalizedQuery.length
    ) {
      // Medicine has extra ingredients beyond the query
      substitutionType = "COMBINATION";
    } else if (
      baseDomains.length > 0 &&
      med.domains.some(d => baseDomains.includes(d))
    ) {
      substitutionType = "THERAPEUTIC";
    } else if (ingredientOverlap > 0) {
      substitutionType = "PARTIAL";
    }

    const extraIngredients = med.ingredients.filter(
      ing => !normalizedQuery.includes(ing)
    );

    // Scoring: Now we penalize ONLY for extra ingredients
    const ingredientScore = 1.0; // Always 1.0 since all query ingredients are present

    const extraIngredientPenalty =
      extraIngredients.length === 0
        ? 1.0  // Perfect - no extra ingredients
        : Math.max(
          0.5,  // Minimum score of 0.5 even with extra ingredients
          1 - (extraIngredients.length * 0.1)  // Penalize 10% per extra ingredient
        );

    const sharedDomains = med.domains.filter(d =>
      baseDomains.includes(d)
    );

    const domainScore =
      baseDomains.length === 0
        ? 0.5
        : sharedDomains.length / baseDomains.length;

    let confidence =
      ingredientScore * 0.4 +        // Has all ingredients
      domainScore * 0.35 +           // Therapeutic domain match
      extraIngredientPenalty * 0.25; // Penalty for extra ingredients

    // Reduce confidence for dangerous drug classes
    const dangerousPrefixes = ["J01", "H02", "M01"];
    if (
      med.domains.some(d =>
        dangerousPrefixes.some(p => d.startsWith(p))
      )
    ) {
      confidence = Math.min(confidence, 0.3);
    }

    confidence = confidence.toFixed(2);

    const extraEffects = {};
    extraIngredients.forEach(ing => {
      if (INGREDIENT_DESCRIPTIONS[ing]) {
        extraEffects[ing] = INGREDIENT_DESCRIPTIONS[ing];
      } else {
        const data = ingredientCodes[ing];
        extraEffects[ing] = data?.atc?.length
          ? `Therapeutic class: ${data.atc.join(", ")}`
          : "Additional active ingredient";
      }
    });

    results.push({
      name: med.name,
      price: med.price,

      comp1: med.comp1,
      comp2: med.comp2,
      salt_composition: med.salt_composition,

      substitutionType,
      confidence,

      ingredientCount: med.ingredients.length,
      domain: med.domains.join(",") || "UNKNOWN",

      extraIngredients,
      extraEffects,
      atc_codes: med.domains,

      manufacturer: med.manufacturer,
      pack_size: med.pack_size,

      medicine_desc: med.medicine_desc,
      side_effects: med.side_effects,
      drug_interactions: med.drug_interactions
    });
  }

  console.log(`✅ Returning ${results.length} results`);

  // Sort by: exact matches first, then by confidence, then by price
  return results.sort((a, b) => {
    // Exact matches first
    if (a.substitutionType === 'EXACT' && b.substitutionType !== 'EXACT') return -1;
    if (b.substitutionType === 'EXACT' && a.substitutionType !== 'EXACT') return 1;

    // Then by confidence
    const confDiff = parseFloat(b.confidence) - parseFloat(a.confidence);
    if (confDiff !== 0) return confDiff;

    // Finally by price
    return a.price - b.price;
  });
}

// --------------------------
// Exported function for route
// --------------------------
async function getSimilarMedicines(queryText) {
  console.log("📝 Query received:", queryText);
  await loadMedicines();
  const queryIngredients = queryText.split(/[,+]/).map(s => s.trim()).filter(Boolean);
  console.log("🔹 Split query ingredients:", queryIngredients);
  return findSimilar(queryIngredients);
}

function searchMedicineByName(medicineName) {
  if (!loaded || !medicineName) return null;
  const lowerQuery = medicineName.toLowerCase().trim();
  const found = medicines.find(m => m.name.toLowerCase().includes(lowerQuery));
  if (found) return found;

  const byIngredient = medicines.find(m => m.ingredients.some(ing => ing.includes(lowerQuery)));
  return byIngredient || null;
}

module.exports = { getSimilarMedicines, loadMedicines, normalizeIngredient, extractIngredients, searchMedicineByName };