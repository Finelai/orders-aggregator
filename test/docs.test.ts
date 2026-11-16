import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { Container } from "../src/container.js";

describe("API documentation", () => {
  it("serves Swagger UI and the OpenAPI contract", async () => {
    const app = buildApp({} as Container);
    try {
      const ui = await app.inject({ method: "GET", url: "/docs/" });
      expect(ui.statusCode).toBe(200);
      expect(ui.body).toContain("Swagger UI");
      const spec = await app.inject({ method: "GET", url: "/docs/json" });
      expect(spec.statusCode).toBe(200);
      expect(Object.keys(spec.json().paths).sort()).toEqual([
        "/customers/{id}/daily-totals",
        "/health",
        "/sync",
        "/webhooks/order",
      ]);
      expect(
        spec.json().paths["/webhooks/order"].post.requestBody.content["application/json"].example
          .customerId,
      ).toBe("c_7");
      const dailySchema =
        spec.json().paths["/customers/{id}/daily-totals"].get.responses["200"].content[
          "application/json"
        ].schema.items;
      expect(dailySchema.required).toEqual(["date", "total", "gross", "discount", "net"]);
      expect(Object.keys(dailySchema.properties)).toEqual(dailySchema.required);
    } finally {
      await app.close();
    }
  });
});
