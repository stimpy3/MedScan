// server/controllers/intent.controller.js
const { classifyIntent, checkIntentDrift } = require("../services/intent.service");
const { extractMedicines, resolveComparePair, resolveImageMedicines } = require("../services/medicineExtraction.service");
const { getSession, updateSession } = require("../services/session.service");
const { generateSuggestions } = require("../services/suggestions.service");
const registry = require("../handlers/registry");

// The four things the assistant can do — offered when an image arrives with no stated goal.
const INTENT_OPTIONS = [
  { intent: "explain_medicine", label: "Explain" },
  { intent: "compare_medicines", label: "Compare" },
  { intent: "find_alternatives", label: "Find alternatives" },
  { intent: "schedule_medicine", label: "Schedule" },
  { intent: "check_availability", label: "Check availability" },
];

// ── Shared tail: check prerequisites, then run the handler (or ask for what's missing) ──────────
// Used by the normal classify path AND the image intent-pick path so both behave identically:
// compare-needs-2 / pick-2-of-many / "which medicine?" disambiguation / missing-prompt / run.
async function finalize({ res, sessionId, session, currentIntent, intentConfident, namedMedicineThisTurn, intentSwitched }) {
  const handler = registry[currentIntent];
  if (!handler) {
    return res.json({
      intent: currentIntent,
      confident: intentConfident,
      reply: "I'm not sure how to help with that. Try asking me to explain a medicine, find alternatives, compare two medicines, or set up a schedule.",
      status: "missing_info",
      medicines: session.prerequisites.medicines
    });
  }
  const requiredMedicines = handler.prerequisites?.medicines ?? 1;

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

  const ctx = {
    medicines: session.prerequisites.medicines,
    focusedMedicine: session.focusedMedicine || null,
    frequency: session.prerequisites.frequency,
    dosage: session.prerequisites.dosage,
    pincode: session.prerequisites.pincode || null,
    subField: session.explainSubField || null, // explain_medicine only; other handlers ignore it
    safetyContext: session.safetyContext || null
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

  // Pincode prerequisite: ask if the handler requires it and it's not in session.
  if (handler.prerequisites?.pincode && !ctx.pincode) {
    const reply = handler.pincodePrompt ? handler.pincodePrompt(ctx) : "What's your pincode?";
    updateSession(sessionId, { stage: "awaiting_pincode" });
    console.log(`[IntentController] Missing pincode → "${reply}"`);
    console.log("========================================\n");
    return res.json({
      intent: currentIntent,
      confident: intentConfident,
      reply,
      status: "missing_info",
      medicines: ctx.medicines
    });
  }

  // Vague request: an intent switch without naming a medicine, when several are known → let them choose.
  if (!namedMedicineThisTurn && intentSwitched && requiredMedicines === 1 && ctx.medicines.length > 1) {
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

  // Run the handler.
  const result = await handler.run(ctx);
  const { reply, primaryMedicine, lastAlternatives, extraSuggestions, ...responsePayload } = result;

  if (primaryMedicine) {
    updateSession(sessionId, { focusedMedicine: primaryMedicine });
  }
  const newAlternatives = lastAlternatives || [];
  updateSession(sessionId, {
    stage: "completed",
    lastAlternatives: newAlternatives,
    lastAlternativesAnchor: newAlternatives.length ? (primaryMedicine || null) : null
  });

  let suggestions;
  if (handler.generatesSuggestions) {
    suggestions = await generateSuggestions({
      lastIntent: currentIntent,
      activeMedicines: ctx.medicines,
      focusedMedicine: primaryMedicine || ctx.focusedMedicine || null,
      lastAlternatives: lastAlternatives || []
    });
  }
  // Handler-provided bubbles (e.g. "View full details" after a targeted answer) come first.
  if (extraSuggestions?.length) suggestions = [...extraSuggestions, ...(suggestions || [])];

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
}

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
    const { sessionId, message, history, action, ocr, safetyContext } = req.body;
    console.log("\n========================================");
    console.log("[IntentController] incoming request", {
      sessionId,
      message,
      historyLength: Array.isArray(history) ? history.length : 0,
      action: action?.type || "none",
      ocr: ocr ? `${ocr.documentType} (${(ocr.medicines || []).length} med)` : "none",
      safetyContext: safetyContext ? "present" : "none"
    });

    if (!message && !action && !ocr) {
      return res.status(400).json({ error: "message, action, or ocr is required" });
    }
    if (message && typeof message !== "string") {
      return res.status(400).json({ error: "message must be a string" });
    }

    const session = getSession(sessionId);
    // Always overwrite (never merge) so clearing/switching the active profile client-side
    // clears it here too. Never persisted beyond the in-memory session.
    updateSession(sessionId, { safetyContext: safetyContext || null });

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
        pendingOptions: [],
        explainSubField: null // explicit card view is always the FULL card
      });

      const handler = registry["explain_medicine"];
      if (!handler) return res.status(500).json({ error: "No explain_medicine handler" });

      const ctx = {
        medicines: [med],
        focusedMedicine: med,
        frequency: null,
        dosage: null,
        safetyContext: session.safetyContext || null
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

      const ctx = { medicines: [medA, medB], focusedMedicine: medA, frequency: null, dosage: null, safetyContext: session.safetyContext || null };
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

    if (action?.type === "intent_pick") {
      // User chose what to do after uploading an image (the 4-intent chooser).
      const intent = action.intent;
      if (!intent || !registry[intent]) {
        return res.status(400).json({ error: "intent_pick action requires a valid intent" });
      }
      updateSession(sessionId, { activeIntent: intent, stage: null, explainSubField: null });

      // Pull in the medicines we grounded from the image on the chooser turn.
      const staged = session.imageMedicines || { grounded: [], ambiguous: [] };
      const pool = session.prerequisites.medicines;
      for (const m of staged.grounded) {
        if (!pool.some(p => p.id === m.id)) pool.push(m);
      }
      session.prerequisites.medicines = pool;
      updateSession(sessionId, { prerequisites: session.prerequisites, imageMedicines: null });

      // A detected name still needs disambiguation → resolve it before running.
      if (staged.ambiguous?.length) {
        const amb = staged.ambiguous[0];
        updateSession(sessionId, {
          stage: "awaiting_medicine",
          pendingOptions: amb.options,
          compareExtracted: intent === "compare_medicines" ? pool.slice() : []
        });
        console.log(`[IntentController] Intent picked "${intent}" → clarifying "${amb.query}"`);
        console.log("========================================\n");
        return res.json({
          intent,
          confident: true,
          reply: `Which "${amb.query}" did you mean?`,
          status: "ambiguous",
          medicines: pool,
          medicineOptions: amb.options
        });
      }

      console.log(`[IntentController] Intent picked "${intent}" → finalizing with ${pool.length} medicine(s)`);
      return await finalize({
        res, sessionId, session,
        currentIntent: intent,
        intentConfident: true,
        namedMedicineThisTurn: false, // let the "which one?" picker fire if >1 for a single-medicine intent
        intentSwitched: true
      });
    }

    // ── Step -0.5: Image (OCR) ingestion ─────────────────────────────────────
    // An uploaded image arrives as { ocr: { documentType, medicines, rawText } }, possibly with no
    // message. Ground its medicines into the prerequisite pool, stash the raw text as context, then
    // either ask what to do (no goal yet) or fall through to the normal flow with the pool pre-filled.
    if (ocr) {
      const resolved = await resolveImageMedicines(ocr.medicines || []);
      updateSession(sessionId, {
        imageContext: {
          medicines: ocr.medicines || [], // structured JSON — primary context
          rawText: ocr.rawText || "",      // raw OCR text — secondary context
          documentType: ocr.documentType || "unrelated"
        }
      });

      const totalFound = resolved.grounded.length + resolved.ambiguous.length;
      if (ocr.documentType === "unrelated" || totalFound === 0) {
        console.log("[IntentController] Image had no recognizable medicine");
        console.log("========================================\n");
        return res.json({
          intent: session.activeIntent || null,
          confident: false,
          reply: "I couldn't find a medicine in that image. You can type the name, or try a clearer photo of the label or prescription.",
          status: "no_medicine",
          medicines: session.prerequisites.medicines
        });
      }

      // Add confidently-grounded medicines to the pool now.
      const pool = session.prerequisites.medicines;
      for (const m of resolved.grounded) {
        if (!pool.some(p => p.id === m.id)) pool.push(m);
      }
      session.prerequisites.medicines = pool;
      updateSession(sessionId, { prerequisites: session.prerequisites });

      // No accompanying text and no goal in progress → ask which of the four intents.
      if (!message && (!session.activeIntent || session.stage === "completed" || session.stage == null)) {
        updateSession(sessionId, { imageMedicines: resolved, stage: "awaiting_intent" });
        const found = [...resolved.grounded.map(m => m.name), ...resolved.ambiguous.map(a => a.query)];
        const namesText = found.length ? found.join(" and ") : "a medicine";
        console.log(`[IntentController] Image → asking intent (found: ${namesText})`);
        console.log("========================================\n");
        return res.json({
          intent: null,
          confident: false,
          reply: `I found ${namesText} in your image. What would you like to do?`,
          status: "choose_intent",
          intentOptions: INTENT_OPTIONS,
          medicines: pool
        });
      }

      // There IS text (or an in-progress intent). If a detected name is ambiguous, clarify it first.
      if (resolved.ambiguous.length) {
        const amb = resolved.ambiguous[0];
        updateSession(sessionId, {
          stage: "awaiting_medicine",
          pendingOptions: amb.options,
          compareExtracted: session.activeIntent === "compare_medicines" ? pool.slice() : []
        });
        console.log(`[IntentController] Image + text → clarifying "${amb.query}"`);
        console.log("========================================\n");
        return res.json({
          intent: session.activeIntent || null,
          confident: false,
          reply: `Which "${amb.query}" did you mean?`,
          status: "ambiguous",
          medicines: pool,
          medicineOptions: amb.options
        });
      }
      // else: fall through to normal classification using `message`, pool pre-filled.
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

    // Sub-case C-pre: user is providing their pincode
    if (!selectionResolved && session.stage === "awaiting_pincode") {
      const pincodeMatch = (message || "").match(/\b\d{6}\b/);
      if (pincodeMatch) {
        const pincode = pincodeMatch[0];
        session.prerequisites.pincode = pincode;
        updateSession(sessionId, { stage: null, prerequisites: session.prerequisites });
        selectionResolved = true;
        console.log(`[IntentController] Pincode resolved → ${pincode}`);
      }
      // If no 6-digit number found, fall through — finalize will ask again
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
      // Bubble click carries the intent directly — skip drift. Bubbles are whole-intent
      // actions, so any stale targeted sub-field state must not hijack them.
      currentIntent = action.intent;
      updateSession(sessionId, { explainSubField: null });
      console.log(`[IntentController] Bubble click → intent "${currentIntent}" (skip drift)`);
    } else if (currentIntent && session.stage === "completed") {
      // The current intent has been answered. Only now may the user drift to a different
      // intent — judge whether this new message continues or switches.
      const drift = await checkIntentDrift(currentIntent, message);
      console.log(`[IntentController] Drift check: ${drift.action} (subField: ${drift.subField})`);

      if (drift.action === "switch" || drift.action === "unclear") {
        const classifyHistory = drift.action === "switch" ? [] : history;
        const result = await classifyIntent(message, classifyHistory);
        currentIntent = result.intent;
        intentConfident = result.confident;
        updateSession(sessionId, { explainSubField: currentIntent === "explain_medicine" ? result.subField : null });
        console.log(`[IntentController] Reclassified → "${currentIntent}" (confident: ${intentConfident}, subField: ${result.subField})`);
      } else {
        // "continue" → keep current intent; the follow-up message re-derives the sub-field
        // (e.g. "and its side effects?" → side_effects, "tell me everything" → null).
        updateSession(sessionId, { explainSubField: drift.subField ?? null });
      }
    } else if (currentIntent) {
      // Active intent that hasn't been answered yet (an awaiting_* stage). This message is
      // the answer to what we asked — keep the intent and let extraction pull the medicine.
      // Don't drift-check the answer away. (explainSubField also survives untouched, so
      // "price of almox" → "which one?" → pick still answers just the price.)
      console.log(`[IntentController] Intent "${currentIntent}" still awaiting answer (stage: ${session.stage}) — keeping it, skipping drift`);
    } else {
      const result = await classifyIntent(message, history);
      currentIntent = result.intent;
      intentConfident = result.confident;
      updateSession(sessionId, { explainSubField: currentIntent === "explain_medicine" ? result.subField : null });
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
    // Whether the user explicitly named a medicine in THIS message. Drives the focus change
    // and the "vague request" fallback below (consumed by finalize()).
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

    // ── Step 4.5: Extract pincode if message contains one ───────────────────
    if (currentIntent === "check_availability" && !session.prerequisites.pincode && message) {
      const pincodeMatch = message.match(/\b\d{6}\b/);
      if (pincodeMatch) {
        session.prerequisites.pincode = pincodeMatch[0];
        updateSession(sessionId, { prerequisites: session.prerequisites });
        console.log(`[IntentController] Pincode extracted inline → ${pincodeMatch[0]}`);
      }
    }

    // ── Step 5–7: Check prerequisites, run the handler, emit suggestions ─────
    return await finalize({
      res, sessionId, session,
      currentIntent,
      intentConfident,
      namedMedicineThisTurn,
      intentSwitched
    });

  } catch (err) {
    console.error("❌ Error in intent controller:", err);
    res.status(500).json({ error: "Failed to classify intent" });
  }
}

module.exports = { handleClassify };
