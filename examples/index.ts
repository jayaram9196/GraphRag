import { genkit, Document } from 'genkit';
import { googleAI } from '@genkit-ai/google-genai';
import { neo4j, neo4jRetrieverRef, neo4jIndexerRef } from 'genkitx-neo4j';

// ── Initialize Genkit with Neo4j plugin ─────────────────────────────────

const ai = genkit({
  plugins: [
    googleAI(),
    neo4j([
      {
        indexId: 'bob-facts',
        embedder: googleAI.embedder('gemini-embedding-001'),
        // Optional: explicit connection params (otherwise uses env vars)
        // clientParams: {
        //   url: 'bolt://localhost:7687',
        //   username: 'neo4j',
        //   password: 'password',
        //   database: 'neo4j',
        // },
      },
    ]),
  ],
});

// ── Create typed references ─────────────────────────────────────────────

const bobFactsRetriever = neo4jRetrieverRef({
  indexId: 'bob-facts',
  displayName: 'Bob Facts Database',
});

const bobFactsIndexer = neo4jIndexerRef({
  indexId: 'bob-facts',
  displayName: 'Bob Facts Database',
});

// ── Example: Index documents ────────────────────────────────────────────

async function indexDocuments() {
  const documents = [
    Document.fromText('Bob is 42 years old.'),
    Document.fromText('Bob lives in New York City.'),
    Document.fromText('Bob works as a software engineer at a startup.'),
    Document.fromText('Bob enjoys hiking and photography on weekends.'),
    Document.fromText("Bob's favorite programming language is TypeScript."),
  ];

  console.log('Indexing documents into Neo4j...');
  await ai.index({ indexer: bobFactsIndexer, documents });
  console.log(`Indexed ${documents.length} documents successfully.`);
}

// ── Example: Retrieve documents ─────────────────────────────────────────

async function retrieveDocuments(query: string) {
  console.log(`\nSearching for: "${query}"`);

  const docs = await ai.retrieve({
    retriever: bobFactsRetriever,
    query,
    options: { k: 3 },
  });

  console.log(`Found ${docs.length} results:`);
  for (const doc of docs) {
    console.log(`  - ${doc.text} (score: ${doc.metadata?._neo4jScore})`);
  }

  return docs;
}

// ── Run ─────────────────────────────────────────────────────────────────

async function main() {
  await indexDocuments();
  await retrieveDocuments('How old is Bob?');
  await retrieveDocuments('Where does Bob live?');
  await retrieveDocuments('What are Bob hobbies?');
}

main().catch(console.error);
