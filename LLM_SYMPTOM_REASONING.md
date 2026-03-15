# LLM-Based Symptom Relationship Evaluation

## Overview

The medical agent has been refactored to **remove all hardcoded medical knowledge** and instead use **LLM-based semantic reasoning** for determining symptom relationships.

**What was removed:**
- `SYMPTOM_ASSOCIATIONS` constant
- `BODY_SYSTEMS` constant  
- `SYSTEMIC_SYMPTOMS` constant
- `INJURY_SYMPTOMS` constant
- `getPrimaryIllnessCategory()` function
- Hardcoded disease-to-symptom mappings

**What was added:**
- `evaluateSymptomRelationship()` - LLM-based function
- `evaluateSymptomType()` - LLM-based function for location determination
- Updated `isEscalation()` - now uses LLM reasoning
- Updated `getMissingFields()` - now async and LLM-driven

---

## New Functions

### 1. `evaluateSymptomRelationship(previousSymptoms, newSymptom)`

**Purpose:** Determine whether a new symptom is related to previous symptoms using LLM reasoning.

**Input:**
```javascript
evaluateSymptomRelationship(
  ["cold", "body pain"],  // Array of previously reported symptoms
  "fever"                  // New symptom to evaluate
)
```

**Output:**
```json
{
  "relationship": "same_condition" | "escalation" | "new_issue",
  "confidence": 0.95,
  "reason": "Fever is commonly associated with viral infections like cold; represents escalation of systemic symptoms"
}
```

**Relationship Types:**
- `"same_condition"`: New symptom is part of the same underlying process
  - Example: Cough + Sore throat (both respiratory)
  
- `"escalation"`: New symptom represents worsening of existing condition
  - Example: Mild fever → High fever
  
- `"new_issue"`: New symptom appears unrelated, separate health problem
  - Example: Cold → Ankle injury

**LLM Constraints:**
- Temperature = 0 (deterministic output)
- Forbidden: Disease diagnosis
- Forbidden: Attribution to specific illnesses
- Allowed: Clinical co-occurrence patterns, symptom progression typical from medical literature

---

### 2. `evaluateSymptomType(symptom)`

**Purpose:** Determine whether a symptom requires a specific body location.

**Input:**
```javascript
evaluateSymptomType("pain")        // Needs location
evaluateSymptomType("fever")       // Doesn't need location
evaluateSymptomType("chest pain")  // Doesn't need additional location
```

**Output:**
```json
{
  "needsLocation": true,
  "reason": "Pain is non-specific; location is clinically essential"
}
```

**Used In:**
- `getMissingFields()` - determines whether to ask for body location
- Conversation flow - decides which clarifying questions to ask

---

### 3. Updated `isEscalation(existingTopic, newSymptom)`

**Now Async!**

```javascript
const escalationCheck = await isEscalation(topic, "fever");

if (escalationCheck.isEscalation && escalationCheck.confidence > 0.65) {
  // Treat as escalation - add to same topic
}
```

**Behavior:**
1. Checks if symptom is duplicate (same symptom already recorded)
2. Calls `evaluateSymptomRelationship()` with LLM
3. Maps response to escalation decision:
   - `"same_condition"` → isEscalation = true (confidence × 0.9)
   - `"escalation"` → isEscalation = true (confidence × 0.95)
   - `"new_issue"` → isEscalation = false

**Confidence Threshold:** 0.65
- If escalation confidence > 0.65, merge symptoms into same topic
- Otherwise, create new topic

---

### 4. Updated `getMissingFields(topic)` 

**Now Async!**

```javascript
const missing = await getMissingFields(topic);
// Returns: ["location", "duration", "severity"]
```

**Process:**
1. Check if primary symptom exists
2. Call `evaluateSymptomType()` for primary symptom
3. If `needsLocation = true` AND location not collected, add "location" to missing
4. Always ask for duration and severity (fundamental for triage)

**Usage:**
```javascript
const missingFields = await getMissingFields(updatedTopic);

if (missingFields.length > 0) {
  const questions = generateQuestions(missingFields);
  // Ask user for remaining information
}
```

---

## Data Flow

### Example: Cold → Body Pain → Fever

**Conversation:**
```
User: "I have a cold"
Agent: Extracts symptom="cold", asks for duration/severity

User: "since yesterday"
Agent: Records duration, still need severity

User: "maybe a 5"
Agent: All info complete, provides guidance

User: "now I also have body pain"
Agent: 
  1. Extracts symptom="body pain"
  2. Calls evaluateSymptomRelationship(["cold"], "body pain")
  3. LLM returns: {relationship: "same_condition", confidence: 0.92}
  4. escalationCheck.confidence (0.92 × 0.9 = 0.828) > 0.65 ✓
  5. Merges: symptoms = ["cold", "body pain"]
  6. Same topic continues
  7. Re-checks missing fields (location needed? LLM evaluates)

User: "and I have a fever"
Agent:
  1. Extracts symptom="fever"
  2. Calls evaluateSymptomRelationship(["cold", "body pain"], "fever")
  3. LLM returns: {relationship: "escalation", confidence: 0.95}
  4. escalationCheck.confidence (0.95 × 0.95 = 0.9025) > 0.65 ✓
  5. Merges: symptoms = ["cold", "body pain", "fever"]
  6. Risk re-classified (multiple symptoms = higher severity)
  7. Response acknowledges escalation
```

