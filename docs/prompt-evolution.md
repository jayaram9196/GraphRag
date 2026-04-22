# Prompt evolution

Every LLM call in this codebase is driven by a prompt. This doc lists them all, and for the one that went through iteration, shows each version with the observed problem that forced the revision.

---

## Prompts currently in the codebase

### 1. Entity extraction from source documents

**Location:** `src/graph.ts` → `extractKnowledge()`
**Model call:** `ai.generate` with `output.schema = KnowledgeGraphSchema`
**Purpose:** Read one source sentence, return structured entities + relationships.

```text
Extract all entities and their relationships from the following text.

Rules:
- Each entity needs a name and a type (Person, Location, Organization, Skill, or Concept).
- Relationship types must be UPPER_SNAKE_CASE (LIVES_IN, WORKS_AS, HAS_AGE, MARRIED_TO, PARENT_OF, HOBBY_IS, etc.).
- Include numeric or descriptive values as properties when relevant (e.g. age: "42").
- Be thorough — capture every factual relationship in the text.

Text: "${text}"
```

Status: **unchanged** across revisions. Structured-output schema is doing the heavy lifting.

---

### 2. Entity extraction from the question + retrieved docs

**Location:** `src/flows.ts` → `graphRagFlow` step 2
**Model call:** `ai.generate` with `output.schema = { names: string[] }`
**Purpose:** Pull entity names out of the user's question and vector-retrieved docs so the graph traversal knows where to anchor.

```text
Extract all entity names (people, places, organizations, concepts) from this text. Return just the names.

"${question}
${sources.join('\n')}"
```

Status: **unchanged**.

---

### 3. Final answer generation — system prompt

**Location:** `src/flows.ts` → `graphRagFlow` step 4
**Model call:** `ai.generate` with a `system` role and the user's question.
**Purpose:** Fuse vector-retrieved documents + graph traversal context into the final answer.

This is the one that went through **three versions** — see the revision history below.

---

### 4. Final answer generation — user prompt

**Location:** `src/flows.ts` → `graphRagFlow` step 4
**Purpose:** Feed the retrieved documents + graph context + question into the model.

```text
Documents:
${sources.join('\n')}

${graphSection}   // only present when graph context is non-empty

Question: ${question}
```

Where `graphSection` is:

```text


Knowledge graph relationships:
${graphContext.join('\n')}
```

Status: **unchanged**. The *shape* of `graphContext` strings was improved in a supporting change (see v3 below).

---

## Revision history for prompt #3 (final answer system prompt)

### v1 — original

```text
You are a helpful assistant that answers questions using the provided documents and knowledge graph relationships. The graph relationships show how entities are connected — use them to give richer, more complete answers. If the context does not contain relevant information, say you don't know.
```

**Observed output** (for "list organisations the Smith adults are connected to"):

> The adults in the Smith family, Bob and Alice, are connected to the following organizations:
> 1. **TechNova Inc**: Bob works as a senior software engineer at TechNova Inc, a fintech startup headquartered in Manhattan, New York.
> 2. **Columbia University**: Alice works as a lead data scientist at Columbia University's AI Research Lab in New York…
> These connections are based on the provided documents and knowledge graph relationships…

**Problems:**

1. **Prose-heavy, combined phrasing** — wraps answers in *"The adults are connected to the following…"* and closes with *"These connections are based on…"*. Reads like a summary, not a definitive list.
2. **No edge evidence** — answers don't cite *which* graph edge proved the connection, so GraphRAG's key differentiator (auditability) is invisible in the output.
3. **No formatting discipline** — LLM decides indentation, bolding, and grouping each time.

---

### v2 — structured output, edge-cited

```text
You answer questions using ONLY the provided documents and knowledge graph relationships.
Output rules (follow strictly):
1. No opening or closing sentences. No preamble. No summary. Answer directly.
2. For list questions, return a numbered list. Each item must cite the graph edge that proves it, formatted as: `Subject -[RELATIONSHIP]-> Object`.
3. When multiple subjects share the answer, group by subject — one heading per subject, then their items beneath.
4. Each item should be one line: `<Target>` — <one-line fact>. Evidence: `Subject -[RELATIONSHIP]-> Target`.
5. Do not paraphrase the question. Do not say "based on the documents" or "these connections are based on".
6. If the context does not contain the answer, reply exactly: `Not in the provided context.`
```

