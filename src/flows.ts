import { z, Document } from 'genkit';
import { ai } from './genkit';
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
      model: 'googleai/gemini-2.5-flash',
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
      model: 'googleai/gemini-2.5-flash',
      system:
        'You are a helpful assistant that answers questions using the provided documents and knowledge graph relationships. ' +
        'The graph relationships show how entities are connected — use them to give richer, more complete answers. ' +
        "If the context does not contain relevant information, say you don't know.",
      prompt: `Documents:\n${sources.join('\n')}${graphSection}\n\nQuestion: ${question}`,
    });

    return { answer: text, sources, graphContext };
  }
);
