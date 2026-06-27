# Data Folder

This folder contains all static datasets used by the MedScan backend.

`medicines.csv` is the primary source of medicine data. All other files are generated from it or enriched using external drug reference data during the build process.

> Do not add comments inside JSON files. JSON comments are invalid and will break the application.

---

# Data Flow

```text
medicines.csv
      │
      ▼
Extract ingredients
      │
      ▼
ingredientNormalization.json
      │
      ▼
Lookup RxNorm / ATC information
      │
      ▼
ingredientCodes.json
      │
      ├──► uniqueIngredients.json
      │
      └──► uniqueIngredientsOriginal.json
```

---

# Example Flow

Assume the CSV contains:

```csv
brand_name,generic_name,ingredients
Crocin,Paracetamol,paracetamol
```

The system processes this medicine in the following steps:

### Step 1: Read from medicines.csv

The backend finds:

```text
Brand      = Crocin
Generic    = Paracetamol
Ingredient = paracetamol
```

At this point the system only knows the ingredient as a text string.

---

### Step 2: Normalize the ingredient name

Using `ingredientNormalization.json`:

```json
{
  "paracetamol": "Paracetamol"
}
```

This ensures different variations resolve to the same canonical name:

```text
paracetamol
PARACETAMOL
Paracetamol
```

becomes:

```text
Paracetamol
```

---

### Step 3: Attach pharmaceutical metadata

Using `ingredientCodes.json`:

```json
{
  "Paracetamol": {
    "rxcui": "161",
    "atc": ["N02BE01"]
  }
}
```

The system now knows:

```text
Paracetamol
├─ RxNorm ID = 161
└─ ATC Code = N02BE01
```

This data is obtained during the build process by looking up ingredients in external pharmaceutical reference sources such as RxNorm and WHO ATC.

The results are stored locally so the application does not need to perform external lookups during runtime.

---

# Files

## 1. medicines.csv

The source of truth for all medicines.

Contains:

* Brand names
* Generic names
* Active ingredients
* Dosage forms

Example:

```csv
brand_name,generic_name,ingredients,dosage_form
Augmentin,Amoxicillin,amoxycillin + clavulanic acid,tablet
Crocin,Paracetamol,paracetamol,tablet
```

Purpose:

* Medicine search
* Brand → ingredient mapping
* Input data for build scripts

---

## 2. ingredientNormalization.json

Maps raw ingredient names to a canonical display name.

Example:

```json
{
  "paracetamol": "Paracetamol",
  "acetylcysteine": "Acetylcysteine"
}
```

Purpose:

* Standardize ingredient names
* Remove casing inconsistencies
* Prevent duplicate ingredient records

---

## 3. ingredientCodes.json

Maps canonical ingredient names to pharmaceutical metadata.

Example:

```json
{
  "Paracetamol": {
    "rxcui": "161",
    "atc": ["N02BE01"],
    "baseIngredient": "paracetamol",
    "isCombination": false,
    "components": []
  }
}
```

Fields:

| Field          | Description                                              |
| -------------- | -------------------------------------------------------- |
| rxcui          | RxNorm Concept Unique Identifier                         |
| atc            | WHO Anatomical Therapeutic Chemical classification codes |
| baseIngredient | Normalized ingredient name                               |
| isCombination  | Whether the ingredient represents a combination product  |
| components     | Individual ingredients for combination products          |

Purpose:

* Drug classification
* Ingredient matching
* Clinical metadata enrichment
* Future interaction checking

---

## What is an ATC code?

ATC codes classify medicines into therapeutic categories.

Example:

```text
Apple
 └─ Fruit

Car
 └─ Vehicle

Paracetamol
 └─ N02BE01
```

ATC classification allows the system to understand what type of medicine an ingredient belongs to.

For example:

```text
Crocin
 → Paracetamol
 → Pain reliever
 → Fever reducer
```

Potential uses:

* Finding similar medicines
* Drug interaction analysis
* Therapeutic category search
* Clinical analytics

---

## 4. uniqueIngredients.json

Deduplicated list of all normalized ingredient names.

Example:

```json
[
  "paracetamol",
  "aspirin",
  "ibuprofen"
]
```

Purpose:

* Search
* Autocomplete
* Validation

Allows fast ingredient lookup without loading the full medicine dataset.

---

## 5. uniqueIngredientsOriginal.json

Deduplicated ingredient list using original display names.

Example:

```json
[
  "Paracetamol",
  "Aspirin",
  "Ibuprofen"
]
```

Purpose:

* Debugging
* Auditing
* Verifying normalization output

---

## 6. .ingredientNormalization.checkpoint.json

Internal checkpoint file used by the build script.

Example:

```json
[
  "Paracetamol",
  "Aspirin",
  "Ibuprofen"
]
```

Purpose:

* Resume interrupted builds
* Avoid reprocessing already completed ingredients

Used only by:

```text
scripts/buildIngredientCodes.js
```

---

# Build Process

Generate all derived files:

```bash
node scripts/buildIngredientCodes.js
```

This creates:

```text
ingredientNormalization.json
ingredientCodes.json
uniqueIngredients.json
uniqueIngredientsOriginal.json
```

---

# Runtime Usage

When the server starts:

```bash
node index.js
```

The backend loads:

```text
medicines.csv
ingredientNormalization.json
ingredientCodes.json
```

and prints:

```text
✅ Medicines loaded
```

When a user searches for a medicine:

```text
Crocin
```

the lookup flow is:

```text
medicines.csv
    ↓
Find Crocin
    ↓
Ingredient = paracetamol
    ↓
ingredientNormalization.json
    ↓
Paracetamol
    ↓
ingredientCodes.json
    ↓
RxCUI + ATC information
```

Result:

```json
{
  "brand": "Crocin",
  "ingredient": "Paracetamol",
  "rxcui": "161",
  "atc": ["N02BE01"]
}
```

This allows medicine searches and ingredient lookups to run without making external RxNorm or ATC API requests during runtime.
