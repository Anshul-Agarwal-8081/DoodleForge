import { z } from "zod";

export type LogicGate = "input" | "and" | "or" | "not" | "xor" | "output";
export type CircuitGraph = { nodes: { id: string; type: string; label: string }[]; edges: { id: string; from: { node: string }; to: { node: string } }[] };
export function simulateCircuit(graph: CircuitGraph, inputs: Record<string, boolean> = {}): { outputs: Record<string, boolean>; error?: string } {
  const nodes = graph.nodes.filter((node) => ["input", "and", "or", "not", "xor", "output"].includes(node.type));
  const values: Record<string, boolean> = {};
  const pending = new Set(nodes.map((node) => node.id));
  let progress = true;
  while (pending.size && progress) {
    progress = false;
    for (const node of nodes) {
      if (!pending.has(node.id)) continue;
      const incoming = graph.edges.filter((edge) => edge.to.node === node.id).map((edge) => values[edge.from.node]);
      if (node.type !== "input" && incoming.some((value) => value === undefined)) continue;
      const args = incoming as boolean[];
      const gate = node.type as LogicGate;
      if (gate === "input") values[node.id] = inputs[node.id] ?? false;
      else if (gate === "and") values[node.id] = args.length > 0 && args.every(Boolean);
      else if (gate === "or") values[node.id] = args.some(Boolean);
      else if (gate === "not") values[node.id] = !args[0];
      else if (gate === "xor") values[node.id] = args.filter(Boolean).length % 2 === 1;
      else values[node.id] = Boolean(args[0]);
      pending.delete(node.id); progress = true;
    }
  }
  if (pending.size) return { outputs: {}, error: `Closed path or missing input: ${[...pending].join(", ")}` };
  return { outputs: Object.fromEntries(nodes.filter((node) => node.type === "output").map((node) => [node.label, values[node.id]!])) };
}

export const WorkflowStepSchema = z.object({ id: z.string().min(1), name: z.string().min(1), kind: z.enum(["transform", "http_request", "notify"]), target: z.string().optional() }).strict();
export const WorkflowSchema = z.object({ id: z.string().min(1), steps: z.array(WorkflowStepSchema), approved: z.boolean().default(false) }).strict();
export function simulateWorkflow(input: unknown, allowedHosts: string[] = []): { ok: boolean; steps: string[]; error?: string } {
  const result = WorkflowSchema.safeParse(input);
  if (!result.success) return { ok: false, steps: [], error: result.error.issues[0]?.message ?? "Invalid workflow" };
  const { steps, approved } = result.data;
  for (const step of steps) if (step.kind === "http_request") {
    try { const host = new URL(step.target ?? "").hostname; if (!allowedHosts.includes(host)) return { ok: false, steps: [], error: `Host ${host || "(missing)"} is not allowlisted` }; }
    catch { return { ok: false, steps: [], error: "HTTP target must be an HTTPS URL" }; }
    if (!step.target?.startsWith("https://")) return { ok: false, steps: [], error: "HTTP target must use HTTPS" };
  }
  return { ok: true, steps: steps.map((step) => `${step.name} · ${step.kind}`), error: approved ? "Dry run only · no external actions executed" : "Approval required before external actions" };
}

export type StoryboardAudience = "team" | "executive" | "customer";
export type StoryboardSlide = { title: string; body: string; notes: string; nodeId: string; offPath: boolean };