---

## LLM Prompts

### evaluateSymptomRelationship Prompt

```
You are a medical triage assistant analyzing symptom relationships.

Your task: Determine if a new symptom is related to existing symptoms.

You are analyzing:
- Previous symptoms reported: [symptoms join]
- New symptom reported: [newSymptom]

CRITICAL RULES:
1. Do NOT diagnose diseases or conditions
2. Do NOT attribute symptoms to specific illnesses
3. Focus ONLY on whether symptoms typically co-occur or form a progression
4. Consider clinical co-occurrence patterns from medical literature
5. Look for signs of escalation

Classify the new symptom as ONE of:
- "same_condition": symptoms typically go together
- "escalation": worsening of existing condition
- "new_issue": unrelated health problem

Respond ONLY with valid JSON:
{
  "relationship": "same_condition" | "escalation" | "new_issue",
  "confidence": 0.0 to 1.0,
  "reason": "Brief clinical reasoning (max 2 sentences)"
}
```

### evaluateSymptomType Prompt

```
You are a medical assistant analyzing symptoms.

Determine if a symptom requires a specific body location.

Examples:
- "fever" → does NOT need location (whole-body)
- "pain" → DOES need location (must know WHERE)
- "chest pain" → does NOT need additional location (already specified)
- "cough" → does NOT need location (respiratory, whole-body)
- "swelling" → DOES need location (where is it swelling?)

Symptom to evaluate: "[symptom]"

Respond ONLY with valid JSON:
{
  "needsLocation": true | false,
  "reason": "Brief explanation"
}
```

---

## Hard Rules Preserved

**Body-part mismatch for new topics:** ✓ Still enforced

```javascript
// In matchTopic() - still a hard rule
if (mentionedBodyPart && currentTopic.location && 
    mentionedBodyPart !== currentTopic.location.toLowerCase() &&
    (input.includes('hurt') || input.includes('injury'))) {
  return { matched: false };  // Different body part = new topic
}
```

This means:
- Cold (respiratory) → Ankle pain (localized injury) = **NEW TOPIC** ✓
- NOT subject to LLM relationship evaluation due to location mismatch

---

## Testing

### Run with Debug Output
```bash
DEBUG=1 node agent.mjs
```

**Debug output shows:**
```
🔍 DEBUG: Extracted info
🚀 ESCALATION DETECTED: [reason from LLM]
🔍 DEBUG: Updated topic
📋 Removed oldest topic
```

### Test Scenarios

#### Scenario 1: Escalation (Same Topic)
```
User: "I have a cold and body pain with a 5 severity since yesterday"
User: "now I have a fever"
Expected: Merged into symptoms array, risk level increased
```

#### Scenario 2: New Topic (Different Body Part)
```
User: "I have a cold since yesterday, severity 5"
User: "my ankle hurts"
Expected: New topic created, hard rule triggered
```

#### Scenario 3: Unrelated Symptom
```
User: "I feel nauseous since this morning"
User: "also my back hurts in the upper left"
Expected: LLM evaluates relationship, likely new topic if truly unrelated
```

---

## Performance Considerations

### LLM Calls per Interaction
- `evaluateSymptomRelationship()` - called when new symptom might be related
- `evaluateSymptomType()` - called once per missing field check

**Total:** 1-2 LLM calls per escalation evaluation

### Optimization Tips

1. **Cache symptom types** if same symptoms appear multiple times:
   ```javascript
   const symptomTypeCache = {};
   ```

2. **Batch evaluate** if implementing multi-turn evaluations

3. **Local fallback** if needed for latency:
   - Default to `needsLocation = true` for safety if LLM is slow
   - Default to `relationship = "new_issue"` if LLM fails

---

## Migration Notes

### From Hardcoded System

**Old:**
```javascript
if (SYMPTOM_ASSOCIATIONS["cold"].includes("fever")) {
  // fever is associated with cold
}
```

**New:**
```javascript
const relationship = await evaluateSymptomRelationship(["cold"], "fever");
if (relationship.relationship === "same_condition") {
  // LLM determined fever is related to cold
}
```

### Backwards Compatibility

- `getIllnessCategory()` still exists but is deprecated
- All topic memory structures unchanged
- Body-part matching logic preserved
- Conversation flow preserved

---

## Safety Features

1. **Confidence thresholds:** Only merge if LLM confidence > 0.65
2. **Error handling:** Defaults to "new_issue" if LLM evaluation fails
3. **Body-part hard rule:** Prevents dangerous merging of unrelated body systems
4. **Temperature = 0:** Consistent, deterministic LLM outputs
5. **Prompt constraints:** Explicitly forbids diagnosis

---

## Future Improvements

1. **Symptom clustering:** Group related symptoms for faster evaluation
2. **Conversation history context:** Use more history for better LLM decisions
3. **Multi-language support:** LLM naturally supports multiple languages
4. **Risk escalation tracking:** Record symptom progression over time
5. **Medical knowledge updates:** LLM stays current without code changes
