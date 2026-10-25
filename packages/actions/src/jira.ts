import { createHash } from "node:crypto";
import * as z from "zod";
import { assertGraphInvariants, GraphSchema, type Graph } from "@doodleforge/ir";
import { storyRecordFromNode } from "@doodleforge/pack-userstory";
import { sanitizeIssueBody } from "./github.js";

export const CreateJiraIssueArgsSchema = z.object({
  story_id: z.string().min(1).max(160),
  project: z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/),
  issueType: z.enum(["Story", "Task", "Epic"]),
  summary: z.string().min(1).max(180),
  description: z.string().max(20_000),
}).strict();
export const CreateJiraIssueTool = { name: "create_jira_issue", description: "Prepare one Jira issue for one selected verified story in the approved project.", parameters: CreateJiraIssueArgsSchema };
export const JiraIssuePayloadSchema = CreateJiraIssueArgsSchema.extend({
  diagram_id: z.string().min(1),
  graph_version: z.number().int().nonnegative(),
  idempotency_key: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type JiraIssuePayload = z.infer<typeof JiraIssuePayloadSchema>;
export type JiraResult =
  | { status: "dry-run"; payload: JiraIssuePayload }
  | { status: "created"; payload: JiraIssuePayload; key: string; url: string }
  | { status: "already-executed"; result: Exclude<JiraResult, { status: "already-executed" }> };
export type JiraToolCall = { name: string; arguments: unknown };

export function parseJiraProjectAllowlist(value = "") {
  return new Set(value.split(",").map((item) => item.trim().toUpperCase()).filter((item) => /^[A-Z][A-Z0-9_]{1,19}$/.test(item)));
}

export function buildFixtureJiraToolCall(graphInput: Graph, nodeId: string, project: string): JiraToolCall {
  const graph = validatedGraph(graphInput);
  const story = verifiedStory(graph, nodeId);
  return { name: "create_jira_issue", arguments: {
    story_id: nodeId,
    project,
    issueType: "Story",
    summary: `${story.id}: ${story.title}`,
    description: [story.title, story.story, `Priority: ${story.priority}`, "Acceptance criteria:", ...story.acceptance.map((item) => `* Given ${item.given}, when ${item.when}, then ${item.then}`)].join("\n\n"),
  } };
}

export function validateJiraToolCall(graphInput: Graph, selectedNodeId: string, selectedProject: string, allowedProjects: Set<string>, call: JiraToolCall): JiraIssuePayload {
  if (call.name !== "create_jira_issue") throw new Error(`Unsupported Jira action '${call.name}'`);
  const graph = validatedGraph(graphInput);
  const story = verifiedStory(graph, selectedNodeId);
  const args = CreateJiraIssueArgsSchema.parse(call.arguments);
  if (args.story_id !== selectedNodeId) throw new Error("Jira action changed the selected story");
  if (args.project !== selectedProject || !allowedProjects.has(selectedProject)) throw new Error("Jira project is not in the server allowlist or was changed by the model");
  const summary = sanitizeIssueBody(args.summary).replace(/[\r\n]+/g, " ").slice(0, 180);
  if (!summary) throw new Error("Jira summary is empty after sanitizing");
  const cleanedDescription = sanitizeIssueBody(args.description);
  const description = cleanedDescription.includes(story.title) ? cleanedDescription : `${story.title}\n\n${cleanedDescription}`.slice(0, 20_000);
  const idempotencyKey = createHash("sha256").update(`${graph.diagram_id}\n${selectedNodeId}\n${graph.version}\njira\n${selectedProject}`).digest("hex");
  return JiraIssuePayloadSchema.parse({ ...args, summary, description, diagram_id: graph.diagram_id, graph_version: graph.version, idempotency_key: idempotencyKey });
}

export function validateJiraHost(baseUrl: string, allowedHosts: Set<string>) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:") throw new Error("Jira base URL must use HTTPS");
  if (!allowedHosts.has(url.hostname.toLowerCase())) throw new Error("Jira host is not in the server allowlist");
  return url.origin;
}

export function createJiraLedger() {
  const entries = new Map<string, Exclude<JiraResult, { status: "already-executed" }>>();
  return { get(key: string) { return entries.get(key); }, set(key: string, result: Exclude<JiraResult, { status: "already-executed" }>) { entries.set(key, structuredClone(result)); } };
}

export async function approveJiraIssue(payloadInput: JiraIssuePayload, options: {
  dryRun: boolean;
  baseUrl?: string;
  allowedHosts: Set<string>;
  allowedProjects: Set<string>;
  email?: string;
  apiToken?: string;
  ledger: ReturnType<typeof createJiraLedger>;
  fetcher?: typeof fetch;
}) : Promise<JiraResult> {
  const payload = JiraIssuePayloadSchema.parse(payloadInput);
  const baseUrl = options.dryRun ? "" : validateJiraHost(options.baseUrl ?? "", options.allowedHosts);
  if (!options.allowedProjects.has(payload.project)) throw new Error("Jira project is not in the server allowlist");
  const previous = options.ledger.get(payload.idempotency_key);
  if (previous) return { status: "already-executed", result: structuredClone(previous) };
  if (options.dryRun) {
    const result: JiraResult = { status: "dry-run", payload };
    options.ledger.set(payload.idempotency_key, result);
    return result;
  }
  if (!options.email || !options.apiToken) throw new Error("JIRA_EMAIL and JIRA_API_TOKEN are required for live Jira creation");
  const auth = Buffer.from(`${options.email}:${options.apiToken}`).toString("base64");
  const fetcher = options.fetcher ?? fetch;
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(`${baseUrl}/rest/api/3/issue`, {
        method: "POST",
        headers: { authorization: `Basic ${auth}`, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ fields: { project: { key: payload.project }, summary: payload.summary, issuetype: { name: payload.issueType }, description: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: payload.description }] }] } } }),
      });
      if (!response.ok) throw new Error(`Jira returned HTTP ${response.status}: ${(await response.text()).slice(0, 500)}`);
      const created = z.object({ key: z.string().min(1) }).passthrough().parse(await response.json());
      const result: JiraResult = { status: "created", payload, key: created.key, url: `${baseUrl}/browse/${encodeURIComponent(created.key)}` };
      options.ledger.set(payload.idempotency_key, result);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * 2 ** attempt));
    }
  }
  throw lastError;
}

function validatedGraph(input: Graph) { const graph = GraphSchema.parse(input); assertGraphInvariants(graph); return graph; }
function verifiedStory(graph: Graph, nodeId: string) {
  const audit = storyRecordFromNode(graph, nodeId);
  if (!audit?.record || audit.status !== "verified") throw new Error(`Selected story is not verified: ${(audit?.errors ?? ["not found"]).join(" ")}`);
  return audit.record;
}