/** Build a deterministic narrative from the current graph. Dependency edges put prerequisites first. */
export function storyboard(
  graph: { nodes: { id: string; type: string; label: string; props: Record<string, unknown> }[]; edges?: { id: string; from: { node: string }; to: { node: string }; relation?: string }[]; domain: string },
  audience: StoryboardAudience = "team",
): StoryboardSlide[] {
  const nodes = graph.nodes;
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const outgoing = new Map(nodes.map((node) => [node.id, new Set<string>()]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  for (const edge of graph.edges ?? []) {
    if (!byId.has(edge.from.node) || !byId.has(edge.to.node)) continue;
    // User-story depends_on edges point from the dependent story to its prerequisite.
    const from = edge.relation === "depends_on" ? edge.to.node : edge.from.node;
    const to = edge.relation === "depends_on" ? edge.from.node : edge.to.node;
    if (outgoing.get(from)!.has(to)) continue;
    outgoing.get(from)!.add(to);
    indegree.set(to, indegree.get(to)! + 1);
  }
  const ready = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const orderedIds: string[] = [];
  while (ready.length) {
    const current = ready.shift()!;
    orderedIds.push(current);
    for (const next of outgoing.get(current) ?? []) {
      indegree.set(next, indegree.get(next)! - 1);
      if (indegree.get(next) === 0) ready.push(next);
    }
  }
  // Cyclic or otherwise disconnected nodes still get slides and remain visible for review.
  for (const node of nodes) if (!orderedIds.includes(node.id)) orderedIds.push(node.id);
  const reached = new Set<string>();
  const roots = nodes.filter((node) => (graph.edges ?? []).every((edge) => {
    const to = edge.relation === "depends_on" ? edge.from.node : edge.to.node;
    return to !== node.id;
  }));
  const queue = roots.slice(0, 1).map((node) => node.id);
  while (queue.length) {
    const current = queue.shift()!;
    if (reached.has(current)) continue;
    reached.add(current);
    for (const next of outgoing.get(current) ?? []) queue.push(next);
  }
  return orderedIds.map((id) => {
    const node = byId.get(id)!;
    const story = typeof node.props.story === "string" ? node.props.story : undefined;
    const benefit = typeof node.props.benefit === "string" ? node.props.benefit : undefined;
    const persona = typeof node.props.persona === "string" ? node.props.persona : undefined;
    const acceptance = Array.isArray(node.props.acceptance) ? node.props.acceptance as { given?: string; when?: string; then?: string }[] : [];
    const body = node.type === "story"
      ? audience === "executive" ? benefit ?? story ?? node.label
        : audience === "customer" ? story ?? node.label
          : story ?? node.label
      : String(node.props.description ?? node.props.summary ?? `${node.type.replaceAll("_", " ")} in ${graph.domain}`);
    const notes = [persona ? `Persona: ${persona}` : "", ...acceptance.map((item, index) => `Acceptance ${index + 1}: Given ${item.given ?? ""}, when ${item.when ?? ""}, then ${item.then ?? ""}`)].filter(Boolean).join("\n") || `Source item ${node.label}.`;
    return { title: node.label, body, notes, nodeId: node.id, offPath: !reached.has(id) };
  });
}

export function storyboardMarkdown(slides: StoryboardSlide[], audience: StoryboardAudience = "team"): string {
  return `# Storyboard\n\nAudience: ${audience}\n\n${slides.map((slide, index) => `## ${index + 1}. ${slide.title}\n\n${slide.body}\n\nSpeaker notes: ${slide.notes}${slide.offPath ? "\n\n> Off-path item: this node is not connected to an entry path." : ""}`).join("\n\n")}${slides.length ? "\n" : "No graph items are available yet.\n"}`;
}

export function storyboardCoverage(graph: { nodes: { id: string }[] }, slides: StoryboardSlide[]) {
  const included = new Set(slides.map((slide) => slide.nodeId));
  return { complete: graph.nodes.every((node) => included.has(node.id)), missing: graph.nodes.filter((node) => !included.has(node.id)).map((node) => node.id), offPath: slides.filter((slide) => slide.offPath).map((slide) => slide.nodeId) };
}

export function extractPalette(colors: string[]): { hex: string; count: number; foreground: string; contrast: number }[] {
  const counts = new Map<string, number>();
  for (const input of colors) { const color = normalizeHex(input); if (color) counts.set(color, (counts.get(color) ?? 0) + 1); }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([hex, count]) => { const black = contrastRatio(hex, "#000000"); const white = contrastRatio(hex, "#ffffff"); return { hex, count, foreground: black >= white ? "#000000" : "#ffffff", contrast: Math.max(black, white) }; });
}
export function contrastRatio(a: string, b: string): number { const l1 = luminance(a), l2 = luminance(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
function normalizeHex(s: string): string | null { const m = /^#?([\da-f]{6})$/i.exec(s.trim()); return m ? `#${m[1]!.toLowerCase()}` : null; }
function luminance(hex: string): number { const match = normalizeHex(hex); if (!match) return 0; const c = match.slice(1).match(/../g)!.map((v) => parseInt(v, 16) / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0]! + .7152 * c[1]! + .0722 * c[2]!; }

export function splitImageTiles(width: number, height: number, tileSize = 1024, overlap = 96): { x: number; y: number; width: number; height: number }[] {
  if (![width, height, tileSize, overlap].every(Number.isInteger) || width < 1 || height < 1 || tileSize < 1 || overlap < 0 || overlap >= tileSize) throw new Error("Invalid tile dimensions");
  const step = tileSize - overlap; const tiles = [] as { x: number; y: number; width: number; height: number }[];
  for (let y = 0; y < height; y += step) for (let x = 0; x < width; x += step) tiles.push({ x, y, width: Math.min(tileSize, width - x), height: Math.min(tileSize, height - y) });
  return tiles;
}
export function vote<T>(candidates: T[], key: (candidate: T) => string): { winner?: T; agreement: number; tie: boolean } {
  const groups = new Map<string, T[]>(); for (const c of candidates) groups.set(key(c), [...(groups.get(key(c)) ?? []), c]);
  const ranked = [...groups.values()].sort((a, b) => b.length - a.length);
  return { winner: ranked[0]?.[0], agreement: candidates.length ? (ranked[0]?.length ?? 0) / candidates.length : 0, tie: ranked.length > 1 && ranked[0]!.length === ranked[1]!.length };
}
export function renderBackMismatches(expected: string[], observed: string[]): string[] { const observedSet = new Set(observed.map((x) => x.trim().toLowerCase())); return expected.filter((x) => !observedSet.has(x.trim().toLowerCase())); }
export function voiceClipAllowed(seconds: number): boolean { return Number.isFinite(seconds) && seconds > 0 && seconds <= 30; }
export function fixtureVoiceTranscript(seconds: number): { transcript: string; stored: false } { if (!voiceClipAllowed(seconds)) throw new Error("Voice clips must be 30 seconds or shorter"); return { transcript: "Create a member sign-in flow with email verification", stored: false }; }
