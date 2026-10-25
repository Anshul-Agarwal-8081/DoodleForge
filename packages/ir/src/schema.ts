import * as z from "zod";

export const BoxSchema = z
  .tuple([
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
    z.number().int().min(0).max(1000),
  ])
  .refine(([ymin, xmin, ymax, xmax]) => ymin <= ymax && xmin <= xmax, {
    message: "Box coordinates must be ordered as [ymin, xmin, ymax, xmax]",
  });
export type Box = z.infer<typeof BoxSchema>;

export const OriginSchema = z.enum(["gemma", "rule", "user"]);
export const ViaSchema = z.enum(["sketch", "text", "voice", "manual"]);
export const SeveritySchema = z.enum(["low", "medium", "high"]);
export const TrustSchema = z.enum(["verified", "advisory"]);

export const PortSchema = z.object({ id: z.string().min(1), dir: z.enum(["in", "out"]) }).strict();
export const RegionSchema = z
  .object({ marker: z.number().int().nonnegative().optional(), box: BoxSchema })
  .strict();

export const NodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1),
    label: z.string(),
    props: z.record(z.string(), z.unknown()),
    ports: z.array(PortSchema).optional(),
    region: RegionSchema.optional(),
    group: z.string().optional(),
    confidence: z.number().min(0).max(1),
    origin: OriginSchema,
    via: ViaSchema,
  })
  .strict();

export const EdgeEndpointSchema = z
  .object({ node: z.string().min(1), port: z.string().min(1).optional() })
  .strict();

export const EdgeSchema = z
  .object({
    id: z.string().min(1),
    from: EdgeEndpointSchema,
    to: EdgeEndpointSchema,
    relation: z.string().min(1),
    label: z.string().optional(),
    region: z.object({ box: BoxSchema }).strict().optional(),
    confidence: z.number().min(0).max(1),
    origin: OriginSchema,
    via: ViaSchema,
  })
  .strict();

export const GroupSchema = z
  .object({ id: z.string().min(1), label: z.string(), members: z.array(z.string()) })
  .strict()
  .refine((group) => new Set(group.members).size === group.members.length, {
    message: "Group members must be unique",
  });

export const AssumptionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    status: z.enum(["open", "accepted", "rejected"]),
    patchId: z.string().min(1),
  })
  .strict();

export const QuestionSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    options: z.array(z.string()),
    targets: z.array(z.string()),
  })
  .strict();

