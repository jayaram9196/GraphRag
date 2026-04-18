import { z } from 'genkit';
import neo4jDriver, { type Driver } from 'neo4j-driver';
import { ai } from './genkit';

// ── Extraction schemas ─────────────────────────────────────────────────

const EntitySchema = z.object({
  name: z.string().describe('Entity name, e.g. "Bob", "New York"'),
  type: z
    .enum(['Person', 'Location', 'Organization', 'Skill', 'Concept'])
    .describe('Entity category'),
  properties: z
    .record(z.string(), z.string())
    .optional()
    .describe('Extra key-value attributes, e.g. { age: "42" }'),
});

const RelationshipSchema = z.object({
  from: z.string().describe('Source entity name'),
  to: z.string().describe('Target entity name'),
  type: z
    .string()
    .describe('UPPER_SNAKE_CASE relationship, e.g. LIVES_IN, WORKS_AS'),
  properties: z
    .record(z.string(), z.string())
    .optional()
    .describe('Optional relationship properties'),
});

const KnowledgeGraphSchema = z.object({
  entities: z.array(EntitySchema),
  relationships: z.array(RelationshipSchema),
});

export type KnowledgeGraph = z.infer<typeof KnowledgeGraphSchema>;

// ── Neo4j driver helper ────────────────────────────────────────────────

let _driver: Driver | null = null;

export function getDriver(): Driver {
  if (!_driver) {
    const uri = process.env.NEO4J_URI || 'bolt://localhost:7687';
    const username = process.env.NEO4J_USERNAME || 'neo4j';
    const password = process.env.NEO4J_PASSWORD || '';
    _driver = neo4jDriver.driver(
      uri,
      neo4jDriver.auth.basic(username, password)
    );
  }
  return _driver;
}

export function getDatabase(): string {
  return process.env.NEO4J_DATABASE || 'neo4j';
}

// Only allow alphanumeric + underscore in Cypher labels / rel types
function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '');
}

// ── Extract entities & relationships via Gemini ────────────────────────

export async function extractKnowledge(
  text: string
): Promise<KnowledgeGraph> {
  const { output } = await ai.generate({
    model: 'googleai/gemini-2.5-flash',
    output: { schema: KnowledgeGraphSchema },
    prompt: `Extract all entities and their relationships from the following text.

Rules:
- Each entity needs a name and a type (Person, Location, Organization, Skill, or Concept).
- Relationship types must be UPPER_SNAKE_CASE (LIVES_IN, WORKS_AS, HAS_AGE, MARRIED_TO, PARENT_OF, HOBBY_IS, etc.).
- Include numeric or descriptive values as properties when relevant (e.g. age: "42").
- Be thorough — capture every factual relationship in the text.

Text: "${text}"`,
  });

  return output ?? { entities: [], relationships: [] };
}

// ── Write knowledge graph to Neo4j ─────────────────────────────────────

export async function writeKnowledgeGraph(
  kg: KnowledgeGraph,
  sourceText: string
): Promise<void> {
  const driver = getDriver();
  const session = driver.session({ database: getDatabase() });

  try {
    // 1. Upsert entity nodes (Entity + type label)
    for (const entity of kg.entities) {
      const label = sanitize(entity.type);
      await session.run(
        `MERGE (e:Entity {name: $name})
         SET e:${label}
         SET e += $props`,
        { name: entity.name, props: entity.properties ?? {} }
      );
    }

    // 2. Create typed relationships between entities
    for (const rel of kg.relationships) {
      const relType = sanitize(rel.type);
      if (!relType) continue;
      await session.run(
        `MATCH (a:Entity {name: $from})
         MATCH (b:Entity {name: $to})
         MERGE (a)-[r:${relType}]->(b)
         SET r += $props`,
        { from: rel.from, to: rel.to, props: rel.properties ?? {} }
      );
    }

    // 3. Link source Document node → Entity via MENTIONS
    for (const entity of kg.entities) {
      await session.run(
        `MATCH (d:Document {text: $text})
         MATCH (e:Entity {name: $name})
         MERGE (d)-[:MENTIONS]->(e)`,
        { text: sourceText, name: entity.name }
      );
    }
  } finally {
    await session.close();
  }
}

// ── Retrieve graph context for a set of entity names ───────────────────

export async function getGraphContext(
  entityNames: string[]
): Promise<string[]> {
  const driver = getDriver();
  const session = driver.session({ database: getDatabase() });

  try {
    const result = await session.run(
      `UNWIND $names AS name
       MATCH (e:Entity {name: name})
       OPTIONAL MATCH (e)-[r]-(related:Entity)
       RETURN e.name AS entity,
              labels(e) AS types,
              e AS node,
              collect(DISTINCT {
                rel: type(r),
                target: related.name,
                targetTypes: labels(related)
              }) AS connections`,
      { names: entityNames }
    );

    return result.records.map((record) => {
      const entity: string = record.get('entity');
      const types = (record.get('types') as string[]).filter(
        (t) => t !== 'Entity'
      );
      const node = record.get('node');
      const props = node.properties as Record<string, unknown>;

      // Build property string (exclude 'name')
      const propPairs = Object.entries(props)
        .filter(([k]) => k !== 'name')
        .map(([k, v]) => `${k}: ${v}`);
      const propStr = propPairs.length ? ` {${propPairs.join(', ')}}` : '';

      const connections = record.get('connections') as Array<{
        rel: string | null;
        target: string | null;
        targetTypes: string[];
      }>;

      const connStrs = connections
        .filter((c) => c.target)
        .map((c) => `-[${c.rel}]-> ${c.target}`);

      return `${entity} (${types.join('/')})${propStr}${connStrs.length ? ': ' + connStrs.join('; ') : ''}`;
    });
  } finally {
    await session.close();
  }
}
