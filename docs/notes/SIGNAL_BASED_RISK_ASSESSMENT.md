# Signal-Based Risk Assessment

## Overview

Risk level determination now uses **signal combination** instead of disease hardcoding. This approach evaluates multiple objective signals and combines them to determine minimum risk level, independent of diagnosis.

---

## Core Concept

Instead of:
```javascript
// ❌ OLD: Disease-based hardcoding
if (disease === "flu") risk = "moderate_medical";
```

We use:
```javascript
// ✅ NEW: Signal-based reasoning
if (severityScore >= 7 && isPersistent) {
  minimumRiskLevel = "moderate_medical";
}
```

---

## Signal Functions

### 1. **`normalizeSeverity(severity)`**

Converts any severity format to 0-10 numeric score.

**Input Examples:**
- `"9/10"` → 9
- `"moderate"` → 5
- `"8"` → 8
- `"severe"` → 8
- `"mild"` → 2
- `"unbearable"` → 10

**Implementation:**
```javascript
// Step 1: Check for numeric formats
"9/10" or "9 out of 10" or "9" → extract number

// Step 2: Map text severity
{
  "none": 0,
  "minimal": 1,
  "mild": 2,
  "moderate": 5,
  "bad": 6,
  "severe": 8,
  "unbearable": 10
}

// Step 3: Fallback to partial matching
"somewhat severe" → includes "severe" → return 8
```

---

### 2. **`detectPersistence(duration)`**

Detects if symptom has reported duration (indicating persistence).

**Key Insight:**
- Duration presence = persistence signal
- Do NOT threshold on duration length
- "since yesterday" is as valid a signal as "for 3 days"

**Implementation:**
```javascript
// Simple presence check
return duration !== null && 
       duration !== undefined && 
       String(duration).trim().length > 0;
```

**Examples:**
- `null` → false (no duration reported)
- `"since yesterday"` → true (duration exists)
- `"for 3 days"` → true (duration exists)
- `"3"` → true (duration exists)
- `""` → false (empty string)

---

### 3. **`isElevatedSeverity(severity)`**

Returns true if severity score >= 7/10.

```javascript
const score = normalizeSeverity(severity);
return score !== null && score >= 7;
```

**Examples:**
- `"7/10"` → true
- `"severe"` (8) → true
- `"moderate"` (5) → false
- `"9"` → true

---

### 4. **`isHighSeverity(severity)`**

Returns true if severity score >= 8/10.

```javascript
return score >= 8;  // Very high threshold
```

---

### 5. **`hasUrgentSigns(urgentSigns)`**

Checks if any urgent signs were reported.

```javascript
return Array.isArray(urgentSigns) && urgentSigns.length > 0;
```

**Examples of Urgent Signs:**
- Difficulty breathing
- Chest pain
- High fever (> 103°F)
- Severe bleeding
- Loss of consciousness
- Confusion

---

### 6. **`getSymptomCount(topic)`**

Returns number of symptoms reported.

```javascript
if (Array.isArray(topic.symptoms)) {
  return topic.symptoms.length;  // Multiple symptoms: ["cold", "fever", "pain"]
} else if (topic.symptom) {
  return 1;  // Single symptom
}
return 0;
```

---

## Signal Combination Logic

### `determineMinimumRiskLevel(topic, isEscalation)`

Combines all signals to determine **minimum risk level**:
- `"home_care"` - can be managed at home
- `"moderate_medical"` - needs medical attention
- `"urgent_medical"` - needs immediate medical attention

**Signal Matrix:**

| Signals | Decision | Reason |
|---------|----------|--------|
| Has urgent signs | URGENT | Danger signs present |
| High severity (≥ 8) | URGENT | Severity alone warrants escalation |
| Elevated severity (≥ 7) + Persistent | MODERATE | Duration + high severity = concern |
| Multiple symptoms + Elevated severity | MODERATE | Multiple complaints + high severity |
| Escalation detected | MODERATE | Worsening trend = escalation |
| Multiple symptoms + Persistent | MODERATE | Ongoing multi-symptom issue |
| None of above | HOME_CARE | Safe for home management |

**Implementation:**
```javascript
const signals = {
  elevatedSeverity: isElevatedSeverity(topic.severity),
  highSeverity: isHighSeverity(topic.severity),
  persistent: detectPersistence(topic.duration),
  multipleSymptoms: getSymptomCount(topic) > 1,
  hasUrgentSigns: hasUrgentSigns(topic.urgent_signs),
  isEscalating: isEscalation,
};

// Check rules in priority order
if (signals.hasUrgentSigns || signals.highSeverity) {
  return "urgent_medical";
}
if (signals.elevatedSeverity && signals.persistent) {
  return "moderate_medical";
}
if (signals.multipleSymptoms && signals.elevatedSeverity) {
  return "moderate_medical";
}
if (signals.isEscalating) {
  return "moderate_medical";
}
if (signals.multipleSymptoms && signals.persistent) {
  return "moderate_medical";
}
return "home_care";
```

---

## Integration with LLM Classifier

### Three-Step Risk Assessment

