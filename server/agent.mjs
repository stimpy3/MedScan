import { Ollama } from "@langchain/ollama";
import readline from "readline";
import { handleToolOrchestration } from "./toolAgent.mjs";
import { classifyRisk, determineMinimumRiskLevel } from "./tools/classifier.mjs";
import {
  addOrUpdateTopic,
  evaluateSymptomType,
  extractSymptomInfo,
  getAllTopics,
  getCurrentTopic,
  getTopicCount,
  isEscalation,
  matchTopic,
  removeOldestTopic
} from "./tools/structured-memory.mjs";

const model = new Ollama({
  baseUrl: "http://localhost:11434",
  model: "llama3.1:8b",
  temperature: 0
});

// Raw conversation history (for context)
const rawConversation = [];

// ---------------- MEMORY DISPLAY ----------------
function displayMemory() {
  console.log("\n╔════════════════ STRUCTURED MEMORY ═══════════════╗");
  const topics = getAllTopics();
  if (topics.length === 0) {
    console.log("  (no topics yet)");
  } else {
    topics.forEach((t, i) => {
      console.log(`\n[${i}] Topic: ${t.topic}`);
      console.log(JSON.stringify(t, null, 2));
    });
  }
  console.log("\n💬 Raw Conversation:");
  rawConversation.forEach((msg, i) => {
    const icon = msg.role === "user" ? "👤" : "🤖";
    console.log(`  [${i}] ${icon} ${msg.role}: ${msg.content.substring(0, 60)}...`);
  });
  console.log("─".repeat(70) + "\n");
}

// Check which fields are missing for a topic (async - uses LLM-based type evaluation)
async function getMissingFields(topic) {
  const missing = [];

  // Get primary symptom (from symptoms array or symptom field)
  const primarySymptom = Array.isArray(topic.symptoms) && topic.symptoms.length > 0
    ? topic.symptoms[0]
    : topic.symptom;

  // Symptom is always required
  if (!primarySymptom) {
    missing.push("symptom");
    return missing; // If no symptom, can't determine other requirements
  }

  // Use LLM to determine if location is needed for this symptom
  const typeEval = await evaluateSymptomType(primarySymptom);
  if (typeEval.needsLocation && !topic.location) {
    missing.push("location");
  }

  // Duration and severity always needed
  if (!topic.duration) missing.push("duration");
  if (!topic.severity) missing.push("severity");

  return missing;
}

// Generate questions for missing fields
function generateQuestions(missingFields) {
  const fieldQuestionsMap = {
    symptom: "What symptoms are you experiencing?",
    location: "Where specifically is the issue?",
    duration: "How long has this been happening?",
    severity: "How severe is it (mild/moderate/severe or rate 1-10)?",
  };

  return missingFields.map(f => fieldQuestionsMap[f] || `Tell me about ${f}`);
}

