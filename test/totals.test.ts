import { describe, expect, it, vi } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("GET /customers/:id/daily-totals", () => {
  it.each(["2026-01-15T12:00:00Z", "2026-07-15T12:00:00Z"])(
    "распределяет заказы по дням Берлина при текущей дате %s",
    async (now) => {
      ctx.api.customers.set("c_1", "Europe/Berlin");
      const orders = [
        { createdAt: "2026-03-27T22:59:59Z", amount: 10.01, amountPaid: 9 },
        { createdAt: "2026-03-27T23:00:00Z", amount: 20.02, amountPaid: 18 },
        { createdAt: "2026-03-29T21:59:59Z", amount: 30.03, amountPaid: 27 },
        { createdAt: "2026-03-29T22:00:00Z", amount: 40.04, amountPaid: 36 },
      ];
      for (const order of orders) {
        const res = await postWebhook(ctx.app, apiOrder(order));
        expect(res.statusCode).toBe(200);
      }

      vi.useFakeTimers({ toFake: ["Date"] });
      try {
        vi.setSystemTime(new Date(now));
        const res = await dailyTotals(ctx.app, "c_1", "2026-03-27", "2026-03-30");
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([
          { date: "2026-03-27", total: 10.01, gross: 10.01, discount: 1.01, net: 9 },
          { date: "2026-03-28", total: 20.02, gross: 20.02, discount: 2.02, net: 18 },
          { date: "2026-03-29", total: 30.03, gross: 30.03, discount: 3.03, net: 27 },
          { date: "2026-03-30", total: 40.04, gross: 40.04, discount: 4.04, net: 36 },
        ]);
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it("учитывает оба повторяющихся часа при осеннем переводе часов в Берлине", async () => {
    ctx.api.customers.set("c_1", "Europe/Berlin");
    for (const [createdAt, amount] of [
      ["2026-10-24T21:59:59Z", 1],
      ["2026-10-24T22:00:00Z", 2],
      ["2026-10-25T00:30:00Z", 4],
      ["2026-10-25T01:30:00Z", 8],
      ["2026-10-25T22:59:59Z", 16],
      ["2026-10-25T23:00:00Z", 32],
    ] as const) {
      expect((await postWebhook(ctx.app, apiOrder({ createdAt, amount }))).statusCode).toBe(200);
    }
    const res = await dailyTotals(ctx.app, "c_1", "2026-10-24", "2026-10-26");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-10-24", total: 1, gross: 1, discount: 0, net: 1 },
      { date: "2026-10-25", total: 30, gross: 30, discount: 0, net: 30 },
      { date: "2026-10-26", total: 32, gross: 32, discount: 0, net: 32 },
    ]);
  });

  it.each([
    [
      "America/New_York",
      "2026-02-10T04:59:59Z",
      "2026-02-10T05:00:00Z",
      "2026-02-13T04:59:59Z",
      "2026-02-13T05:00:00Z",
    ],
    [
      "Asia/Kathmandu",
      "2026-02-09T18:14:59Z",
      "2026-02-09T18:15:00Z",
      "2026-02-12T18:14:59Z",
      "2026-02-12T18:15:00Z",
    ],
    [
      "Pacific/Kiritimati",
      "2026-02-09T09:59:59Z",
      "2026-02-09T10:00:00Z",
      "2026-02-12T09:59:59Z",
      "2026-02-12T10:00:00Z",
    ],
    [
      "Etc/GMT+12",
      "2026-02-10T11:59:59Z",
      "2026-02-10T12:00:00Z",
      "2026-02-13T11:59:59Z",
      "2026-02-13T12:00:00Z",
    ],
  ])("соблюдает границы периода в %s", async (zone, before, start, end, after) => {
    ctx.api.customers.set("c_1", zone);
    for (const [createdAt, amount] of [
      [before, 100],
      [start, 1],
      [end, 2],
      [after, 200],
    ] as const) {
      expect((await postWebhook(ctx.app, apiOrder({ createdAt, amount }))).statusCode).toBe(200);
    }
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-12");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 1, gross: 1, discount: 0, net: 1 },
      { date: "2026-02-11", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-12", total: 2, gross: 2, discount: 0, net: 2 },
    ]);
  });

  it("не зависит от часового пояса процесса", async () => {
    ctx.api.customers.set("c_1", "Europe/Berlin");
    expect(
      (await postWebhook(ctx.app, apiOrder({ createdAt: "2026-03-29T22:30:00Z", amount: 7 })))
        .statusCode,
    ).toBe(200);
    try {
      for (const zone of ["Pacific/Honolulu", "Asia/Tokyo"]) {
        vi.stubEnv("TZ", zone);
        const res = await dailyTotals(ctx.app, "c_1", "2026-03-29", "2026-03-30");
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual([
          { date: "2026-03-29", total: 0, gross: 0, discount: 0, net: 0 },
          { date: "2026-03-30", total: 7, gross: 7, discount: 0, net: 7 },
        ]);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([
      { date: "2026-02-09", total: 0, gross: 0, discount: 0, net: 0 },
      { date: "2026-02-10", total: 1000, gross: 1000, discount: 0, net: 1000 },
      { date: "2026-02-11", total: 349, gross: 349, discount: 0, net: 349 },
    ]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 500, gross: 500, discount: 0, net: 500 },
    ]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 800, gross: 800, discount: 0, net: 800 },
    ]);
  });

  it("суммирует скидки в копейках только для оплаченных заказов", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 1.15, amountPaid: 0.29 }));
    await postWebhook(ctx.app, apiOrder({ amount: 10.99, amountPaid: 8.5 }));
    await postWebhook(ctx.app, apiOrder({ amount: 2.01 }));
    await postWebhook(ctx.app, apiOrder({ amount: 100, amountPaid: 1, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 100, amountPaid: 1, status: "refunded" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([
      { date: "2026-02-10", total: 14.15, gross: 14.15, discount: 3.35, net: 10.8 },
    ]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });
});
