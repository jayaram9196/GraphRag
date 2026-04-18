import { indexDocumentsFlow } from '../flows';

const sampleFacts = [
  'Bob is 42 years old and lives in New York City.',
  'Bob works as a senior software engineer at a fintech startup.',
  'Alice is Bob\'s wife and she is a data scientist at a research university.',
  'Bob and Alice have two children named Charlie and Diana.',
  'Bob enjoys playing chess and reading science fiction novels in his free time.',
];

async function main() {
  console.log('Indexing sample documents into Neo4j...');
  const result = await indexDocumentsFlow(sampleFacts);
  console.log(`Done. Indexed ${result.indexed} documents.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Indexing failed:', err);
  process.exit(1);
});
