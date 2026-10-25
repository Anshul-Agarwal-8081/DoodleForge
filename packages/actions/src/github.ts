import { createHash } from "node:crypto";
import { assertGraphInvariants, GraphSchema, type Graph } from "@doodleforge/ir";
import { storyRecordFromNode } from "@doodleforge/pack-userstory";
import { CreateGithubIssueArgsSchema, GitHubIssuePayloadSchema, type ActionResult, type ActionToolCall, type CreateGithubIssueArgs, type GitHubIssuePayload } from "./contracts.js";

export const ACTION_CAP = 25;

export function parseRepositoryAllowlist(value = "") {
  return new Set(value.split(",").map((repo) => repo.trim()).filter((repo) => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)));
}

export function assertSelectedActionBatch(nodeIds: string[]) {
  if (!nodeIds.length) throw new Error("Select at least one story before proposing actions");
  if (nodeIds.length > ACTION_CAP) throw new Error(`Action batch exceeds the ${ACTION_CAP}-item cap`);
  if (new Set(nodeIds).size !== nodeIds.length) throw new Error("An item may only be selected once per action batch");
}

export function buildFixtureToolCall(graphInput: Graph, nodeId: string, repository: string): ActionToolCall {
  const graph = validatedGraph(graphInput);
  const story = getVerifiedStory(graph, nodeId);
  const body = [
    story.story,
    story.epic ? `Epic: ${story.epic}` : "",
    "Acceptance criteria:",
    ...story.acceptance.map((criterion) => `- Given ${criterion.given}, when ${criterion.when}, then ${criterion.then}`),
  ].filter(Boolean).join("\n\n");
  return {
    name: "create_github_issue",
    arguments: { story_id: nodeId, repository, title: `${story.id}: ${story.title}`, body },
  };
}

export function validateActionToolCall(
  graphInput: Graph,
  selectedNodeId: string,
  selectedRepository: string,
  allowedRepositories: Set<string>,
  call: ActionToolCall,
): GitHubIssuePayload {
  if (call.name !== "create_github_issue") throw new Error(`Unsupported action tool '${call.name}'`);
  if (!allowedRepositories.has(selectedRepository)) throw new Error("Repository is not in the server allowlist");
  const graph = validatedGraph(graphInput);
  const story = getVerifiedStory(graph, selectedNodeId);
  const args = CreateGithubIssueArgsSchema.parse(call.arguments);
  if (args.story_id !== selectedNodeId) throw new Error("Action tool call does not match the selected story");
  if (args.repository !== selectedRepository) throw new Error("Action tool call changed the approved repository");
  if (args.title.toLocaleLowerCase("en-US").includes("@")) throw new Error("Issue title cannot contain an @ mention");
  const safeTitle = stripHtml(args.title).replace(/[\r\n]+/g, " ").trim();
  if (!safeTitle) throw new Error("Issue title is empty after sanitizing HTML");
  const safeBody = sanitizeIssueBody(args.body);
  const idempotencyKey = createHash("sha256")
    .update(`${graph.diagram_id}\n${selectedNodeId}\n${graph.version}`)
    .digest("hex");
  return GitHubIssuePayloadSchema.parse({
    ...args,
    title: safeTitle,
    body: safeBody,
    diagram_id: graph.diagram_id,
    graph_version: graph.version,
    idempotency_key: idempotencyKey,
  });
}

export function sanitizeIssueBody(value: string) {
  return stripHtml(value)
    .replace(/@(?=[A-Za-z0-9_-])/g, "@\u200b")
    .replace(/\r\n?/g, "\n")
    .slice(0, 20_000)
    .trim();
}

export function createInMemoryLedger() {
  const entries = new Map<string, Exclude<ActionResult, { status: "already-executed" }>>();
  return {
    get(key: string) { return entries.get(key); },
    set(key: string, value: Exclude<ActionResult, { status: "already-executed" }>) { entries.set(key, structuredClone(value)); },
  };
}

export async function approveGithubIssue(
  payloadInput: GitHubIssuePayload,
  options: {
    dryRun: boolean;
    token?: string;
    allowedRepositories: Set<string>;
    ledger: ReturnType<typeof createInMemoryLedger>;
    createIssue?: (repository: string, title: string, body: string, token: string) => Promise<{ url: string; number: number }>;
  },
): Promise<ActionResult> {
  const payload = GitHubIssuePayloadSchema.parse(payloadInput);
  if (!options.allowedRepositories.has(payload.repository)) throw new Error("Repository is not in the server allowlist");
  const previous = options.ledger.get(payload.idempotency_key);
  if (previous) return { status: "already-executed", result: structuredClone(previous) };
  if (options.dryRun) {
    const result = { status: "dry-run" as const, payload };
    options.ledger.set(payload.idempotency_key, result);
    return result;
  }
  if (!options.token) throw new Error("GITHUB_TOKEN is required for live issue creation");
  if (!options.createIssue) throw new Error("GitHub issue executor is unavailable");
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const issue = await options.createIssue(payload.repository, payload.title, payload.body, options.token);
      const result = { status: "created" as const, payload, ...issue };
      options.ledger.set(payload.idempotency_key, result);
      return result;
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 100 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function getVerifiedStory(graph: Graph, nodeId: string) {
  const audit = storyRecordFromNode(graph, nodeId);
  if (!audit?.record || audit.status !== "verified") {
    throw new Error(`Story '${nodeId}' is not verified: ${(audit?.errors ?? ["not found"]).join(" ")}`);
  }
  return audit.record;
}

function validatedGraph(input: Graph) {
  const graph = GraphSchema.parse(input);
  assertGraphInvariants(graph);
  return graph;
}

function stripHtml(value: string) {
  return value
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:lt|gt|amp|quot|#39|nbsp);/gi, (entity) => ({ "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'", "&nbsp;": " " }[entity.toLowerCase()] ?? " "));
}
