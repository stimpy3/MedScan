// server/services/explainMedicine.service.js
const { EXPLAIN_MEDICINE_SYSTEM_PROMPT } = require("../prompts/explainMedicine.prompt");
const { chatCompletionJson } = require("./groq.service");
const { searchMedicineByName } = require("./medicineSearch.service");
const { cleanLlmJsonResponse } = require("../utils/helpers");

async function getMedicineExplanationCard(medicineName) {
  console.log(`[ExplainMedicineService] Explaining medicine: "${medicineName}"`);
  
  const med = searchMedicineByName(medicineName);
  
  let databaseDetails = {};
  let price = 0;
  let pack_size = "";
  let manufacturer = "";
  let type = "Allopathy"; // Default type if not specified
  
  if (med) {
    console.log(`[ExplainMedicineService] Found medicine in database:`, med.name);
    databaseDetails = {
      name: med.name,
      medicine_desc: med.medicine_desc || "",
      salt_composition: med.salt_composition || "",
      short_composition1: med.comp1 || "",
      short_composition2: med.comp2 || "",
      side_effects: med.side_effects || "",
      manufacturer_name: med.manufacturer || "",
      type: "Allopathy", // We can default or extract if defined
      pack_size_label: med.pack_size || "",
      price: med.price || 0
    };
    price = med.price || 0;
    pack_size = med.pack_size || "";
    manufacturer = med.manufacturer || "";
  } else {
    console.log(`[ExplainMedicineService] Medicine "${medicineName}" not found in local database. Relying on LLM knowledge.`);
    databaseDetails = {
      name: medicineName,
      medicine_desc: "Not available in local database. Generate using general knowledge.",
      salt_composition: "Not available in local database. Generate using general knowledge.",
      short_composition1: "",
      short_composition2: "",
      side_effects: "Not available in local database. Generate using general knowledge.",
      manufacturer_name: "Unknown",
      type: "Allopathy",
      pack_size_label: "Unknown",
      price: 0
    };
  }

  const messages = [
    { role: "system", content: EXPLAIN_MEDICINE_SYSTEM_PROMPT },
    { role: "user", content: `Please generate the structured explanation for this medicine:\n\n${JSON.stringify(databaseDetails, null, 2)}` }
  ];

  try {
    const responseText = await chatCompletionJson(messages);
    const cleanedText = cleanLlmJsonResponse(responseText);
    const generatedDetails = JSON.parse(cleanedText);

    return {
      name: databaseDetails.name,
      type: databaseDetails.type || "Allopathy",
      category: generatedDetails.category || "Medication",
      short_desc: generatedDetails.short_desc || "",
      price: price > 0 ? `₹${price.toFixed(2)}` : "Price not available",
      pack_size: pack_size || "Standard Packaging",
      overview: generatedDetails.overview || "",
      composition: generatedDetails.composition || "",
      side_effects: generatedDetails.side_effects || "",
      manufacturer: generatedDetails.manufacturer || manufacturer || "Unknown Manufacturer"
    };
  } catch (error) {
    console.error("[ExplainMedicineService] Error calling LLM for explanation:", error);
    // Return graceful fallback
    return {
      name: databaseDetails.name,
      type: "Allopathy",
      category: "Medication",
      short_desc: `Information details for ${databaseDetails.name}`,
      price: price > 0 ? `₹${price.toFixed(2)}` : "Price not available",
      pack_size: pack_size || "Standard Packaging",
      overview: databaseDetails.medicine_desc || "No overview available.",
      composition: databaseDetails.salt_composition || "No composition details available.",
      side_effects: databaseDetails.side_effects || "No side effects information available.",
      manufacturer: manufacturer || "Unknown Manufacturer"
    };
  }
}

module.exports = { getMedicineExplanationCard };
