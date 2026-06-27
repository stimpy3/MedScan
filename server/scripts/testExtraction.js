require("dotenv").config();
const { initMedicineService, extractMedicines } = require("../services/medicineExtraction.service");

async function runTests() {
  await initMedicineService();

  console.log("\n--- Test 1: Exact matches ---");
  const res1 = await extractMedicines("I took dolo 650 after lunch");
  console.log(JSON.stringify(res1, null, 2));

  console.log("\n--- Test 2: Garbage text ---");
  const res2 = await extractMedicines("I ate an apple");
  console.log(JSON.stringify(res2, null, 2));

  console.log("\n--- Test 3: Ambiguous query ---");
  const res3 = await extractMedicines("I take Augmentin");
  console.log(JSON.stringify(res3, null, 2));
}

runTests().catch(console.error);
