const fs = require("fs");
const csv = require("csv-parser");
const levenshtein = require("fast-levenshtein");

let medicines = [];
let ingredientIndex = new Map(); // ingredient → Set of medicine indices
let loaded = false;


const SALT_SUFFIXES = ["mononitrate","hydrochloride","hcl","sulfate","sulphate","phosphate","citrate","gluconate","acetate","maleate","fumarate","succinate","tartrate","lactate","pantothenate","chloride","bromide","iodide","nitrate","oxide","carbonate","bicarbonate","stearate","palmitate","triturate","ip","usp","bp"];

// Common ingredient descriptions
const INGREDIENT_DESCRIPTIONS = {
  "paracetamol": "Pain reliever and fever reducer",
  "ibuprofen": "Anti-inflammatory and pain reliever",
  "ambroxol": "Mucolytic agent, helps loosen mucus",
  "cetirizine": "Antihistamine for allergies",
  "chlorpheniramine": "Antihistamine for cold and allergy symptoms",
  "phenylephrine": "Decongestant for nasal congestion",
  "dextromethorphan": "Cough suppressant",
  "guaifenesin": "Expectorant, helps clear mucus",
  "diphenhydramine": "Antihistamine and sleep aid",
  "loratadine": "Non-drowsy antihistamine",
  "pseudoephedrine": "Decongestant",
  "codeine": "Opioid pain reliever and cough suppressant",
  "aspirin": "Pain reliever and blood thinner",
  "caffeine": "Stimulant, enhances pain relief",
  "omeprazole": "Reduces stomach acid production",
  "ranitidine": "Reduces stomach acid",
  "loperamide": "Anti-diarrheal medication",
  "domperidone": "Anti-nausea, promotes gastric motility",
  "metoclopramide": "Anti-nausea and gastric motility enhancer",
  "salbutamol": "Bronchodilator for asthma",
  "montelukast": "Anti-inflammatory for asthma",
  "azithromycin": "Antibiotic",
  "amoxicillin": "Antibiotic",
  "ciprofloxacin": "Antibiotic",
  "metformin": "Diabetes medication",
  "atorvastatin": "Cholesterol-lowering medication",
  "amlodipine": "Blood pressure medication",
  "losartan": "Blood pressure medication",
  "levothyroxine": "Thyroid hormone replacement",
  "vitamin d": "Supports bone health and immunity",
  "vitamin c": "Antioxidant, supports immune system",
  "zinc": "Supports immune function and healing",
  "calcium": "Supports bone health",
  "iron": "Treats iron deficiency anemia",
  "folic acid": "Prevents neural tube defects, supports cell growth",
  "vitamin b12": "Supports nerve function and red blood cell formation",
};

const EXCLUDE_FORMS = [
  "accuhaler","addshe-kit","adsorbed","androgel","divicap","dol-kit","dologel","douche","dpicaps",
  "dr","er","evohaler","inhalation","inhaler","injection","innospray","instacap","instacaps","ir",
  "kit","kwikpen","multihaler","novocart","octacap","octacaps","oestrogel","oxipule","pen","penfill",
  "pulmicaps","rapitab","readymix","redicaps","redimed","redimix","respicap","respicaps","respule",
  "respules","rheocap","rotacap","rotacaps","solostar","spray","spray/drop","spray/solution",
  "starhaler","suppositories","suppository","suppressant","syringe","tears","transcaps","transgel",
  "transhaler","transpules","turbuhaler","ultigel","vaccine","vomispray","wash","xr","infusion","shot",
  "ampoule","iv","im"
];

// Load ingredientCodes.json with normalized keys
const rawIngredientCodes = JSON.parse(
  fs.readFileSync("data/ingredientCodes.json", "utf8")
);

const ingredientCodes = {};
for (const key in rawIngredientCodes) {
  const normalizedKey = normalizeIngredient(key); // lowercase + remove salts
  ingredientCodes[normalizedKey] = rawIngredientCodes[key];
}


