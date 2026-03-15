import { tool } from '@langchain/core/tools';
import { search } from 'duck-duck-scrape';
import { z } from 'zod';
import medicineSearch from '../services/medicineSearch.js';
// Load medicines at startup for the tool
medicineSearch.loadMedicines().catch(console.error);

// 1. Medicine Information Tool (CSV database lookup)
export const medicineInfoTool = tool(
    async ({ medicineName }) => {
        try {
            if (process.env.DEBUG) console.log(`\n🛠️  TOOL CALLED: medicineInfoTool for "${medicineName}"`);
            const result = medicineSearch.searchMedicineByName(medicineName);

            if (!result) {
                return `No exact match found in the medicine database for "${medicineName}".`;
            }

            // Format response safely
            return `
Medicine: ${result.name}
Composition: ${result.salt_composition}
Uses/Description: ${result.medicine_desc || "No description available."}
Side Effects: ${result.side_effects || "None listed."}
Manufacturer: ${result.manufacturer || "Unknown"}
Pack Size: ${result.pack_size || "Unknown"}
Price: ${result.price ? "₹" + result.price : "Unknown"}
`.trim();
        } catch (error) {
            console.error("Error in medicineInfoTool:", error);
            return "An error occurred while searching the medicine database.";
        }
    },
    {
        name: "medicineInfoTool",
        description: "Search for a specific medicine in the local CSV database to get its description, uses, composition, side effects, and price. Use this only for specific medicine queries like 'What is Crocin used for?'.",
        schema: z.object({
            medicineName: z.string().describe("The name of the medicine to search for (e.g., 'Crocin', 'Ambroxol')")
        })
    }
);

// 2. Web Search Tool (fetch general health information)
export const webSearchTool = tool(
    async ({ query }) => {
        try {
            if (process.env.DEBUG) console.log(`\n🛠️  TOOL CALLED: webSearchTool for "${query}"`);
            const searchResults = await search(query + " health or medical advice");
            const results = searchResults.results;

            if (!results || results.length === 0) {
                return "No web search results found. Please consult a doctor.";
            }

            // Get the top 3 results and summarize string
            const summary = results.slice(0, 3).map(r => `- ${r.title}: ${r.description}`).join('\n');
            return `Web search results:\n${summary}\n\nDisclaimer: This is from web search. Always consult a real doctor for serious issues.`;
        } catch (error) {
            console.error("Error in webSearchTool:", error);
            return "Web search failed. Could not fetch health information right now.";
        }
    },
    {
        name: "webSearchTool",
        description: "Perform a web search to fetch general health information, lifestyle advice, or home remedies. This is useful for general queries like 'I have a headache for two days, what should I do?'.",
        schema: z.object({
            query: z.string().describe("The medical or health-related query to search the web for")
        })
    }
);

// 3. Calendar Reminder Tool (schedule medication reminders)
export const calendarReminderTool = tool(
    async ({ medicineName, timeOfTaking, intervalHours }) => {
        try {
            if (process.env.DEBUG) console.log(`\n🛠️  TOOL CALLED: calendarReminderTool for "${medicineName}"`);

            // We generate a Google Calendar template link
            const text = encodeURIComponent(`Take Medicine: ${medicineName}`);
            let details = encodeURIComponent(`Reminder to take your medicine: ${medicineName}.`);

            if (intervalHours) {
                details += encodeURIComponent(`\nPlease take this every ${intervalHours} hours.`);
            }

            // Simple date format for Google Calendar (assuming it starts tomorrow at the given time/timezone)
            // Format: YYYYMMDDTHHmmssZ
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);

            // Dummy fixed time approach or just using action=TEMPLATE which lets the user pick the starting time easily.
            const gcalLink = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${text}&details=${details}`;

            return `I have created a calendar reminder for your medication. Click this link to add it to your Google Calendar:\n${gcalLink}`;
        } catch (error) {
            return "Could not create the calendar reminder.";
        }
    },
    {
        name: "calendarReminderTool",
        description: "Schedule a medication reminder for the user by creating a Google Calendar event link. Use this when the user asks to be reminded to take a medicine.",
        schema: z.object({
            medicineName: z.string().describe("The name of the medicine to remind the user about"),
            timeOfTaking: z.string().optional().describe("The time of day the medicine should be taken (e.g., '9 PM')"),
            intervalHours: z.number().optional().describe("If the medicine needs to be taken multiple times, the interval in hours")
        })
    }
);

export const agentTools = [medicineInfoTool, webSearchTool, calendarReminderTool];
