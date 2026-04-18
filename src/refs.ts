import { indexerRef, retrieverRef } from 'genkit';

export const bobFactsRetriever = retrieverRef({
  name: 'neo4j/bob-facts',
  info: { label: 'Bob Facts Database' },
});

export const bobFactsIndexer = indexerRef({
  name: 'neo4j/bob-facts',
  info: { label: 'Bob Facts Database' },
});
