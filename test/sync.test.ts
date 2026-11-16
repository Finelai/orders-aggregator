import { describe, expect, it } from "vitest";
import { OrdersRepository } from "../src/repositories/orders.js";
import { apiOrder, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /sync", () => {
  it("проходит все страницы и останавливается на пустой странице с тем же курсором", async () => {
    const [a, b, c] = [apiOrder(), apiOrder(), apiOrder()];
    ctx.api.pages.set(null, { items: [a, b], nextCursor: "p2" });
    ctx.api.pages.set("p2", { items: [c], nextCursor: "p3" });
    ctx.api.pages.set("p3", { items: [], nextCursor: "p3" });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pages: 3, received: 3, applied: 3, invalid: 0 });
    const { rows } = await ctx.db.query(`SELECT count(*)::int AS n FROM orders`);
    expect(rows[0].n).toBe(3);
  });

  it("невалидные заказы пропускает, а не падает", async () => {
    ctx.api.pages.set(null, {
      items: [apiOrder(), { id: "broken" }, apiOrder({ amount: "abc" })],
      nextCursor: null,
    });
    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ received: 3, applied: 1, invalid: 2 });
  });

  it("не откатывает более свежую версию заказа", async () => {
    const fresh = apiOrder({ status: "refunded", updatedAt: "2026-02-12T00:00:00Z" });
    await ctx.app.inject({ method: "POST", url: "/webhooks/order", payload: fresh });
    ctx.api.pages.set(null, {
      items: [{ ...fresh, status: "paid", updatedAt: "2026-02-10T12:00:00Z" }],
      nextCursor: null,
    });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ stale: 1 });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [fresh.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("строковые суммы и даты без зоны", async () => {
    const o = apiOrder({ amount: "2500.00", createdAt: "2026-02-10T21:30:00" });
    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });
    const { rows } = await ctx.db.query(`SELECT amount_kop, created_at FROM orders WHERE id = $1`, [
      o.id,
    ]);
    expect(Number(rows[0].amount_kop)).toBe(250000);
    expect(rows[0].created_at.toISOString()).toBe("2026-02-10T21:30:00.000Z");
  });

  it("восстанавливает неизвестную оплату при той же версии и не меняет остальные поля", async () => {
    const order = apiOrder({ amount: 1000 });
    await ctx.app.inject({ method: "POST", url: "/webhooks/order", payload: order });
    ctx.api.pages.set(null, {
      items: [{ ...order, amount: 9999, amountPaid: 700 }],
      nextCursor: null,
    });

    expect((await ctx.app.inject({ method: "POST", url: "/sync" })).json()).toMatchObject({
      applied: 1,
    });
    const { rows } = await ctx.db.query(
      `SELECT amount_kop, amount_paid_kop FROM orders WHERE id = $1`,
      [order.id],
    );
    expect(Number(rows[0].amount_kop)).toBe(100000);
    expect(Number(rows[0].amount_paid_kop)).toBe(70000);
    expect((await ctx.app.inject({ method: "POST", url: "/sync" })).json()).toMatchObject({
      stale: 1,
    });
  });

  it("использует сумму заказа при отсутствии оплаты и оставляет возможность восстановления", async () => {
    const order = apiOrder({ amount: 250 });
    ctx.api.pages.set(null, { items: [order], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });
    const stored = await new OrdersRepository(ctx.db).get(order.id);
    expect(stored?.amountPaidKop).toBe(25000);
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [
      order.id,
    ]);
    expect(rows[0].amount_paid_kop).toBeNull();
  });
});
