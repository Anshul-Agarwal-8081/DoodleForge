import Fastify from "fastify";
import cors from "@fastify/cors";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod";
import { JobRequestSchema, VoiceJobRequestSchema } from "./contracts.js";
import { actionSettings, approveAction, ProposeActionsSchema, proposeActions } from "./actions.js";
import { getAdapterMode, runSketchJob, runVoiceJob } from "./pipeline.js";
import { approveJiraAction, jiraSettings, proposeJiraActions, ProposeJiraActionsSchema } from "./jira-actions.js";
import { GraphSchema } from "@doodleforge/ir";
import { verifyTerraform } from "@doodleforge/pack-cloud/verify";
import { GeminiRequestError, geminiApiKeyFromEnv, getGeminiConnectionSettings, googleGenAiBackendFromEnv, googleRateLimitRemainingSeconds } from "@doodleforge/gemma";

try {
  process.loadEnvFile?.(".env");
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

export function buildServer(env: NodeJS.ProcessEnv = process.env) {
  const app = Fastify({ logger: true, bodyLimit: 25 * 1024 * 1024 });
  const localOrigins = new Set(["http://127.0.0.1:4173", "http://127.0.0.1:4178", "http://127.0.0.1:4179", "http://localhost:4173", "http://localhost:4178", "http://localhost:4179", "http://127.0.0.1:5173", "http://localhost:5173"]);
  void app.register(cors, {
    origin: (origin, callback) => callback(null, !origin || localOrigins.has(origin) || origin.endsWith(".vercel.app") || Boolean(process.env.VERCEL)),
    credentials: false,
  });

  app.get("/api/health", async () => ({ ok: true, ...(await getAdapterMode(env)) }));
  app.get("/api/settings", async () => ({ ...actionSettings(env), jira: jiraSettings(env) }));
  app.get("/api/model/status", async () => getGeminiConnectionSettings(env));
  app.post("/api/model/credential", async (request, reply) => {
    if (process.env.VERCEL) {
      return reply.code(400).send({
        ok: false,
        message: "On Vercel, please set GEMINI_API_KEY in your Project Settings > Environment Variables in the Vercel dashboard.",
      });
    }
    const address = request.raw.socket.remoteAddress?.replace(/^::ffff:/, "");
    if (address && address !== "127.0.0.1" && address !== "::1") return reply.code(403).send({ ok: false, message: "Credentials can only be saved from this computer." });
    const parsed = z.object({ apiKey: z.string().trim().min(20).max(500) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ ok: false, message: "Enter a valid API key (20–500 characters)." });
    const envPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env");
    const tempPath = `${envPath}.${process.pid}.tmp`;
    let current = "";
    try { current = await readFile(envPath, "utf8"); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return reply.code(500).send({ ok: false, message: "Could not read the local environment file." }); }
    const lines = current.split(/\r?\n/).filter((line) => !/^\s*(?:GEMINI_API_KEY|GEMMA_API_KEY)\s*=/.test(line));
    while (lines.at(-1) === "") lines.pop();
    lines.push(`GEMINI_API_KEY=${JSON.stringify(parsed.data.apiKey)}`);
    try {
      await writeFile(tempPath, `${lines.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(tempPath, envPath);
      await chmod(envPath, 0o600);
      env.GEMINI_API_KEY = parsed.data.apiKey;
      delete env.GEMMA_API_KEY;
      return { ok: true, apiKeyConfigured: true, message: "Credential stored in the ignored local .env file. It stays on this server." };
    } catch {
      return reply.code(500).send({ ok: false, message: "Could not securely save the credential. Check that the project folder is writable." });
    }
  });
  app.post("/api/model/test", async (_request, reply) => {
    const settings = getGeminiConnectionSettings(env);
    if (!settings.apiKeyConfigured) return reply.code(400).send({ ok: false, message: "GEMINI_API_KEY is missing. Add a rotated Google AI Studio key on the Model setup page; it will be saved only to the local API server." });
    try {
      let answer = "";
      for await (const chunk of googleGenAiBackendFromEnv(env).generate({
        model: "main", pass: "connection-test", promptVersion: "gemini-connection-v1",
        system: "Reply with the single word OK.",
        messages: [{ role: "user", parts: [{ type: "text", text: "Check the Gemini connection." }] }],
      })) answer += chunk.text ?? "";
      if (!answer.trim()) throw new Error("Gemini returned no text");
      return { ok: true, mode: settings.mode, model: settings.model, message: "Gemini 3.8 Flash connection succeeded." };
    } catch (error) {
      const key = geminiApiKeyFromEnv(env);
      const details = error instanceof Error ? error.message.replaceAll(key ?? "\u0000", "[redacted]").slice(0, 360) : "Unknown SDK error";
      const rateLimited = error instanceof GeminiRequestError && error.status === 429;
      return reply.code(rateLimited ? 429 : 502).send({ ok: false, message: rateLimited ? details : `Gemini connection failed: ${details}`, ...(rateLimited ? { retryAfterSeconds: googleRateLimitRemainingSeconds() } : {}) });
    }
  });

  app.post("/api/cloud/terraform/verify", async (request, reply) => {
    const parsed = GraphSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_cloud_graph", issues: parsed.error.issues });
    try { return await verifyTerraform(parsed.data, { ...(env.TERRAFORM_BINARY ? { binary: env.TERRAFORM_BINARY } : {}) }); }
    catch (error) { return reply.code(422).send({ error: "terraform_verification_failed", message: error instanceof Error ? error.message : "Terraform verification failed" }); }
  });

  app.post("/api/jira/actions/propose", async (request, reply) => {
    const parsed = ProposeJiraActionsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_jira_action_request", issues: parsed.error.issues });
    try { return await proposeJiraActions(parsed.data, env); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare Jira action";
      return reply.code(message.includes("allowlist") ? 403 : 422).send({ error: "jira_action_proposal_rejected", message });
    }
  });

  app.post<{ Params: { actionId: string } }>("/api/jira/actions/:actionId/approve", async (request, reply) => {
    try { return await approveJiraAction(request.params.actionId, env); }
    catch (error) {
      const message = error instanceof Error ? error.message : "Jira approval failed";
      return reply.code(message.includes("not found") ? 404 : 422).send({ error: "jira_action_approval_rejected", message });
    }
  });

  app.post("/api/actions/propose", async (request, reply) => {
    const parsed = ProposeActionsSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_action_request", issues: parsed.error.issues });
    try {
      return await proposeActions(parsed.data, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not prepare action";
      return reply.code(message.includes("allowlist") ? 403 : 422).send({ error: "action_proposal_rejected", message });
    }
  });

  app.post<{ Params: { actionId: string } }>("/api/actions/:actionId/approve", async (request, reply) => {
    try {
      return await approveAction(request.params.actionId, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Action approval failed";
      return reply.code(message.includes("not found") ? 404 : 422).send({ error: "action_approval_rejected", message });
    }
  });

  app.post("/api/jobs", async (request, reply) => {
    const parsed = JobRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_job", issues: parsed.error.issues });

    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    response.flushHeaders();
    const emit = (event: string, data: Record<string, unknown>) => {
      if (!response.destroyed) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      await runSketchJob(parsed.data, emit, env);
    } catch (error) {
      request.log.error({ err: error }, "Sketch job failed");
      emit("error", { code: "job_failed", message: error instanceof Error ? error.message : "Sketch job failed" });
    } finally {
      response.end();
    }
  });

  app.post("/api/voice/jobs", async (request, reply) => {
    const parsed = VoiceJobRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_voice_job", issues: parsed.error.issues });
    reply.hijack();
    const response = reply.raw;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-content-type-options": "nosniff",
    });
    response.flushHeaders();
    const emit = (event: string, data: Record<string, unknown>) => {
      if (!response.destroyed) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    try {
      await runVoiceJob(parsed.data, emit, env);
    } catch (error) {
      request.log.error({ err: error }, "Voice diagram job failed");
      emit("error", { code: "voice_job_failed", message: error instanceof Error ? error.message : "Voice interpretation failed" });
    } finally {
      response.end();
    }
  });

  return app;
}

const isDirectRun = Boolean(
  process.argv[1] &&
  (fileURLToPath(import.meta.url) === resolve(process.argv[1]) ||
   process.argv[1].endsWith("apps/api/src/server.ts") ||
   process.argv[1].endsWith("apps/api/src/server.js"))
);

const port = Number(process.env.API_PORT ?? 4173);
if (process.env.NODE_ENV !== "test" && !process.env.VERCEL && isDirectRun) {
  const app = buildServer();
  await app.listen({ host: "127.0.0.1", port });
}
