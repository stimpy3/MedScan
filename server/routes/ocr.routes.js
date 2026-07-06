const express = require("express");
const router = express.Router();
const { VISION_PROVIDER } = require("../config/llmProviders");
const gemini = require("../services/gemini.service");
const cerebras = require("../services/cerebras.service");

// Provider picked by the flag in config/llmProviders.js — "gemma4" (Cerebras) or "gemini".
const extractFromImage = VISION_PROVIDER === "gemini" ? gemini.extractFromImage : cerebras.extractFromImage;

router.post("/extract", async (req, res) => {
  try {
    const { image, mimeType } = req.body;
    if (!image) {
      return res.status(400).json({ error: "Missing 'image' (base64) in request body" });
    }

    const result = await extractFromImage(image, mimeType);

    // Phase 1: just print to terminal for testing.
    console.log(`\n========== [OCR] ${VISION_PROVIDER} extraction ==========`);
    console.log("documentType:", result.documentType);
    console.log("medicines:", JSON.stringify(result.medicines, null, 2));
    console.log("rawText:\n", result.rawText);
    console.log("=============================================\n");

    res.json(result);
  } catch (err) {
    console.error("[OCR] extraction failed:", err.response?.data || err.message);
    res.status(500).json({ error: "OCR extraction failed" });
  }
});

module.exports = router;
