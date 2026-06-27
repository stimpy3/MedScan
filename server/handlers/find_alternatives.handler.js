// server/handlers/find_alternatives.handler.js
const { searchMedicineByName, getSimilarMedicines } = require("../services/medicineSearch.service");

const DANGEROUS_PREFIXES = ["J01", "H02", "M01"];
const isDangerous = atcCodes => (atcCodes || []).some(d => DANGEROUS_PREFIXES.some(p => d.startsWith(p)));

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
    let alternatives = [];
    let originalPrice = 0;
    let salt = "";

    if (targetMed) {
      originalPrice = targetMed.price || 0;
      salt = targetMed.salt_composition || "";
      const saltWithoutDosage = salt.replace(/\s*\([^)]*\)/g, "");
      const rawAlts = await getSimilarMedicines(saltWithoutDosage);

      alternatives = rawAlts
        .filter(m => m.name.toLowerCase() !== targetMed.name.toLowerCase())
        .map(m => {
          const altPrice = m.price || 0;
          const savingsPct =
            originalPrice > 0 && altPrice < originalPrice
              ? Math.round(((originalPrice - altPrice) / originalPrice) * 100)
              : 0;
          return {
            name: m.name,
            manufacturer: m.manufacturer || "Unknown Manufacturer",
            price: `₹${altPrice.toFixed(2)}`,
            savings: savingsPct > 0 ? `-${savingsPct}%` : null,
            matchType: m.substitutionType === "EXACT" ? "EXACT MATCH" : "THERAPEUTIC EQUIVALENT",
            salt_composition: m.salt_composition,
            isDangerousClass: isDangerous(m.atc_codes)
          };
        })
        .slice(0, 3);
    }

    const resolvedName = targetMed ? targetMed.name : target.name;

    if (alternatives.length === 0) {
      return {
        reply: `Sorry, I couldn't find any alternatives for ${resolvedName} in my database.`,
        primaryMedicine: target,
        lastAlternatives: [],
      };
    }

    const alternativesData = {
      targetMedicineName: resolvedName,
      description: "We've identified therapeutic equivalents with higher cost-efficiency and similar efficacy profiles.",
      alternatives,
      clinicalTip: `Clinical Tip: Both options contain the same active ingredient (${salt || "same compounds"}) and are biologically equivalent to your current medication.`
    };

    return {
      reply: `Here are cheaper alternatives for ${resolvedName}.`,
      alternativesData,
      primaryMedicine: target,
      lastAlternatives: alternatives.map(a => ({ id: a.name, name: a.name })),
    };
  }
};
