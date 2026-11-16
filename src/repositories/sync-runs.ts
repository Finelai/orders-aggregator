import type { Db } from "../db.js";

export class SyncRunsRepository {
  constructor(private readonly db: Db) {}

  async start(): Promise<number> {
    const { rows } = await this.db.query<{ id: number }>(
      `INSERT INTO sync_runs DEFAULT VALUES RETURNING id`,
    );
    const row = rows[0];
    if (!row) {
      throw new Error("Failed to create sync run: no row returned");
    }
    return row.id;
  }

  async finish(
    id: number,
    stats: { pages: number; received: number; error?: string },
  ): Promise<void> {
    await this.db.query(
      `UPDATE sync_runs SET finished_at = now(), pages = $2, received = $3, error = $4 WHERE id = $1`,
      [id, stats.pages, stats.received, stats.error ?? null],
    );
  }
}