function isExcludedForm(name) {
  const n = name.toLowerCase();
  return EXCLUDE_FORMS.some(f => n.includes(f));
}

function normalizeIngredient(raw) {
  let ing = raw.toLowerCase().trim();
  ing = ing.replace(/\s*\(.*?\)\s*/g, " ");
  SALT_SUFFIXES.forEach(suf => {
    ing = ing.replace(new RegExp(`\\b${suf}\\b`, "g"), "");
  });
  return ing.replace(/\s+/g, " ").trim();
}

function extractIngredients(saltComposition) {
  if (!saltComposition) return [];
  return saltComposition.split("+").map(s => normalizeIngredient(s)).filter(Boolean);
}

function getDomainsForIngredients(ingredients) {
  const domains = new Set();
  for (const ing of ingredients) {
    const key = normalizeIngredient(ing);
    const data = ingredientCodes[key];
    if (data?.atc) {
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
      .on("data", (row) => {
        if (isExcludedForm(row.name)) return;

        const ingredients = extractIngredients(row.salt_composition);
        if (ingredients.length === 0) return;

        console.log(`🔹 Processing medicine: ${row.name}`);
        console.log(`   Raw ingredients: ${row.salt_composition}`);
        console.log(`   Normalized: ${ingredients.join(", ")}`);

        const medIndex = results.length;

        const domains = new Set();
        for (const ing of ingredients) {
          const key = normalizeIngredient(ing);
          const data = ingredientCodes[key];
          if (!data) console.log(`⚠️  Ingredient missing in JSON: "${key}"`);
          if (data?.atc) {
            data.atc.forEach(code => domains.add(code));
          }
        }

        results.push({
          name: row.name,
          price: Number(row.price) || 0,
          comp1: row.short_composition1 || "",
          comp2: row.short_composition2 || "",
          ingredients,
          domains: [...domains]
        });

        ingredients.forEach(ing => {
          const key = normalizeIngredient(ing);
          if (!ingredientIndex.has(key)) ingredientIndex.set(key, new Set());
          ingredientIndex.get(key).add(medIndex);
        });
      })
      .on("end", () => {
        medicines = results;
        loaded = true;
        console.log(`✅ Loaded ${medicines.length} medicines`);
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Error loading CSV:", err);
        reject(err);
      });
  });
}

