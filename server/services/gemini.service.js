const axios = require("axios");

const MODEL = "gemini-2.5-flash";
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const EXTRACTION_PROMPT = `You are reading a photo a user took with their phone. It is ONE of:
- a "medicine_label" (a medicine strip, bottle, box, or packaging), OR
- a "prescription" (a doctor's prescription, handwritten or printed), OR
- "unrelated" (anything else: a person, food, random object, blurry/unreadable image).

Read the image carefully, including messy handwriting, and return ONLY a JSON object:
{
  "documentType": "medicine_label" | "prescription" | "unrelated",
  "medicines": [
    {
      "name": "<brand or medicine name, or null>",
      "ingredients": ["<active ingredient>", "..."],
      "dosage": "<strength/dose e.g. 500mg, or null>"
    }
  ],
  "rawText": "<all text you can read, exactly as written>"
}

Rules:
- If "unrelated", set medicines to [] and rawText to a short description of what you see.
- A prescription may list several medicines — include each as its own object.
- Use null (not guesses) for any field you genuinely cannot read.
- ingredients is always an array (empty [] if unknown).
- Return JSON only, no markdown, no commentary.`;

async function extractFromImage(base64, mimeType = "image/jpeg") {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not defined in the environment variables");
  }

  const response = await axios.post(
    `${ENDPOINT}?key=${apiKey}`,
    {
      contents: [
        {
          parts: [
            { text: EXTRACTION_PROMPT },
            { inline_data: { mime_type: mimeType, data: base64 } }
          ]
        }
      ],
      generationConfig: { responseMimeType: "application/json", temperature: 0 }
    },
    { headers: { "Content-Type": "application/json" } }
  );

  const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    console.error("[GeminiService] Could not parse JSON, raw text:", text);
    parsed = { documentType: "unrelated", medicines: [], rawText: text };
  }

  return parsed;
}

// EXTRACTION_PROMPT is shared with cerebras.service so both vision providers honor the same contract.
module.exports = { extractFromImage, EXTRACTION_PROMPT };
