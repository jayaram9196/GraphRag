import { type Genkit } from 'genkit';
import { genkitPlugin } from 'genkit/plugin';
import neo4jDriver, { type Driver } from 'neo4j-driver';
import { type Neo4jPluginConfig, type ResolvedNeo4jConnection } from './types';
import { defineNeo4jRetriever } from './retriever';
import { defineNeo4jIndexer } from './indexer';

/** Active Neo4j drivers keyed by index ID, for cleanup */
const drivers = new Map<string, Driver>();

/**
 * Resolves Neo4j connection config from explicit clientParams or environment variables.
 */
function resolveConnection(config: Neo4jPluginConfig): ResolvedNeo4jConnection {
  return {
    url:
      config.clientParams?.url ||
      process.env.NEO4J_URI ||
      'bolt://localhost:7687',
    username:
      config.clientParams?.username ||
      process.env.NEO4J_USERNAME ||
      'neo4j',
    password:
      config.clientParams?.password ||
      process.env.NEO4J_PASSWORD ||
      '',
    database:
      config.clientParams?.database ||
      process.env.NEO4J_DATABASE ||
      'neo4j',
  };
}

/**
 * Creates a Neo4j driver for the given connection configuration.
 */
function createDriver(connection: ResolvedNeo4jConnection): Driver {
  return neo4jDriver.driver(
    connection.url,
    neo4jDriver.auth.basic(connection.username, connection.password)
  );
}

/**
 * Neo4j plugin for Genkit.
 *
 * Provides vector indexer and retriever implementations backed by Neo4j's
 * graph database with vector search capabilities.
 *
 * @example
 * ```ts
 * import { genkit } from 'genkit';
 * import { neo4j } from 'genkitx-neo4j';
 * import { googleAI } from '@genkit-ai/google-genai';
 *
 * const ai = genkit({
 *   plugins: [
 *     googleAI(),
 *     neo4j([{
 *       indexId: 'my-docs',
 *       embedder: googleAI.embedder('gemini-embedding-001'),
 *     }]),
 *   ],
 * });
 * ```
 */
export function neo4j(configs: Neo4jPluginConfig[]) {
  return genkitPlugin('neo4j', async (ai: Genkit) => {
    for (const config of configs) {
      if (!config.indexId) {
        throw new Error('neo4j plugin: indexId is required for each index configuration');
      }
      if (!config.embedder) {
        throw new Error(`neo4j plugin: embedder is required for index "${config.indexId}"`);
      }

      const connection = resolveConnection(config);
      const driver = createDriver(connection);
      drivers.set(config.indexId, driver);

      // Verify connectivity
      try {
        await driver.verifyConnectivity();
      } catch (err) {
        console.warn(
          `neo4j plugin: Could not verify connectivity to Neo4j for index "${config.indexId}". ` +
          `Ensure Neo4j is running at ${connection.url}. Error: ${err}`
        );
      }

      defineNeo4jRetriever(ai, config, driver, connection);
      defineNeo4jIndexer(ai, config, driver, connection);
    }

    // Graceful shutdown: close drivers when process exits
    const cleanup = async () => {
      for (const [, drv] of drivers) {
        await drv.close().catch(() => {});
      }
      drivers.clear();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  });
}
