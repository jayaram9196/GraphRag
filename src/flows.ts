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
        'You answer questions using ONLY the provided documents and knowledge graph relationships. ' +
        'Output rules (follow strictly):\n' +
        '1. No opening or closing sentences. No preamble. No summary. Answer directly.\n' +
        '2. For list questions, return a numbered list. Each item must cite a graph edge EXACTLY as it appears in the knowledge graph relationships above — do not invent, rename, or flip edges.\n' +
        '3. Only include DIRECT connections — a first-degree edge between the subject and the target. Do NOT include connections mediated by another entity (e.g. if Alice is married to Bob and Bob works at X, X is NOT Alice\'s connection to report).\n' +
        '4. When multiple subjects share the answer, group by subject — one heading per subject, then their items beneath.\n' +
        '5. Each item must be one line: `<Target>` — <one-line fact>. Evidence: `(Subject) -[RELATIONSHIP]-> (Target)`.\n' +
        '6. Copy the edge direction verbatim from the provided graph. If the graph shows `(MIT) -[X]-> (Alice)`, write it that way, not flipped.\n' +
        '7. Do not paraphrase the question. Do not say "based on the documents" or "these connections are based on".\n' +
        '8. If the context does not contain the answer, reply exactly: `Not in the provided context.`',
      prompt: `Documents:\n${sources.join('\n')}${graphSection}\n\nQuestion: ${question}`,
    });

    return { answer: text, sources, graphContext };
  }
);
