import * as z from "zod";

export const CloudNodeTypeSchema = z.enum(["service", "database", "cache", "bucket", "security_group", "queue"]);
export const CloudPropsSchema = z.object({
  resourceName: z.string().trim().min(1).max(63).optional(),
  public: z.boolean().optional(),
  encryption: z.boolean().optional(),
  engine: z.string().trim().min(1).max(40).optional(),
  instanceClass: z.string().trim().min(1).max(80).optional(),
  ingress: z.array(z.object({ cidr: z.string(), port: z.number().int().min(1).max(65535) }).strict()).max(32).optional(),
  tags: z.record(z.string(), z.string()).optional(),
}).strict();
export const CloudConstraintSchema = z.object({
  provider: z.enum(["aws", "azure", "gcp"]).default("aws"),
  region: z.string().regex(/^[a-z]{2}(?:-[a-z]+)+-\d+$/).default("us-east-1"),
  monthly_budget_usd: z.number().positive().optional(),
  compliance: z.array(z.string()).default([]),
}).strict();
