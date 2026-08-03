/**
 * One-shot CLI to purge incomplete / ghost user records.
 * Safe to re-run. Usage (from apps/backend):
 *   pnpm exec tsx scripts/cleanup-ghost-users.ts
 */
import "dotenv/config";
import { purgeIncompleteUsers } from "../src/auth/service.ts";

const { deleted } = await purgeIncompleteUsers();
console.log(`Deleted ${deleted} incomplete user record(s).`);
process.exit(0);
