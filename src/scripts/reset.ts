import 'dotenv/config';
import neo4j from 'neo4j-driver';

const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
const username = process.env.NEO4J_USERNAME || 'neo4j';
const password = process.env.NEO4J_PASSWORD || '';
const database = process.env.NEO4J_DATABASE || 'neo4j';

async function main() {
  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  const session = driver.session({ database });

  try {
    console.log('Dropping vector index "bob-facts"...');
    await session.run('DROP INDEX `bob-facts` IF EXISTS');

    console.log('Deleting all Document nodes...');
    await session.run('MATCH (d:Document) DETACH DELETE d');

    console.log('Deleting all Entity nodes and relationships...');
    await session.run('MATCH (e:Entity) DETACH DELETE e');

    console.log('Done. Neo4j is clean — ready to re-index.');
  } finally {
    await session.close();
    await driver.close();
  }
}

main().catch((err) => {
  console.error('Reset failed:', err);
  process.exit(1);
});
