import { Ollama } from "@langchain/ollama";

const model = new Ollama({
  baseUrl: "http://localhost:11434",
  model: "llama3.1:8b",
  temperature: 0
});

// ---------------- In-memory topic storage ----------------
const topics = [];

/**
 * Evaluate the relationship between previous symptoms and a new symptom using LLM reasoning
 * 
 * Returns: { "relationship": "same_condition" | "escalation" | "new_issue", "confidence": 0-1, "reason": string }
 */
export async function evaluateSymptomRelationship(previousSymptoms, newSymptom) {
  if (!previousSymptoms || previousSymptoms.length === 0 || !newSymptom) {
    return { relationship: "new_issue", confidence: 0, reason: "No previous symptoms to compare" };
  }

  const systemPrompt = `You are a medical triage assistant analyzing symptom relationships.

Your task: Determine if a new symptom is related to existing symptoms.

You are analyzing:
- Previous symptoms reported: ${previousSymptoms.join(", ")}
- New symptom reported: ${newSymptom}

CRITICAL RULES:
1. Do NOT diagnose diseases or conditions
2. Do NOT attribute symptoms to specific illnesses
3. Focus ONLY on whether symptoms typically co-occur or form a progression
4. Consider clinical co-occurrence patterns from medical literature
5. Look for signs of escalation (e.g., symptom severity increasing, new symptoms in typical progression)

Classify the new symptom as ONE of:
- "same_condition": The new symptom is part of the same underlying process (e.g., cough + sore throat both suggest respiratory issue)
- "escalation": The new symptom represents worsening of the existing condition (e.g., mild fever → high fever)
- "new_issue": The new symptom appears unrelated and suggests a separate health problem

Respond ONLY with valid JSON (no markdown, no explanation):
{
  "relationship": "same_condition" | "escalation" | "new_issue",
  "confidence": 0.0 to 1.0,
  "reason": "Brief clinical reasoning (max 2 sentences)"
}`;

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Are these symptoms related?` }
    ]);

    let responseText = typeof response === "string" ? response : response.content || response;

    // Extract JSON from markdown blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/i) 
                   || responseText.match(/```([\s\S]*?)```/);
    if (jsonMatch) {
      responseText = jsonMatch[1].trim();
    } else {
      responseText = responseText.trim();
    }

    const parsed = JSON.parse(responseText);

    // Validate response format
    if (!parsed.relationship || typeof parsed.confidence !== 'number' || !parsed.reason) {
      console.error("⚠️ Invalid response format from evaluateSymptomRelationship:", parsed);
      return { relationship: "new_issue", confidence: 0.3, reason: "Evaluation error - treating as separate issue for safety" };
    }

    return parsed;
  } catch (error) {
    console.error("⚠️ Error evaluating symptom relationship:", error.message);
    return { relationship: "new_issue", confidence: 0.3, reason: "Evaluation failed - treating as separate issue for safety" };
  }
}

/**
 * Evaluate whether a symptom requires a body location to be specified (LLM-based)
 * Returns: { "needsLocation": boolean, "reason": string }
 */
export async function evaluateSymptomType(symptom) {
  if (!symptom) {
    return { needsLocation: false, reason: "No symptom provided" };
  }

  const systemPrompt = `You are a medical assistant analyzing symptoms.

Determine if a symptom requires a specific body location to be clinically meaningful.

Examples:
- "fever" → does NOT need location (it's a whole-body symptom)
- "pain" → DOES need location (must know WHERE the pain is)
- "chest pain" → does NOT need additional location (location is already implied)
- "cough" → does NOT need location (respiratory, whole-body)
- "nausea" → does NOT need location (whole-body)
- "knee swelling" → does NOT need additional location (location already specified)
- "swelling" → DOES need location (must know where the swelling is)

Symptom to evaluate: "${symptom}"

Respond ONLY with valid JSON:
{
  "needsLocation": true | false,
  "reason": "Brief explanation"
}`;

  try {
    const response = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: `Does this symptom need a location?` }
    ]);

    let responseText = typeof response === "string" ? response : response.content || response;

    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/i) 
                   || responseText.match(/```([\s\S]*?)```/);
    if (jsonMatch) {
      responseText = jsonMatch[1].trim();
    } else {
      responseText = responseText.trim();
    }

    const parsed = JSON.parse(responseText);

    if (typeof parsed.needsLocation !== 'boolean') {
      console.error("⚠️ Invalid response format from evaluateSymptomType:", parsed);
      return { needsLocation: true, reason: "Default to asking for location" };
    }

    return parsed;
  } catch (error) {
    console.error("⚠️ Error evaluating symptom type:", error.message);
    return { needsLocation: true, reason: "Default to asking for location" };
  }
}

/**
 * Check if a new symptom is likely an escalation of an existing condition
 * Uses LLM-based semantic reasoning instead of hardcoded rules
 */
export async function isEscalation(existingTopic, newSymptom) {
  if (!existingTopic || !newSymptom) {
    return { isEscalation: false, confidence: 0, reason: "Missing data" };
  }

  const newSymptomLower = newSymptom.toLowerCase().trim();

  // Check if same symptom (not an escalation, just re-stating)
  const existingSymptomArray = Array.isArray(existingTopic.symptoms) 
    ? existingTopic.symptoms 
    : (existingTopic.symptom ? [existingTopic.symptom] : []);
  
  if (existingSymptomArray.some(s => s.toLowerCase().includes(newSymptomLower) || 
                                   newSymptomLower.includes(s.toLowerCase()))) {
    return { isEscalation: false, confidence: 0, reason: "Same symptom already recorded" };
  }

  // Use LLM to evaluate relationship
  const relationshipResult = await evaluateSymptomRelationship(existingSymptomArray, newSymptom);

  if (relationshipResult.relationship === "same_condition") {
    return { 
      isEscalation: true, 
      confidence: relationshipResult.confidence * 0.9,  // Slightly reduce confidence for safety
      reason: `Related symptom: ${relationshipResult.reason}` 
    };
  }

  if (relationshipResult.relationship === "escalation") {
    return { 
      isEscalation: true, 
      confidence: relationshipResult.confidence * 0.95,
      reason: `Escalation detected: ${relationshipResult.reason}` 
    };
  }

  return { 
    isEscalation: false, 
    confidence: 1 - relationshipResult.confidence,
    reason: relationshipResult.reason
  };
}

/**
 * Extract structured information from user input
 */
export async function extractSymptomInfo(userInput, conversationHistory = []) {
  // Detect if this is clearly a NEW symptom (new body part or symptom with "too", "also")
  const input = userInput.toLowerCase();
  const isNewIssue = /\btoo|\balso|\bnow my/i.test(userInput);
  const bodyParts = ['knee', 'elbow', 'head', 'stomach', 'back', 'chest', 
                     'leg', 'arm', 'foot', 'hand', 'neck', 'shoulder', 'ankle', 
                     'wrist', 'hip', 'jaw', 'throat', 'eye', 'ear', 'nose'];
  const mentionedBodyPart = bodyParts.find(part => input.includes(part));
  
  // Build system prompt with guidance on handling new issues
  let systemPrompt = `
You are a medical information extractor.

Review the entire conversation history and current input to extract structured medical information.

Extract these fields ONLY if present and relevant:
- symptom: The main complaint (e.g., "pain", "fever", "cold", "nausea")
- location: Body part ONLY for localized symptoms (e.g., "knee", "elbow", "chest")
- duration: How long (e.g., "2 days", "since yesterday", "1 week")
- severity: How bad (e.g., "mild", "moderate", "severe", "6/10", "6")
- urgent_signs: Array of danger signs (e.g., ["swelling", "fever"])
- context: How it happened (e.g., "fell", "after exercise")

CRITICAL RULES:
1. If user mentions a NEW body part or NEW symptom, treat it as a SEPARATE issue
2. "I hurt my knee" after talking about cold = NEW symptom about knee, NOT related to cold
3. Only combine information if it's clearly about the SAME issue
4. Use null for missing information
5. For systemic symptoms (cold, flu, fever), do NOT add location`;

  // Add special guidance if this appears to be a new issue
  if (isNewIssue && mentionedBodyPart) {
    systemPrompt += `

*** IMPORTANT: The user mentioned "${mentionedBodyPart}" with "too" or "also" ***
This is a SEPARATE complaint about a different body part.
Extract only information about "${mentionedBodyPart}", NOT about previous symptoms.
If extracting about "${mentionedBodyPart}", also include its location.`;
  }

  systemPrompt += `

Respond ONLY in valid JSON (no markdown, no explanations):
{
  "symptom": "string or null",
  "location": "string or null",
  "duration": "string or null",
  "severity": "string or null",
  "urgent_signs": [],
  "context": "string or null"
}`;

  const messages = [
    { role: "system", content: systemPrompt },
    ...conversationHistory.slice(-4), // Only last 2 turns to reduce confusion
    { role: "user", content: userInput }
  ];

  const response = await model.invoke(messages);

  try {
    let responseText = typeof response === "string" ? response : response.content || response;

    // Extract JSON from markdown blocks
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/i) 
                   || responseText.match(/```([\s\S]*?)```/);
    if (jsonMatch) {
      responseText = jsonMatch[1].trim();
    } else {
      responseText = responseText.trim();
    }

    const parsed = JSON.parse(responseText);

    return {
      symptom: parsed.symptom || null,
      location: parsed.location || null,
      duration: parsed.duration || null,
      severity: parsed.severity || null,
      urgent_signs: Array.isArray(parsed.urgent_signs) ? parsed.urgent_signs : [],
      context: parsed.context || null
    };
  } catch (error) {
    console.error("⚠️ Info extraction failed:", error.message);
    if (process.env.DEBUG) {
      console.error("Raw response:", response);
    }
    return {
      symptom: null,
      location: null,
      duration: null,
      severity: null,
      urgent_signs: [],
      context: null
    };
  }
}

/**
 * Add or update a topic in the structured memory
 * Supports both single symptom and multiple symptoms
 */
export function addOrUpdateTopic(topicData) {
  if (!topicData.topic) {
    console.warn("⚠️ Topic data missing 'topic' field");
    return;
  }

  const existingIndex = topics.findIndex(t => t.topic === topicData.topic);

  if (existingIndex >= 0) {
    // Merge existing topic with new data (only update non-null values)
    const updated = { ...topics[existingIndex] };
    Object.keys(topicData).forEach(key => {
      if (topicData[key] !== null && topicData[key] !== undefined) {
        if (key === 'urgent_signs' && Array.isArray(topicData[key])) {
          // Merge urgent signs arrays
          updated[key] = [...new Set([...(updated[key] || []), ...topicData[key]])];
        } else if (key === 'symptoms' && Array.isArray(topicData[key])) {
          // Merge symptoms arrays, avoid duplicates
          const existing = updated[key] || [];
          const merged = [...existing];
          topicData[key].forEach(newSym => {
            if (!merged.some(s => s.toLowerCase() === newSym.toLowerCase())) {
              merged.push(newSym);
            }
          });
          updated[key] = merged;
        } else {
          updated[key] = topicData[key];
        }
      }
    });
    topics[existingIndex] = updated;
  } else {
    // Add new topic
    topics.push(topicData);
  }
}

/**
 * Get all topics from structured memory
 */
export function getAllTopics() {
  return topics;
}

/**
 * Get the current (most recently added/updated) topic
 */
export function getCurrentTopic() {
  return topics.length > 0 ? topics[topics.length - 1] : null;
}

/**
 * Match user input to an existing topic
 * Returns: { matched: boolean, topicName: string|null, isEscalation: boolean }
 */
export function matchTopic(userInput) {
  if (topics.length === 0) return { matched: false, topicName: null, isEscalation: false };

  const input = userInput.toLowerCase().trim();
  const currentTopic = topics[topics.length - 1];

  // List of body parts for new topic detection
  const bodyParts = ['knee', 'elbow', 'head', 'stomach', 'back', 'chest', 
                     'leg', 'arm', 'foot', 'hand', 'neck', 'shoulder', 'ankle', 
                     'wrist', 'hip', 'jaw', 'throat', 'eye', 'ear', 'nose'];

  // Check for explicit new topics (injuries, unrelated body parts)
  const mentionedBodyPart = bodyParts.find(part => input.includes(part));
  if (mentionedBodyPart && currentTopic.location && 
      mentionedBodyPart !== currentTopic.location.toLowerCase() &&
      (input.includes('hurt') || input.includes('injury') || input.includes('pain'))) {
    return { matched: false, topicName: null, isEscalation: false };
  }

  // Check for strong new issue indicators
  const newIssueIndicators = [
    /\bi hurt my/i,
    /\bmy \w+ hurts/i,
    /\bnow my/i,
  ];
  
  const hasNewIssueIndicator = newIssueIndicators.some(pattern => pattern.test(userInput));

  // If has new issue indicator but not following escalation patterns, could be new
  if (hasNewIssueIndicator && !input.includes('also') && !input.includes('too')) {
    return { matched: false, topicName: null, isEscalation: false };
  }

  // Check if input is clearly continuing the same topic (answers questions)
  const continuationPatterns = [
    /^\d+\s*(days?|weeks?|hours?|months?)/i,  // "2 days", "3 weeks"
    /^(mild|moderate|severe)/i,                 // "mild", "severe"
    /^(yes|no|not really|somewhat|pretty)/i,   // "yes", "no"
    /^\d+\s*(out of)?\s*10/i,                   // "6 out of 10", "7/10"
    /^(since|for|about|since yesterday)/i,      // "since yesterday"
    /^(it|the|that|they|and|but)/i              // "it hurts", "the pain", "and"
  ];
  
  const isContinuation = continuationPatterns.some(pattern => pattern.test(input));
  
  if (isContinuation) {
    return { matched: true, topicName: currentTopic.topic, isEscalation: false };
  }

  // Default: don't match for now, but we'll check escalation later
  return { matched: false, topicName: null, isEscalation: false };
}

/**
 * Get the count of topics in memory
 */
export function getTopicCount() {
  return topics.length;
}

/**
 * Remove the oldest topic to maintain max 5 topics limit
 */
export function removeOldestTopic() {
  if (topics.length > 0) {
    const removed = topics.shift();
    return removed;
  }
  return null;
}

/**
 * Get the primary illness category for a symptom
 * DEPRECATED: Use evaluateSymptomRelationship() instead for LLM-based reasoning
 */
export function getIllnessCategory(symptom) {
  // Placeholder - no longer supported
  // Use evaluateSymptomRelationship() for symptom relationship analysis
  return null;
}
