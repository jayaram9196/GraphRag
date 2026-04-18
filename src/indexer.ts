import { type Genkit } from 'genkit';
import neo4jDriver, { type Driver } from 'neo4j-driver';
import { type Neo4jPluginConfig, type ResolvedNeo4jConnection } from './types';

/** Tracks which indexes have been ensured during this session */
const ensuredIndexes = new Set<string>();

/**
 * Creates the Neo4j vector index if it doesn't already exist.
 */
async function ensureVectorIndex(
  driver: Driver,
  connection: ResolvedNeo4jConnection,
  indexId: string,
  dimensions: number
) {
  if (ensuredIndexes.has(indexId)) return;

  const session = driver.session({ database: connection.database });
  try {
    await session.run(
      [
        `CREATE VECTOR INDEX \`${indexId}\` IF NOT EXISTS`,
        `FOR (d:Document)`,
        `ON (d.embedding)`,
        `OPTIONS {indexConfig: {`,
        `  \`vector.dimensions\`: $dimensions,`,
        `  \`vector.similarity_function\`: 'cosine'`,
        `}}`,
      ].join('\n'),
      { dimensions: neo4jDriver.int(dimensions) }
    );
    ensuredIndexes.add(indexId);
  } finally {
    await session.close();
  }
}

/**
 * Defines a Neo4j vector indexer on the given Genkit instance.
 */
export function defineNeo4jIndexer(
  ai: Genkit,
  config: Neo4jPluginConfig,
  driver: Driver,
  connection: ResolvedNeo4jConnection
) {
  return ai.defineIndexer(
    {
      name: `neo4j/${config.indexId}`,
    },
    async (documents) => {
      const session = driver.session({ database: connection.database });
      try {
        for (const doc of documents) {
          const text = doc.text;

          // Generate embedding for the document
          const embedResult = await ai.embed({
            embedder: config.embedder,
            content: doc,
          });
          const embedding = embedResult[0].embedding;

          // Ensure the vector index exists (only checks once per index)
          await ensureVectorIndex(
            driver,
            connection,
            config.indexId,
            embedding.length
          );

          // Store document as a node in Neo4j
          await session.run(
            `CREATE (d:Document {
               text: $text,
               metadata: $metadata,
               embedding: $embedding
             })`,
            {
              text,
              metadata: JSON.stringify(doc.metadata || {}),
              embedding,
            }
          );
        }
      } finally {
        await session.close();
      }
    }
  );
}
