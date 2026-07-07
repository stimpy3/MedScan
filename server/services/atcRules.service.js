// server/services/atcRules.service.js
// Deterministic ATC-based safety rules — a structured sibling to the 1mg-text checks in
// safetyCheck.service. Two rule families:
//   1. profile-condition rules: medicine's ATC class × a profile fact (NSAID + kidney disease,
//      steroid + diabetes, CNS medicine + alcohol, ...)
//   2. cross-medicine rules: the medicine × the user's current medicines (duplicate therapy —
//      same ingredient or same 4-char ATC subgroup — and dual antibiotics)
// No LLM anywhere. Warnings use the exact shape safetyCheck already emits.
const {
  searchMedicineByName,
  extractIngredients,
  getDomainsForIngredients
} = require("./medicineSearch.service");
const { classLabel, describeAtc, atcOfficialName } = require("./atcExplain.service");

const lc = s => String(s || "").toLowerCase().trim();
const titleCase = s => String(s || "").split(/\s+/).filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
const truncate = (s, n = 220) => (String(s).length > n ? String(s).slice(0, n - 1) + "…" : String(s));

// ATC codes are ingredient-level; a diclofenac GEL would otherwise trigger the NSAID/kidney
// warning. Heuristic: skip profile-condition rules for clearly topical/local products.
// (no leading \b — "Emulgel"-style suffixes must match too; the trailing \b still blocks mid-word hits)
const TOPICAL_NAME = /(gel|cream|ointment|lotion|eye ?drops?|ear ?drops?|\bdrops?|spray|rinse|mouthwash|shampoo)\b/i;

// Class memberships RxNorm assigns via combination products ("Opioids in combination with…")
// must not drive same-class comparisons — restrict each medicine to its primary 3-char class.
function primaryCodes(codes) {
  const cleaned = [...new Set(codes.map(c => String(c).toUpperCase()).filter(Boolean))]
    .filter(c => !/combination/i.test(atcOfficialName(c) || ""));
  const primary = describeAtc(cleaned);
  if (!primary) return [];
  return cleaned.filter(c => c.startsWith(primary.atc3));
}

// ── name → { salts, codes } resolution, memoized (names repeat constantly) ───────────────────
const NAME_CACHE_MAX = 1000;
const nameCache = new Map();

function atcCodesForName(medicineName) {
  const key = lc(medicineName);
  if (!key) return { salts: [], codes: [] };
  if (nameCache.has(key)) return nameCache.get(key);

  const rec = searchMedicineByName(key);
  const salts = rec ? extractIngredients(rec.salt_composition || "") : [];
  const codes = salts.length ? primaryCodes(getDomainsForIngredients(salts)) : [];

  const value = { salts, codes };
  if (nameCache.size >= NAME_CACHE_MAX) nameCache.delete(nameCache.keys().next().value);
  nameCache.set(key, value);
  return value;
}

// ── profile-condition rule table ──────────────────────────────────────────────────────────────
// terms match against profile.conditions entries; alcohol-kind rules check profile.alcohol.
const CONDITION_RULES = [
  {
    id: "nsaid_kidney", prefixes: ["M01A"], kind: "condition",
    terms: /kidney|renal|nephro|\bckd\b|dialysis/i, severity: "high",
    message: (med, label) => `${med} is an NSAID (${label}). NSAIDs can strain the kidneys — with your kidney condition, ask a doctor before taking it.`
  },
  {
    id: "nsaid_gi", prefixes: ["M01A"], kind: "condition",
    terms: /ulcer|gastric|gastritis|stomach bleed|gerd|reflux|acidity/i, severity: "high",
    message: (med, label) => `${med} is an NSAID (${label}). NSAIDs can irritate the stomach lining — risky with your ulcer/gastric history.`
  },
  {
    id: "steroid_diabetes", prefixes: ["H02"], kind: "condition",
    terms: /diabet|blood sugar|hyperglyc/i, severity: "medium",
    message: (med, label) => `${med} is a corticosteroid (${label}). Steroids can raise blood sugar — monitor closely with your diabetes.`
  },
  {
    id: "antithrombotic_bleeding", prefixes: ["B01"], kind: "condition",
    terms: /bleed|clotting|h(a?)emophilia|platelet|thrombocytopenia/i, severity: "high",
    message: (med, label) => `${med} is a blood thinner (${label}). With a bleeding/clotting disorder, use it only under a doctor's supervision.`
  },
  {
    id: "cns_alcohol", prefixes: ["N05", "N06"], kind: "alcohol", severity: "medium",
    message: (med, label) => `${med} acts on the nervous system (${label}). Combining it with alcohol can amplify drowsiness and side effects.`
  }
];

