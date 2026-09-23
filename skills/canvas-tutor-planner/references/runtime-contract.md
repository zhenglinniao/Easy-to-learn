# Easy to learn Tutor runtime contract

Use this reference when planning or reviewing a canvas tutoring result against the production contract.

## Input boundary

- The user chooses `solve`, `hint`, or `explain_step`; the model does not replace that choice. Under Prompt `v3`, `solve` means a complete educational decomposition rather than only solving exercises.
- A request contains selected text and/or a validated PNG/JPEG representation of supported Excalidraw elements.
- `explain_step` includes both the parent tutor-board ID and target step ID. Other modes do not carry that context.
- Missing or unreadable source information must remain explicit; do not fabricate labels or problem conditions.

## Current confirmed mode semantics

- `solve`: classify the selected content and provide the most useful complete educational decomposition. Follow an explicit question; otherwise infer one primary learning goal from the content. When that goal is `solve`, classify the problem as `simple` or `reasoning`; simple problems place the conclusion in the first step, while reasoning problems place it only in the final step.
- `hint`: return exactly three progressive hints without the final numerical answer or complete proof.
- `explain_step`: explain only the specified step while remaining consistent with its parent tutor board.

The Solve answer-placement rule was confirmed on 2026-09-23 in Prompt `v2`. Prompt `v3` retains it for `learningGoal=solve` and adds the user-approved general-content routing, hand-drawn visual-storytelling direction, light-humor boundary, and uncertainty handling. Any additional global teaching-policy constraint requires user confirmation before it enters the production prompt registry.

## Output boundary

Tutor Result V1 contains a title and one or more steps. Each step has a stable ID, title, and one or more blocks. Supported blocks are:

- paragraph;
- KaTeX math;
- ordered or unordered list;
- callout with an approved tone;
- a constrained coordinate-plane, geometry, or flow diagram.

Prompt `v3` results contain `contentProfile.contentKind`, `learningGoal`, `goalSource`, and `confidence`. The server requires this profile for every mode and rejects it on older prompt versions.

Prompt `v2` Solve results contain `answerPresentation.problemType` and `answerPresentation.conclusionPosition`. Prompt `v3` requires the same pair only for full `solve` results whose `learningGoal` is `solve`; non-solution routes, Hint, and Explain step cannot carry it.

The hand-drawn look, stroke animation, mascot, navigation, and reduced-motion behavior remain frontend responsibilities. Model output expresses semantic visual relationships only through the safe blocks below.

The model does not output HTML, arbitrary SVG, CSS, executable animation, URLs, external resources, or UI controls. React components own rendering and navigation. Server code overwrites model, prompt version, and generation time metadata.

## Validation and failure behavior

- The domain Zod schema is the source of truth for shape, size, enum, diagram, and Hint invariants.
- The service performs at most one format-correction attempt after invalid Tutor DSL.
- A valid but pedagogically weak response is an evaluation failure, not a reason to bypass the schema.
- Provider failure may use the configured fallback chain; invalid lesson content does not silently switch providers.

Implementation sources:

- `packages/domain/src/tutor.ts`
- `packages/domain/src/api.ts`
- `api/_shared/tutor-service.ts`
- `api/_shared/model-prompt.ts`
