import * as z from "zod";
import type { Graph, Patch, PatchOp } from "@doodleforge/ir";

export const TextIntentSchema = z.enum(["create", "modify", "explain", "constrain", "command"]);
export const ArchitecturePatternSchema = z.enum(["three_tier", "event_driven", "microservices", "pipeline", "serverless", "story_map"]);
export type TextIntent = z.infer<typeof TextIntentSchema>;
export type ArchitecturePattern = z.infer<typeof ArchitecturePatternSchema>;

export const PATTERN_LIBRARY: Record<ArchitecturePattern, { title: string; labels: string[]; relations: Array<[number, number, string]>; domain: string }> = {
  three_tier: { title: "Three tier", labels: ["Web client", "Application API", "Primary database"], relations: [[0, 1, "calls"], [1, 2, "reads_writes"]], domain: "software" },
  event_driven: { title: "Event driven", labels: ["Producer", "Event queue", "Consumer"], relations: [[0, 1, "publishes"], [1, 2, "delivers"]], domain: "software" },
  microservices: { title: "Microservices", labels: ["API gateway", "User service", "Order service", "Event bus"], relations: [[0, 1, "routes_to"], [0, 2, "routes_to"], [2, 3, "publishes"]], domain: "software" },
  pipeline: { title: "Data pipeline", labels: ["Ingest", "Transform", "Warehouse"], relations: [[0, 1, "feeds"], [1, 2, "loads"]], domain: "software" },
  serverless: { title: "Serverless", labels: ["API endpoint", "Function", "Object storage"], relations: [[0, 1, "invokes"], [1, 2, "writes_to"]], domain: "cloud" },
  story_map: { title: "Story map", labels: ["Discover", "Plan", "Deliver"], relations: [[0, 1, "precedes"], [1, 2, "precedes"]], domain: "userstory" },
};

export type TextInterpretation = { intent: TextIntent; pattern?: ArchitecturePattern; message: string; patches: Patch[]; constraints?: Record<string, unknown>; assumptions: string[] };

export function classifyTextIntent(text: string): TextIntent {
  const value = text.trim();
  if (/^(undo|redo|undo last|redo last)(\b|$)/i.test(value)) return "command";
  if (/^(why|how does|what does|explain|show me why)\b/i.test(value)) return "explain";
  if (/\b(provider|region|budget|scale|compliance|hipaa|gdpr|soc ?2|pci|deploy in|under \$|monthly spend)\b/i.test(value)) return "constrain";
  if (/^(rename|change|update|remove|delete|add|replace)\b/i.test(value)) return "modify";
  return "create";
}

export function compileTextIntent(text: string, graph: Graph): TextInterpretation {
  const intent = classifyTextIntent(text);
  const value = text.trim();
  if (intent === "command") return { intent, message: /^undo/i.test(value) ? "Undo the last user patch." : "Redo the last undone patch.", patches: [], assumptions: [] };
  if (intent === "explain") return { intent, message: "Rule findings are verified by the active pack. Select a finding to see its targets, or ask about a specific node label.", patches: [], assumptions: [] };
  if (intent === "constrain") {
    const parsed = parseConstraints(value);
    if (Object.keys(parsed).length === 0) return { intent, message: "I could not extract a safe, explicit constraint. Include a provider, region, budget, scale, or compliance requirement.", patches: [], assumptions: [] };
    const constraints = { ...graph.constraints, ...parsed };
    return { intent, constraints: parsed, message: `Recorded ${Object.keys(parsed).join(", ")} as explicit graph constraints.`, patches: [patch(graph, `Set constraints: ${Object.keys(parsed).join(", ")}`, [{ type: "set_constraints", constraints }])], assumptions: [] };
  }
  if (intent === "modify") return compileModify(value, graph);
  const pattern = matchPattern(value);
  if (!pattern) return { intent, message: "No architecture pattern matched. Continuing with the standard text-to-graph flow.", patches: [], assumptions: [] };
  const definition = PATTERN_LIBRARY[pattern];
  const nodes = definition.labels.map((label, index) => ({
    id: `${safeId(graph.diagram_id)}-${pattern}-${graph.nodes.length + index + 1}`,
    type: pattern === "story_map" ? "story" : "service",
    label,
    props: pattern === "story_map" ? { story: label } : { component: label.toLowerCase().replaceAll(" ", "_") },
    confidence: 1,
    origin: "rule" as const,
    via: "text" as const,
  }));
  const edges = definition.relations.map(([from, to, relation], index) => ({
    id: `${safeId(graph.diagram_id)}-${pattern}-edge-${graph.edges.length + index + 1}`,
    from: { node: nodes[from]!.id }, to: { node: nodes[to]!.id }, relation,
    confidence: 1, origin: "rule" as const, via: "text" as const,
  }));
  const ops: PatchOp[] = [{ type: "set_domain", domain: definition.domain }, ...nodes.map((node) => ({ type: "add_node" as const, node })), ...edges.map((edge) => ({ type: "add_edge" as const, edge }))];
  return { intent, pattern, message: `Applied the ${definition.title} pattern with ${nodes.length} nodes and ${edges.length} connections.`, patches: [patch(graph, `Apply ${definition.title} pattern`, ops)], assumptions: [] };
}

