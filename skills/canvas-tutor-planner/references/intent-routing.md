# Content and learning-goal routing

Use this reference after reading the canvas selection. Classification selects a teaching route; it does not label the user or restrict future content types.

## Evidence priority

1. The user's explicit question or instruction.
2. Legible selected text and unambiguous image content.
3. Spatial relationships such as arrows, grouping, labels, and sequence.
4. A useful default inferred from the dominant recognizable content.

Never replace an explicit request with a default. When evidence conflicts, follow the explicit request and mention the conflict only when it affects correctness.

## Content kinds

- `exercise`: a school-style problem, proof, calculation, code task, or question with a checkable result.
- `question`: an explicit question that is not primarily a conventional exercise.
- `article`: prose, notes, a paragraph, a document excerpt, or an argument.
- `food_dish`: a prepared dish, meal, drink, or named recipe.
- `produce`: a fruit, vegetable, grain, herb, or other recognizable raw ingredient.
- `object`: a physical item, tool, machine, artifact, or everyday product.
- `process`: an event, workflow, transformation, system, or observable sequence.
- `diagram`: a graph, chart, map, schematic, labeled drawing, or relationship diagram.
- `mixed`: multiple content kinds are necessary to understand the selection.
- `unknown`: the selection is too ambiguous or unreadable for a more specific classification.

Choose the dominant kind, not every possible tag. Use `mixed` only when reducing to one kind would discard an essential relationship.

## Learning goals

- `solve`: reach and explain a checkable answer or decision.
- `explain`: make a concept, statement, or observed content understandable.
- `summarize`: expose an article's thesis, structure, evidence, and takeaways.
- `recipe`: explain ingredients, preparation sequence, transformations, and practical checkpoints.
- `nutrition`: explain major nutrient roles and sensible context without diagnosing or prescribing.
- `production`: explain how something is made, sourced, or reaches the user.
- `growth`: explain biological growth, cultivation, seasonality, or life cycle.
- `mechanism`: explain parts, interactions, inputs, outputs, or why an object/process works.
- `compare`: organize meaningful similarities, differences, and trade-offs.
- `explore`: present a useful overview when no narrower goal is sufficiently supported.

## Default route when no question is present

Use one primary route and optionally weave in one supporting angle; do not dump every fact you know.

| Dominant content | Primary default | Useful supporting angle                             |
| ---------------- | --------------- | --------------------------------------------------- |
| Exercise         | `solve`         | prerequisite or verification                        |
| Article or notes | `summarize`     | argument map or key terms                           |
| Prepared food    | `recipe`        | ingredient transformations or cultural context      |
| Produce          | `nutrition`     | growth/seasonality or journey from field to table   |
| Object           | `mechanism`     | parts, use, or production                           |
| Process          | `explain`       | causal chain or timeline                            |
| Diagram          | `explain`       | read axes/labels, then relationships and takeaway   |
| Mixed            | `explore`       | connect the components around one central question  |
| Unknown          | `explore`       | describe visible evidence and name the missing clue |

Examples are directional, not hard-coded outputs. A visible tomato beside “怎么种？” routes to `growth`, not the default `nutrition`. A cake beside “为什么会蓬松？” routes to `mechanism`, not a generic recipe.

## Route metadata

Return:

- `contentKind`: one value from the content-kind list;
- `learningGoal`: one value from the learning-goal list;
- `goalSource`: `explicit` when the user/selection asks for it, otherwise `inferred`;
- `confidence`: `high`, `medium`, or `low` based on identification and intent evidence.

Low confidence is not a license to fabricate. Make the first step an honest orientation: what is visible, what is uncertain, and what interpretation the explanation will use.

## Answer order for exercises

The confirmed Solve policy still applies when `learningGoal=solve`:

- simple exercise → conclusion first, then concise explanation;
- reasoning exercise → necessary reasoning first, conclusion in the final step.

Non-exercise routes do not pretend to have a single “final answer.” Lead with a useful orientation, then unfold the selected route.