function matchedPrefix(codes, prefixes) {
  for (const code of codes) {
    const p = prefixes.find(pre => code.startsWith(pre));
    if (p) return code;
  }
  return null;
}

function conditionRuleWarnings(medName, codes, profile) {
  if (TOPICAL_NAME.test(medName)) return { warnings: [], firedRegexes: [] };

  const warnings = [];
  const firedRegexes = [];
  const conditions = (profile.conditions || []).map(lc);
  const drinks = ["occasional", "regular"].includes(lc(profile.alcohol));

  for (const rule of CONDITION_RULES) {
    const code = matchedPrefix(codes, rule.prefixes);
    if (!code) continue;

    let matchedFact = null;
    if (rule.kind === "condition") {
      matchedFact = conditions.find(c => rule.terms.test(c)) || null;
      if (!matchedFact) continue;
      firedRegexes.push(rule.terms);
    } else if (rule.kind === "alcohol") {
      if (!drinks) continue;
      matchedFact = `alcohol use (${lc(profile.alcohol)})`;
    }

    const label = classLabel([code]) || atcOfficialName(code) || code;
    warnings.push({
      type: rule.kind,
      severity: rule.severity,
      message: truncate(rule.message(medName, label)),
      basis: truncate(`ATC ${code} (${atcOfficialName(code) || label}) + profile ${rule.kind === "alcohol" ? matchedFact : `condition "${matchedFact}"`}`)
    });
  }
  return { warnings, firedRegexes };
}

// ── cross-medicine rules: duplicate therapy + dual antibiotics ────────────────────────────────
function crossMedicineWarnings(medName, medSalts, medCodes, currentMedicines) {
  const warnings = [];
  const medSaltSet = new Set(medSalts);

  for (const current of currentMedicines) {
    if (lc(current) === lc(medName)) continue; // the medicine itself is usually scheduled

    const { salts: curSalts, codes: curCodes } = atcCodesForName(current);
    if (!curSalts.length && !curCodes.length) continue; // unresolved — rule silently skips

    const sharedSalts = curSalts.filter(s => medSaltSet.has(s));
    if (sharedSalts.length) {
      warnings.push({
        type: "duplicate therapy",
        severity: "high",
        message: truncate(`${current} contains the same active ingredient as ${medName} (${sharedSalts.map(titleCase).join(", ")}). Taking both risks double-dosing — check with a doctor.`),
        basis: truncate(`current medicine "${current}" shares ingredient ${sharedSalts.join(", ")}`)
      });
      continue;
    }

    const curSet = new Set(curCodes);
    const shared5 = medCodes.find(c => curSet.has(c));
    const shared4 = shared5 ? null : medCodes.find(c => curCodes.some(cc => cc.slice(0, 4) === c.slice(0, 4)));
    if (shared5 || shared4) {
      const code = shared5 || shared4;
      const label = classLabel([shared5 || code.slice(0, 4)]) || atcOfficialName(code) || code;
      warnings.push({
        type: "duplicate therapy",
        severity: shared5 ? "high" : "medium",
        message: truncate(`You're already taking ${current}, which is in the same class (${label}) as ${medName}. Taking both can double up the effect — check with a doctor.`),
        basis: truncate(`ATC ${code} shared with current medicine "${current}" (${shared5 ? "same subgroup" : "same class"})`)
      });
      continue;
    }

    // Dual antibiotics: sometimes intentional (co-prescribed) — informational only.
    if (medCodes.some(c => c.startsWith("J01")) && curCodes.some(c => c.startsWith("J01"))) {
      warnings.push({
        type: "duplicate therapy",
        severity: "low",
        message: truncate(`${medName} and ${current} are both antibiotics. Two antibiotics together is sometimes intentional — confirm this combination is prescribed.`),
        basis: truncate(`ATC J01 (antibiotics) on both ${medName} and current medicine "${current}"`)
      });
    }
  }
  return warnings;
}

