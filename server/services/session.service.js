const sessions = new Map();
const IDLE_TTL_MS = 30 * 60 * 1000; // evict sessions idle for 30 min (memory housekeeping only)

function getSession(sessionId) {
  if (!sessionId) return {};
  // Evict stale sessions before lookup so the Map doesn't grow unbounded.
  const existing = sessions.get(sessionId);
  if (existing && existing.lastActiveAt && Date.now() - existing.lastActiveAt > IDLE_TTL_MS) {
    sessions.delete(sessionId);
  }
  if (!sessions.has(sessionId)) {
    sessions.set(sessionId, {
      activeIntent: null,
      stage: null,
      focusedMedicine: null,       // the primary medicine from the last completed response
      explainSubField: null,       // explain_medicine sub-aspect asked for (side_effects/price/…) — null = full card
      lastAlternatives: [],        // { id, name }[] of alternatives from the last find_alternatives run
      lastAlternativesAnchor: null, // { id, name } the medicine those alternatives were generated for
      lastActiveAt: Date.now(),    // for idle eviction
      prerequisites: {
        medicines: [],
        frequency: null,
        dosage: null,
        pincode: null
      },
      compareAnchor: null,         // { id, name } — anchor medicine in an in-progress compare selection
      compareExtracted: [],        // medicines resolved so far in a compare-from-scratch flow
      safetyContext: null          // { profile, currentMedicines, profileHash } — client-supplied, never persisted
    });
  }
  return sessions.get(sessionId);
}

function updateSession(sessionId, updates) {
  if (!sessionId) return;
  const current = getSession(sessionId);
  // Mutate in place instead of creating a new object so that existing
  // references held by the controller remain valid for the full request.
  Object.assign(current, updates, { lastActiveAt: Date.now() });
}

function clearSession(sessionId) {
  if (!sessionId) return;
  sessions.delete(sessionId);
}

module.exports = {
  getSession,
  updateSession,
  clearSession
};
