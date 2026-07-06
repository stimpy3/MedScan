require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { loadMedicines } = require("./services/medicineSearch.service.js");
const { initMedicineService } = require("./services/medicineExtraction.service.js");
const { connectDB } = require("./config/db.js");
const medicineRoutes = require("./routes/medicine.js");
const intentRoutes = require("./routes/intent.routes.js");
const ocrRoutes = require("./routes/ocr.routes.js");
const authRoutes = require("./routes/auth.routes.js");
const profileRoutes = require("./routes/profile.routes.js");
const scheduleRoutes = require("./routes/schedule.routes.js");
const syncRoutes = require("./routes/sync.routes.js");

const app = express();
app.use(cors());
app.use(express.json({ limit: "10mb" })); // base64 images exceed the default 100kb

// Load CSV ONCE at startup; Mongo connects in parallel (non-fatal — guest mode works without it).
Promise.all([
  loadMedicines().then(() => console.log("✅ Medicines loaded")),
  initMedicineService(), // It already logs "Medicine extraction service initialized"
  connectDB()
]).catch(err => console.error("❌ Failed to initialize services:", err));

app.use("/medicine", medicineRoutes);
app.use("/api/intent", intentRoutes);
app.use("/api/ocr", ocrRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/schedules", scheduleRoutes);
app.use("/api/sync", syncRoutes);

// Render (and other hosts) probe this to know the service is alive.
app.get("/healthz", (req, res) => res.json({ ok: true }));

// Render injects PORT; 3000 stays the local default.
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});