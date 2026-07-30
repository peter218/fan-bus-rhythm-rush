import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

// Taken from drizzle rather than named directly: D1Database is a global from
// @cloudflare/workers-types, which this project does not install.
type D1Binding = Parameters<typeof drizzle>[0];

let schemaReady: Promise<void> | null = null;
let bindingLookup: Promise<D1Binding | null> | null = null;

async function findBinding(): Promise<D1Binding | null> {
  try {
    // `cloudflare:workers` only resolves inside the Workers runtime. Importing
    // it at module scope kills plain Node while the module graph loads — which
    // is how `vinext start` boots a self-hosted deploy — so it is pulled in
    // lazily through a variable specifier the bundler cannot inline, and a
    // missing binding degrades to "no leaderboard" instead of a dead server.
    const specifier = "cloudflare:workers";
    const workers = (await import(/* @vite-ignore */ specifier)) as {
      env?: { DB?: D1Binding };
    };
    return workers.env?.DB ?? null;
  } catch {
    return null;
  }
}

/** Resolves the D1 binding once, or null when the platform has no D1. */
export async function getD1Binding() {
  bindingLookup ??= findBinding();
  return bindingLookup;
}

/**
 * Creates the leaderboard tables if needed.
 *
 * Returns false when there is no D1 binding at all — a configuration state, not
 * a failure. Callers should read that as "leaderboard disabled" and keep
 * serving the game. Real database errors still throw.
 */
export async function ensureDbSchema(): Promise<boolean> {
  const binding = await getD1Binding();
  if (!binding) return false;

  schemaReady ??= binding
    .batch([
      binding.prepare(`
        CREATE TABLE IF NOT EXISTS leaderboard_scores (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          player_id TEXT NOT NULL,
          player_name TEXT NOT NULL,
          fans INTEGER NOT NULL,
          max_combo INTEGER NOT NULL,
          score INTEGER NOT NULL,
          concert TEXT NOT NULL,
          song TEXT NOT NULL,
          created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
          updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
        )
      `),
      binding.prepare(`
        CREATE UNIQUE INDEX IF NOT EXISTS leaderboard_scores_player_id_unique
        ON leaderboard_scores (player_id)
      `),
      binding.prepare(`
        CREATE INDEX IF NOT EXISTS leaderboard_scores_rank_idx
        ON leaderboard_scores (score DESC, fans DESC, max_combo DESC)
      `),
    ])
    .then(() => undefined);
  await schemaReady;
  return true;
}

/** The drizzle client, or null when the platform has no D1 binding. */
export async function getDb() {
  const binding = await getD1Binding();
  if (!binding) return null;
  return drizzle(binding, { schema });
}
