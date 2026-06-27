# Chat System Long-Term Workflow & Intent Enhancements

The current chat flow structure effectively identifies intents and gathers prerequisites. As the system scales with new features (Explain, Alternatives, Compare, Schedule), we need a definitive workflow for what happens **after** an answer is generated, allowing smooth transitions between intents.

## Four Primary Intents

1. **Explain Medicine** (`explain_medicine`) — Explain what a medicine is, its composition, side effects, etc.
2. **Find Alternatives** (`find_alternatives`) — Find generic or therapeutic alternatives to a medicine.
3. **Compare Medicines** (`compare_medicines`) — Side-by-side comparison of two medicines.
4. **Schedule Medicine** (`schedule_medicine`) — Set up a schedule or reminder to take a medicine.

## Chat Pipeline

1. **Extract intent** from the user's message.
2. **Extract medicine names** from the user's message (if any are mentioned).
3. **Check prerequisites** for the detected intent and ask for any missing info.
4. **Generate the response** using the database and LLM once all prerequisites are available.

## Post-Answer Flow

1. **Context Retention**: After generating an answer for a specific medicine, that medicine is locked into the session context.
2. **Dynamic Suggestion Generation**: Use the LLM to generate context-aware follow-up questions/actions based on the remaining intents.
   * *Example*: If the user just asked to explain "Aspirin", the system generates 3 follow-up bubbles:
      * "Find cheaper alternatives for Aspirin" (Intent: Find Alternatives)
      * "Compare Aspirin with another medicine" (Intent: Compare Medicines)
      * "Schedule a reminder for Aspirin" (Intent: Schedule Medicine)
3. **Intent Switching**: When a user clicks a suggestion bubble (or types a new request), the intent switches immediately. The system leverages the medicine already stored in context, bypassing extraction and prerequisite phases if already met.

## Intent Prerequisites

| Intent | Required Medicines | Other Requirements |
|---|---|---|
| `explain_medicine` | 1 | — |
| `find_alternatives` | 1 | — |
| `compare_medicines` | 2 | — |
| `schedule_medicine` | 1 | frequency, dosage (future) |

## Output Formats Per Intent

- **Explain Medicine** → `MedicineCard` component (accordion-style card with overview, composition, side effects, manufacturer)
- **Find Alternatives** → `AlternativesCarousel` component (horizontal scrollable cards)
- **Compare Medicines** → Comparison card (side-by-side, TBD)
- **Schedule Medicine** → Confirmation message with schedule details (TBD)
