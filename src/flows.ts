import { z, Document } from 'genkit';
import { ai, GENERATION_MODEL } from './genkit';
import { bobFactsRetriever, bobFactsIndexer } from './refs';
import { extractKnowledge, writeKnowledgeGraph, getGraphContext } from './graph';

// ── Flow 1: Index documents as vectors ─────────────────────────────────

export const indexDocumentsFlow = ai.defineFlow(
  {
    name: 'indexDocuments',
    inputSchema: z.array(z.string()),
    outputSchema: z.object({ indexed: z.number() }),
  },
  async (texts) => {
    const documents = texts.map((text) => Document.fromText(text));
    await ai.index({ indexer: bobFactsIndexer, documents });
    return { indexed: documents.length };
  }
);

// ── Flow 2: Build knowledge graph from texts ───────────────────────────
//    Extracts entities + relationships via Gemini, writes them to Neo4j,
//    and links them to existing Document nodes via MENTIONS edges.

export const buildGraphFlow = ai.defineFlow(
  {
    name: 'buildGraph',
    inputSchema: z.array(z.string()),
    outputSchema: z.object({
      entities: z.number(),
      relationships: z.number(),
    }),
  },
  async (texts) => {
    let totalEntities = 0;
    let totalRelationships = 0;

    for (const text of texts) {
      const kg = await extractKnowledge(text);
      await writeKnowledgeGraph(kg, text);
      totalEntities += kg.entities.length;
      totalRelationships += kg.relationships.length;
    }

    return { entities: totalEntities, relationships: totalRelationships };
  }
);

// ── Flow 3: Pure vector search ─────────────────────────────────────────

export const retrieveFlow = ai.defineFlow(
  {
    name: 'retrieveFacts',
    inputSchema: z.string(),
    outputSchema: z.array(
      z.object({
        text: z.string(),
        score: z.number().optional(),
      })
    ),
  },
  async (query) => {
    const docs = await ai.retrieve({
      retriever: bobFactsRetriever,
      query,
      options: { k: 5 },
    });

    return docs.map((doc) => ({
      text: doc.text,
      score: (doc.metadata?._neo4jScore as number) ?? undefined,
    }));
  }
);

// ── Flow 4: Full GraphRAG — vector search + graph traversal + LLM ─────

export const graphRagFlow = ai.defineFlow(
  {
    name: 'graphRag',
    inputSchema: z.string(),
    outputSchema: z.object({
      answer: z.string(),
      sources: z.array(z.string()),
      graphContext: z.array(z.string()),
    }),
  },
  async (question) => {
    // Step 1: Vector search for relevant documents
    const docs = await ai.retrieve({
      retriever: bobFactsRetriever,
      query: question,
      options: { k: 5 },
    });
    const sources = docs.map((d) => d.text);

    // Step 2: Extract entity names from question + retrieved docs
    const { output: extracted } = await ai.generate({
      model: GENERATION_MODEL,
      output: {
        schema: z.object({
          names: z
            .array(z.string())
            .describe('All entity names found in the text'),
        }),
      },
      prompt: `Extract all entity names (people, places, organizations, concepts) from this text. Return just the names.\n\n"${question}\n${sources.join('\n')}"`,
    });

    // Step 3: Traverse the knowledge graph for connected context
    const entityNames = extracted?.names ?? [];
    const graphContext = entityNames.length
      ? await getGraphContext(entityNames)
      : [];

    // Step 4: Generate answer with both vector and graph context
    const graphSection = graphContext.length
      ? `\n\nKnowledge graph relationships:\n${graphContext.join('\n')}`
      : '';

    const { text } = await ai.generate({
      model: GENERATION_MODEL,
      system:
        'You answer questions using ONLY the provided documents and knowledge graph relationships.\n\n' +
        'Procedure for nested / multi-hop questions ("X whose Y did Z", "the employer of the person who ..."):\n' +
        '1. Decompose the question from the INSIDE OUT. Resolve the innermost clause first, then use that result as the input to the next clause, until you reach the outermost question.\n' +
        '2. At each step, find an edge in the provided graph that satisfies the clause. Write the step as: `Step N: <sub-question> → <entity>  (edge: <graph edge verbatim>)`.\n' +
        '3. Treat entities whose names clearly refer to the same real-world thing as one entity (e.g. "Alice" and "Alice Chen", "Bob" and "Bob Smith").\n' +
        '4. Edges must appear VERBATIM in the provided graph. You cannot flip an edge or rename its label. If the graph has `(David Li) -[SUPERVISED]-> (Alice)`, you cannot cite `(Alice) -[STUDIED_UNDER]-> (David Li)` — that is invention. Use the original edge as-is, even if it points the "wrong" way for your sentence.\n' +
        '5. After the decomposition, verify: does the final entity satisfy EVERY clause in the original question? If not, your subject is wrong — restart from step 1.\n\n' +
        'Worked example (study this carefully):\n' +
        'Question: "Which company employs someone whose spouse studied under David Li?"\n' +
        'Decomposition:\n' +
        '  Step 1: Who studied under David Li?  → Alice  (edge: (David Li) -[SUPERVISED]-> (Alice))\n' +
        '  Step 2: Who is Alice\'s spouse?       → Bob    (edge: (Alice Chen) -[IS_WIFE_OF]-> (Bob))\n' +
        '  Step 3: Which company employs Bob?   → TechNova Inc  (edge: (Bob) -[JOINED]-> (TechNova Inc))\n' +
        'Verify: TechNova Inc employs Bob (✓), Bob\'s spouse Alice studied under David Li (✓). Subject is correct.\n' +
        'Final answer: TechNova Inc. Evidence: (David Li) -[SUPERVISED]-> (Alice); (Alice Chen) -[IS_WIFE_OF]-> (Bob); (Bob) -[JOINED]-> (TechNova Inc)\n\n' +
        'Output rules:\n' +
        '- Output ONLY the final answer line. Do NOT output the decomposition steps or the verification — do that reasoning silently.\n' +
        '- Single-answer question: `<Answer>`. Evidence: `(A) -[R1]-> (B); (B) -[R2]-> (C); ...`\n' +
        '- List question: numbered list, one item per line, same format. Only include items that satisfy ALL constraints.\n' +
        '- If the context does not contain the answer, reply exactly: `Not in the provided context.`\n' +
        '- No preamble, no summary, no "based on the documents" filler.',
      prompt: `Documents:\n${sources.join('\n')}${graphSection}\n\nQuestion: ${question}`,
    });

    return { answer: text, sources, graphContext };
  }
);
