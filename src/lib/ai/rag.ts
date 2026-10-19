/**
 * Policy retrieval for the chatbot — the "R" in RAG.
 *
 * Why this exists: the chatbot must answer ONLY from indexed company policy.
 * Retrieval runs before every chat turn and returns the excerpts that get
 * embedded in the prompt; the honesty rules in the chat service handle the
 * case where nothing matches. Postgres full-text search (backed by the
 * expression GIN index on to_tsvector('english', content) from the raw SQL
 * migration) is the retriever — no external vector store, no embeddings
 * pipeline to keep in sync with uploads.
 *
 * Security/consistency notes:
 *  - The query is a Prisma tagged-template raw query: user text is ALWAYS a
 *    bound parameter, never string-interpolated — SQL injection is structurally
 *    impossible here.
 *  - Only documents with status READY are searchable — a half-processed or
 *    failed upload must never leak into an answer.
 *  - Chunk content is truncated to CHUNK_PROMPT_CHARS in the returned DTO to
 *    bound the prompt budget; the full text stays in the database untouched.
 */
import { prisma } from "@/lib/prisma";

/** Prompt budget per chunk: 1500 chars ≈ 375 tokens, keeps 5 chunks well inside provider input limits. */
const CHUNK_PROMPT_CHARS = 1500;

export type RetrievedChunk = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  section: string | null;
  content: string;
  score: number;
};

type RawChunkRow = {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  section: string | null;
  content: string;
  score: number | string;
};

/**
 * Retrieve the policy chunks most relevant to `query`.
 *
 * Ranking: full-text rank first; ILIKE-only hits (substring matches that the
 * tsquery misses, e.g. typos) sort after them because their rank is NULLS
 * LAST; ties break by chunk order so the prompt reads coherently. Degenerate
 * queries (<2 chars after trim) return [] without touching the database.
 */
export async function retrieveContext(query: string, limit = 5): Promise<RetrievedChunk[]> {
  const trimmed = query.trim();
  if (trimmed.length < 2) return [];

  const rows = await prisma.$queryRaw<RawChunkRow[]>`
    SELECT
      cd.id AS "chunkId",
      cd."documentId" AS "documentId",
      d.title AS "documentTitle",
      cd.section AS "section",
      cd.content AS "content",
      ts_rank(to_tsvector('english', cd.content), plainto_tsquery('english', ${trimmed})) AS "score"
    FROM "PolicyChunk" cd
    JOIN "PolicyDocument" d ON d.id = cd."documentId"
    WHERE d.status = 'READY'
      AND (
        to_tsvector('english', cd.content) @@ plainto_tsquery('english', ${trimmed})
        OR cd.content ILIKE '%' || ${trimmed} || '%'
      )
    ORDER BY
      ts_rank(to_tsvector('english', cd.content), plainto_tsquery('english', ${trimmed})) DESC NULLS LAST,
      cd."chunkIndex" ASC
    LIMIT ${limit}
  `;

  return rows.map((row) => ({
    chunkId: row.chunkId,
    documentId: row.documentId,
    documentTitle: row.documentTitle,
    section: row.section,
    // Truncate for the prompt only — the DB keeps the full chunk.
    content: row.content.slice(0, CHUNK_PROMPT_CHARS),
    // Depending on the adapter, pg numeric types can arrive as strings.
    score: Number(row.score ?? 0),
  }));
}
