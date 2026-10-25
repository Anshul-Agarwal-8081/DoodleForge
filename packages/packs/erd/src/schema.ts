import * as z from "zod";

export const SqlTypeSchema = z.enum(["uuid", "text", "integer", "boolean", "timestamptz", "numeric(12,2)", "jsonb"]);
export const ErdColumnSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: SqlTypeSchema.optional(),
  primaryKey: z.boolean().optional(),
  nullable: z.boolean().optional(),
  unique: z.boolean().optional(),
}).strict();
export const ErdEntityPropsSchema = z.object({
  tableName: z.string().trim().min(1).max(80).optional(),
  columns: z.array(ErdColumnSchema).max(128).default([]),
}).passthrough();
export const ErdRelationshipSchema = z.enum(["one_to_many", "many_to_many"]);
export type ErdColumn = z.infer<typeof ErdColumnSchema>;
