/**
 * Database control center contract tests.
 *
 * Verifies the browser adapter's diagnostics round-trip against the JSON
 * shapes produced by wavery-server, and the byte formatter used by the
 * Library & Database settings tab.
 */

import assert from "assert";
import { formatBytes } from "../src/utils/library";
import { playerAdapter } from "../src/services/adapter";

export async function runDatabaseControlCenterTests(): Promise<void> {
  console.log("\n=======================================================");
  console.log("  DATABASE CONTROL CENTER CONTRACTS");
  console.log("=======================================================\n");

  let assertions = 0;
  function ok(condition: boolean, description: string) {
    assertions++;
    if (!condition) throw new Error(`Assertion failed: ${description}`);
    console.log(`  ✓ ${description}`);
  }
  function equal<T>(actual: T, expected: T, description: string) {
    assertions++;
    assert.strictEqual(actual, expected, `${description} (got ${String(actual)})`);
    console.log(`  ✓ ${description}`);
  }

  console.log("--- Byte formatting ---");
  equal(formatBytes(0), "0 B", "Zero bytes uses the base unit");
  equal(formatBytes(512), "512 B", "Sub-kilobyte values stay in bytes");
  equal(formatBytes(1024), "1.00 KB", "Kilobytes use binary units");
  equal(formatBytes(1536), "1.50 KB", "Fractional kilobytes keep two decimals");
  equal(formatBytes(1048576), "1.00 MB", "Megabytes use binary units");
  equal(formatBytes(20 * 1024 * 1024), "20.0 MB", "Two-digit values keep one decimal");
  equal(formatBytes(150 * 1024 * 1024), "150 MB", "Three-digit values drop decimals");
  equal(formatBytes(-4), "0 B", "Negative values are clamped to zero");
  equal(formatBytes(Number.NaN), "0 B", "Non-finite values are clamped to zero");

  console.log("--- Adapter surface ---");
  ok(typeof playerAdapter.getDatabaseStats === "function", "Adapter exposes getDatabaseStats");
  ok(typeof playerAdapter.checkDatabaseHealth === "function", "Adapter exposes checkDatabaseHealth");
  ok(typeof playerAdapter.pruneMissingTracks === "function", "Adapter exposes pruneMissingTracks");
  ok(typeof playerAdapter.backupDatabase === "function", "Adapter exposes backupDatabase");
  ok(
    typeof playerAdapter.revealDatabaseLocation === "function",
    "Adapter exposes revealDatabaseLocation"
  );

  console.log("--- Browser diagnostics round-trip ---");
  const stats = await playerAdapter.getDatabaseStats();
  equal(stats.trackCount, 12345, "Stats preserve the track count");
  equal(stats.albumCount, 678, "Stats preserve the album count");
  equal(stats.databaseBytes, 1048576, "Stats preserve the database size");
  equal(stats.missingFileCount, 3, "Stats preserve the missing-file count");
  equal(stats.journalMode, "wal", "Stats expose the journal mode");

  const health = await playerAdapter.checkDatabaseHealth();
  equal(health.isHealthy, true, "Health sweep reports a healthy database");
  equal(health.quickCheck, "ok", "Health sweep preserves the quick-check result");
  equal(health.ftsIndexedTracks, 12345, "Health sweep reports FTS document coverage");

  equal(await playerAdapter.pruneMissingTracks(), 2, "Prune returns the removed row count");

  const backup = await playerAdapter.backupDatabase();
  ok(backup !== null, "Backup returns a destination");
  equal(
    backup?.path,
    "/tmp/wavery/backups/wavery-library-backup.db",
    "Backup preserves the written path"
  );
  equal(backup?.bytes, 1048576, "Backup preserves the written size");

  await playerAdapter.revealDatabaseLocation("database");
  ok(true, "Browser reveal is a safe no-op");
}
