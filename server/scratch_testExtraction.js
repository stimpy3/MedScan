const { initMedicineService, extractMedicines } = require("./services/medicineExtraction.service");

async function main() {
  await initMedicineService();
  console.log("\n--- TEST CASE 1: 'Almox capsules' ---");
  let res = await extractMedicines("Almox capsules");
  console.log("Result:", JSON.stringify(res, null, 2));

  console.log("\n--- TEST CASE 2: 'I want explain prescription' ---");
  res = await extractMedicines("I want explain prescription");
  console.log("Result:", JSON.stringify(res, null, 2));

  console.log("\n--- TEST CASE 3: 'find me medicine correspondig to Ascoril Syrup' ---");
  res = await extractMedicines("find me medicine correspondig to Ascoril Syrup");
  console.log("Result:", JSON.stringify(res, null, 2));
}

main().catch(console.error);
