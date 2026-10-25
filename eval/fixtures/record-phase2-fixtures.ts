import { writeFile } from "node:fs/promises";
import { inputHash } from "../../packages/gemma/src/adapter.js";
import { createEmptyGraph } from "../../packages/ir/src/patch-engine.js";
import { demoSketches } from "../../apps/api/src/demo-fixtures.js";
import { buildClassifyRequest, buildStructureRequest, buildTranscriptionRequest, fixturePassOutputs } from "../../apps/api/src/prompts.js";

const records = [];
for (const fixture of demoSketches) {
  const outputs = fixturePassOutputs(fixture);
  const classify = buildClassifyRequest({ kind: "fixture", fixture });
  const transcription = buildTranscriptionRequest({ kind: "fixture", fixture }, outputs.classification);
  const graph = {
    ...createEmptyGraph(`diagram-${fixture.id}`, "userstory"),
    version: 1,
    source: { image_id: fixture.id, width: 1000, height: 720 },
  };
  const structure = buildStructureRequest(outputs.transcription, graph);
  for (const [request, value] of [
    [classify, outputs.classification],
    [transcription, outputs.transcription],
    [structure, outputs.patchBatch],
  ] as const) {
    records.push({
      inputHash: inputHash(request),
      chunks: [{ text: JSON.stringify(value) }],
      metadata: { fixture: fixture.id, pass: request.pass, promptVersion: request.promptVersion },
    });
  }
}

await writeFile(
  new URL("../../fixtures/gemma/phase2-sketches.json", import.meta.url),
  `${JSON.stringify({ records }, null, 2)}\n`,
);
console.log(`Recorded ${records.length} pass fixtures for ${demoSketches.length} sketches.`);
