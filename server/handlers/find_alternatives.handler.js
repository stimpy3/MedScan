// server/handlers/find_alternatives.handler.js
// Two sections: exactSubstitutes (same salts — same/different strength/combination) and
// therapeuticAlternatives (same ATC class, different salt — the fallback when no same-salt
// substitute exists). The legacy flat `alternatives` array stays populated with the exact
// section so old installed clients keep working. Every item carries a deterministic
// `whySuggested` one-liner — no LLM involved anywhere in this handler.
const {
  searchMedicineByName,
  getSimilarMedicines,
  findTherapeuticAlternatives,
  extractIngredients,
  unitPriceOf
} = require("../services/medicineSearch.service");
const { lazyEnrichFields } = require("../services/lazyEnrichment.service");

const DANGEROUS_PREFIXES = ["J01", "H02", "M01"];
const isDangerous = atcCodes => (atcCodes || []).some(d => DANGEROUS_PREFIXES.some(p => d.startsWith(p)));

const titleCase = s => String(s || "").split(/\s+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

const MATCH_TYPE_LABEL = {
  EXACT: "EXACT MATCH",
  SAME_SALT_DIFF_STRENGTH: "DIFFERENT STRENGTH",
  COMBINATION: "COMBINATION"
};

// Savings vs the original: per-unit when both pack labels parsed (fair across pack sizes),
// per-pack otherwise. Returns e.g. "-47% per tablet" / "-47%" / null.
function savingsLabel(origUnit, altUnit, altUnitName, origPrice, altPrice) {
  if (origUnit != null && altUnit != null) {
    if (altUnit >= origUnit) return null;
    return `-${Math.round(((origUnit - altUnit) / origUnit) * 100)}% per ${altUnitName || "unit"}`;
  }
  if (origPrice > 0 && altPrice > 0 && altPrice < origPrice) {
    return `-${Math.round(((origPrice - altPrice) / origPrice) * 100)}%`;
  }
  return null;
}

function whyForSameSalt(m, origUnit) {
  if (m.substitutionType === "SAME_SALT_DIFF_STRENGTH") {
    const diffs = (m.doseDiffs || [])
      .map(d => `${titleCase(d.ingredient)} ${d.candidate} instead of ${d.target}`)
      .join(", ");
    return `Same ingredient but ${diffs || "a different strength"} — confirm the dose with your doctor before switching.`;
  }
  if (m.substitutionType === "COMBINATION") {
    const extras = (m.extraIngredients || []).map(titleCase).join(", ");
    return `Contains your medicine's ingredient plus ${extras || "extra ingredients"} — not a like-for-like swap.`;
  }
  // EXACT — same salts, same strengths
  const priceBit = origUnit != null && m.unit_price != null
    ? ` — ₹${m.unit_price.toFixed(2)}/${m.unit} vs ₹${origUnit.toFixed(2)}`
    : "";
  return `Same ingredient & strength (${m.salt_composition || "same composition"})${priceBit}.`;
}

module.exports = {
  intent: "find_alternatives",
  prerequisites: { medicines: 1 },
  generatesSuggestions: true,

  missingPrompt: () => "Which medicine are you looking for an alternative to?",

  run: async (ctx) => {
    const target = ctx.focusedMedicine
      ? ctx.medicines.find(m => m.id === ctx.focusedMedicine.id) || ctx.medicines[0]
      : ctx.medicines[0];

    const targetMed = searchMedicineByName(target.name);
    let exactSubstitutes = [];
    let therapeuticAlternatives = [];
    let salt = "";
    let originalPrice = 0;
    let origUnitInfo = null;

    if (targetMed) {
      originalPrice = targetMed.price || 0;
      origUnitInfo = unitPriceOf(originalPrice, targetMed.pack_size);
      salt = String(targetMed.salt_composition || "").trim();

      // 97% of CSV rows have no salt — fetch it on demand from 1mg so those medicines still get
      // alternatives (cached; same latency pattern explain/compare already accept).
      if (!salt) {
        try {
          const web = await lazyEnrichFields(targetMed.name, targetMed);
          if (web?.found && web.fields.salt_composition) salt = String(web.fields.salt_composition).trim();
        } catch (err) {
          console.error("[FindAlternatives] Lazy salt enrichment failed:", err.message);
        }
      }
    }

    if (salt) {
      const origUnit = origUnitInfo ? origUnitInfo.unit_price : null;

      const rawAlts = await getSimilarMedicines(salt); // dose-aware: pass the salt WITH strengths
      exactSubstitutes = rawAlts
        .filter(m => m.name.toLowerCase() !== targetMed.name.toLowerCase())
        .slice(0, 3)
        .map(m => ({
          name: m.name,
          manufacturer: m.manufacturer || "Unknown Manufacturer",
          price: `₹${(m.price || 0).toFixed(2)}`,
          savings: savingsLabel(origUnit, m.unit_price, m.unit, originalPrice, m.price || 0),
          matchType: MATCH_TYPE_LABEL[m.substitutionType] || "THERAPEUTIC EQUIVALENT",
          salt_composition: m.salt_composition,
          pack_size: m.pack_size,
          whySuggested: whyForSameSalt(m, origUnit),
          isDangerousClass: isDangerous(m.atc_codes)
        }));

      const queryIngredients = extractIngredients(salt);
      therapeuticAlternatives = findTherapeuticAlternatives(queryIngredients, { limit: 3, targetName: targetMed.name })
        .filter(m => m.name.toLowerCase() !== targetMed.name.toLowerCase())
        .map(m => {
          const mainIngredient = titleCase((m.ingredients || [])[0] || "");
          return {
            name: m.name,
            manufacturer: m.manufacturer || "Unknown Manufacturer",
            price: `₹${(m.price || 0).toFixed(2)}`,
            savings: null, // a % against a different molecule is misleading
            matchType: "THERAPEUTIC ALTERNATIVE",
            salt_composition: m.salt_composition,
            pack_size: m.pack_size,
            className: m.className,
            consultDoctor: true,
            whySuggested: `Different ingredient${mainIngredient ? ` (${mainIngredient})` : ""} from the same class${m.className ? ` — ${m.className}` : ""}; used for the same kind of problem.`,
            isDangerousClass: isDangerous(m.atc_codes)
          };
        });
    }

    const resolvedName = targetMed ? targetMed.name : target.name;

    if (exactSubstitutes.length === 0 && therapeuticAlternatives.length === 0) {
      return {
        reply: `Sorry, I couldn't find any alternatives for ${resolvedName} in my database.`,
        primaryMedicine: target,
        lastAlternatives: [],
      };
    }

    const hasTrueExact = exactSubstitutes.some(a => a.matchType === "EXACT MATCH");
    const clinicalTip = hasTrueExact
      ? `Clinical Tip: Exact substitutes contain the same active ingredient (${salt || "same compounds"}) at the same strength and are biologically equivalent to your current medication.`
      : exactSubstitutes.length > 0
        ? "Clinical Tip: These options share your medicine's active ingredient but differ in strength or added ingredients — confirm the right dose with your doctor."
        : "Clinical Tip: No same-ingredient substitute was found. The options below work on the same kind of problem with a different ingredient — switch only after consulting your doctor.";

    const reply = exactSubstitutes.length > 0
      ? `Here are alternatives for ${resolvedName}.`
      : `No same-ingredient substitute found for ${resolvedName} — here are medicines from the same therapeutic class instead (consult your doctor before switching).`;

    const alternativesData = {
      targetMedicineName: resolvedName,
      description: "Exact substitutes share the same ingredients. Therapeutic alternatives work on the same problem with different ingredients.",
      alternatives: exactSubstitutes, // legacy clients read this flat array
      exactSubstitutes,
      therapeuticAlternatives,
      clinicalTip
    };

    const allItems = [...exactSubstitutes, ...therapeuticAlternatives];
    return {
      reply,
      alternativesData,
      primaryMedicine: target,
      lastAlternatives: allItems.map(a => ({ id: a.name, name: a.name })),
    };
  }
};
