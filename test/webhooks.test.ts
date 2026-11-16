import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, {
      ...o,
      status: "paid",
      updatedAt: "2026-02-11T00:00:00Z",
    });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });

  it("сохраняет оплату, обновляет её новой версией и игнорирует старые версии", async () => {
    const order = apiOrder({ amount: 1000, amountPaid: "750.50" });
    await postWebhook(ctx.app, order);
    const initial = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [
      order.id,
    ]);
    expect(Number(initial.rows[0].amount_paid_kop)).toBe(75050);
    const newer = { ...order, amountPaid: 600, updatedAt: "2026-02-11T12:00:00Z" };
    expect((await postWebhook(ctx.app, newer)).json()).toEqual({ result: "updated" });
    expect((await postWebhook(ctx.app, order)).json()).toEqual({ result: "stale" });
    expect((await postWebhook(ctx.app, { ...newer, amountPaid: 1 })).json()).toEqual({
      result: "stale",
    });
    const { rows } = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [
      order.id,
    ]);
    expect(Number(rows[0].amount_paid_kop)).toBe(60000);
  });

  it("отклоняет некорректную сумму оплаты", async () => {
    for (const amountPaid of [-1, "invalid", null]) {
      expect((await postWebhook(ctx.app, apiOrder({ amountPaid }))).statusCode).toBe(400);
    }
  });
});