export const SourceSchema = z
  .object({
    image_id: z.string().min(1),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const DiagnosticTargetSchema = z
  .object({ node: z.string().min(1).optional(), edge: z.string().min(1).optional() })
  .strict()
  .refine((target) => Number(Boolean(target.node)) + Number(Boolean(target.edge)) === 1, {
    message: "A diagnostic target must identify exactly one node or edge",
  });

export type Patch = {
  id: string;
  base_version: number;
  origin: z.infer<typeof OriginSchema>;
  via: z.infer<typeof ViaSchema>;
  reason: string;
  ops: PatchOp[];
};

export type Diagnostic = {
  id: string;
  rule: string;
  severity: z.infer<typeof SeveritySchema>;
  trust: z.infer<typeof TrustSchema>;
  targets: Array<{ node?: string; edge?: string }>;
  message: string;
  fix?: Patch;
};

export const DiagnosticSchema: z.ZodType<Diagnostic> = z
  .object({
    id: z.string().min(1),
    rule: z.string().min(1),
    severity: SeveritySchema,
    trust: TrustSchema,
    targets: z.array(DiagnosticTargetSchema),
    message: z.string().min(1),
    fix: z.lazy(() => PatchSchema).optional(),
  })
  .strict();

export type Graph = {
  diagram_id: string;
  version: number;
  domain: string;
  source?: z.infer<typeof SourceSchema>;
  nodes: z.infer<typeof NodeSchema>[];
  edges: z.infer<typeof EdgeSchema>[];
  groups: z.infer<typeof GroupSchema>[];
  assumptions: z.infer<typeof AssumptionSchema>[];
  questions: z.infer<typeof QuestionSchema>[];
  diagnostics: Diagnostic[];
  constraints: Record<string, unknown>;
  style: Record<string, unknown>;
};

export const GraphSchema: z.ZodType<Graph> = z
  .object({
    diagram_id: z.string().min(1),
    version: z.number().int().nonnegative(),
    domain: z.string().min(1),
    source: SourceSchema.optional(),
    nodes: z.array(NodeSchema),
    edges: z.array(EdgeSchema),
    groups: z.array(GroupSchema),
    assumptions: z.array(AssumptionSchema),
    questions: z.array(QuestionSchema),
    diagnostics: z.array(DiagnosticSchema),
    constraints: z.record(z.string(), z.unknown()),
    style: z.record(z.string(), z.unknown()),
  })
  .strict();

export type PatchOp =
  | { type: "add_node"; node: z.infer<typeof NodeSchema> }
  | { type: "update_node"; node: z.infer<typeof NodeSchema> }
  | { type: "remove_node"; id: string }
  | { type: "merge_nodes"; source_id: string; target_id: string; label?: string }
  | { type: "add_edge"; edge: z.infer<typeof EdgeSchema> }
  | { type: "update_edge"; edge: z.infer<typeof EdgeSchema> }
  | { type: "remove_edge"; id: string }
  | { type: "group"; group: z.infer<typeof GroupSchema> }
  | { type: "ungroup"; id: string }
  | { type: "set_domain"; domain: string }
  | { type: "set_style"; style: Record<string, unknown> }
  | { type: "set_constraints"; constraints: Record<string, unknown> }
  | { type: "set_source"; source?: Graph["source"] }
  | { type: "set_diagnostics"; diagnostics: Diagnostic[] }
  | { type: "add_assumption"; assumption: z.infer<typeof AssumptionSchema> }
  | { type: "remove_assumption"; id: string }
  | { type: "ask_question"; question: z.infer<typeof QuestionSchema> }
  | { type: "resolve_question"; question_id: string }
  | { type: "remove_question"; id: string }
  | { type: "replace_all"; graph: Graph };

const PatchOpSchema: z.ZodType<PatchOp> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_node"), node: NodeSchema }).strict(),
  z.object({ type: z.literal("update_node"), node: NodeSchema }).strict(),
  z.object({ type: z.literal("remove_node"), id: z.string().min(1) }).strict(),
  z
    .object({
      type: z.literal("merge_nodes"),
      source_id: z.string().min(1),
      target_id: z.string().min(1),
      label: z.string().optional(),
    })
    .strict(),
  z.object({ type: z.literal("add_edge"), edge: EdgeSchema }).strict(),
  z.object({ type: z.literal("update_edge"), edge: EdgeSchema }).strict(),
  z.object({ type: z.literal("remove_edge"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("group"), group: GroupSchema }).strict(),
  z.object({ type: z.literal("ungroup"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("set_domain"), domain: z.string().min(1) }).strict(),
  z.object({ type: z.literal("set_style"), style: z.record(z.string(), z.unknown()) }).strict(),
  z
    .object({
      type: z.literal("set_constraints"),
      constraints: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal("set_source"),
      source: SourceSchema.optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("set_diagnostics"), diagnostics: z.array(DiagnosticSchema) })
    .strict(),
  z
    .object({ type: z.literal("add_assumption"), assumption: AssumptionSchema })
    .strict(),
  z.object({ type: z.literal("remove_assumption"), id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("ask_question"), question: QuestionSchema }).strict(),
  z.object({ type: z.literal("resolve_question"), question_id: z.string().min(1) }).strict(),
  z.object({ type: z.literal("remove_question"), id: z.string().min(1) }).strict(),
  z
    .object({ type: z.literal("replace_all"), graph: z.lazy(() => GraphSchema) })
    .strict(),
]);

export const PatchSchema: z.ZodType<Patch> = z
  .object({
    id: z.string().min(1),
    base_version: z.number().int().nonnegative(),
    origin: OriginSchema,
    via: ViaSchema,
    reason: z.string().min(1),
    ops: z.array(PatchOpSchema).min(1),
  })
  .strict();

export const FindingSchema = z
  .object({
    id: z.string().min(1),
    rule: z.string().min(1),
    severity: SeveritySchema,
    trust: TrustSchema,
    targets: z.array(DiagnosticTargetSchema),
    message: z.string().min(1),
    fix: PatchSchema.optional(),
  })
  .strict();

export const RuleSchema = z
  .object({
    id: z.string().min(1),
    pack: z.string().min(1),
    severity: SeveritySchema,
    check: z.custom<(graph: Graph) => Diagnostic[]>(
      (value) => typeof value === "function",
      { message: "Rule check must be a function" },
    ),
    fix: z
      .custom<(graph: Graph, finding: Diagnostic) => Patch>(
        (value) => typeof value === "function",
      )
      .optional(),
  })
  .strict();

const PropsSchema = z.custom<z.ZodType>(
  (value) => value instanceof z.ZodType,
  { message: "propsSchema must be a Zod schema" },
);

export const DomainPackSchema = z
  .object({
    id: z.string().min(1),
    vocabulary: z
      .object({
        nodeTypes: z.record(
          z.string(),
          z
            .object({
              propsSchema: PropsSchema,
              ports: z.array(PortSchema).optional(),
              icon: z.string().optional(),
            })
            .strict(),
        ),
        relations: z.array(z.string()),
        allowedPortPairs: z.tuple([z.string(), z.string()]).array(),
      })
      .strict(),
    classifierHint: z.string(),
    prompts: z
      .object({
        transcribe: z.string().optional(),
        structure: z.string(),
        fewShots: z.array(z.object({ input: z.string(), ir: GraphSchema }).strict()),
      })
      .strict(),
    patterns: z.array(z.unknown()).optional(),
    rules: z.array(RuleSchema),
    simulate: z.custom<(graph: Graph, inputs: Record<string, unknown>) => unknown>(
      (value) => typeof value === "function",
    ).optional(),
    emitters: z.array(
      z
        .object({
          id: z.string().min(1),
          emit: z.custom<(graph: Graph) => unknown>((value) => typeof value === "function"),
        })
        .strict(),
    ),
    preview: z.custom<(graph: Graph) => unknown>((value) => typeof value === "function").optional(),
  })
  .strict();

export type DomainPack = z.infer<typeof DomainPackSchema>;

