import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { OrdersRepository } from "../src/repositories/orders.js";
import { setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("paid amount migration", () => {
  it("preserves legacy rows and permits recovery of the paid amount", async () => {
    const client = await ctx.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA paid_amount_migration_test");
      await client.query("SET LOCAL search_path TO paid_amount_migration_test");
      await client.query(
        await readFile(new URL("../migrations/001_init.sql", import.meta.url), "utf8"),
      );
      await client.query(
        `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
         VALUES ('legacy', 'c_1', 12500, 'paid', '2026-02-10T12:00:00Z', '2026-02-10T12:00:00Z')`,
      );
      await client.query(
        await readFile(new URL("../migrations/002_amount_paid.sql", import.meta.url), "utf8"),
      );

      const { rows } = await client.query(
        `SELECT amount_kop, amount_paid_kop FROM orders WHERE id = 'legacy'`,
      );
      expect(Number(rows[0].amount_kop)).toBe(12500);
      expect(rows[0].amount_paid_kop).toBeNull();
      // The repository uses the same transaction and schema as the migration.
      const repo = new OrdersRepository(client as unknown as typeof ctx.db);
      expect((await repo.get("legacy"))?.amountPaidKop).toBe(12500);
      expect(
        await repo.apply(
          {
            id: "legacy",
            customerId: "c_1",
            amountKop: 12500,
            amountPaidKop: 10000,
            status: "paid",
            createdAt: new Date("2026-02-10T12:00:00Z"),
            updatedAt: new Date("2026-02-10T12:00:00Z"),
          },
          true,
        ),
      ).toBe("updated");
      expect((await repo.get("legacy"))?.amountPaidKop).toBe(10000);
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});
