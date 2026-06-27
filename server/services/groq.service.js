const axios = require("axios");

async function chatCompletionJson(messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("GROQ_API_KEY is not defined in the environment variables");
  }

  console.log({
    model: 'llama-3.1-8b-instant',
    messageCount: messages.length,
  });

  const response = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.1-8b-instant",
      messages,
      response_format: { type: "json_object" }
    },
    {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      }
    }
  );

  console.log('groq status', response.status);
  console.log('[GroqService] raw response content', response.data?.choices?.[0]?.message?.content);

  return response.data.choices[0].message.content;
}

module.exports = { chatCompletionJson };
