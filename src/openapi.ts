import type { FastifyDynamicSwaggerOptions } from "@fastify/swagger";

const errorResponse = {
  description: "Ошибка запроса",
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

export const openapi: NonNullable<FastifyDynamicSwaggerOptions["openapi"]> = {
  openapi: "3.0.3",
  info: { title: "Orders Aggregator API", version: "2.3.0" },
  components: {
    schemas: {
      Error: {
        type: "object",
        required: ["error", "message"],
        properties: { error: { type: "string" }, message: { type: "string" } },
      },
      Order: {
        type: "object",
        required: ["id", "customerId", "amount", "status", "createdAt", "updatedAt"],
        properties: {
          id: { type: "string", example: "o_manual_1" },
          customerId: { type: "string", example: "c_7" },
          amount: {
            oneOf: [{ type: "number" }, { type: "string" }],
            example: 1000,
            description: "Сумма в рублях",
          },
          status: { type: "string", enum: ["pending", "paid", "refunded"] },
          createdAt: { type: "string", format: "date-time", example: "2026-03-27T12:00:00Z" },
          updatedAt: { type: "string", format: "date-time", example: "2026-03-27T12:00:00Z" },
          discountPercent: {
            type: "number",
            description: "Поле внешнего API; сейчас не используется сервисом",
          },
          amountPaid: {
            type: "number",
            description: "Поле внешнего API; сейчас не используется сервисом",
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Проверить доступность сервиса",
        responses: {
          200: {
            description: "Сервис доступен",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { status: { type: "string", example: "ok" } },
                },
              },
            },
          },
        },
      },
    },
    "/sync": {
      post: {
        summary: "Синхронизировать заказы",
        description: "Ответ возвращается после загрузки всех страниц.",
        responses: {
          200: {
            description: "Статистика синхронизации",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: Object.fromEntries(
                    ["pages", "received", "applied", "stale", "invalid"].map((name) => [
                      name,
                      { type: "integer" },
                    ]),
                  ),
                },
              },
            },
          },
          500: errorResponse,
          502: errorResponse,
        },
      },
    },
    "/webhooks/order": {
      post: {
        summary: "Применить обновление заказа",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/Order" },
              example: {
                id: "o_manual_1",
                customerId: "c_7",
                amount: 1000,
                status: "paid",
                createdAt: "2026-03-27T12:00:00Z",
                updatedAt: "2026-03-27T12:00:00Z",
              },
            },
          },
        },
        responses: {
          200: {
            description: "Результат обработки",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { result: { type: "string", enum: ["created", "updated", "stale"] } },
                },
              },
            },
          },
          400: errorResponse,
          500: errorResponse,
        },
      },
    },
    "/customers/{id}/daily-totals": {
      get: {
        summary: "Получить дневные суммы клиента",
        description: "Суммы оплаченных заказов в рублях за включительный диапазон дат.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, example: "c_7" },
          ...["from", "to"].map((name) => ({
            name,
            in: "query",
            required: true,
            schema: { type: "string" as const, format: "date" },
            example: name === "from" ? "2026-03-27" : "2026-03-31",
          })),
        ],
        responses: {
          200: {
            description: "Суммы по дням",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      date: { type: "string", format: "date" },
                      total: { type: "number", description: "Сумма в рублях" },
                    },
                  },
                },
              },
            },
          },
          400: errorResponse,
          404: errorResponse,
          500: errorResponse,
          502: errorResponse,
        },
      },
    },
  },
};
