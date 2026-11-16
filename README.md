# orders-aggregator

Сервис забирает заказы интернет-магазина из внешней системы (API поддерживает другая команда),
принимает их обновления через вебхуки и считает статистику по клиентам.

## Стек

Node 20+, TypeScript, Fastify, PostgreSQL (`pg`), Zod, Vitest.

## Запуск

Образ внешнего API лежит рядом с этой папкой — загрузите тот, что под вашу архитектуру (`uname -m`):

```bash
docker load -i ../orders-mock-arm64.tar.gz   # arm64 / aarch64 (Mac на Apple Silicon)
docker load -i ../orders-mock-amd64.tar.gz   # x86_64
```

```bash
cp .env.example .env
docker compose up -d        # PostgreSQL (+ тестовая БД orders_test) и внешний API на :4000
npm install
npm run migrate
npm run dev                 # http://localhost:3000
```

Отправка вебхуков из внешней системы (для разработки запускается вручную, сервис должен быть запущен):

```bash
docker compose run --rm orders-api webhooks --target http://host.docker.internal:3000/webhooks/order
```

Тесты (нужен запущенный PostgreSQL):

```bash
npm test
```

Проверка кода без изменения файлов:

```bash
npm run lint
npm run format:check
npm run typecheck
```

Biome проверяет исходный код и тесты. Для автоматического форматирования выполните `npm run format`.

## Структура

```
src/
  app.ts              Fastify-приложение, обработка ошибок
  container.ts        сборка зависимостей
  db.ts               пул соединений, миграции
  clients/            клиент внешнего API (лимиты, ретраи)
  repositories/       доступ к данным
  services/           бизнес-логика
  routes/             HTTP-слой
  utils/              деньги, время
migrations/           SQL-миграции, применяются по порядку
test/                 интеграционные тесты на реальной БД (внешний API — фейк)
```

## Соглашения

- Деньги внутри сервиса — в копейках (integer). Рубли — только на входе из внешнего API и в ответах.
- Время храним в UTC (`TIMESTAMPTZ`).
- Ошибки бизнес-логики — наследники `AppError`, в ответе `{ error: <код>, message }`.

## API сервиса

Swagger UI доступен после запуска сервиса: [http://localhost:3000/docs/](http://localhost:3000/docs/). OpenAPI-схема для импорта в Postman: [http://localhost:3000/docs/json](http://localhost:3000/docs/json). Описание контракта находится в `src/openapi.ts`; обновляйте его при изменении API. Запросы в Swagger UI изменяют данные так же, как обычные HTTP-запросы.


| Метод | Путь | Описание |
|---|---|---|
| POST | `/sync` | Забрать все заказы из внешнего API. Отвечает статистикой, когда всё забрано |
| POST | `/webhooks/order` | Обновление заказа (тело — `Order` внешнего API). Повтор/устаревшая версия → `200 { result: "stale" }` |
| GET | `/customers/:id/daily-totals?from=YYYY-MM-DD&to=YYYY-MM-DD` | Суммы оплаченных (`paid`) заказов по дням в таймзоне клиента: `[{ date, total, gross, discount, net }]` |
| GET | `/health` | Проверка живости |

В ответе дневной статистики суммы указаны в рублях:

- `gross` — сумма заказов до скидки; `total` равен `gross`.
- `net` — сумма оплаты; `discount` равен `gross - net`.
- Для дня без оплаченных заказов все суммы равны нулю.

Если в заказе нет `amountPaid`, сервис считает оплату равной `amount`.
Для таких заказов скидка считается нулевой, хотя фактическая скидка может быть неизвестна.

## Внешний API (`ORDERS_API_URL`)

- `GET /orders?cursor=<string>&limit=<1..100>` → `{ items: Order[], nextCursor: string | null }`. Лимит 5 rps.
- `GET /customers/:id` → `{ id, timezone }` (IANA, например `Europe/Berlin`).
- Вебхуки: `POST` на наш `/webhooks/order`, тело — `Order`. Повторная доставка возможна.

```ts
type Order = {
  id: string;
  customerId: string;
  amount: number;          // сумма заказа в рублях, до скидки
  discountPercent?: number;          // скидка, % (0 — без скидки)
  amountPaid?: number | string;      // оплачено, в рублях: amount со скидкой
  status: "pending" | "paid" | "refunded";
  createdAt: string;       // ISO 8601, UTC
  updatedAt: string;       // ISO 8601, UTC
};
```

Сервис использует `amountPaid`, когда поле присутствует. `discountPercent` в расчёте не используется.
Mock API может не передавать эти поля. Числовые суммы также принимаются в виде строк.
