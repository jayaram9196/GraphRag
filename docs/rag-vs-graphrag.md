# Where vector RAG breaks (and GraphRAG doesn't)

| Scenario | Why RAG fails | Why GraphRAG wins |
|---|---|---|
| **Scale** — 10,000+ docs, top-k retrieval must pick 5-10 | Top-k ranks by semantic similarity, not logical proximity. The doc with the "missing hop" may not rank in the top-k. One missing hop = confident wrong answer. | Graph traversal is deterministic — if the edge exists, it's found, regardless of document similarity. |
| **Multi-hop questions** ("who funded the employer of X's parent?") | Requires 3+ specific docs to co-occur in top-k. Probability drops fast. | `MATCH (x)-[:PARENT]->()-[:WORKS_AT]->()-[:FUNDED_BY]->(vc)` — single deterministic query. |
| **Counting / aggregation** ("how many companies has Bob worked for?") | Top-k misses one, answer is wrong by one. LLM won't know it's wrong. | Cypher returns **all** matches, guaranteed. |
| **Entity resolution** — "Alice", "Alice Chen", "Dr. Chen" | Vector embeds each surface form separately. LLM may think they're different people. | `MERGE (e:Entity {name})` unifies on write. |
| **Path / network questions** — "3 degrees of separation", "shortest path" | LLMs can't reliably execute graph algorithms. | Cypher does this in one line. |
| **Explainability / audit** — "prove why you said that" | Answer is latent in the LLM weights. Can cite source docs but not the reasoning chain. | Every answer cites the exact edges traversed — critical for KYC, healthcare, legal, enterprise. |
| **Access control** — "user can see orgs but not personal edges" | Can't filter vector similarity by permission. | Filter by edge type / label at the Cypher layer. |
| **Incremental updates** — "John left Acme and joined Xerox" | Must re-embed surrounding docs; stale chunks stick around. | One Cypher statement updates one edge; no re-embedding. |

## The one-line heuristic

> **If the answer lives in one document, use RAG. If the answer requires joining facts across documents, use GraphRAG. If you need to explain *why*, you need GraphRAG.**