// ── main entries ──────────────────────────────────────────────────────────────────────────────
// medicines: the shape safetyCheck passes ([{ name, composition, ... }]); composition may be
// lazily-enriched salt text or a not-found sentinel (starts with "no verified information").
// → { results: [{ name, warnings }] aligned to input order, firedConditionRegexes: RegExp[] }
function runAtcRules({ medicines, profile, currentMedicines }) {
  const firedConditionRegexes = [];
  const results = (medicines || []).map(med => {
    const composition = String(med.composition || "").trim();
    const usable = composition && !lc(composition).startsWith("no verified information");
    let salts = usable ? extractIngredients(composition) : [];
    let codes = salts.length ? primaryCodes(getDomainsForIngredients(salts)) : [];
    if (!salts.length) {
      const resolved = atcCodesForName(med.name);
      salts = resolved.salts;
      codes = resolved.codes;
    }

    const warnings = [];
    if (codes.length && profile) {
      const cond = conditionRuleWarnings(med.name, codes, profile);
      warnings.push(...cond.warnings);
      firedConditionRegexes.push(...cond.firedRegexes);
    }
    if ((salts.length || codes.length) && (currentMedicines || []).length) {
      warnings.push(...crossMedicineWarnings(med.name, salts, codes, currentMedicines));
    }
    return { name: med.name, warnings };
  });

  return { results, firedConditionRegexes };
}

// Duplicate-therapy groups across a list of medicine names (powers /api/schedules/check-duplicate
// and the reminders banner). Same-ingredient groups first (exact salt-set signature), then
// same-class groups by shared 4-char ATC subgroup among the rest.
function findDuplicateGroups(names) {
  const resolved = [];
  const unresolved = [];
  const seen = new Set();
  for (const raw of names || []) {
    const name = String(raw || "").trim();
    if (!name || seen.has(lc(name))) continue;
    seen.add(lc(name));
    const info = atcCodesForName(name);
    if (!info.salts.length && !info.codes.length) unresolved.push(name);
    else resolved.push({ name, ...info, saltSig: [...info.salts].sort().join("+") });
  }

  const groups = [];

  // same ingredient: identical salt sets under different product names
  const bySalt = new Map();
  for (const r of resolved) {
    if (!r.saltSig) continue;
    if (!bySalt.has(r.saltSig)) bySalt.set(r.saltSig, []);
    bySalt.get(r.saltSig).push(r);
  }
  const sameIngredientNames = new Set();
  for (const [sig, members] of bySalt) {
    if (members.length < 2) continue;
    members.forEach(m => sameIngredientNames.add(m.name));
    groups.push({
      kind: "same_ingredient",
      atc4: null,
      className: null,
      friendlyLabel: sig.split("+").map(titleCase).join(" + "),
      medicines: members.map(m => m.name)
    });
  }

  // same class: shared 4-char subgroup among medicines NOT already grouped by ingredient
  const byAtc4 = new Map();
  for (const r of resolved) {
    for (const code of r.codes) {
      const p4 = code.slice(0, 4);
      if (!byAtc4.has(p4)) byAtc4.set(p4, new Map());
      byAtc4.get(p4).set(r.name, r);
    }
  }
  const grouped = new Set();
  for (const [p4, memberMap] of byAtc4) {
    const members = [...memberMap.values()];
    if (members.length < 2) continue;
    const sigs = new Set(members.map(m => m.saltSig));
    if (sigs.size < 2) continue; // identical salts → already a same_ingredient group
    const key = members.map(m => m.name).sort().join("|");
    if (grouped.has(key)) continue;
    grouped.add(key);
    groups.push({
      kind: "same_class",
      atc4: p4,
      className: atcOfficialName(p4),
      friendlyLabel: classLabel([p4]),
      medicines: members.map(m => m.name)
    });
  }

  return { groups, unresolved };
}

module.exports = { runAtcRules, findDuplicateGroups, atcCodesForName };
