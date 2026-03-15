import { ChatOllama } from "@langchain/ollama";
import { agentTools } from "./tools/agentTools.mjs";

const chatModel = new ChatOllama({
    baseUrl: "http://localhost:11434",
    model: "llama3.1:8b",
    temperature: 0
}).bindTools(agentTools);

export async function handleToolOrchestration(userInput) {
    try {
        if (process.env.DEBUG) {
            console.log("\n--------- AGENT REASONING ---------");
            console.log("Analyzing user goal: Does this require external tools?");
        }

        // Step 1: LLM determines if tool is needed
        const response = await chatModel.invoke([
            {
                role: "system", content: `You are an intelligent routing agent.
Your ONLY job is to decide whether to call a tool or pass the message to medical triage.

Available Tools:
1. medicineInfoTool: Search for specific medicine names to get usage, composition, side effects (Examples: "What is Crocin?", "Ambroxol side effects"). 
2. webSearchTool: Look up general health tips, research, and non-diagnostic guidelines on the web (Example: "I have a headache for two days, what should I do?").
3. calendarReminderTool: Create Google Calendar reminders for taking medication.

If the user is ONLY reporting symptoms like "I have a cold and a cough", DO NOT use any tool, let the medical triage handle it!
If the user asks a question about a medicine, wants health advice, or wants a reminder, call the appropriate tool.` },
            { role: "user", content: userInput }
        ]);

        if (response.tool_calls && response.tool_calls.length > 0) {
            const toolCall = response.tool_calls[0];
            if (process.env.DEBUG) {
                console.log(`🤖 Model decides to call: ${toolCall.name}`);
                console.log(`   Arguments: ${JSON.stringify(toolCall.args)}`);
            }

            const tool = agentTools.find(t => t.name === toolCall.name);
            if (tool) {
                // Step 2: Observation (tool execution)
                const observation = await tool.invoke(toolCall.args);

                if (process.env.DEBUG) {
                    console.log(`\n👁️  OBSERVATION FROM TOOL:`);
                    console.log(observation.substring(0, 300) + (observation.length > 300 ? "..." : ""));
                    console.log("\n🧠 Synthesizing final response...");
                }

                // Step 3: Final Response Synthesis
                // Note: For Ollama, we might just pass the tool output directly if it's already well-formatted
                const safeObservationStr = typeof observation === 'string' ? observation : JSON.stringify(observation);

                const finalResponse = await chatModel.invoke([
                    { role: "system", content: "You are a helpful medical assistant. Synthesize the tool observation below into a final, user-friendly response. DO NOT make up any information. If it's a calendar link, be sure to provide the link to the user clearly." },
                    { role: "user", content: userInput },
                    // Instead of complex tool message sequence that Ollama might struggle with, just pass it as system context
                    { role: "system", content: `Tool output: ${safeObservationStr}` }
                ]);

                return { handled: true, response: finalResponse.content };
            }
        }

        if (process.env.DEBUG) {
            console.log("-> No tool needed, routing to medical triage.");
        }
        return { handled: false, response: null };
    } catch (error) {
        console.error("Tool orchestration error:", error);
        return { handled: false, response: null };
    }
}
