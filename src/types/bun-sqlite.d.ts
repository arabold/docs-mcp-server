declare module "bun:sqlite" {
  type SQLQueryBinding =
    | string
    | number
    | bigint
    | boolean
    | null
    | Uint8Array
    | Record<string, SQLQueryBinding>;

  interface StatementRunResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  interface Transaction<Result> {
    (): Result;
    immediate(): Result;
  }

  export class Statement<
    BindParameters extends SQLQueryBinding[] = SQLQueryBinding[],
    Result = unknown,
  > {
    all(...bindings: BindParameters): Result[];
    get(...bindings: BindParameters): Result | null;
    run(...bindings: BindParameters): StatementRunResult;
  }

  interface BunSqliteDatabase {
    loadExtension(path: string, entrypoint?: string): void;
  }

  export class Database {
    constructor(
      filename?: string,
      options?: { readonly?: boolean; create?: boolean; readwrite?: boolean },
    );

    static setCustomSQLite(path: string): void;

    exec(query: string): void;
    prepare<
      BindParameters extends SQLQueryBinding[] = SQLQueryBinding[],
      Result = unknown,
    >(query: string): Statement<BindParameters, Result>;
    query<BindParameters extends SQLQueryBinding[] = SQLQueryBinding[], Result = unknown>(
      query: string,
    ): Statement<BindParameters, Result>;
    transaction<Result>(callback: () => Result): Transaction<Result>;
    close(force?: boolean): void;
  }

  export interface Database extends BunSqliteDatabase {}

  export namespace Database {
    export type Statement<
      BindParameters extends SQLQueryBinding[] = SQLQueryBinding[],
      Result = unknown,
    > = import("bun:sqlite").Statement<BindParameters, Result>;
  }
}