// --------------------------
// Candidate retrieval + filtering with logs
// --------------------------
function findSimilar(queryIngredients) {
  if (!loaded) return [];

  const normalizedQuery = queryIngredients.map(normalizeIngredient);
  console.log("🔎 Query ingredients normalized:", normalizedQuery);

  const baseDomains = getDomainsForIngredients(normalizedQuery);
  console.log("🔹 Query domains:", baseDomains);

  const candidateIndices = new Set();
  normalizedQuery.forEach(ing => {
    const candidates = ingredientIndex.get(ing) || new Set();
    console.log(`   Candidates for "${ing}":`, candidates.size || 0);
    candidates.forEach(i => candidateIndices.add(i));
  });

  console.log(`🔹 Total unique candidates: ${candidateIndices.size}`);

  if (candidateIndices.size === 0) {
    console.log("⚠️ No candidate medicines found matching the ingredients.");
    return [];
  }

  const results = [];

  for (const idx of candidateIndices) {
    const med = medicines[idx];
    
    // Check how many query ingredients are in the medicine
    const queryIngredientsInMed = normalizedQuery.filter(i => med.ingredients.includes(i)).length;
    
    // Check how many medicine ingredients are in the query
    const medIngredientsInQuery = med.ingredients.filter(i => normalizedQuery.includes(i)).length;
    
    const ingredientOverlap = queryIngredientsInMed / normalizedQuery.length;

    let substitutionType = "UNSAFE";

    // EXACT: All ingredients match exactly (same count, all present in both)
    if (
      med.ingredients.length === normalizedQuery.length &&
      queryIngredientsInMed === normalizedQuery.length &&
      medIngredientsInQuery === med.ingredients.length
    ) {
      substitutionType = "EXACT";
    } 
    // THERAPEUTIC: Shares therapeutic domain
    else if (
      baseDomains.length > 0 && med.domains.some(d => baseDomains.includes(d))
    ) {
      substitutionType = "THERAPEUTIC";
    } 
    // PARTIAL: Has some ingredient overlap
    else if (ingredientOverlap > 0) {
      substitutionType = "PARTIAL";
    }

   
    // --------------------------
    // Confidence calculation (FIXED)
    // --------------------------
    
    // Calculate extra ingredients FIRST (ingredients in medicine but not in query)
    const extraIngredients = med.ingredients.filter(ing => !normalizedQuery.includes(ing));
    
    // Ingredient coverage
    const ingredientScore = queryIngredientsInMed / normalizedQuery.length;
    
    // Extra ingredient penalty
    const extraIngredientPenalty =
      extraIngredients.length === 0
        ? 1
        : Math.max(0, 1 - extraIngredients.length / med.ingredients.length);
    
    // Domain alignment
    const sharedDomains = med.domains.filter(d => baseDomains.includes(d));
    const domainScore =
      baseDomains.length === 0
        ? 0.5
        : sharedDomains.length / baseDomains.length;
    
    // Base confidence
    let confidence =
      ingredientScore * 0.5 +
      domainScore * 0.35 +
      extraIngredientPenalty * 0.15;
    
    // EXACT must have NO extra ingredients
    if (substitutionType === "EXACT" && extraIngredients.length > 0) {
      substitutionType = "THERAPEUTIC";
      confidence = Math.min(confidence, 0.85);
    }
    
    // Hard penalty for dangerous therapeutic drift
    const dangerousPrefixes = ["J01", "H02", "M01"]; // antibiotics, steroids, NSAIDs
    if (med.domains.some(d => dangerousPrefixes.some(p => d.startsWith(p)))) {
      confidence = Math.min(confidence, 0.3);
    }
    
    confidence = confidence.toFixed(2);
    
    // Get descriptions for extra ingredients
    const extraEffects = {};
    extraIngredients.forEach(ing => {
      const normalized = normalizeIngredient(ing);
      
      // First try to find description in our mapping
      if (INGREDIENT_DESCRIPTIONS[normalized]) {
        extraEffects[ing] = INGREDIENT_DESCRIPTIONS[normalized];
      } else {
        // Fallback: try to get from ATC codes
        const key = normalizeIngredient(ing);
        const data = ingredientCodes[key];
        if (data?.atc && data.atc.length > 0) {
          extraEffects[ing] = `Therapeutic class: ${data.atc.join(", ")}`;
        } else {
          extraEffects[ing] = "Additional active ingredient";
        }
      }
    });

    results.push({
      name: med.name,
      price: med.price,
      comp1: med.comp1,
      comp2: med.comp2,
      substitutionType,
      confidence,
      ingredientCount: med.ingredients.length,
      domain: med.domains.join(",") || "UNKNOWN",
      extraIngredients: extraIngredients,
      extraEffects: extraEffects,
      atc_codes: med.domains
    });
  }

  console.log(`✅ Found ${results.length} candidates`);
  return results.sort(
    (a, b) => parseFloat(b.confidence) - parseFloat(a.confidence) || a.price - b.price
  );
}

// --------------------------
// Exported function for route
// --------------------------
async function getSimilarMedicines(queryText) {
  console.log("📝 Query received:", queryText);
  await loadMedicines();
  const queryIngredients = queryText.split(/[,+]/).map(s => s.trim()).filter(Boolean);
  return findSimilar(queryIngredients);
}

module.exports = { getSimilarMedicines, loadMedicines, normalizeIngredient, extractIngredients };