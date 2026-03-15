# How Your App Finds Similar Medicines

## Overview

This document describes how the system converts a user medicine query into normalized ingredients, maps medicines using ATC domains, and ranks substitutes using a weighted confidence score.

Similarity is graded (0–1.0). The goal is to answer:

“How safe is this as a substitute?”

—not merely “is this similar.”

---

## 1. User Input → RxNorm Matching

When a user searches for a medicine, the app receives raw ingredient text.

Examples:

Ambroxol  
Paracetamol + Ibuprofen  

Each ingredient is normalized using `ingredientNormalization.json`.

Handled by `normalizeIngredient()`:

- Convert to lowercase  
- Remove dosage info (anything in parentheses like 500mg)  
- Map brand names to generics via RxNorm normalization  
- Remove duplicate ingredients using Sets  

Result:

["ambroxol"]

or

["paracetamol", "ibuprofen"]

---

## 2. Ingredient Extraction and Grouping

The CSV contains raw `salt_composition` values such as:

Ambroxol 30mg + Bromhexine 8mg

Processing:

- `extractIngredients()` splits by + or ,
- Dosages are removed
- If an ingredient itself is a combination (defined in `ingredientCodes.json`), it is expanded into components

At load time, an `ingredientIndex` is built:

normalized ingredient → all medicine indices containing it

Result:

All medicines containing ambroxol (30mg, 75mg, or combinations) are grouped together.

---

## 3. ATC Codes: Classification and Similarity

`ingredientCodes.json` stores ATC codes for each ingredient.

Example:

Ambroxol → R05CB06

For each medicine:

`getDomainsForIngredients()` gathers ALL ATC codes from its ingredients.

Single ingredient → one ATC  
Multiple ingredients → multiple ATCs  

ATC hierarchy:

Level 1: Anatomical class (R = Respiratory)  
Level 2: Therapeutic subgroup (R05 = Cough/Cold)  
Level 3+: Chemical substance (R05CB06)  

Shared ATC prefixes determine therapeutic similarity.

---

## 4. Confidence Scoring

Final confidence:

Confidence =
(Ingredient Score × 0.4) +
(Domain Score × 0.35) +
(Extra Ingredient Penalty × 0.25)

### Ingredient Match (40%)

- 1.0 if ALL query ingredients are present
- Medicines missing any query ingredient are excluded

### ATC Domain Match (35%)

shared_domains / total_query_domains

Example:

Query has 2 ATCs  
Medicine shares 1  

Score = 0.5

### Extra Ingredient Penalty (25%)

No extras → 1.0  

With extras:

max(0.5, 1 - (extra_count × 0.1))

10% penalty per extra ingredient, minimum 50%.

Encourages closest formulation.

---

## Safety Filter

Dangerous ATC classes are capped at 0.3 confidence:

J01 – Antibiotics  
H02 – Steroids  
M01 – NSAIDs  

Prevents unsafe substitutions from ranking highly.

---

## 5. Similarity Types

Each result is classified:

EXACT – Same ingredients, same count  
COMBINATION – Query ingredients plus extras  
THERAPEUTIC – Same ATC domain, different ingredient  
PARTIAL – Some ingredients match  
UNSAFE – Filtered or very low confidence  

Rules:

- Must contain ALL query ingredients
- Dangerous ATCs capped
- THERAPEUTIC only allowed when query has ATC codes

---

## 6. Complete Flow

User searches: Ambroxol

Normalize → ["ambroxol"]

Ingredient index lookup

Query ATC domains → [R05CB06]

For each candidate:

- Verify ingredient match
- Extract ingredients
- Collect ATC domains
- Compute ingredient score
- Compute domain score
- Apply extra ingredient penalty
- Apply safety caps

Results sorted by:

1. EXACT matches
2. Highest confidence
3. Cheapest price

Final output:

Ranked safe alternatives.

---

## Definition of Similarity

A medicine is similar if it:

- Contains ALL original active ingredients
- Shares therapeutic ATC domains
- Has minimal extra ingredients
- Passes safety rules

Similarity is continuous (0–1.0), not binary.

The system answers:

“How safe is this as a substitute?”

not:

“Is this identical?”

---

## Summary

The pipeline combines:

- RxNorm normalization
- Ingredient indexing
- ATC classification
- Weighted scoring
- Safety caps

to deliver ranked, clinically safer alternatives while suppressing risky replacements.

