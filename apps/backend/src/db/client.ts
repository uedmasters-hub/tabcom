import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

type DrizzleDb = ReturnType<typeof drizzle<typeof schema>>;

let instance: DrizzleDb | null = null;

/**
 * Lazily creates the Drizzle client on first real use, not at module
 * import time. Auth is additive to this server (see the socket
 * connection handler) — importing this file must never crash a
 * deployment or test run that isn't using auth and hasn't set
 * DATABASE_URL. The clear error still happens, just at the moment
 * someone actually calls an auth endpoint without a database
 * configured, which is the correct place for it.
 */
function getDb(): DrizzleDb {
  if (instance) return instance;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Auth requires a Postgres connection string " +
        "(e.g. from Neon: https://neon.tech) — see apps/backend/.env.example."
    );
  }

  const client = postgres(connectionString, {
    // Neon (and most serverless Postgres providers) close idle
    // connections aggressively — keep the pool small and let it
    // reconnect rather than holding stale connections open.
    max: 5,
    idle_timeout: 20,
  });

  instance = drizzle(client, { schema });
  return instance;
}

/** Proxy so call sites can keep writing `db.select()...` unchanged —
 *  each property access resolves the lazy client first. */
export const db: DrizzleDb = new Proxy({} as DrizzleDb, {
  get(_target, prop, receiver) {
    return Reflect.get(getDb() as object, prop, receiver);
  },
});

export { schema };
