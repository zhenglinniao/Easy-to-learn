---
name: canvas-tutor-planner
description: Classify and decompose text, handwriting, exercises, images, objects, foods, articles, diagrams, or mixed whiteboard selections into an age-inclusive, lightly humorous hand-drawn-style Easy to learn Tutor DSL lesson. Use for canvas understanding, teaching-route design, prompt-policy changes, or generated-lesson review; do not use for ordinary UI implementation or unrestricted HTML generation.
---

# Canvas Tutor Planner

Turn whatever the learner selects on the canvas into the most useful visual explanation without taking over rendering, provider selection, or product policy.

## Workflow

1. Preserve the selected mode: `solve`, `hint`, or `explain_step`. In `solve`, “solve” means a complete educational decomposition and is not limited to school exercises.
2. Read the selection as evidence. Separate explicit text, recognizable visual content, spatial relationships, and uncertain details. Never invent unreadable labels or a specific object identity.
3. Determine `contentProfile`: what the selection primarily is, what learning goal best fits it, whether that goal was explicit or inferred, and confidence. Read [references/intent-routing.md](references/intent-routing.md) for routing and defaults.
4. Decide whether the idea needs one visual step or several connected visual steps, then build a progressive visual story. Read [references/visual-storytelling.md](references/visual-storytelling.md) for the single/multi-step rule, Q-style math explanation, hand-drawn composition, humor, diagram choice, and age-inclusive language.
5. Produce or review structured Tutor DSL only. Never return arbitrary HTML, CSS, SVG, scripts, URLs, external resources, or tool calls as lesson content.
6. Apply [references/quality-and-safety.md](references/quality-and-safety.md) when the content involves health, nutrition, food safety, hazards, disputed claims, identity-sensitive material, or uncertainty.
7. Treat the runtime schema and server validators as authoritative even when a prompt suggests otherwise.

Read [references/runtime-contract.md](references/runtime-contract.md) when planning or reviewing a lesson against the current product contract.

When changing production prompt wording, inspect [references/prompt-registry.json](references/prompt-registry.json). Preserve confirmed semantics unless the user explicitly changes them. Ask before introducing a new global rule about step limits, learner personalization, answer disclosure, citations, or assessment behavior; examples in the routing reference are defaults, not an exhaustive taxonomy.

## Invariants

- Follow an explicit user question over any inferred route.
- If no question is present but the content is recognizable, choose one primary educational route and disclose it through `contentProfile.goalSource=inferred`.
- If identity or intent is too uncertain, explain what is visible and what extra detail would disambiguate it; do not confidently choose a recipe, species, diagnosis, or factual claim.
- Keep each step centered on one idea and connect it to the next. Prefer a diagram only when relationships, parts, sequence, comparison, or causality become clearer visually.
- Under Prompt `v4`, every step is a visual explanation card: include at least one informative diagram and use prose only to support the picture. For mathematics, combine accurate math/geometry/coordinates with a Q-style `comic-strip` cue that explains the reasoning action rather than decorating the answer.
- Use light, original humor as a memory aid. Never let a joke obscure the fact, target the learner, or trivialize serious and sensitive content.
- Use plain Chinese suitable for a broad audience. Define necessary jargon in context rather than assuming an age or talking down to the learner.

## Boundaries

- Do not expose hidden chain-of-thought. Return concise, learner-facing reasoning summaries and observable intermediate steps.
- Do not add provider-specific teaching behavior; provider adapters only translate transport and structured-output capabilities.
- Do not weaken Tutor DSL, Zod validation, quota, image validation, or audit metadata through prompt changes.
- Do not claim exact nutrition, medical, legal, safety, or current factual accuracy when the input or evidence cannot support it.
- Do not claim real-provider quality until the relevant multimodal golden set and provider integration have run.
