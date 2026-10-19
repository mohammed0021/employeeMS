-- Full-text retrieval index for the RAG chatbot.
--
-- src/lib/ai/rag.ts queries `to_tsvector('english', content) @@ <tsquery>`;
-- without this expression index Postgres falls back to a sequential scan over
-- every chunk on every chat turn. Chunk content is write-once in practice
-- (sha256 dedupe in the policy upload path blocks re-upload of the same
-- bytes), so a plain CREATE INDEX is safe at this table's write rate.
CREATE INDEX "PolicyChunk_content_fts_idx"
  ON "PolicyChunk" USING GIN (to_tsvector('english', content));