function compileModify(text: string, graph: Graph): TextInterpretation {
  const match = text.match(/^(?:rename|change|update)\s+["“]?(.+?)["”]?\s+to\s+["“]?(.+?)["”]?[.!]?$/i);
  if (!match) return { intent: "modify", message: "For a safe edit, use: rename <exact node label> to <new label>.", patches: [], assumptions: [] };
  const [, original, renamed] = match;
  const targets = graph.nodes.filter((node) => node.label.trim().toLocaleLowerCase("en-US") === original!.trim().toLocaleLowerCase("en-US"));
  if (targets.length !== 1) return { intent: "modify", message: targets.length === 0 ? `No node has the exact label “${original}”; nothing was changed.` : `More than one node is named “${original}”; nothing was changed. Select or rename one first.`, patches: [], assumptions: [] };
  const node = targets[0]!;
  const updated = { ...node, label: renamed!.trim(), origin: "user" as const, via: "text" as const };
  if (!updated.label) return { intent: "modify", message: "A node label cannot be empty; nothing was changed.", patches: [], assumptions: [] };
  return { intent: "modify", message: `Renamed only “${node.label}” to “${updated.label}”.`, patches: [patch(graph, `Rename ${node.label}`, [{ type: "update_node", node: updated }])], assumptions: [] };
}

function parseConstraints(text: string) {
  const output: Record<string, unknown> = {};
  const provider = text.match(/\b(?:provider\s+)?(AWS|Azure|GCP|Google Cloud)\b/i)?.[1];
  const region = text.match(/\b(?:region|in)\s+([a-z]{2}(?:-[a-z]+)+-\d+)\b/i)?.[1];
  const budget = text.match(/\b(?:budget|under)\s*\$?\s*([\d,]+)\s*(?:USD)?\s*(?:\/\s*(?:month|mo))?/i)?.[1];
  const scale = text.match(/\b(\d+(?:[.,]\d+)?\s*[kKmM]?\s*(?:rps|requests per second|users|daily active users|gb|tb))\b/i)?.[1];
  const compliance = text.match(/\b(SOC\s*2|HIPAA|GDPR|PCI(?: DSS)?)\b/i)?.[1];
  if (provider) output.provider = provider.toLowerCase().includes("google") ? "gcp" : provider.toLowerCase();
  if (region) output.region = region;
  if (budget) output.monthly_budget_usd = Number(budget.replaceAll(",", ""));
  if (scale) output.scale = scale.trim();
  if (compliance) output.compliance = compliance.toUpperCase().replace(/\s+/g, " ");
  return output;
}

function matchPattern(text: string): ArchitecturePattern | undefined {
  const value = text.toLowerCase();
  if (/three[- ]tier|frontend.*api.*database/.test(value)) return "three_tier";
  if (/event[- ]driven|event bus|message queue/.test(value)) return "event_driven";
  if (/microservices/.test(value)) return "microservices";
  if (/data pipeline|ingest.*transform.*warehouse/.test(value)) return "pipeline";
  if (/serverless/.test(value)) return "serverless";
  if (/story map|user story map/.test(value)) return "story_map";
  return undefined;
}

function patch(graph: Graph, reason: string, ops: PatchOp[]): Patch {
  const stamp = safeId(`${graph.diagram_id}-${graph.version}-${reason}`);
  return { id: `text-${stamp}`, base_version: graph.version, origin: "user", via: "text", reason, ops };
}

function safeId(value: string) { return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "diagram"; }
