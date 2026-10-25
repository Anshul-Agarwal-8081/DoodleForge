import * as z from "zod";

export const CreateGithubIssueArgsSchema = z.object({
  story_id: z.string().min(1).max(160),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  title: z.string().min(1).max(180),
  body: z.string().max(20_000),
}).strict();

export const CreateGithubIssueTool = {
  name: "create_github_issue",
  description: "Prepare one issue for the selected, verified DoodleForge story in the user-approved repository.",
  parameters: CreateGithubIssueArgsSchema,
};

export const GitHubIssuePayloadSchema = CreateGithubIssueArgsSchema.extend({
  diagram_id: z.string().min(1),
  graph_version: z.number().int().nonnegative(),
  idempotency_key: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export type CreateGithubIssueArgs = z.infer<typeof CreateGithubIssueArgsSchema>;
export type GitHubIssuePayload = z.infer<typeof GitHubIssuePayloadSchema>;
export type ActionToolCall = { name: string; arguments: unknown };

export type ActionResult =
  | { status: "dry-run"; payload: GitHubIssuePayload }
  | { status: "created"; payload: GitHubIssuePayload; url: string; number: number }
  | { status: "already-executed"; result: Exclude<ActionResult, { status: "already-executed" }> };
