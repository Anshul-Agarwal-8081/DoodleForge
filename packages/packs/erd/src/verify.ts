import { PGlite } from "@electric-sql/pglite";
import type { Graph } from "@doodleforge/ir";
import { emitErdSql } from "./emitter.js";

export async function verifyErdGraph(graph: Graph) {
  const emission = emitErdSql(graph);
  let database: PGlite | undefined;
  try {
    database = new PGlite();
    await database.exec(emission.sql);
    const tables = await database.query<{ tablename: string }>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename");
    const foreignKeys = await database.query<{ table_name: string; column_name: string; referenced_table: string; referenced_column: string }>(
      "SELECT tc.table_name, kcu.column_name, ccu.table_name AS referenced_table, ccu.column_name AS referenced_column FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public' ORDER BY tc.table_name, kcu.column_name, ccu.table_name, ccu.column_name",
    );
    const expectedTables = [...emission.tables].sort();
    const actualTables = tables.rows.map((row) => row.tablename).sort();
    const key = (item: { table: string; column: string; referencedTable: string; referencedColumn: string }) => `${item.table}.${item.column}->${item.referencedTable}.${item.referencedColumn}`;
    const expectedForeignKeys = emission.foreignKeys.map(key).sort();
    const actualForeignKeys = foreignKeys.rows.map((row) => key({ table: row.table_name, column: row.column_name, referencedTable: row.referenced_table, referencedColumn: row.referenced_column })).sort();
    const tablePreviews = await Promise.all(actualTables.map(async (table) => {
      const columns = await database!.query<{ column_name: string; data_type: string }>(
        "SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position",
        [table],
      );
      const rows = await database!.query<Record<string, unknown>>(`SELECT * FROM ${quoteIdentifier(table)} LIMIT 5`);
      return { table, columns: columns.rows, rows: rows.rows };
    }));
    return {
      valid: expectedTables.length === actualTables.length && expectedTables.every((table, index) => table === actualTables[index]) && expectedForeignKeys.length === actualForeignKeys.length && expectedForeignKeys.every((relationship, index) => relationship === actualForeignKeys[index]),
      tables: actualTables,
      expectedTables,
      foreignKeyCount: actualForeignKeys.length,
      expectedForeignKeys,
      actualForeignKeys,
      tablePreviews,
      assumptions: emission.assumptions,
      sql: emission.sql,
    };
  } catch (error) {
    return { valid: false, tables: [], expectedTables: emission.tables, foreignKeyCount: 0, expectedForeignKeys: emission.foreignKeys.map((item) => `${item.table}.${item.column}->${item.referencedTable}.${item.referencedColumn}`), actualForeignKeys: [], tablePreviews: [], assumptions: emission.assumptions, sql: emission.sql, error: error instanceof Error ? error.message : String(error) };
  } finally {
    await database?.close();
  }
}

function quoteIdentifier(identifier: string) { return `"${identifier.replaceAll('"', '""')}"`; }
