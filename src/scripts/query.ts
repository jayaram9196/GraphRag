import { graphRagFlow } from '../flows';

const question = process.argv[2];

if (!question) {
  console.error('Usage: npm run query -- "your question here"');
  process.exit(1);
}

async function main() {
  console.log(`Question: ${question}\n`);
  const result = await graphRagFlow(question);
  console.log(`Answer: ${result.answer}`);
  console.log('\nSources:');
  result.sources.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  process.exit(0);
}

main().catch((err) => {
  console.error('Query failed:', err);
  process.exit(1);
});
