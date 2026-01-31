const express = require("express");
const { loadMedicines } = require("./services/medicineSearch.js");
const medicineRoutes = require("./routes/medicine.js");

const app = express();
app.use(express.json());

// Load CSV ONCE at startup
loadMedicines()
  .then(() => console.log("✅ Medicines loaded"))
  .catch(err => console.error("❌ Failed to load medicines:", err));

app.use("/medicine", medicineRoutes);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});