# Symptom Escalation Implementation Guide

## Overview
The medical agent now intelligently distinguishes between **symptom escalations** (conditions worsening within the same illness) and **new topics** (unrelated health issues).

---

## What Changed

### 1. **Symptom Association Map** (`structured-memory.mjs`)
Defined medical symptom clusters for common illnesses:
- **Cold**: runny nose, cough, sore throat, congestion, fatigue, body pain, low fever, headache
- **Flu**: high fever, body pain, muscle ache, fatigue, cough, sore throat, headache
- **Gastroenteritis**: nausea, vomiting, diarrhea, stomach pain, fever, body pain

### 2. **Escalation Detection Function** (`isEscalation()`)
Evaluates whether a new symptom is an escalation or new topic:

```javascript
{
  isEscalation: boolean,
  confidence: 0-1,
  reason: string
}
```

**Decision Logic:**
- ✅ **Is Escalation if:**
  - New symptom is in the same illness cluster (e.g., cold → body pain → fever)
  - Confidence > 0.65
  
- ❌ **Is New Topic if:**
  - Different body system affected (respiratory vs digestive)
  - Conflicting onset time/cause
  - Different injury type

### 3. **Enhanced Topic Matching** (`matchTopic()`)
Returns structured matching info:
```javascript
{
  matched: boolean,      // Is continuation of existing topic
  topicName: string,     // Topic identifier
  isEscalation: boolean  // Can be escalation later
}
```

### 4. **Multiple Symptoms Per Topic**
Topics now support a `symptoms` array:
```javascript
{
  topic: "cold_1771156840919",
  symptoms: ["cold", "body pain", "fever"],  // NEW: array of symptoms
  location: null,
  duration: "since yesterday",
  severity: "5/10",
  urgent_signs: [],
  escalation_count: 3
}
```

### 5. **Body Systems Conflict Detection**
Prevents incorrectly merging unrelated symptoms:
- Respiratory: cold, flu, cough, sore throat
- Digestive: nausea, vomiting, diarrhea
- Musculoskeletal: pain, sprain, injury
- Neurological: headache, dizziness

---

## Test Scenarios

### ✅ Scenario 1: Cold Escalation (SHOULD BE ONE TOPIC)
```
User: "I have a cold since yesterday"
Agent: "How severe is it?"

User: "like a 5"
Agent: "Based on your cold..."

User: "now I also have body pain"
Expected: ESCALATION → Add to same topic's symptoms array
Topics: [{ symptoms: ["cold", "body pain"], ... }]

User: "and I have a fever"
Expected: ESCALATION → Add to same topic's symptoms array
Topics: [{ symptoms: ["cold", "body pain", "fever"], ... }]
Risk re-classified to potentially MODERATE_MEDICAL (escalation detected)
```

### ✅ Scenario 2: New Topic (SHOULD BE SEPARATE TOPIC)
```
User: "I have a cold since yesterday"
Agent: "How severe is it? (5/10)"

User: "my ankle hurts too"
Expected: NEW TOPIC → Different body part, not respiratory
Topics: [
  { symptoms: ["cold"], ... },
  { symptoms: ["ankle pain"], location: "ankle", ... }
]
```

### ✅ Scenario 3: Related Digestive Escalation (SHOULD BE ONE TOPIC)
```
User: "I feel nauseous"
Agent: "How long?"

User: "like a 6, started this morning"
Agent: "Got it, tracking your nausea..."

User: "now I have diarrhea too"
Expected: ESCALATION → Both are GI symptoms
Topics: [{ symptoms: ["nausea", "diarrhea"], ... }]
```

---

## How It Works in Agent Flow

### Step-by-Step Escalation Detection:

1. **Extract new symptom** from user input
2. **Check existing topic** for match/continuation
3. **If no match, check escalation:**
   ```javascript
   const escalationCheck = isEscalation(currentTopic, newSymptom);
   if (escalationCheck.isEscalation && escalationCheck.confidence > 0.65) {
     // Use same topic, add symptom to array
     topicName = currentTopic.topic;
     isEscalationFlag = true;
   }
   ```
4. **Update topic** with symptom array (not replacement)
5. **Re-classify risk** with ALL symptoms combined
6. **Generate response** acknowledging escalation

---

## Key Functions

### `isEscalation(existingTopic, newSymptom)`
Determines if new symptom is escalation or new topic.

### `getPrimaryIllnessCategory(symptom)`
Maps symptom to illness type (cold, flu, fever, etc).

### `isSystemicSymptom(symptom)`
Checks if symptom doesn't need location (used for validation).

### Updated `addOrUpdateTopic()`
Now supports `symptoms` array merging:
```javascript
updated.symptoms = [...existing, ...newSymptoms];
// Avoids duplicates
```

---

## Data Structure

### Old (Single Symptom):
```javascript
{
  topic: "cold_...",
  symptom: "cold",
  location: null,
  duration: "since yesterday",
  severity: "5/10"
}
```

### New (Multiple Symptoms):
```javascript
{
  topic: "cold_...",
  symptoms: ["cold", "body pain", "fever"],
  location: null,
  duration: "since yesterday",
  severity: "5/10",
  urgent_signs: []
}
```

**Backwards Compatible:** Code handles both `symptom` (string) and `symptoms` (array).

---

## Configuration

**Confidence Thresholds:**
- `> 0.90`: Very confident escalation (same illness cluster)
- `0.65 - 0.90`: Likely escalation (related symptoms)
- `< 0.65`: Treat as new topic

**Max Topics:** Still 5 (oldest removed when limit exceeded)

---

## Testing the Implementation

### Run in DEBUG mode:
```bash
DEBUG=1 node agent.mjs
```

Output shows:
- 🔍 Extracted symptom info
- 🚀 ESCALATION DETECTED (if applicable)
- 📋 Updated topic structure
- Risk level before/after escalation

### Try these conversations:
1. Cold → Body pain → Fever (escalation)
2. Cold → Ankle injury (new topic)
3. Nausea → Diarrhea → Stomach pain (escalation)
4. Headache → Body pain → Fatigue (escalation/flu)

---

## Medical Safety Notes

- **Escalation = Risk increase:** System automatically re-classifies risk higher
- **Always confirm:** Agent asks clarifying questions only when needed
- **Never diagnose:** Still only performs triage and risk assessment
- **Track changes:** Memory maintains full symptom progression