**Step 1: Signal-Based Minimum**
```javascript
const minimumRiskLevel = determineMinimumRiskLevel(topic, isEscalation);
// Result: "home_care" | "moderate_medical" | "urgent_medical"
```

**Step 2: LLM Classification (With Constraint)**
```javascript
// Pass minimum as constraint to LLM
const summaryWithMinimumRisk = 
  `${patientSummary}
   
CONSTRAINT: Minimum risk level is: ${minimumRiskLevel}
Do NOT classify lower than this if signals indicate it.`;

const finalClassification = await classifyRisk(summaryWithMinimumRisk);
```

**Step 3: Enforce Minimum Risk**
```javascript
const riskLevelOrder = ["home_care", "moderate_medical", "urgent_medical"];
const minRiskIndex = riskLevelOrder.indexOf(minimumRiskLevel);
const llmRiskIndex = riskLevelOrder.indexOf(finalClassification.risk_level);

if (llmRiskIndex < minRiskIndex) {
  // LLM classified lower than minimum - escalate
  finalClassification.risk_level = minimumRiskLevel;
}
```

**Result:** Risk level is at least as high as signal-based minimum, but may be higher if LLM provides additional context.

---

## Example Scenarios

### Scenario 1: Mild Cold (Home Care)

```
Severity: "mild" → score 2
Duration: "since today"
Symptoms: 1 (cold)
Urgent signs: none
Escalation: no

Signals:
  elevatedSeverity: false  (2 < 7)
  highSeverity: false      (2 < 8)
  persistent: true         (duration exists)
  multipleSymptoms: false  (count = 1)
  hasUrgentSigns: false
  isEscalating: false

Result: home_care ✓
(No rule triggered)
```

### Scenario 2: Severe + Persistent (Moderate Medical)

```
Severity: "8/10"
Duration: "since 3 days"
Symptoms: 1
Urgent signs: none
Escalation: no

Signals:
  highSeverity: true       (8 >= 8) ✓
  persistent: true

Result: urgent_medical ✓
(High severity alone triggers urgent)
```

### Scenario 3: Multiple Symptoms + Escalation (Moderate Medical)

```
Symptoms: ["cold", "fever", "body pain"] (count = 3)
Severity: "6/10"
Duration: "since yesterday"
Escalation: yes

Signals:
  elevatedSeverity: false  (6 < 7)
  highSeverity: false      (6 < 8)
  persistent: true
  multipleSymptoms: true   (count = 3) ✓
  isEscalating: true       ✓

Result: moderate_medical ✓
(Multiple + escalation triggers moderate)
```

---

## Why No Disease Hardcoding?

### Traditional Approach (Bad)
```javascript
if (symptoms.includes("chest pain") && symptoms.includes("shortness of breath")) {
  risk = "urgent_medical"; // Assumed heart attack
}
// But chest pain could be anxiety, muscle strain, etc.
```

### Signal-Based Approach (Good)
```javascript
if (hasUrgentSigns(symptoms) || isHighSeverity(severity)) {
  risk = "urgent_medical"; // Objective danger signals
}
// Works for ANY condition with high severity
```

---

## Testing

### Run with Debug Output
```bash
DEBUG=1 node agent.mjs
```

**Output includes:**
```
📊 Risk Signals:
{
  "elevatedSeverity": true,
  "highSeverity": false,
  "persistent": true,
  "multipleSymptoms": true,
  "hasUrgentSigns": false,
  "isEscalating": false
}

🚨 Minimum Risk Level (Signal-Based): moderate_medical
⚠️  Escalated risk from home_care to moderate_medical due to signal constraints
```

### Test Cases

1. **Normalize Severity**
   ```javascript
   normalizeSeverity("8/10") // 8
   normalizeSeverity("severe") // 8
   normalizeSeverity("5") // 5
   ```

2. **Detect Persistence**
   ```javascript
   detectPersistence("since yesterday") // true
   detectPersistence(null) // false
   detectPersistence("") // false
   ```

3. **Signal Combination**
   ```javascript
   // High severity = urgent
   topic = { severity: "8/10", duration: "today" };
   determineMinimumRiskLevel(topic) // "urgent_medical"
   
   // Multiple + escalation = moderate
   topic = { 
     symptoms: ["cold", "fever"], 
     severity: "6/10", 
     duration: "3 days" 
   };
   determineMinimumRiskLevel(topic, true) // "moderate_medical"
   ```

---

## Configuration

**Severity Thresholds (Customizable):**
```javascript
isElevatedSeverity(severity)  // >= 7
isHighSeverity(severity)      // >= 8

// To change: edit thresholds in these functions
```

**Risk Level Escalation Order:**
```javascript
["home_care", "moderate_medical", "urgent_medical"]
// Can be extended as needed
```

---

## Safety Notes

✅ **Always escalates when signals warrant it**  
✅ **Never de-escalates below signal-based minimum**  
✅ **Works without disease knowledge**  
✅ **Handles any symptom combination**  
✅ **Objective, repeatable decisions**

⚠️ **For demonstration/education only**  
⚠️ **Not a replacement for professional medical judgment**  
⚠️ **Always consult healthcare providers for serious symptoms**