**What changed from v1:**

- Forbade preamble / summary wrappers (rule 1, 5).
- Required every item to cite a graph edge (rule 2, 4).
- Required grouping by subject when multiple subjects are relevant (rule 3).
- Locked the "unknown" fallback to an exact string (rule 6) so callers can detect it.

**Observed output** (same question):

> ## Bob Smith
> 1. TechNova Inc — Works as a senior software engineer. Evidence: Bob Smith -[WORKS_AT]-> TechNova Inc
> 2. Google — Previously worked for 6 years. Evidence: **Google -[PREVIOUSLY_WORKED_AT]-> Bob**   ← WRONG DIRECTION
>
> ## Alice Chen
> 1. Columbia University — Works at AI Research Lab. Evidence: Alice Chen -[WORKS_AT]-> AI Research Lab, AI Research Lab -[PART_OF]-> Columbia University
> 2. MIT — Completed PhD in Machine Learning. Evidence: **MIT -[STUDIED_AT]-> Alice**   ← WRONG DIRECTION
> 3. **TechNova Inc — Through her husband Bob who works there.**   ← TRANSITIVE, NOT DIRECT

**Remaining problems:**

1. **Edge directions were flipped** (`Google -[PREVIOUSLY_WORKED_AT]-> Bob`, `MIT -[STUDIED_AT]-> Alice`) — because the upstream `getGraphContext` Cypher in `src/graph.ts` matched edges undirected but rendered every one as outgoing (`-[REL]-> target`). The LLM tried to "correct" the weird direction and got it backwards.
2. **Transitive connections slipped in** — Alice's list included TechNova via her husband. For "*connected to*" questions this is noise.

---

### v3 — directional + direct-only (current)

```text
You answer questions using ONLY the provided documents and knowledge graph relationships.
Output rules (follow strictly):
1. No opening or closing sentences. No preamble. No summary. Answer directly.
2. For list questions, return a numbered list. Each item must cite a graph edge EXACTLY as it appears in the knowledge graph relationships above — do not invent, rename, or flip edges.
3. Only include DIRECT connections — a first-degree edge between the subject and the target. Do NOT include connections mediated by another entity (e.g. if Alice is married to Bob and Bob works at X, X is NOT Alice's connection to report).
4. When multiple subjects share the answer, group by subject — one heading per subject, then their items beneath.
5. Each item must be one line: `<Target>` — <one-line fact>. Evidence: `(Subject) -[RELATIONSHIP]-> (Target)`.
6. Copy the edge direction verbatim from the provided graph. If the graph shows `(MIT) -[X]-> (Alice)`, write it that way, not flipped.
7. Do not paraphrase the question. Do not say "based on the documents" or "these connections are based on".
8. If the context does not contain the answer, reply exactly: `Not in the provided context.`
```

**What changed from v2:**

- Rule 2: forbade inventing, renaming, or flipping edges.
- Rule 3 (new): **direct connections only** — explicitly rejects the transitive-via-spouse case.
- Rule 5: standardised the evidence format as `(Subject) -[RELATIONSHIP]-> (Target)` with parens.
- Rule 6 (new): copy edge direction verbatim — belts-and-braces to block the v2 direction bug.

**Supporting change (not a prompt change, but necessary for v3 to work):** the Cypher in `src/graph.ts` → `getGraphContext()` was rewritten to query outgoing and incoming edges *separately* and render each with its true direction. Before this, the LLM only saw outgoing-style strings regardless of the real edge direction; rule 6 alone couldn't save it because the input was already wrong.

**Why v3 works:** the combination of
1. directional input (from `getGraphContext`) and
2. verbatim-copy instruction (rule 6) and
3. direct-only constraint (rule 3)

means the model can no longer paper over upstream ambiguity with its own guesses.

---

## Principle

Each revision was driven by a **specific hallucination observed in the real output**, not a general intuition. The sequence was:

| Revision | Triggering failure mode | Fix |
|---|---|---|
| v1 → v2 | Prose padding, no evidence | Structured output rules + cite every edge |
| v2 → v3 | Flipped edge directions + transitive inference | Direct-only rule + verbatim-direction rule + directional upstream data |

When you edit a prompt, record the output that forced the change. Otherwise in six months you won't remember why rule 6 exists and someone will "simplify" it out.
