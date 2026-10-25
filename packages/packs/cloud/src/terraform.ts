import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Graph } from "@doodleforge/ir";
import { emitTerraform } from "./hcl.js";

export async function verifyTerraform(graph: Graph, options: { binary?: string; timeoutMs?: number } = {}) {
  const emission = emitTerraform(graph);
  const directory = await mkdtemp(join(tmpdir(), "doodleforge-tf-"));
  try {
    await writeFile(join(directory, "main.tf"), emission.hcl, { mode: 0o600 });
    const binary = options.binary ?? "terraform";
    const fmt = await run(binary, ["fmt", "-check", "-diff"], directory, options.timeoutMs);
    if (!fmt.ok) return { verified: false, status: fmt.unavailable ? "unavailable" as const : "failed" as const, stage: "fmt", detail: fmt.output, assumptions: emission.assumptions };
    const init = await run(binary, ["init", "-backend=false", "-input=false", "-no-color"], directory, options.timeoutMs ?? 60_000);
    if (!init.ok) return { verified: false, status: init.unavailable ? "unavailable" as const : "failed" as const, stage: "init", detail: init.output, assumptions: emission.assumptions };
    const validate = await run(binary, ["validate", "-no-color"], directory, options.timeoutMs ?? 60_000);
    return { verified: validate.ok, status: validate.ok ? "verified" as const : validate.unavailable ? "unavailable" as const : "failed" as const, stage: "validate", detail: validate.output, assumptions: emission.assumptions };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function run(binary: string, args: string[], cwd: string, timeoutMs = 60_000): Promise<{ ok: boolean; unavailable?: boolean; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(binary, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve({ ok: false, output: `${binary} ${args[0]} timed out after ${timeoutMs}ms` }); }, timeoutMs);
    child.stdout.on("data", (data: Buffer) => { output += data.toString(); });
    child.stderr.on("data", (data: Buffer) => { output += data.toString(); });
    child.once("error", (error: NodeJS.ErrnoException) => { clearTimeout(timer); resolve({ ok: false, unavailable: error.code === "ENOENT", output: error.message }); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ ok: code === 0, output: output.trim() || `exit code ${code}` }); });
  });
}
