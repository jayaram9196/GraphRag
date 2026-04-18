// Plugin exports
export { neo4j } from './plugin';
export type {
  Neo4jPluginConfig,
  Neo4jClientParams,
  ResolvedNeo4jConnection,
} from './types';
export { Neo4jRetrieverOptionsSchema } from './retriever';

// References
export { bobFactsRetriever, bobFactsIndexer } from './refs';

// Graph utilities
export { extractKnowledge, writeKnowledgeGraph, getGraphContext } from './graph';

// Flows (importing registers them with the Genkit dev UI)
export {
  indexDocumentsFlow,
  buildGraphFlow,
  retrieveFlow,
  graphRagFlow,
} from './flows';
