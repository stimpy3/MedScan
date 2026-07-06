// Checks 1mg availability for a medicine at a given pincode.
// Uses 1mg's internal API (drug_page endpoint) — no API key required,
// but rate-limit gracefully: one call per user request.
const { matchOneMg } = require("./oneMgMatch.service");

const TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(id);
  }
}

// Returns { available, price, mrp, deliveryDays, url, matchedName } or null on failure.
async function checkAvailability(medicineName, pincode) {
  const match = matchOneMg(medicineName);
  if (!match || match.score < 0.3) return null;

  const drugId = match.url.match(/\-(\d+)$/)?.[1];
  if (!drugId) return null;

  const productUrl = match.url;

  try {
    // 1mg's internal drug page API — returns SKU availability keyed by drug id
    const apiUrl = `https://www.1mg.com/api/1.0/drug_page/?id=${drugId}&pincode=${pincode}`;
    const res = await fetchWithTimeout(apiUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
        "Referer": "https://www.1mg.com/"
      }
    });

    if (!res.ok) {
      // API may have changed — fall back to a minimal response with just the link
      return {
        available: null,
        price: null,
        mrp: null,
        deliveryDays: null,
        url: productUrl,
        matchedName: match.key
      };
    }

    const json = await res.json();
    const data = json?.data || json;

    // Parse the fields 1mg returns — field names may vary; extract what we can
    const price = data?.selling_price ?? data?.price ?? null;
    const mrp = data?.mrp ?? null;
    const available = data?.is_available ?? data?.available ?? (price != null ? true : null);
    const deliveryDays = data?.delivery_days ?? data?.delivery ?? null;

    return {
      available,
      price: price != null ? Number(price) : null,
      mrp: mrp != null ? Number(mrp) : null,
      deliveryDays,
      url: productUrl,
      matchedName: match.key
    };
  } catch (err) {
    // Network error / abort — still return the link so the user can check manually
    return {
      available: null,
      price: null,
      mrp: null,
      deliveryDays: null,
      url: productUrl,
      matchedName: match.key
    };
  }
}

module.exports = { checkAvailability };
