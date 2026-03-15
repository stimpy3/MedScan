//server/tools/classifier.mjs
import { Ollama } from "@langchain/ollama";

const model = new Ollama({
  baseUrl: "http://localhost:11434",
  model: "llama3.1:8b",
  temperature: 0
});

// ============ SIGNAL-BASED RISK ASSESSMENT ============

/**
 * Normalize severity from various formats to a 0-10 numeric score
 * Handles: "9/10", "severe", "mild", "7", "moderate", etc.
 */
export function normalizeSeverity(severity) {
  if (!severity) return null;
  
  const lower = String(severity).toLowerCase().trim();
  
  // Extract numeric values (e.g., "9/10", "9 out of 10", "9")
  const numMatch = lower.match(/(\d+)\s*(?:\/|out of)?\s*10?/);
  if (numMatch) {
    const score = parseInt(numMatch[1], 10);
    if (!isNaN(score) && score >= 0 && score <= 10) {
      return score;
    }
  }
  
  // Map text descriptions to numeric scores
  const severityMap = {
    "none": 0,
    "minimal": 1,
    "mild": 2,
    "slight": 2,
    "moderate": 5,
    "medium": 5,
    "fair": 5,
    "bad": 6,
    "severe": 8,
    "terrible": 9,
    "unbearable": 10,
    "excruciating": 10,
  };
  
  if (severityMap.hasOwnProperty(lower)) {
    return severityMap[lower];
  }
  
  // Try partial matching
  for (const [key, value] of Object.entries(severityMap)) {
    if (lower.includes(key)) {
      return value;
    }
  }
  
  return null;
}

/**
 * Detect if a symptom shows persistence (reported duration)
 * Returns: boolean - true if duration data exists, false otherwise
 * 
 * Note: Presence of duration (even "since yesterday") indicates persistence.
 * We don't threshhold on duration length - any duration is a signal.
 */
export function detectPersistence(duration) {
  // Duration exists if it's not null, undefined, or empty string
  return duration !== null && duration !== undefined && String(duration).trim().length > 0;
}

/**
 * Detect if severity is elevated (>= 7/10)
 */
export function isElevatedSeverity(severity) {
  const score = normalizeSeverity(severity);
  return score !== null && score >= 7;
}

/**
 * Detect if severity is high (>= 8/10)
 */
export function isHighSeverity(severity) {
  const score = normalizeSeverity(severity);
  return score !== null && score >= 8;
}

/**
 * Detect if there are urgent signs reported
 */
export function hasUrgentSigns(urgentSigns) {
  return Array.isArray(urgentSigns) && urgentSigns.length > 0;
}

/**
 * Count the number of symptoms reported
 */
export function getSymptomCount(topic) {
  if (Array.isArray(topic.symptoms)) {
    return topic.symptoms.length;
  } else if (topic.symptom) {
    return 1;
  }
  return 0;
}

/**
 * Determine minimum risk level based on accumulated signals
 * Uses: severity, persistence, symptom count, urgent signs, escalation
 * 
 * Returns: risk level ("home_care" | "moderate_medical" | "urgent_medical")
 */
export function determineMinimumRiskLevel(topic, isEscalation = false) {
  const signals = {
    elevatedSeverity: isElevatedSeverity(topic.severity),
    highSeverity: isHighSeverity(topic.severity),
    persistent: detectPersistence(topic.duration),
    multipleSymptoms: getSymptomCount(topic) > 1,
    hasUrgentSigns: hasUrgentSigns(topic.urgent_signs),
    isEscalating: isEscalation,
  };

  if (process.env.DEBUG) {
    console.log("\n📊 Risk Signals:");
    console.log(JSON.stringify(signals, null, 2));
  }

  // HIGH RISK: Urgent signs or high severity
  if (signals.hasUrgentSigns || signals.highSeverity) {
    return "urgent_medical";
  }

  // MODERATE RISK: Elevated severity + persistence
  if (signals.elevatedSeverity && signals.persistent) {
    return "moderate_medical";
  }

  // MODERATE RISK: Multiple symptoms + elevated severity
  if (signals.multipleSymptoms && signals.elevatedSeverity) {
    return "moderate_medical";
  }

  // MODERATE RISK: Escalation detected (worsening)
  if (signals.isEscalating) {
    return "moderate_medical";
  }

  // MODERATE RISK: Multiple symptoms + persistence (even if not severe)
  if (signals.multipleSymptoms && signals.persistent) {
    return "moderate_medical";
  }

  // Default: Home care if none of the above
  return "home_care";
}

// ============ RISK CLASSIFICATION ============

export async function classifyRisk(message) {
  const systemPrompt = `
You are a medical triage risk classifier.

Your task is NOT to diagnose.
Your task is ONLY to assess risk severity and urgency.

Classify the user's message into ONE category:
- not_medical
- home_care
- moderate_medical
- urgent_medical
- mental_health_crisis

DECISION RULES:
- Prioritize safety.
- Escalate if unsure.
- Urgent or mental health risk always comes first.

Respond ONLY in valid JSON:
{
  "risk_level": "...",
  "confidence": 0.0-1.0,
  "reason": "short explanation"
}
`;

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: message }
  ]);

  try {
    // Handle both string and object responses
    let responseText = typeof response === 'string' ? response : response.content || response;
    
    // Try to extract JSON from markdown code blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      responseText = jsonMatch[1];
    }
    
    const parsed = JSON.parse(responseText);
    
    // Validate required fields
    if (!parsed.risk_level || typeof parsed.confidence !== 'number') {
      console.error("⚠️ Classifier returned invalid format:", parsed);
      // Default to moderate risk if uncertain
      return {
        risk_level: "moderate_medical",
        confidence: 0.5,
        reason: "Classification failed - defaulting to moderate risk for safety"
      };
    }
    
    return parsed;
  } catch (error) {
    console.error("⚠️ Classifier did not return valid JSON:", response);
    console.error("Error:", error.message);
    // Default to moderate risk for safety
    return {
      risk_level: "moderate_medical",
      confidence: 0.5,
      reason: "Classification parsing failed - defaulting to moderate risk for safety"
    };
  }
}
