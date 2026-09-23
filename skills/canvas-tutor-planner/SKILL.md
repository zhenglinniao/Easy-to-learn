---
name: canvas-tutor-planner
description: Plan or review how selected whiteboard content becomes a structured Easy to learn Tutor DSL lesson. Use for canvas problem decomposition, tutoring-step design, prompt-policy changes, or evaluating generated teaching answers; do not use for ordinary UI implementation or unrestricted HTML generation.
---

# Canvas Tutor Planner

Turn a canvas selection into a teachable plan without taking over rendering, provider selection, or product policy.

## Workflow

1. Preserve the user's selected mode: `solve`, `hint`, or `explain_step`. Do not infer a different mode.
2. Separate the learning problem from incidental canvas layout. Use selected text, supported visual elements, source bounds, and image evidence only.
3. Produce or review structured Tutor DSL; never return arbitrary HTML, CSS, SVG, scripts, URLs, or tool calls as lesson content.
4. Keep model-independent teaching intent separate from provider transport and frontend presentation.
5. Report ambiguity instead of inventing unreadable text, missing diagram labels, or unstated problem conditions.
6. Treat the runtime schema and server validators as authoritative even when a prompt suggests otherwise.

Read [references/runtime-contract.md](references/runtime-contract.md) when planning or reviewing a lesson against the current product contract.

When changing production prompt wording, also inspect [references/prompt-registry.json](references/prompt-registry.json). Preserve its current semantics unless the user explicitly confirms the new teaching constraint. Ask before introducing or changing rules about step granularity, answer timing, learner-age adaptation, tone, visual/animation use, or self-check questions.

## Boundaries

- Do not expose hidden chain-of-thought. Return concise teaching steps and explanations intended for the learner.
- Do not add model-specific teaching behavior; provider adapters only translate transport and structured-output capabilities.
- Do not weaken Tutor DSL, Zod validation, quota, image validation, or audit metadata through prompt changes.
- Do not claim real-provider quality until the relevant golden set and provider integration have run.
