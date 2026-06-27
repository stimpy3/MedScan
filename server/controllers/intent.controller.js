// server/controllers/intent.controller.js
const { classifyIntent, checkIntentDrift } = require("../services/intent.service");
const { extractMedicines, resolveComparePair } = require("../services/medicineExtraction.service");
const { getSession, updateSession } = require("../services/session.service");
const { generateSuggestions } = require("../services/suggestions.service");
const registry = require("../handlers/registry");

// ── Compare slot-flow helper ──────────────────────────────────────────────────
// Drives the "compare from scratch" flow with grounded slot resolution. Given the message,
// resolves up to 2 medicine slots and decides what to do:
//   • returns a response object (caller does res.json) for the ask / clarify / dual-picker cases, OR
//   • returns null after committing a ready 2-medicine pair to session.prerequisites.medicines,
//     so the main flow falls through to the compare handler run.
async function resolveCompareFlow({ sessionId, session, message, intentConfident }) {
  const { slots } = await resolveComparePair(message);
  // When we explicitly asked for the FIRST medicine, ignore any stale focus as a pairing anchor.
  const contextMed = session.stage === "awaiting_compare_medicine_1"
    ? null
    : (session.focusedMedicine || null);

  const confident = slots.filter(s => s.status === "confident").map(s => s.medicine);
  const ambiguous = slots.filter(s => s.status === "ambiguous");

  const commitPair = (a, b) => {
    session.prerequisites.medicines = [a, b];
    updateSession(sessionId, {
      prerequisites: session.prerequisites,
      stage: null, pendingOptions: [], compareAnchor: null, compareExtracted: []
    });
    return null; // fall through to handler run
  };

  const askForSecond = (firstMed) => {
    session.prerequisites.medicines = [firstMed];
    updateSession(sessionId, {
      stage: "awaiting_compare_medicine_2",
      compareExtracted: [firstMed],
      prerequisites: session.prerequisites,
      pendingOptions: []
    });
    return {
      intent: "compare_medicines",
      confident: intentConfident,
      reply: `What do you want to compare **${firstMed.name}** against?`,
      status: "missing_info",
      medicines: [firstMed]
    };
  };

  // ── 2 medicine references in this message ──
  if (slots.length === 2) {
    if (ambiguous.length === 0) {
      return commitPair(confident[0], confident[1]);
    }
    if (ambiguous.length === 1) {
      // One side resolved, the other ambiguous → stash the sure one, clarify the other (single col).
      updateSession(sessionId, {
        stage: "awaiting_medicine",
        pendingOptions: ambiguous[0].options,
        compareExtracted: [confident[0]]
      });
      return {
        intent: "compare_medicines",
        confident: intentConfident,
        reply: `Which "${ambiguous[0].query}" did you mean? (comparing with ${confident[0].name})`,
        status: "ambiguous",
        medicines: session.prerequisites.medicines,
        medicineOptions: ambiguous[0].options
      };
    }
    // Both ambiguous → side-by-side dual picker; nothing committed until the user taps Compare.
    updateSession(sessionId, { stage: "awaiting_compare_dual", pendingOptions: [] });
    return {
      intent: "compare_medicines",
      confident: intentConfident,
      reply: "I found a few matches for each — pick one from each side, then tap Compare.",
      status: "awaiting_compare_dual",
      medicines: session.prerequisites.medicines,
      compareClarify: {
        a: { query: ambiguous[0].query, options: ambiguous[0].options },
        b: { query: ambiguous[1].query, options: ambiguous[1].options }
      }
    };
  }

  // ── 1 medicine reference in this message ──
  if (slots.length === 1) {
    const slot = slots[0];
    if (slot.status === "confident") {
      const med = slot.medicine;
      if (contextMed && contextMed.id !== med.id) return commitPair(contextMed, med);
      return askForSecond(med);
    }
    // Ambiguous single reference → clarify it (single column). If a context medicine exists, stash
    // it so the pick pairs straight into a comparison; otherwise the pick becomes the 1st medicine.
    updateSession(sessionId, {
      stage: "awaiting_medicine",
      pendingOptions: slot.options,
      compareExtracted: contextMed ? [contextMed] : []
    });
    return {
      intent: "compare_medicines",
      confident: intentConfident,
      reply: contextMed
        ? `Which "${slot.query}" did you mean? (comparing with ${contextMed.name})`
        : `Which "${slot.query}" did you mean?`,
      status: "ambiguous",
      medicines: session.prerequisites.medicines,
      medicineOptions: slot.options
    };
  }

  // ── 0 medicine references in this message ──
  if (contextMed) return askForSecond(contextMed);
  updateSession(sessionId, { stage: "awaiting_compare_medicine_1", compareExtracted: [], pendingOptions: [] });
  return {
    intent: "compare_medicines",
    confident: intentConfident,
    reply: "Which medicine would you like to compare first?",
    status: "missing_info",
    medicines: session.prerequisites.medicines
  };
}

