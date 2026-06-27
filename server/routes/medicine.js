const express = require("express");
const router = express.Router();
const { getSimilarMedicines } = require("../services/medicineSearch.service.js");

router.post("/find-similar", async (req, res) => {
  try {
    const { ingredients } = req.body;
    if (!ingredients || typeof ingredients !== "string") {
      return res.status(400).json({ error: "ingredients string required" });
    }

    const results = await getSimilarMedicines(ingredients);
    res.json(results);
  } catch (err) {
    console.error("❌ Error in find-similar route:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;