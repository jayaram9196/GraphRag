import { type Genkit, Document, z } from 'genkit';
import neo4jDriver, { type Driver } from 'neo4j-driver';
import { type Neo4jPluginConfig, type ResolvedNeo4jConnection } from './types';

/** Schema for retriever options */
export const Neo4jRetrieverOptionsSchema = z.object({
  k: z
    .number()
    .min(1)
    .max(1000)
    .default(10)
    .describe('Number of documents to retrieve (max 1000)'),
});

/**
 * Defines a Neo4j vector retriever on the given Genkit instance.
 */
export function defineNeo4jRetriever(
  ai: Genkit,
  config: Neo4jPluginConfig,
  driver: Driver,
  connection: ResolvedNeo4jConnection
) {
  return ai.defineRetriever(
    {
      name: `neo4j/${config.indexId}`,
      configSchema: Neo4jRetrieverOptionsSchema,
    },
    async (query, options) => {
      const k = options?.k ?? 10;

      // Generate embedding for the query
      const embedResult = await ai.embed({
        embedder: config.embedder,
        content: query,
      });
      const embedding = embedResult[0].embedding;

      const session = driver.session({ database: connection.database });
      try {
        const result = await session.run(
          `CALL db.index.vector.queryNodes($indexName, $k, $embedding)
           YIELD node, score
           RETURN node.text AS text, node.metadata AS metadata, score
           ORDER BY score DESC`,
          {
            indexName: config.indexId,
            k: neo4jDriver.int(k),
            embedding,
          }
        );

        const documents = result.records.map((record) => {
          const text: string = record.get('text');
          const rawMetadata: string | null = record.get('metadata');
          const score: number = record.get('score');

          let metadata: Record<string, unknown> = {};
          if (rawMetadata) {
            try {
              metadata = JSON.parse(rawMetadata);
            } catch {
              metadata = {};
            }
          }
          metadata._neo4jScore = score;

          return Document.fromText(text, metadata);
        });

        return { documents };
      } finally {
        await session.close();
      }
    }
  );
}
