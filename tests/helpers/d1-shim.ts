import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type { DatabaseLike, StatementLike } from "../../functions/_lib/types";

class StatementShim implements StatementLike {
  private readonly stmt: Database.Statement;
  private readonly values: unknown[];

  constructor(stmt: Database.Statement, values: unknown[] = []) {
    this.stmt = stmt;
    this.values = values;
  }

  bind(...values: unknown[]): StatementLike {
    return new StatementShim(this.stmt, values);
  }

  async run<T = Record<string, unknown>>(): Promise<{ success: boolean; results?: T[] }> {
    this.stmt.run(...this.values);
    return { success: true };
  }

  async all<T = Record<string, unknown>>(): Promise<{ results: T[] }> {
    const results = this.stmt.all(...this.values) as T[];
    return { results };
  }

  async first<T = Record<string, unknown>>(columnName?: string): Promise<T | null> {
    const result = this.stmt.get(...this.values) as T | undefined;
    if (!result) {
      return null;
    }

    if (columnName) {
      const value = (result as Record<string, unknown>)[columnName];
      return (value ?? null) as T;
    }

    return result;
  }
}

export class D1DatabaseShim implements DatabaseLike {
  private readonly db: Database.Database;

  constructor() {
    this.db = new Database(":memory:");
    this.db.pragma("foreign_keys = ON");
  }

  prepare(query: string): StatementLike {
    return new StatementShim(this.db.prepare(query));
  }

  async batch(statements: StatementLike[]): Promise<unknown[]> {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  }

  async exec(query: string): Promise<void> {
    this.db.exec(query);
  }

  runMigrations(): void {
    const migrationDir = path.resolve(process.cwd(), "migrations");
    const files = fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort();

    for (const file of files) {
      const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
      this.db.exec(sql);
    }
  }

  raw<T = unknown>(query: string, values: unknown[] = []): T[] {
    return this.db.prepare(query).all(...values) as T[];
  }
}