async function handleClassify(req, res) {
  console.log("\n🔵 [IntentController] REQUEST RECEIVED");
  try {
    const { sessionId, message, history, action } = req.body;
    console.log("\n========================================");
    console.log("[IntentController] incoming request", {
      sessionId,
      message,
      historyLength: Array.isArray(history) ? history.length : 0,
      action: action?.type || "none"
    });

    if (!message && !action) {
      return res.status(400).json({ error: "message or action is required" });
    }
    if (message && typeof message !== "string") {
      return res.status(400).json({ error: "message must be a string" });
    }

    const session = getSession(sessionId);

    // ── Step -1: Explicit UI action dispatch ─────────────────────────────────
    // Card/bubble clicks carry deterministic intent — bypass drift pipeline entirely.

    if (action?.type === "card_explain") {
      // User tapped "VIEW DETAILS" on an alternative card — inject the card's medicine directly.
      const m = action.medicine;
      if (!m?.name) {
        return res.status(400).json({ error: "card_explain action requires medicine.name" });
      }
      const med = { id: m.id || m.name, name: m.name };
      session.prerequisites.medicines = [med];
      updateSession(sessionId, {
        activeIntent: "explain_medicine",
        prerequisites: session.prerequisites,
        stage: null,
        pendingOptions: []
      });

      const handler = registry["explain_medicine"];
      if (!handler) return res.status(500).json({ error: "No explain_medicine handler" });

      const ctx = {
        medicines: [med],
        focusedMedicine: med,
        frequency: null,
        dosage: null
      };
      const result = await handler.run(ctx);
      const { reply, primaryMedicine, lastAlternatives, ...responsePayload } = result;
      if (primaryMedicine) updateSession(sessionId, { focusedMedicine: primaryMedicine });
      // Viewing details of an alternative must NOT erase the alternatives context — a
      // following "Compare" tap still needs the original anchor + the other alternatives.
      // Only overwrite lastAlternatives if this handler actually produced a new set.
      const explainCompletion = { stage: "completed" };
      if (lastAlternatives !== undefined) explainCompletion.lastAlternatives = lastAlternatives;
      updateSession(sessionId, explainCompletion);

      let suggestions;
      if (handler.generatesSuggestions) {
        suggestions = await generateSuggestions({
          lastIntent: "explain_medicine",
          activeMedicines: ctx.medicines,
          focusedMedicine: primaryMedicine || med,
          lastAlternatives: lastAlternatives || []
        });
      }
      console.log(`[IntentController] Completed intent "explain_medicine" (card action)`);
      console.log("========================================\n");
      return res.json({
        intent: "explain_medicine",
        confident: true,
        reply,
        medicines: ctx.medicines,
        ...responsePayload,
        suggestions,
        status: "success"
      });
    }

    if (action?.type === "card_compare") {
      // User tapped "COMPARE" on an alternative card.
      // Anchor = the card clicked. Contenders = original medicine + other shown alternatives.
      const clicked = action.clickedMedicine;
      if (!clicked?.name) {
        return res.status(400).json({ error: "card_compare action requires clickedMedicine.name" });
      }
      const anchor = { id: clicked.id || clicked.name, name: clicked.name };
      // The medicine the alternatives were generated for (e.g. the original searched drug),
      // not focusedMedicine — that may have moved to an alternative via a View-Details tap.
      const original = session.lastAlternativesAnchor || session.focusedMedicine;
      // Contenders = original + the other alternatives, excluding the clicked anchor, deduped by name.
      const seen = new Set([anchor.name.toLowerCase()]);
      const contenders = [];
      for (const c of [original, ...(session.lastAlternatives || [])].filter(Boolean)) {
        const key = c.name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        contenders.push(c);
      }

      updateSession(sessionId, {
        compareAnchor: anchor,
        stage: "awaiting_compare_contender",
        pendingOptions: contenders,
        activeIntent: "compare_medicines"
      });

      console.log(`[IntentController] Card compare → anchor "${anchor.name}", ${contenders.length} contender(s)`);
      console.log("========================================\n");
      return res.json({
        intent: "compare_medicines",
        confident: true,
        reply: `What do you want to compare **${anchor.name}** against?`,
        status: "awaiting_contender",
        compareOptions: contenders,
        medicines: session.prerequisites.medicines
      });
    }

    if (action?.type === "compare_pick") {
      // User resolved a side-by-side dual clarification and tapped Compare. Both medicines are
      // already chosen by id — run the comparison directly, no extraction.
      const a = action.a, b = action.b;
      if (!a?.name || !b?.name) {
        return res.status(400).json({ error: "compare_pick action requires a.name and b.name" });
      }
      const medA = { id: a.id || a.name, name: a.name };
      const medB = { id: b.id || b.name, name: b.name };
      session.prerequisites.medicines = [medA, medB];
      updateSession(sessionId, {
        activeIntent: "compare_medicines",
        prerequisites: session.prerequisites,
        stage: null,
        pendingOptions: [],
        compareAnchor: null,
        compareExtracted: []
      });

      const handler = registry["compare_medicines"];
      if (!handler) return res.status(500).json({ error: "No compare_medicines handler" });

      const ctx = { medicines: [medA, medB], focusedMedicine: medA, frequency: null, dosage: null };
      const result = await handler.run(ctx);
      const { reply, primaryMedicine, lastAlternatives, ...responsePayload } = result;
      if (primaryMedicine) updateSession(sessionId, { focusedMedicine: primaryMedicine });
      updateSession(sessionId, { stage: "completed", lastAlternatives: lastAlternatives || [] });

      let suggestions;
      if (handler.generatesSuggestions) {
        suggestions = await generateSuggestions({
          lastIntent: "compare_medicines",
          activeMedicines: ctx.medicines,
          focusedMedicine: primaryMedicine || medA,
          lastAlternatives: lastAlternatives || []
        });
      }
      console.log(`[IntentController] Compare dual-pick → "${medA.name}" vs "${medB.name}"`);
      console.log("========================================\n");
      return res.json({
        intent: "compare_medicines",
        confident: true,
        reply,
        medicines: ctx.medicines,
        ...responsePayload,
        suggestions,
        status: "success"
      });
    }

    // ── Step 0: Clarification selection lock ──────────────────────────────────
    let selectionResolved = false;
    let currentIntent = session.activeIntent;

    // Sub-case A: user is picking a contender for compare (from card_compare or >2 medicine flow)
    if (
      session.stage === "awaiting_compare_contender" &&
      Array.isArray(session.pendingOptions) &&
      session.pendingOptions.length
    ) {
      const picked = session.pendingOptions.find(
        o => o.name.toLowerCase() === (message || "").trim().toLowerCase()
      );
      if (picked) {
        const anchor = session.compareAnchor;
        session.prerequisites.medicines = anchor ? [anchor, picked] : [picked];
        updateSession(sessionId, {
          stage: null,
          pendingOptions: [],
          compareAnchor: null,
          prerequisites: session.prerequisites,
          activeIntent: "compare_medicines"
        });
        selectionResolved = true;
        currentIntent = "compare_medicines";
        console.log(`[IntentController] Compare contender resolved → "${anchor?.name}" vs "${picked.name}"`);
      }
    }

    // Sub-case B: user is picking from medicine disambiguation options
    if (
      !selectionResolved &&
      session.stage === "awaiting_medicine" &&
      Array.isArray(session.pendingOptions) &&
      session.pendingOptions.length
    ) {
      const picked = session.pendingOptions.find(
        o => o.name.toLowerCase() === (message || "").trim().toLowerCase()
      );
      if (picked) {
        console.log(`[IntentController] Clarification resolved → "${picked.name}" (locked from presented options)`);
        // If we were disambiguating a 2nd compare medicine, combine with compareExtracted
        if (session.compareExtracted?.length > 0) {
          session.prerequisites.medicines = [
            ...session.compareExtracted,
            { id: picked.id, name: picked.name }
          ];
          updateSession(sessionId, {
            stage: null,
            pendingOptions: [],
            prerequisites: session.prerequisites,
            compareExtracted: []
          });
        } else {
          if (!session.prerequisites.medicines.some(m => m.id === picked.id)) {
            session.prerequisites.medicines.push({ id: picked.id, name: picked.name });
          }
          // The medicine the user just picked becomes the focus — this is how a
          // clarification ("explain almox" → pick Amoxyclav 625) actually re-focuses.
          updateSession(sessionId, {
            stage: null,
            pendingOptions: [],
            prerequisites: session.prerequisites,
            focusedMedicine: { id: picked.id, name: picked.name }
          });
          console.log(`[IntentController] Focus changed → "${picked.name}" (clarification pick)`);
        }
        selectionResolved = true;
      }
    }

    // Sub-case C: user is providing the 2nd medicine for a fresh compare
    if (!selectionResolved && session.stage === "awaiting_compare_medicine_2") {
      try {
        const result = await extractMedicines(message);
        if (result.status === "ambiguous" && result.clarification_question) {
          // Show picker for the 2nd medicine; stash the 1st in compareExtracted
          updateSession(sessionId, {
            stage: "awaiting_medicine",
            pendingOptions: result.candidates || [],
            compareExtracted: session.compareExtracted || session.prerequisites.medicines
          });
          console.log("========================================\n");
          return res.json({
            intent: "compare_medicines",
            confident: true,
            reply: result.clarification_question,
            status: "ambiguous",
            medicines: session.prerequisites.medicines,
            medicineOptions: result.candidates || []
          });
        }
        const extracted = result.medicines || [];
        if (extracted.length > 0) {
          const m2 = extracted[0];
          session.prerequisites.medicines = [
            ...(session.compareExtracted || session.prerequisites.medicines),
            m2
          ];
          updateSession(sessionId, {
            stage: null,
            prerequisites: session.prerequisites,
            compareExtracted: []
          });
          selectionResolved = true;
          currentIntent = "compare_medicines";
          console.log(`[IntentController] Compare 2nd medicine resolved → "${m2.name}"`);
        }
        // If extraction found nothing, fall through to normal flow (missingPrompt will fire again)
      } catch (err) {
        console.error("[IntentController] Error extracting 2nd compare medicine:", err);
      }
    }

    // ── Step 1: Resolve intent ────────────────────────────────────────────────
    let intentConfident = true;

    if (selectionResolved) {
      // Keep the active intent — user only disambiguated medicine/contender choice.
      console.log(`[IntentController] Selection locked — keeping intent "${currentIntent}", skipping drift`);
    } else if (action?.type === "bubble") {
      // Bubble click carries the intent directly — skip drift.
      currentIntent = action.intent;
      console.log(`[IntentController] Bubble click → intent "${currentIntent}" (skip drift)`);
    } else if (currentIntent && session.stage === "completed") {
      // The current intent has been answered. Only now may the user drift to a different
      // intent — judge whether this new message continues or switches.
      const driftAction = await checkIntentDrift(currentIntent, message);
      console.log(`[IntentController] Drift check: ${driftAction}`);

      if (driftAction === "switch" || driftAction === "unclear") {
        const classifyHistory = driftAction === "switch" ? [] : history;
        const result = await classifyIntent(message, classifyHistory);
        currentIntent = result.intent;
        intentConfident = result.confident;
        console.log(`[IntentController] Reclassified → "${currentIntent}" (confident: ${intentConfident})`);
      }
      // "continue" → keep current intent
    } else if (currentIntent) {
      // Active intent that hasn't been answered yet (an awaiting_* stage). This message is
      // the answer to what we asked — keep the intent and let extraction pull the medicine.
      // Don't drift-check the answer away.
      console.log(`[IntentController] Intent "${currentIntent}" still awaiting answer (stage: ${session.stage}) — keeping it, skipping drift`);
    } else {
      const result = await classifyIntent(message, history);
      currentIntent = result.intent;
      intentConfident = result.confident;
    }

    // ── Step 2: Intent switch housekeeping ───────────────────────────────────
    const intentSwitched = currentIntent !== session.activeIntent;
    if (intentSwitched) {
      session.prerequisites = {
        medicines: session.prerequisites?.medicines ?? [],
        frequency: null,
        dosage: null
      };
    }
    updateSession(sessionId, { activeIntent: currentIntent });

    // ── Step 3: Look up the handler ──────────────────────────────────────────
    const handler = registry[currentIntent];
    if (!handler) {
      console.warn(`[IntentController] No handler registered for intent: "${currentIntent}"`);
      return res.json({
        intent: currentIntent,
        confident: intentConfident,
        reply: "I'm not sure how to help with that. Try asking me to explain a medicine, find alternatives, compare two medicines, or set up a schedule.",
        status: "missing_info",
        medicines: session.prerequisites.medicines
      });
    }

    // ── Step 4: Extract medicines ────────────────────────────────────────────
    const requiredMedicines = handler.prerequisites?.medicines ?? 1;
    // Whether the user explicitly named a medicine in THIS message. Drives the focus change
    // and the "vague request" fallback below.
    let namedMedicineThisTurn = false;

    // A suggestion bubble was generated FOR the medicine currently in focus, so it already refers to
    // a known medicine. Reuse the focused medicine directly instead of re-extracting from the bubble's
    // wordy text ("Find generic X alternatives") — that text can mis-resolve to an ambiguous
    // clarification and pointlessly re-ask. Compare is excluded: its bubble names a 2nd medicine and
    // is handled by the compare resolver below.
    if (action?.type === "bubble" && currentIntent !== "compare_medicines" && !selectionResolved && session.focusedMedicine) {
      const fm = session.focusedMedicine;
      if (!session.prerequisites.medicines.some(m => m.id === fm.id)) {
        session.prerequisites.medicines.push({ id: fm.id, name: fm.name });
      }
      updateSession(sessionId, { prerequisites: session.prerequisites });
      selectionResolved = true;       // skip extraction — the medicine is already known
      namedMedicineThisTurn = true;   // and don't fall into the "vague request" picker
      console.log(`[IntentController] Bubble → reusing focused medicine "${fm.name}", skipping re-extraction`);
    }

    // Compare runs a dedicated grounded slot resolver (handles merged "X vs Y" messages, sequential
    // medicine-1 → medicine-2 asking, single-column clarification, and the dual side-by-side picker).
    if (currentIntent === "compare_medicines" && !selectionResolved && message) {
      const compareResponse = await resolveCompareFlow({ sessionId, session, message, intentConfident });
      if (compareResponse) {
        console.log("========================================\n");
        return res.json(compareResponse);
      }
      // A ready 2-medicine pair was committed to session.prerequisites.medicines — fall through.
    }

    // Always scan the message for a medicine — even when prerequisites are already satisfied —
    // so naming a different medicine ("explain almox" after Novamox) re-focuses onto it.
    // Skip only when the user just picked from an options list (the medicine is already locked).
    if (currentIntent !== "compare_medicines" && !selectionResolved && message) {
      try {
        const extractionResult = await extractMedicines(message);
        console.log("[DEBUG] extractionResult status:", extractionResult.status);
        console.log("[DEBUG] extractionResult medicines count:", extractionResult.medicines?.length || 0);
        console.log("[DEBUG] extractionResult clarification:", extractionResult.clarification_question?.slice(0, 100) || "N/A");

        if (extractionResult.status === "ambiguous" && extractionResult.clarification_question) {
          console.log("[IntentController] Extraction ambiguous — sending clarification");
          updateSession(sessionId, {
            stage: "awaiting_medicine",
            pendingOptions: extractionResult.candidates || []
          });
          console.log("========================================\n");
          return res.json({
            intent: currentIntent,
            confident: intentConfident,
            reply: extractionResult.clarification_question,
            status: "ambiguous",
            medicines: session.prerequisites.medicines,
            medicineOptions: extractionResult.candidates || []
          });
        }

        const extracted = extractionResult.medicines || [];
        console.log(`[IntentController] Extracted ${extracted.length} medicine(s): ${extracted.map(m => m.name).join(", ") || "none"}`);

        // Accumulate into context (dedupe by id) — never replace, so the pool keeps every
        // medicine discussed this session for later vague requests.
        const current = session.prerequisites.medicines;
        for (const med of extracted) {
          if (!current.some(m => m.id === med.id)) current.push(med);
        }
        session.prerequisites.medicines = current;

        if (extracted.length > 0) {
          namedMedicineThisTurn = true;
          // The medicine named this turn becomes the focus (single-medicine intents).
          // Compare keeps its own pairing logic and doesn't move the focus here.
          if (currentIntent !== "compare_medicines") {
            updateSession(sessionId, {
              focusedMedicine: { id: extracted[0].id, name: extracted[0].name },
              prerequisites: session.prerequisites
            });
            console.log(`[IntentController] Focus changed → "${extracted[0].name}" (named in message)`);
          } else {
            updateSession(sessionId, { prerequisites: session.prerequisites });
          }
        } else {
          updateSession(sessionId, { prerequisites: session.prerequisites });
        }
      } catch (err) {
        console.error("[IntentController] Extraction error:", err);
      }
    } else if (selectionResolved) {
      console.log("[IntentController] Selection already locked — skipping extraction");
    }

    // For compare: if accumulated medicines > 2, ask user to pick 2.
    if (currentIntent === "compare_medicines" && session.prerequisites.medicines.length > 2) {
      console.log(`[IntentController] ${session.prerequisites.medicines.length} medicine candidates — asking user to pick 2`);
      updateSession(sessionId, {
        stage: "awaiting_compare_contender",
        pendingOptions: session.prerequisites.medicines,
        compareAnchor: null
      });
      console.log("========================================\n");
      return res.json({
        intent: "compare_medicines",
        confident: intentConfident,
        reply: "Which two medicines would you like to compare?",
        status: "awaiting_contender",
        compareOptions: session.prerequisites.medicines,
        medicines: session.prerequisites.medicines
      });
    }

    console.log(`[IntentController] Medicines (${session.prerequisites.medicines.length}): ${session.prerequisites.medicines.map(m => m.name).join(", ")}`);

    // ── Step 5: Check prerequisites or run handler ───────────────────────────
    const ctx = {
      medicines: session.prerequisites.medicines,
      focusedMedicine: session.focusedMedicine || null,
      frequency: session.prerequisites.frequency,
      dosage: session.prerequisites.dosage
    };

    const nowSatisfied = ctx.medicines.length >= requiredMedicines;

    if (!nowSatisfied) {
      // For compare with exactly 1 medicine: remember it and ask for the 2nd specifically.
      if (currentIntent === "compare_medicines" && ctx.medicines.length === 1) {
        updateSession(sessionId, {
          stage: "awaiting_compare_medicine_2",
          compareExtracted: ctx.medicines
        });
        const reply = `What do you want to compare **${ctx.medicines[0].name}** against?`;
        console.log(`[IntentController] Compare needs 2nd medicine → "${reply}"`);
        console.log("========================================\n");
        return res.json({
          intent: currentIntent,
          confident: intentConfident,
          reply,
          status: "missing_info",
          medicines: ctx.medicines
        });
      }

      const reply = handler.missingPrompt(ctx);
      updateSession(sessionId, { stage: "awaiting_prerequisites" });
      console.log(`[IntentController] Missing prerequisites → "${reply}"`);
      console.log("========================================\n");
      return res.json({
        intent: currentIntent,
        confident: intentConfident,
        reply,
        status: "missing_info",
        medicines: ctx.medicines
      });
    }

    // ── Step 5b: Vague request on an intent switch ───────────────────────────
    // The user switched intents without naming a medicine (e.g. "schedule my medicine").
    // If several medicines are known, don't assume the last focus — let them choose. A
    // same-intent follow-up ("its side effects") falls through and reuses the focus.
    if (
      !namedMedicineThisTurn &&
      intentSwitched &&
      requiredMedicines === 1 &&
      ctx.medicines.length > 1
    ) {
      const options = ctx.medicines.map(m => ({ id: m.id, name: m.name }));
      console.log(`[IntentController] Vague intent switch with ${options.length} known medicines — asking which one`);
      updateSession(sessionId, { stage: "awaiting_medicine", pendingOptions: options });
      console.log("========================================\n");
      return res.json({
        intent: currentIntent,
        confident: intentConfident,
        reply: handler.missingPrompt(ctx) || "Which medicine?",
        status: "ambiguous",
        medicines: ctx.medicines,
        medicineOptions: options
      });
    }

    // ── Step 6: Run the handler ───────────────────────────────────────────────
    const result = await handler.run(ctx);
    const { reply, primaryMedicine, lastAlternatives, ...responsePayload } = result;

    if (primaryMedicine) {
      updateSession(sessionId, { focusedMedicine: primaryMedicine });
    }
    const newAlternatives = lastAlternatives || [];
    updateSession(sessionId, {
      stage: "completed",
      lastAlternatives: newAlternatives,
      // Remember which medicine these alternatives belong to so a later card "Compare"
      // can anchor on it even after a View-Details detour. Clear it when there are none.
      lastAlternativesAnchor: newAlternatives.length ? (primaryMedicine || null) : null
    });

    // ── Step 7: Generate follow-up suggestions ────────────────────────────────
    let suggestions;
    if (handler.generatesSuggestions) {
      suggestions = await generateSuggestions({
        lastIntent: currentIntent,
        activeMedicines: ctx.medicines,
        focusedMedicine: primaryMedicine || ctx.focusedMedicine || null,
        lastAlternatives: lastAlternatives || []
      });
    }

    console.log(`[IntentController] Completed intent "${currentIntent}"`);
    console.log("========================================\n");

    return res.json({
      intent: currentIntent,
      confident: intentConfident,
      reply,
      medicines: ctx.medicines,
      ...responsePayload,
      suggestions,
      status: "success"
    });

  } catch (err) {
    console.error("❌ Error in intent controller:", err);
    res.status(500).json({ error: "Failed to classify intent" });
  }
}

module.exports = { handleClassify };
