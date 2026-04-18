import { EmbedderArgument, z } from 'genkit';

/**
 * Neo4j connection parameters for direct configuration.
 */
export interface Neo4jClientParams {
  /** Neo4j connection URL (e.g., bolt://localhost:7687) */
  url: string;
  /** Neo4j username */
  username: string;
  /** Neo4j password */
  password: string;
  /** Neo4j database name (defaults to 'neo4j') */
  database?: string;
}

/**
 * Configuration for a single Neo4j vector index within the plugin.
 */
export interface Neo4jPluginConfig {
  /** The name of the vector index in Neo4j */
  indexId: string;
  /** The embedding model to use for generating vectors */
  embedder: EmbedderArgument<z.ZodTypeAny>;
  /** Optional Neo4j connection parameters (falls back to environment variables) */
  clientParams?: Neo4jClientParams;
}

/**
 * Resolved Neo4j connection configuration (after merging clientParams + env vars).
 */
export interface ResolvedNeo4jConnection {
  url: string;
  username: string;
  password: string;
  database: string;
}
