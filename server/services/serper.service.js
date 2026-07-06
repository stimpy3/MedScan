// server/services/serper.service.js
// Thin wrapper over the Serper.dev Google Search API. Used ONLY by the lazy enrichment
// fallback (lazyEnrichment.service.js) when the offline 1mg index can't resolve a medicine.
// Queries are India-localized; the caller locks them to site:1mg.com.
const axios = require("axios");

async function searchSerper(query, num = 6) {
  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    throw new Error("SERPER_API_KEY is not defined in the environment variables");
  }

  const response = await axios.post(
    "https://google.serper.dev/search",
    { q: query, num, gl: "in", hl: "en" },
    {
      headers: { "X-API-KEY": apiKey, "Content-Type": "application/json" },
      timeout: 15000
    }
  );

  return (response.data?.organic || []).map(r => ({
    title: r.title || "",
    link: r.link || "",
    snippet: r.snippet || ""
  }));
}

module.exports = { searchSerper };