// ---------------- AGENT STEP ----------------
async function agentStep(userInput) {
  rawConversation.push({ role: "user", content: userInput });

  // STEP 0: Tool Orchestration (LLM decides if a tool is needed)
  if (process.env.DEBUG) console.log("--- Tool Checking Pipeline ---");
  const toolResult = await handleToolOrchestration(userInput);
  if (toolResult && toolResult.handled) {
    if (process.env.DEBUG) console.log(`--- Tool Returned Response ---`);
    rawConversation.push({ role: "agent", content: toolResult.response });
    return { classification: null, response: toolResult.response, isToolResponse: true };
  }

  // STEP 1: Classify input to detect if it's medical or just chat
  const initialClassification = await classifyRisk(userInput);

  // STEP 2: Handle non-medical input (like "hello", "hi", "how are you")
  if (initialClassification.risk_level === "not_medical" && !getCurrentTopic()) {
    const genericResponse = "Hello! I'm here to help with medical concerns. Please describe any symptoms or health issues you're experiencing, and I'll do my best to provide guidance.";
    rawConversation.push({ role: "agent", content: genericResponse });
    return { classification: null, response: genericResponse };
  }

  // STEP 3: Medical topic detected or continuing - extract structured info
  const conversationHistory = rawConversation.map(item => ({
    role: item.role === "agent" ? "assistant" : "user",
    content: item.content
  }));

  const extractedInfo = await extractSymptomInfo(userInput, conversationHistory);

  if (process.env.DEBUG) {
    console.log("\n🔍 DEBUG: Extracted info:");
    console.log(JSON.stringify(extractedInfo, null, 2));
  }

  // STEP 4: Determine if this is continuation, escalation, or new topic
  const currentTopic = getCurrentTopic();
  let matchResult = matchTopic(userInput);
  let topicName = matchResult.topicName;
  let isEscalationFlag = false;

  // Check for escalation (new symptom, same condition)
  if (!topicName && currentTopic && extractedInfo.symptom) {
    const escalationCheck = await isEscalation(currentTopic, extractedInfo.symptom);

    if (escalationCheck.isEscalation && escalationCheck.confidence > 0.65) {
      if (process.env.DEBUG) {
        console.log(`\n🚀 ESCALATION DETECTED: ${escalationCheck.reason}`);
      }
      topicName = currentTopic.topic;
      isEscalationFlag = true;
    }
  }

  // If still no topic, create new topic if we extracted a symptom
  if (!topicName && extractedInfo.symptom) {
    topicName = `${extractedInfo.symptom}_${Date.now()}`;
  }

  // If still no topic and no symptom extracted, we can't proceed
  if (!topicName && !extractedInfo.symptom) {
    const clarifyResponse = "I'd like to help, but I need more information. What symptoms or health concerns are you experiencing?";
    rawConversation.push({ role: "agent", content: clarifyResponse });
    return { classification: null, response: clarifyResponse };
  }

  // STEP 5: Enforce max 5 topics - remove oldest if at limit and creating new topic
  const isNewTopic = !currentTopic || (currentTopic && topicName !== currentTopic.topic);
  if (isNewTopic && extractedInfo.symptom) {
    if (getTopicCount() >= 5) {
      const removed = removeOldestTopic();
      if (process.env.DEBUG) {
        console.log(`\n📋 Removed oldest topic to maintain max 5: ${removed?.topic}`);
      }
    }
  }

  // STEP 6: Prepare data for updating topic
  let updateData = { ...extractedInfo };

  // Handle symptoms - support both single symptom and array
  if (isEscalationFlag && currentTopic) {
    // For escalations, add new symptom to existing symptoms array
    const existingSymptoms = Array.isArray(currentTopic.symptoms)
      ? currentTopic.symptoms
      : (currentTopic.symptom ? [currentTopic.symptom] : []);

    updateData.symptoms = [...existingSymptoms, extractedInfo.symptom];
    delete updateData.symptom; // Use symptoms array instead
  } else if (extractedInfo.symptom) {
    // Convert single symptom to array
    updateData.symptoms = [extractedInfo.symptom];
    delete updateData.symptom;
  }

  addOrUpdateTopic({
    topic: topicName,
    ...updateData
  });

  const updatedTopic = getCurrentTopic();

  if (process.env.DEBUG) {
    console.log("\n🔍 DEBUG: Updated topic:");
    console.log(JSON.stringify(updatedTopic, null, 2));
  }

  // STEP 7: Check if we have all required info (dynamic based on topic type)
  const missingFields = await getMissingFields(updatedTopic);

  if (missingFields.length > 0) {
    // Missing info - ask clarifying questions
    const questions = generateQuestions(missingFields);
    const questionsText = questions.join("\n");
    rawConversation.push({ role: "agent", content: questionsText });
    return { classification: null, response: questionsText };
  }

  // STEP 8: All info complete - classify risk with complete information
  const symptomsText = Array.isArray(updatedTopic.symptoms)
    ? updatedTopic.symptoms.join(", ")
    : updatedTopic.symptom;

  const summaryForClassifier = `
Symptoms: ${symptomsText}
${updatedTopic.location ? `Location: ${updatedTopic.location}` : ''}
Duration: ${updatedTopic.duration}
Severity: ${updatedTopic.severity}
${updatedTopic.urgent_signs?.length > 0 ? `Urgent signs: ${updatedTopic.urgent_signs.join(", ")}` : 'Urgent signs: none'}
${updatedTopic.context ? `Context: ${updatedTopic.context}` : ''}
`.trim();

  // STEP 8A: Signal-based risk assessment (no disease hardcoding)
  const minimumRiskLevel = determineMinimumRiskLevel(updatedTopic, isEscalationFlag);

  if (process.env.DEBUG) {
    console.log(`\n🚨 Minimum Risk Level (Signal-Based): ${minimumRiskLevel}`);
  }

  // STEP 8B: LLM-based risk classification with signal-based minimum constraint
  const summaryWithMinimumRisk = `${summaryForClassifier}

CONSTRAINT: Based on accumulated signals (severity, persistence, symptom count), 
the minimum risk level for this case is: ${minimumRiskLevel}
Do NOT classify lower than this minimum if signals indicate ${minimumRiskLevel} or higher.`;

  const finalClassification = await classifyRisk(summaryWithMinimumRisk);

  // STEP 8C: Enforce signal-based minimum risk level
  const riskLevelOrder = ["home_care", "moderate_medical", "urgent_medical"];
  const minRiskIndex = riskLevelOrder.indexOf(minimumRiskLevel);
  const llmRiskIndex = riskLevelOrder.indexOf(finalClassification.risk_level);

  if (llmRiskIndex < minRiskIndex) {
    // LLM classified lower than signal-based minimum - escalate to minimum
    finalClassification.risk_level = minimumRiskLevel;
    if (process.env.DEBUG) {
      console.log(`⚠️  Escalated risk from ${riskLevelOrder[llmRiskIndex]} to ${minimumRiskLevel} due to signal constraints`);
    }
  }

  // STEP 9: Generate final response based on complete structured data
  const systemPrompt = `
You are a medical assistant. Provide guidance based on this patient information:

${JSON.stringify(updatedTopic, null, 2)}

Risk level: ${finalClassification.risk_level}

IMPORTANT:
- Keep response SHORT (2-4 sentences for home_care, 3-5 for moderate/urgent)
- Be direct and actionable
- Include safety warnings if risk is moderate or urgent
- Do NOT diagnose, only provide guidance
${isEscalationFlag ? '- This is an escalation of the existing condition, acknowledge the worsening' : ''}
`;

  const response = await model.invoke([
    { role: "system", content: systemPrompt },
    { role: "user", content: "Provide medical guidance based on the information." }
  ]);

  rawConversation.push({ role: "agent", content: response });

  if (process.env.DEBUG) {
    displayMemory();
  }

  return { classification: finalClassification, response };
}

// ---------------- CLI ----------------
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log("╔════════════════════════════════════════════════════════════════╗");
console.log("║       Medical Symptom Guidance Agent (Topic-Aware v2)         ║");
console.log("╚════════════════════════════════════════════════════════════════╝");
console.log();
console.log("I'm here to help with medical concerns.");
console.log();
console.log("Commands:");
console.log("  /memory  - Show structured memory");
console.log("  /clear   - Clear all memory");
console.log();
console.log("Type your symptoms or say hello to start:");
console.log();

rl.on("line", async (input) => {
  if (input.trim() === "/memory") {
    displayMemory();
    return;
  }
  if (input.trim() === "/clear") {
    rawConversation.length = 0;
    // Clear structured memory
    while (getAllTopics().length) getAllTopics().pop();
    console.log("✅ Memory cleared!");
    return;
  }

  const { classification, response } = await agentStep(input);

  if (classification) {
    console.log("\n--- Classification ---");
    console.log(`Risk Level: ${classification.risk_level}`);
    console.log(`Confidence: ${classification.confidence}`);
    console.log(`Reason: ${classification.reason}`);
  }

  console.log("\n--- Agent Response ---");
  console.log(response);
  console.log("\n" + "─".repeat(70));
  console.log();
});
