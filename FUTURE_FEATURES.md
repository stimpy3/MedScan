# MedScan — Future Features Roadmap

Pick these up once the current flows are stable and the UI is solid.
Ordered by resume impact vs effort.

---

## 1. OCR — Scan a Medicine Label or Prescription

**What:** User points camera at a medicine strip or doctor's prescription. App extracts the medicine name automatically without typing.

**Why it matters:**
- Makes the demo visual and tangible — huge for interviews
- Closes the gap between "chat toy" and "tool someone would actually use"
- You already had the foundation (`utils/ocr.ts` existed before the refactor)

**How to build it:**
- Use `expo-camera` to capture the image
- Send image to Google Vision API or AWS Textract (both have free tiers) for OCR
- Feed the extracted text into the existing `extractMedicines()` pipeline — no changes needed there
- Show a preview of what was scanned before sending to chat

**Stretch goal:** Full prescription scan → extract ALL medicines + dosages → auto-populate multiple schedules at once. That's a complete pipeline story for interviews.

---

## 2. Augment the Dataset with Live APIs (Don't Replace It)

**What:** The current CSV is already a strong structured dataset — it has `medicine_desc`, `side_effects`, `drug_interactions` (JSON), `short_composition1/2`, `manufacturer_name`, `pack_size_label`, and `price`. That's genuinely good RAG-style source material. The right move is to keep it as the primary source and call live APIs only for what the CSV doesn't or can't cover.

**What the CSV covers well (keep using it):**
- Medicine name, composition, type, pack size
- Price and manufacturer
- Full description paragraphs (used for LLM grounding in explanations)
- Side effects list
- Drug interaction structure (already has `drug`, `brand`, `effect` JSON fields)

**What live APIs add on top:**

| Gap | API to fill it |
|-----|---------------|
| Medicines not in the dataset | OpenFDA label search — `api.fda.gov/drug/label.json` |
| Up-to-date interaction data | OpenFDA interactions or DrugBank free tier |
| US equivalents / generic names | RxNorm — `rxnav.nlm.nih.gov/REST/drugs.json` |
| Real-time availability / recalls | OpenFDA enforcement endpoint |

**How to build it:**
- Add a fallback layer in `medicineSearch.service.js`: if local CSV returns no match, query OpenFDA and cache the result in-memory for the session
- The FlexSearch + Levenshtein pipeline stays exactly as-is — it just gets a second data source to index from
- For drug interactions specifically: parse the existing `drug_interactions` JSON column first, hit OpenFDA only if it's empty

**Interview framing:** "I started with a rich structured dataset that gave me composition, pricing, descriptions and interaction fields. I augmented it with OpenFDA as a live fallback for medicines not in the dataset, so the system works offline-first but degrades gracefully to live data rather than failing."

---

## 3. Drug Interaction Checker

**What:** User has two or more medicines — does taking them together cause problems?

**Why it matters:**
- This is a real clinical problem people actually face
- No other student project does this
- Turns the app from "find cheaper medicine" into "is my combination safe"
- Has a real, defensible API behind it — not just LLM guessing

**How to build it:**
- The CSV already has a `drug_interactions` column with structured JSON (`{ "drug": [], "brand": [], "effect": [] }`). Parse that first — for many medicines the data is already there.
- For medicines where the column is empty, fall back to OpenFDA: `api.fda.gov/drug/label.json` has a `drug_interactions` text field; DrugBank free tier gives structured severity levels.
- New intent: `check_interactions` — fits cleanly into the existing handler registry, same pattern as the others
- UI: severity badge (mild / moderate / severe) + the interaction description, similar card style to ComparisonCard

**Interview story:** "The dataset already had drug interaction fields. I built a new intent on top of it so users can check whether two medicines they're already comparing are safe to take together — grounded in the data, not LLM guessing."

---

## 4. Web Search Grounding for Medicine Explanations

**What:** When explaining a medicine, fetch the current FDA label or a PubMed abstract first, then ground the LLM response in that data.

**Why it matters:**
- Directly addresses the #1 criticism of any medical AI: "what if the LLM is wrong?"
- Shows you thought about hallucination risk and mitigated it — that's a senior-level signal
- Makes the explanation answers actually trustworthy

**How to build it:**
- Before calling the LLM in `explainMedicine.service.js`, hit the OpenFDA label API
- Pass the fetched label text as grounding context in the LLM prompt
- Add a "Source: FDA Label" citation to the card UI
- Fallback gracefully if the API returns nothing

---

## 5. Google Calendar Integration

**What:** After scheduling a medicine, push the reminders to the user's Google Calendar.

**Why it matters (product):** Real utility — reminders show up on the user's main calendar, not a separate app.

**Why it matters less for resume:** This is OAuth + API integration, which is table stakes. Do it for the product, not the technical story.

**How to build it:**
- Google Calendar API with OAuth 2.0 via `expo-auth-session`
- After `addSchedule()` succeeds, create a recurring Google Calendar event
- Map the `days` array to RRULE recurrence rules (e.g., `BYDAY=MO,WE,FR`)

---

## Priority Order

| # | Feature | Resume Impact | Effort |
|---|---------|--------------|--------|
| 1 | OCR label scan | High | Medium |
| 2 | OpenFDA / RxNorm API | Medium | Low |
| 3 | Drug interaction checker | Very High | Medium |
| 4 | Web search grounding | High | Low |
| 5 | Google Calendar | Low | Medium |

Start with **OCR** — it makes the demo 10x more compelling with the least architectural change.
Then **drug interactions** — it's the feature that makes this app unique and gives you the best interview story.
