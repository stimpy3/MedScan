require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { loadMedicines } = require("./services/medicineSearch.service.js");
const { initMedicineService } = require("./services/medicineExtraction.service.js");
const medicineRoutes = require("./routes/medicine.js");
const intentRoutes = require("./routes/intent.routes.js");

const app = express();
app.use(cors());
app.use(express.json());

// Load CSV ONCE at startup
Promise.all([
  loadMedicines().then(() => console.log("✅ Medicines loaded")),
  initMedicineService() // It already logs "Medicine extraction service initialized"
]).catch(err => console.error("❌ Failed to initialize services:", err));

app.use("/medicine", medicineRoutes);
app.use("/api/intent", intentRoutes);

app.listen(3000, () => {
  console.log("Server running on port 3000");
});