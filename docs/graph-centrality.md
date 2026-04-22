# Graph centrality in this codebase

Can we answer *"Which entity is most central to the Smith family?"* with PageRank or betweenness centrality? **Partly yes, partly depends on your Neo4j plan.**

## Three options, in order of cost

### Option 1 — Degree centrality in pure Cypher (works today, zero changes)

"Most central" ≈ "most connections to family members" is computable right now in one Cypher query, no plugins. This covers ~80% of what a non-expert means by "central":

```cypher
// Who has the most edges connecting them to anyone in the Smith family?
WITH ['Bob Smith','Alice Chen','Charlie','Diana',
      'Patricia Smith','Robert Smith Sr.',
      'Wei Chen','Mei Lin Chen'] AS family
MATCH (e:Entity)-[r]-(f:Entity)
WHERE f.name IN family AND NOT e.name IN family
RETURN e.name AS entity,
       labels(e) AS types,
       count(DISTINCT r) AS edgesToFamily,
       collect(DISTINCT f.name) AS connectedFamilyMembers
ORDER BY edgesToFamily DESC
LIMIT 10
```

This answers *"Which non-family entity is connected to the most Smith family members?"* — which is usually the real question behind "most central."

### Option 2 — Real PageRank / betweenness via Neo4j GDS library

Neo4j's **Graph Data Science (GDS)** library provides `gds.pageRank`, `gds.betweenness`, `gds.articleRank`, etc. But it requires installing the GDS plugin:

| Your Neo4j | GDS available? |
|---|---|
| **Neo4j Aura Free** | Not available |
| **Neo4j Aura Professional / Business / Enterprise** | Yes, preinstalled |
| **Local Neo4j Community / Enterprise** | Install `neo4j-graph-data-science.jar` in `plugins/` |

If you have GDS, the usage is roughly:

```cypher
// 1. Project the graph into GDS memory
CALL gds.graph.project('smith-graph', 'Entity', '*');

// 2. Run personalized PageRank biased toward family members
CALL gds.pageRank.stream('smith-graph', {
  sourceNodes: [nodes matching family names],
  maxIterations: 20
})
YIELD nodeId, score
RETURN gds.util.asNode(nodeId).name AS entity, score
ORDER BY score DESC LIMIT 10;

// 3. Drop the projection
CALL gds.graph.drop('smith-graph');
```

The current `.env.example` uses `neo4j+s://xxxxx.databases.neo4j.io` — that's Aura. Check your tier at console.neo4j.io → if it's **Free**, GDS is disabled. Either upgrade or run a local Neo4j for GDS experiments.

### Option 3 — External library (NetworkX, graphology)

Export the graph to JSON via Cypher, compute centrality in Python/JS, load results back as node properties. Heaviest, most flexible. Not worth it for the scale of data here.

## Recommendation

**Start with Option 1.** It takes one query, works on Aura Free, and answers the practical question well. Wiring it into this codebase means adding a fifth Genkit flow — `centralityFlow` — that accepts a list of "anchor" entity names and returns the top-N entities ranked by their connection count to the anchors.

If the project later moves to Aura Pro or a local Neo4j with GDS, add `pageRankFlow` as a separate flow — no need to replace the simple version.

## Relationship to existing retrieval

| Retrieval layer | Metric / method | Where configured |
|---|---|---|
| Vector search (`graphRag` step 1) | cosine similarity | `src/indexer.ts` → `ensureVectorIndex` |
| Graph traversal (`graphRag` step 3) | unweighted structural pattern match | `src/graph.ts` → `getGraphContext` |
| **Centrality ranking** (proposed) | degree count (Option 1) or PageRank (Option 2) | would be a new flow |

Centrality does *not* replace vector search or graph traversal — it's a third lens on the same graph, answering "importance" questions rather than "what's connected to X" questions.
