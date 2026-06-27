// Validates fuzzy-matched compare mentions against the user's actual intent.
// The retrieval + scoring is deterministic and grounded in our dataset; this LLM step only judges
// whether each detected phrase was genuinely used as a MEDICINE reference, or is a normal/
// conversational word that coincidentally resembles a medicine name. This is the dataset+LLM combo:
// we never let the LLM invent medicines — it only confirms/rejects spans that already matched real
// rows, so a leading "lets" / "ok" / "set" that fuzzy-hit a brand gets filtered out without us
// hardcoding a stopword list.
const COMPARE_VALIDATE_SYSTEM_PROMPT = `You filter false-positive medicine matches from a fuzzy search.

You are given the user's full message and a list of detected mentions. Each mention is a phrase that
appeared in the message and fuzzy-matched a real medicine name in our database.

Decide for each mention by its GRAMMATICAL ROLE in the sentence, not by whether the word also has an
everyday meaning. The phrase already matches a real medicine in our database, so bias toward ACCEPT.

- REJECT only when the phrase is functioning as an ordinary English word: a verb ("meant", "lets",
  "take", "want"), a pronoun, a greeting/filler ("ok", "hey", "well", "please"), a connector, or a
  number/quantity — i.e. it is NOT naming a product.
- ACCEPT when the phrase is used as a NAME or list item referring to a medicine, EVEN IF that word
  also has a normal English meaning. Names like "codex", "combiflam", "cold", "pain x" used as the
  thing being compared are medicines here.
- Examples:
  - "No i meant hisplon" → "meant" is a verb → REJECT; "hisplon" is a name → ACCEPT.
  - "lets compare dolo with crocin" → "lets" is filler → REJECT; "dolo", "crocin" → ACCEPT.
  - "codex and hisplon" → both are list items naming medicines → ACCEPT both.
- When genuinely unsure, ACCEPT.

Return ONLY valid JSON. Include one entry for EVERY numbered mention, echoing its index number and
the exact phrase given (do not substitute the matched medicine name for the phrase):
{ "results": [ { "index": <number>, "phrase": "<exact phrase>", "is_medicine": true | false } ] }`;

module.exports = { COMPARE_VALIDATE_SYSTEM_PROMPT };
