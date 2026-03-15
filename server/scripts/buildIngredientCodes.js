// server/scripts/buildIngredientNormalization.js
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");

const INPUT = path.join(__dirname, "../data/uniqueIngredientsOriginal.json");
const OUTPUT = path.join(__dirname, "../data/ingredientNormalization.json");
const PROGRESS_FILE = path.join(__dirname, "../data/ingredientNormalization.progress.json");

const ingredients = JSON.parse(fs.readFileSync(INPUT, "utf8"));

// Load existing progress if available
let normalizationMap = {};
let processedIngredients = new Set();

if (fs.existsSync(OUTPUT)) {
  console.log("📂 Loading existing output file...");
  normalizationMap = JSON.parse(fs.readFileSync(OUTPUT, "utf8"));
}

if (fs.existsSync(PROGRESS_FILE)) {
  console.log("📂 Loading progress file...");
  const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, "utf8"));
  processedIngredients = new Set(progress.processed || []);
  console.log(`✅ Found ${processedIngredients.size} already processed ingredients\n`);
}

// Save progress every N ingredients
function saveProgress(ingredient) {
  processedIngredients.add(ingredient);
  
  // Save the normalization map
  fs.writeFileSync(OUTPUT, JSON.stringify(normalizationMap, null, 2));
  
  // Save progress tracker
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    processed: Array.from(processedIngredients),
    lastUpdated: new Date().toISOString()
  }, null, 2));
}

// Get only the Precise Ingredient (PIN) variations - these are the chemical/salt variants
async function getIngredientVariations(baseIngredient) {
  const variations = new Set();
  const baseLower = baseIngredient.toLowerCase();
  variations.add(baseLower);

  try {
    // Step 1: Search for all ingredients matching this term
    const searchUrl = `https://rxnav.nlm.nih.gov/REST/approximateTerm.json?term=${encodeURIComponent(baseIngredient)}&maxEntries=100`;
    const searchRes = await fetch(searchUrl);
    const searchData = await searchRes.json();
    
    const candidates = searchData.approximateGroup?.candidate || [];

    for (const candidate of candidates) {
      try {
        const rxcui = candidate.rxcui;
        const name = candidate.name;

        if (!rxcui || !name) continue;

        // Get the term type for this RxCUI
        const propsUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${rxcui}/properties.json`;
        const propsRes = await fetch(propsUrl);
        const propsData = await propsRes.json();
        const termType = propsData.properties?.tty;

        // ONLY include PIN (Precise Ingredient)
        if (termType === 'PIN') {
          const nameLower = name.toLowerCase();
          
          // STRICTER CHECK: The PIN must START with the base ingredient name
          if (nameLower.startsWith(baseLower) || baseLower.startsWith(nameLower)) {
            if (!variations.has(nameLower)) {
              variations.add(nameLower);
              console.log(`   ✓ Found PIN: ${name}`);
            }
          }
        }

        // Small delay
        await new Promise(r => setTimeout(r, 50));
      } catch (candidateErr) {
        console.log(`   ⚠️  Skipped candidate: ${candidateErr.message}`);
        continue;
      }
    }

    // Step 2: Get related PINs
    try {
      const baseSearchUrl = `https://rxnav.nlm.nih.gov/REST/rxcui.json?name=${encodeURIComponent(baseIngredient)}`;
      const baseSearchRes = await fetch(baseSearchUrl);
      const baseSearchData = await baseSearchRes.json();
      const baseRxcui = baseSearchData.idGroup?.rxnormId?.[0];

      if (baseRxcui) {
        const relatedUrl = `https://rxnav.nlm.nih.gov/REST/rxcui/${baseRxcui}/related.json?tty=PIN`;
        const relatedRes = await fetch(relatedUrl);
        const relatedData = await relatedRes.json();

        const conceptGroups = relatedData.relatedGroup?.conceptGroup || [];
        for (const group of conceptGroups) {
          if (group.tty === 'PIN' && group.conceptProperties) {
            for (const concept of group.conceptProperties) {
              if (concept.name) {
                const nameLower = concept.name.toLowerCase();
                
                if (nameLower.startsWith(baseLower) || baseLower.startsWith(nameLower)) {
                  if (!variations.has(nameLower)) {
                    variations.add(nameLower);
                    console.log(`   ✓ Found related PIN: ${concept.name}`);
                  }
                }
              }
            }
          }
        }
      }
    } catch (relatedErr) {
      console.log(`   ⚠️  Could not fetch related PINs: ${relatedErr.message}`);
    }

  } catch (err) {
    console.error(`   ❌ Error in main search:`, err.message);
  }

  console.log(`   📋 Total PIN variations found: ${variations.size}`);
  return Array.from(variations);
}

(async () => {
  let count = 0;
  let skipped = 0;
  let totalVariations = Object.keys(normalizationMap).length;

  console.log(`Total ingredients: ${ingredients.length}`);
  console.log(`Already processed: ${processedIngredients.size}`);
  console.log(`Remaining: ${ingredients.length - processedIngredients.size}\n`);
  console.log(`Progress is saved after each ingredient - you can stop anytime with Ctrl+C\n`);

  for (const baseIngredient of ingredients) {
    count++;
    
    // Skip if already processed
    if (processedIngredients.has(baseIngredient)) {
      skipped++;
      continue;
    }

    console.log(`[${count}/${ingredients.length}] ${baseIngredient} (${skipped} skipped)`);

    try {
      // Get all PIN variations of this base ingredient
      const variations = await getIngredientVariations(baseIngredient);
      
      // Map each variation back to the base ingredient
      for (const variation of variations) {
        normalizationMap[variation] = baseIngredient;
      }

      console.log(`   📌 Mapped ${variations.length} variation(s) to "${baseIngredient}"`);
      totalVariations += variations.length;

      // Save progress after each ingredient
      saveProgress(baseIngredient);
      console.log(`   💾 Progress saved\n`);

    } catch (err) {
      console.error(`   ❌ Failed:`, err.message);
      // Fallback: just map the ingredient to itself
      normalizationMap[baseIngredient.toLowerCase()] = baseIngredient;
      totalVariations += 1;
      saveProgress(baseIngredient);
    }

    // Rate limiting
    await new Promise((r) => setTimeout(r, 500));
  }

  // Clean up progress file when done
  if (fs.existsSync(PROGRESS_FILE)) {
    fs.unlinkSync(PROGRESS_FILE);
    console.log("🗑️  Progress file deleted (processing complete)");
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("✅ ingredientNormalization.json created");
  console.log(`📊 Base ingredients processed: ${ingredients.length}`);
  console.log(`🗺️  Total PIN variation mappings: ${totalVariations}`);
  console.log(`📈 Average PIN variations per ingredient: ${(totalVariations / ingredients.length).toFixed(1)}`);
  console.log("=".repeat(60));
})();