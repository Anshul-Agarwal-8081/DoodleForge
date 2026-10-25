import * as z from "zod";
import type { Graph } from "@doodleforge/ir";
import { runRules, userStoryRules } from "@doodleforge/rules";

export const AcceptanceCriterionSchema = z.object({
  given: z.string().min(1),
  when: z.string().min(1),
  then: z.string().min(1),
}).strict();

export const PrioritySchema = z.enum(["Must", "Should", "Could", "Won't"]);
export const PrioritySourceSchema = z.enum(["mark", "quadrant", "default", "user"]);

export const UserStoryPropsSchema = z.object({
  story_id: z.string().optional(),
  story: z.string().optional(),
  persona: z.string().optional(),
  benefit: z.string().optional(),
  acceptance: z.array(AcceptanceCriterionSchema).default([]),
  priority: PrioritySchema.default("Should"),
  priority_source: PrioritySourceSchema.default("default"),
  estimate: z.number().min(0).max(1000).optional(),
}).strict();

export const UserStoryRecordSchema = z.object({
  id: z.string().min(1),
  epic: z.string().optional(),
  persona: z.string().optional(),
  title: z.string().min(1),
  story: z.string().min(1),
  acceptance: z.array(AcceptanceCriterionSchema),
  priority: PrioritySchema,
  priority_source: PrioritySourceSchema,
  depends_on: z.array(z.string()),
  source_tags: z.array(z.number().int().positive()),
  confidence: z.number().min(0).max(1),
  estimate: z.number().min(0).max(1000).optional(),
}).strict();

export type UserStoryRecord = z.infer<typeof UserStoryRecordSchema>;
export type StoryAudit = { record?: UserStoryRecord; valid: boolean; status: "verified" | "draft"; errors: string[] };

export function storyRecordFromNode(graph: Graph, nodeId: string): StoryAudit | undefined {
  return storyAuditsFromGraph(graph).get(nodeId);
}

export function storyAuditsFromGraph(graph: Graph): Map<string, StoryAudit> {
  const diagnostics = runRules(graph, userStoryRules);
  const results = new Map<string, StoryAudit>();
  for (const node of graph.nodes.filter((item) => item.type === "story")) {
    const group = graph.groups.find((item) => item.id === node.group);
    const targetDiagnostics = diagnostics.filter((item) =>
      item.targets.some((target) => target.node === node.id || (target.edge && graph.edges.some((edge) => edge.id === target.edge && [edge.from.node, edge.to.node].includes(node.id)))),
    );
    const props = UserStoryPropsSchema.safeParse(node.props);
    const parsed = UserStoryRecordSchema.safeParse({
      id: typeof node.props.story_id === "string" ? node.props.story_id : node.id,
      ...(group ? { epic: group.label } : {}),
      ...(typeof node.props.persona === "string" && node.props.persona.trim() ? { persona: node.props.persona } : {}),
      title: node.label,
      story: typeof node.props.story === "string" && node.props.story.trim() ? node.props.story : `As a user, I want ${node.label.toLowerCase()}`,
      acceptance: node.props.acceptance ?? [],
      priority: node.props.priority ?? "Should",
      priority_source: node.props.priority_source ?? "default",
      depends_on: graph.edges.filter((edge) => edge.relation === "depends_on" && edge.from.node === node.id).map((edge) => graph.nodes.find((item) => item.id === edge.to.node)?.label ?? edge.to.node),
      source_tags: node.region?.marker === undefined ? [] : [node.region.marker],
      confidence: node.confidence,
      ...(typeof node.props.estimate === "number" ? { estimate: node.props.estimate } : {}),
    });
    const errors = [
      ...(props.success ? [] : props.error.issues.map((issue) => `props.${issue.path.join(".") || "story"}: ${issue.message}`)),
      ...(parsed.success ? [] : parsed.error.issues.map((issue) => `${issue.path.join(".") || "story"}: ${issue.message}`)),
      ...targetDiagnostics.map((diagnostic) => diagnostic.message),
    ];
    results.set(node.id, {
      ...(parsed.success ? { record: parsed.data } : {}),
      valid: props.success && parsed.success,
      status: props.success && parsed.success && targetDiagnostics.length === 0 ? "verified" : "draft",
      errors,
    });
  }
  return results;
}

export function userStoryMarkdown(graph: Graph): string {
  const audits = storyAuditsFromGraph(graph);
  const rows = graph.nodes.filter((node) => node.type === "story").map((node) => audits.get(node.id)).filter((item): item is StoryAudit => Boolean(item?.record));
  const sections = rows.map(({ record }) => {
    const epic = record!.epic ? `\nEpic: ${record!.epic}` : "";
    const criteria = record!.acceptance.length
      ? record!.acceptance.map((criterion) => `- Given ${criterion.given}, when ${criterion.when}, then ${criterion.then}`).join("\n")
      : "- Not provided";
    return `## ${record!.id}: ${record!.title}\n\n${record!.story}${epic}\n\nPriority: ${record!.priority} (${record!.priority_source})\n\nAcceptance criteria:\n${criteria}`;
  });
  return `# DoodleForge backlog\n\nStories with missing required information remain drafts. Estimates are advisory.\n\n${sections.join("\n\n")}${sections.length ? "\n" : ""}`;
}
