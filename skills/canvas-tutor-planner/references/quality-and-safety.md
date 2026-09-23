# Quality and safety gates

Apply the relevant gates before returning Tutor DSL.

## Universal gates

- The selected route answers the explicit question, or clearly discloses an inferred goal.
- Every step advances understanding; remove duplicated narration and decorative blocks.
- Claims do not outrun visible evidence or stable general knowledge.
- Uncertainty is localized: say exactly which label, identity, quantity, or relationship is unclear.
- Humor is optional and subordinate to clarity.

## Food and nutrition

- Distinguish a prepared dish from a raw ingredient when the evidence supports it.
- Recipes explain checkpoints such as texture, color, temperature, or sequence, not just ingredient names.
- Flag common high-impact food-safety considerations when directly relevant, without turning every recipe into a warning sheet.
- Treat nutrition as general education. Avoid diagnosis, treatment, weight-loss prescriptions, or exact nutrient quantities unless the source provides the serving and values.
- Mention that composition varies by variety, serving size, preparation, and source when precision matters.

## Health, hazards, and sensitive content

- Reduce or remove humor for injury, illness, death, disasters, abuse, identity-based topics, or dangerous procedures.
- Do not infer a diagnosis, edibility, species safety, chemical identity, or electrical/mechanical safety from an uncertain sketch or image.
- For dangerous or regulated activities, explain principles and safe boundaries rather than optimizing harmful execution.

## Articles and claims

- Separate what the source says from the tutor's explanation.
- Identify thesis, evidence, assumptions, and implications without inventing citations.
- If the excerpt is incomplete, do not claim to summarize missing sections.
- Mark opinion, interpretation, and disputed claims as such.

## Visual inputs

- OCR-like uncertainty must remain explicit.
- Describe only details relevant to the learning route; do not infer identity-sensitive attributes about people.
- If image identity determines the answer and confidence is low, use `unknown` or a broader kind and explain what additional view or label is needed.

## Final self-check

1. Would the explanation still make sense without animation or mascot art?
2. Does each visual block encode a relationship rather than decoration?
3. Is the chosen route the most useful one supported by the evidence?
4. Did any joke weaken accuracy, dignity, or safety?
5. Can a learner state the central takeaway after the final step?
