import { applyPatch, createEmptyGraph } from "../packages/ir/src/patch-engine.js";
import type { Graph, Patch } from "../packages/ir/src/schema.js";
import { demoSketches } from "../apps/api/src/demo-fixtures.js";
import { runSketchJob } from "../apps/api/src/pipeline.js";
import { scoreGraph } from "./metrics.js";

const rows: Array<{ id: string; nodes: string; edges: string }> = [];
let aggregateExpected: Graph | undefined;
let aggregateActual: Graph | undefined;

for (const fixture of demoSketches) {
  let actual: Graph | undefined;
  await runSketchJob({ kind: "fixture", fixtureId: fixture.id }, (event, data) => {
    if (event === "done") actual = data.graph as Graph;
  });
  if (!actual) throw new Error(`Fixture pipeline did not complete: ${fixture.id}`);
  const expected = expectedGraph(fixture.id, fixture.patchBatch.patches, fixture.patchBatch.assumptions, fixture.patchBatch.questions);
  const score = scoreGraph(expected, actual);
  rows.push({ id: fixture.id, nodes: fmt(score.nodes.f1), edges: fmt(score.edges.f1) });
  aggregateExpected = aggregateExpected ? mergeGraphs(aggregateExpected, expected) : expected;
  aggregateActual = aggregateActual ? mergeGraphs(aggregateActual, actual) : actual;
}

if (rows.length !== 10 || !aggregateExpected || !aggregateActual) {
  throw new Error(`Expected ten curated offline sketch cases, found ${rows.length}`);
}
const aggregate = scoreGraph(aggregateExpected, aggregateActual);
console.log("Offline fixture replay only. Scores verify recorded-pipeline reconstruction; they are not live model or image-recognition accuracy.");
console.log("Sketch case               Node F1   Edge F1");
for (const row of rows) console.log(`${row.id.padEnd(25)} ${row.nodes.padStart(7)}   ${row.edges.padStart(7)}`);
console.log(`${"MICRO AVERAGE".padEnd(25)} ${fmt(aggregate.nodes.f1).padStart(7)}   ${fmt(aggregate.edges.f1).padStart(7)}`);

function expectedGraph(id: string, patches: Patch[], assumptions: Graph["assumptions"], questions: Graph["questions"]) {
  let graph = createEmptyGraph(`diagram-${id}`, "userstory");
  graph = applyPatch(graph, {
    id: `eval-source-${id}`,
    base_version: graph.version,
    origin: "rule",
    via: "sketch",
    reason: "Register fixture sketch for evaluation",
    ops: [{ type: "set_source", source: { image_id: id, width: 1000, height: 720 } }, { type: "set_domain", domain: "userstory" }],
  }).graph;
  for (const sourcePatch of patches) {
    graph = applyPatch(graph, { ...sourcePatch, id: `${sourcePatch.id}-eval`, base_version: graph.version }).graph;
  }
  const extraOps: Patch["ops"] = [];
  for (const assumption of assumptions) {
    if (!graph.assumptions.some((item) => item.id === assumption.id)) extraOps.push({ type: "add_assumption", assumption });
  }
  for (const question of questions) {
    if (!graph.questions.some((item) => item.id === question.id)) extraOps.push({ type: "ask_question", question });
  }
  if (extraOps.length) {
    graph = applyPatch(graph, {
      id: `eval-context-${id}`,
      base_version: graph.version,
      origin: "gemma",
      via: "sketch",
      reason: "Record fixture context",
      ops: extraOps,
    }).graph;
  }
  return graph;
}

function mergeGraphs(first: Graph, next: Graph): Graph {
  const nodes = [...first.nodes, ...next.nodes].map((node, index) => ({ ...node, id: `n${index}` }));
  const labelToId = new Map(nodes.map((node) => [node.label, node.id]));
  const sourceNodes = [...first.nodes, ...next.nodes];
  const edges = [...first.edges, ...next.edges].map((edge, index) => ({
    ...edge,
    id: `e${index}`,
    from: { ...edge.from, node: labelToId.get(sourceNodes.find((node) => node.id === edge.from.node)?.label ?? "") ?? `missing-from-${index}` },
    to: { ...edge.to, node: labelToId.get(sourceNodes.find((node) => node.id === edge.to.node)?.label ?? "") ?? `missing-to-${index}` },
  }));
  return { ...first, nodes, edges };
}

function fmt(value: number) { return `${(value * 100).toFixed(1)}%`; }
