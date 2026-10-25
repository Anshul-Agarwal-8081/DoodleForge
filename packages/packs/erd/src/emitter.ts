import type { Graph } from "@doodleforge/ir";
import { ErdEntityPropsSchema, type ErdColumn } from "./schema.js";

export type ErdForeignKey = { table: string; column: string; referencedTable: string; referencedColumn: string };
export type ErdEmission = { sql: string; tables: string[]; assumptions: string[]; foreignKeys: ErdForeignKey[] };

export function inferSqlType(columnName: string): ErdColumn["type"] {
  const name = columnName.toLowerCase();
  if (name === "id" || name.endsWith("_id")) return "uuid";
  if (name === "email" || name.endsWith("_email")) return "text";
  if (name.endsWith("_at")) return "timestamptz";
  if (name.startsWith("is_") || name.startsWith("has_")) return "boolean";
  if (/price|amount|cost|total/.test(name)) return "numeric(12,2)";
  if (/count|quantity|rank|age/.test(name)) return "integer";
  if (/metadata|payload|settings/.test(name)) return "jsonb";
  return "text";
}

export function emitErdSql(graph: Graph): ErdEmission {
  const entities = graph.nodes.filter((node) => node.type === "entity");
  if (entities.length === 0) throw new Error("The ERD has no entity nodes");
  const tableByNode = new Map<string, string>();
  for (const node of entities) {
    const props = ErdEntityPropsSchema.parse(node.props);
    const table = sqlIdentifier(props.tableName ?? node.label);
    if ([...tableByNode.values()].includes(table)) throw new Error(`Entity table name '${table}' is duplicated`);
    tableByNode.set(node.id, table);
  }

  const columnsByNode = new Map<string, ErdColumn[]>();
  const assumptions: string[] = [];
  for (const node of entities) {
    const props = ErdEntityPropsSchema.parse(node.props);
    for (const column of props.columns) {
      if (!column.type) assumptions.push(`${tableByNode.get(node.id)}.${column.name}: inferred ${inferSqlType(column.name)}`);
    }
    const columns = props.columns.map((column) => ({ ...column, type: column.type ?? inferSqlType(column.name) }));
    const normalized = columns.map((column) => sqlIdentifier(column.name));
    if (new Set(normalized).size !== normalized.length) throw new Error(`Entity '${node.label}' has duplicate column names`);
    if (!columns.some((column) => column.primaryKey)) {
      if (columns.some((column) => sqlIdentifier(column.name) === "id")) {
        columns.find((column) => sqlIdentifier(column.name) === "id")!.primaryKey = true;
      } else {
        columns.unshift({ name: "id", type: "uuid", primaryKey: true, nullable: false });
        assumptions.push(`${tableByNode.get(node.id)}: added an id UUID primary key`);
      }
    }
    columnsByNode.set(node.id, columns);
  }

  const statements: string[] = [];
  const foreignKeys: ErdForeignKey[] = [];
  for (const node of entities) {
    const table = tableByNode.get(node.id)!;
    const columns = columnsByNode.get(node.id)!;
    const generatedColumns: string[] = [];
    const constraints: string[] = [];
    const indexes: string[] = [];
    for (const edge of graph.edges) {
      if (edge.relation === "one_to_many" && edge.to.node === node.id && tableByNode.has(edge.from.node)) {
        const parent = tableByNode.get(edge.from.node)!;
        const parentPk = primaryKeyName(columnsByNode.get(edge.from.node)!);
        const name = `${parent}_id`;
        const parentType = columnsByNode.get(edge.from.node)!.find((column) => sqlIdentifier(column.name) === parentPk)!.type ?? "uuid";
        const column = columns.find((item) => sqlIdentifier(item.name) === name);
        if (!column) generatedColumns.push(`${quote(name)} ${parentType}`);
        constraints.push(`CONSTRAINT ${quote(sqlIdentifier(`fk_${table}_${edge.id}`))} FOREIGN KEY (${quote(name)}) REFERENCES ${quote(parent)}(${quote(parentPk)}) ON DELETE CASCADE`);
        foreignKeys.push({ table, column: name, referencedTable: parent, referencedColumn: parentPk });
        indexes.push(`CREATE INDEX ${quote(sqlIdentifier(`${table}_${name}_${edge.id}_idx`))} ON ${quote(table)} (${quote(name)});`);
      }
    }
    const definitions = columns.map((column) => {
      const parts = [quote(column.name), column.type ?? inferSqlType(column.name)];
      if (column.primaryKey) parts.push("PRIMARY KEY");
      if (column.unique || /^(email|.*_email)$/i.test(column.name)) parts.push("UNIQUE");
      if (column.nullable === false || column.primaryKey) parts.push("NOT NULL");
      return parts.join(" ");
    });
    statements.push(`CREATE TABLE ${quote(table)} (\n  ${[...definitions, ...generatedColumns, ...constraints].join(",\n  ")}\n);`);
    statements.push(...indexes);
  }

  for (const edge of graph.edges.filter((item) => item.relation === "many_to_many")) {
    const left = tableByNode.get(edge.from.node);
    const right = tableByNode.get(edge.to.node);
    if (!left || !right) throw new Error(`Relationship '${edge.id}' must connect two entity nodes`);
    const join = sqlIdentifier(`${left}_${right}_link`);
    const leftPk = primaryKeyName(columnsByNode.get(edge.from.node)!);
    const rightPk = primaryKeyName(columnsByNode.get(edge.to.node)!);
    const leftKey = `${left}_id`;
    const rightKey = `${right}_id`;
    const leftType = columnsByNode.get(edge.from.node)!.find((column) => sqlIdentifier(column.name) === leftPk)!.type ?? "uuid";
    const rightType = columnsByNode.get(edge.to.node)!.find((column) => sqlIdentifier(column.name) === rightPk)!.type ?? "uuid";
    statements.push(`CREATE TABLE ${quote(join)} (\n  ${quote(leftKey)} ${leftType} NOT NULL REFERENCES ${quote(left)}(${quote(leftPk)}) ON DELETE CASCADE,\n  ${quote(rightKey)} ${rightType} NOT NULL REFERENCES ${quote(right)}(${quote(rightPk)}) ON DELETE CASCADE,\n  PRIMARY KEY (${quote(leftKey)}, ${quote(rightKey)})\n);`);
    foreignKeys.push({ table: join, column: leftKey, referencedTable: left, referencedColumn: leftPk });
    foreignKeys.push({ table: join, column: rightKey, referencedTable: right, referencedColumn: rightPk });
    statements.push(`CREATE INDEX ${quote(`${join}_${rightKey}_idx`)} ON ${quote(join)} (${quote(rightKey)});`);
    tableByNode.set(`join:${edge.id}`, join);
  }

  return { sql: `${statements.join("\n\n")}\n`, tables: [...tableByNode.values()], assumptions, foreignKeys };
}

function primaryKeyName(columns: ErdColumn[]): string {
  const key = columns.find((column) => column.primaryKey);
  if (!key) throw new Error("An entity must have a primary key after normalization");
  return sqlIdentifier(key.name);
}

function sqlIdentifier(value: string): string {
  const result = value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  if (!result || !/^[a-z_][a-z0-9_]*$/.test(result)) throw new Error(`Invalid SQL identifier '${value}'`);
  return result;
}

function quote(identifier: string) { return `"${identifier.replaceAll('"', '""')}"`; }
