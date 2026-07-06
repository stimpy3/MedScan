// server/services/oneMgMatch.service.js
// Matches a dataset medicine name to the best 1mg drug page in data/1mg_index.json, token-aware
// (whole-word, brand>dose>form weighting via the shared getSimilarity), with brand-token blocking
// so it scales over ~374k keys. Returns a scored best candidate; the caller decides accept/reject
// by threshold + gap (precision-first: better to leave a row empty than match the wrong drug).
const fs = require("fs");
const path = require("path");
const { getSimilarity } = require("./medicineExtraction.service");

const INDEX_PATH = path.join(__dirname, "../data/1mg_index.json");
const FORM_TOKENS = new Set(["tablet", "tablets", "capsule", "capsules", "syrup", "suspension", "injection", "cream", "gel", "drops", "solution", "oral", "ointment", "lotion", "powder", "sachet", "spray", "kit", "tube", "bottle", "respules", "rotacaps"]);

let _keys = null;        // string[] of normalized 1mg names
let _entries = null;     // parallel array of { url, id }
let _tokenMap = null;    // token -> number[] (indices into _keys)

function normKey(name) {
  return String(name || "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

function load() {
  if (_keys) return;
  const idx = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
  _keys = Object.keys(idx);
  _entries = _keys.map(k => idx[k]);
  _tokenMap = new Map();
  for (let i = 0; i < _keys.length; i++) {
    for (const tok of _keys[i].split(" ")) {
      if (!tok) continue;
      let arr = _tokenMap.get(tok);
      if (!arr) { arr = []; _tokenMap.set(tok, arr); }
      arr.push(i);
    }
  }
}

// Most distinctive query token to block on: prefer a long, non-form, non-numeric word (the brand);
// fall back to the rarest token in the index.
function blockingTokens(tokens) {
  const cand = tokens.filter(t => t.length >= 4 && !FORM_TOKENS.has(t) && !/^\d/.test(t));
  const pool = cand.length ? cand : tokens;
  // sort by index rarity (ascending list length) so we scan the smallest candidate set first
  return pool
    .map(t => ({ t, n: (_tokenMap.get(t) || []).length }))
    .filter(x => x.n > 0)
    .sort((a, b) => a.n - b.n)
    .map(x => x.t);
}

// Returns { url, key, score, gap, secondKey } or null (no candidate sharing a brand token).
function matchOneMg(name) {
  load();
  const q = normKey(name);
  if (!q) return null;
  const qTokens = q.split(" ");

  // Gather candidate indices from the most distinctive token; if that set is huge, intersect with
  // the next distinctive token to keep scoring bounded.
  const blocks = blockingTokens(qTokens);
  if (!blocks.length) return null;
  let candidates = _tokenMap.get(blocks[0]) || [];
  if (candidates.length > 4000 && blocks[1]) {
    const second = new Set(_tokenMap.get(blocks[1]) || []);
    const narrowed = candidates.filter(i => second.has(i));
    if (narrowed.length) candidates = narrowed;
  }
  if (!candidates.length) return null;

  let best = -1, bestScore = 0, secondScore = 0, secondIdx = -1;
  for (const i of candidates) {
    const s = getSimilarity(q, _keys[i]);
    if (s > bestScore) { secondScore = bestScore; secondIdx = best; best = i; bestScore = s; }
    else if (s > secondScore) { secondScore = s; secondIdx = i; }
  }
  if (best < 0) return null;
  return {
    url: _entries[best].url,
    key: _keys[best],
    score: Number(bestScore.toFixed(3)),
    gap: Number((bestScore - secondScore).toFixed(3)),
    secondKey: secondIdx >= 0 ? _keys[secondIdx] : null
  };
}

module.exports = { matchOneMg, normKey };
