//server/tools/clarification.mjs
import { Ollama } from "@langchain/ollama";
import { classifyRisk } from "./classifier.mjs";
import { getCurrentTopic } from "./structured-memory.mjs";

const model = new Ollama({
  baseUrl: "http://localhost:11434",
  model: "llama3.1:8b",
  temperature: 0
});

export async function checkClarification(userInput, conversationHistory = []) {
  // Step 1: Check if there's a topic already
  let topic = getCurrentTopic();

  // Step 2: If no topic, try to classify the input
  if (!topic) {
    const classificationSummary = await classifyRisk(userInput);
    if (!classificationSummary || classificationSummary.risk_level === "not_medical") {
      // Interrupt: no medical topic detected
      return {
        needs_clarification: false,
        questions: ["Please describe your medical concern or symptoms so I can assist you."]
      };
    }
  }

  // Step 3: Only continue with topic-based follow-ups if a valid topic exists
  topic = topic || getCurrentTopic();
  const fieldsToCheck = [];

  if (!topic) return { needs_clarification: false, questions: [] }; // safety fallback

  // Determine missing fields dynamically based on topic type
  if ((topic.location === undefined || topic.location === null) &&
      topic.symptom && !["cold", "flu", "fever", "headache"].includes(topic.symptom.toLowerCase())) {
    fieldsToCheck.push("location");
  }
  if (topic.duration === undefined || topic.duration === null) fieldsToCheck.push("duration");
  if (topic.severity === undefined || topic.severity === null) fieldsToCheck.push("severity");
  if (!topic.urgent_signs || topic.urgent_signs.length === 0) fieldsToCheck.push("urgent_signs");

  if (fieldsToCheck.length === 0) return { needs_clarification: false, questions: [] };

  const fieldQuestionsMap = {
    location: "Where specifically is the issue?",
    duration: "How long has this been happening?",
    severity: "How severe is it (mild/moderate/severe or 1-10)?",
    urgent_signs: "Have you noticed any urgent signs (swelling, bleeding, difficulty moving, fever)?"
  };
  const questions = fieldsToCheck.map(f => fieldQuestionsMap[f]);

  return {
    needs_clarification: true,
    questions
  };
}
