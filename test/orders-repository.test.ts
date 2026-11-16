import { describe, expect, it } from "vitest";
import { OrdersRepository } from "../src/repositories/orders.js";
import { setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("orders repository paid amount", () => {
  it("stores and updates the paid amount separately from the original amount", async () => {
    const repository = new OrdersRepository(ctx.db);
    const order = {
      id: "paid-amount",
      customerId: "c_1",
      amountKop: 10000,
      amountPaidKop: 7500,
      status: "paid" as const,
      createdAt: new Date("2026-02-10T12:00:00Z"),
      updatedAt: new Date("2026-02-10T12:00:00Z"),
    };

    await repository.save(order);
    expect(await repository.get(order.id)).toEqual(order);
    await repository.save({ ...order, amountPaidKop: 6000 });
    expect((await repository.get(order.id))?.amountPaidKop).toBe(6000);
    expect(
      (
        await repository.paidCreatedBetween("c_1", new Date("2026-02-10"), new Date("2026-02-11"))
      )[0]?.amountPaidKop,
    ).toBe(6000);
  });

  it("uses the original amount for legacy rows while retaining the unknown marker", async () => {
    await ctx.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
       VALUES ('legacy', 'c_1', 12500, 'paid', now(), now())`,
    );

    expect((await new OrdersRepository(ctx.db).get("legacy"))?.amountPaidKop).toBe(12500);
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = 'legacy'`);
    expect(rows[0].amount_paid_kop).toBeNull();
  });
});
