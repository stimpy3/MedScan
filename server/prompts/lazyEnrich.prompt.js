// server/prompts/lazyEnrich.prompt.js
// The three small prompts behind the lazy (on-demand) enrichment loop
// (server/services/lazyEnrichment.service.js):
//   1. QUERY_BUILDER   — turn medicine + missing fields into ONE focused search query
//   2. GAP_CHECK       — judge whether a round's results were relevant + what to try next
//   3. SNIPPET_EXTRACT — pull field values out of search snippets, strictly no invention

const LAZY_QUERY_BUILDER_PROMPT = `You write ONE Google search query to find missing facts about a specific Indian medicine.

You are given: the exact medicine name, the list of missing information (e.g. "salt composition", "uses", "side effects"), the round number, and — on round 2 — the previous query plus a hint about what is still missing.

Rules:
- The query MUST contain the medicine name. Keep dosage/form words like "650mg" or "Tablet" — they identify the exact product.
- Add plain keywords for the missing information ONLY. Never ask for information that is not in the list.
- Round 2 means the first query didn't fully work: make the query NARROWER and target only the leftover gaps (use the hint if given).
- Do NOT include any site: operator — the system adds it.
- Keep the query under 12 words.

Return strictly valid JSON: { "query": "your search query" }`;

const LAZY_GAP_CHECK_PROMPT = `You are auditing one round of web search about a specific Indian medicine.

You are given: the medicine name, the fields we needed, what has been collected so far (null = still missing), and the search result titles/snippets.

Decide:
- "relevant": were these search results about this exact medicine (or its salt/brand)? true or false. Results about a different medicine, a different brand, or generic health pages are NOT relevant.
- "hint": if fields are still missing and the results suggest a better angle, one short phrase describing what to search next (e.g. "side effects of <salt name>"). Otherwise null.

Return strictly valid JSON: { "relevant": true, "hint": null }`;

const LAZY_SNIPPET_EXTRACT_PROMPT = `You extract facts about a specific medicine from Google search snippets. This is the last resort after page parsing failed, so precision matters far more than coverage.

You are given the medicine name, the missing fields, and search results (title, link, snippet).

STRICT rules:
- Copy a fact ONLY if a snippet explicitly states it ABOUT THIS EXACT MEDICINE. Rephrase minimally.
- Ignore snippets about a different brand, salt, or dosage form.
- NEVER use your own knowledge. NEVER guess. If the snippets don't state a field, return null for it.
- Field meanings: "salt_composition" = active ingredients with strengths; "medicine_desc" = what it is / what it treats; "side_effects" = the listed side effects.

Return strictly valid JSON with exactly these keys (each a string or null):
{ "salt_composition": null, "medicine_desc": null, "side_effects": null }`;

module.exports = {
  LAZY_QUERY_BUILDER_PROMPT,
  LAZY_GAP_CHECK_PROMPT,
  LAZY_SNIPPET_EXTRACT_PROMPT
};
