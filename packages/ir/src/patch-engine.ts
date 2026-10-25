import {
  AssumptionSchema,
  DiagnosticSchema,
  GraphSchema,
  GroupSchema,
  NodeSchema,
  PatchSchema,
  QuestionSchema,
  type DomainPack,
  type Graph,
  type Patch,
  type PatchOp,
} from "./schema.js";

export type PatchErrorCode =
  | "invalid_patch"
  | "stale_base_version"
  | "future_base_version"
  | "not_found"
  | "duplicate_id"
  | "replace_all_not_allowed"
  | "invariant_violation";

export class PatchRejected extends Error {
  readonly code: PatchErrorCode;
  readonly details?: unknown;

  constructor(code: PatchErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = "PatchRejected";
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export type PatchApplication = {
  graph: Graph;
  patch: Patch;
  inverse: Patch;
  rebased: boolean;
};

export type PatchLog = {
  baseGraph: Graph;
  entries: Patch[];
};

const clone = <T>(value: T): T => structuredClone(value);
const equal = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const entityIds = (graph: Graph): Array<[string, string]> => [
  ...graph.nodes.map(({ id }) => ["node", id] as [string, string]),
  ...graph.edges.map(({ id }) => ["edge", id] as [string, string]),
  ...graph.groups.map(({ id }) => ["group", id] as [string, string]),
  ...graph.assumptions.map(({ id }) => ["assumption", id] as [string, string]),
  ...graph.questions.map(({ id }) => ["question", id] as [string, string]),
  ...graph.diagnostics.map(({ id }) => ["diagnostic", id] as [string, string]),
];

export function assertGraphInvariants(graphInput: unknown, pack?: DomainPack): asserts graphInput is Graph {
  const parsed = GraphSchema.safeParse(graphInput);
  if (!parsed.success) {
    throw new PatchRejected("invariant_violation", "Graph does not match the IR schema", parsed.error.issues);
  }
  const graph = parsed.data;

  const seenIds = new Map<string, string>();
  for (const [kind, id] of entityIds(graph)) {
    const prior = seenIds.get(id);
    if (prior) {
      throw new PatchRejected("duplicate_id", `Id '${id}' is used by both ${prior} and ${kind}`);
    }
    seenIds.set(id, kind);
  }

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  for (const node of graph.nodes) {
    const ports = node.ports ?? [];
    if (new Set(ports.map((port) => port.id)).size !== ports.length) {
      throw new PatchRejected("duplicate_id", `Node '${node.id}' has duplicate port ids`);
    }
    if (node.group && !graph.groups.some((group) => group.id === node.group)) {
      throw new PatchRejected("invariant_violation", `Node '${node.id}' refers to missing group '${node.group}'`);
    }
    if (pack) {
      const typeSpec = pack.vocabulary.nodeTypes[node.type];
      if (!typeSpec) {
        throw new PatchRejected("invariant_violation", `Node '${node.id}' uses type '${node.type}' outside pack '${pack.id}'`);
      }
      const propsResult = typeSpec.propsSchema.safeParse(node.props);
      if (!propsResult.success) {
        throw new PatchRejected(
          "invariant_violation",
          `Node '${node.id}' props do not match the '${node.type}' pack schema`,
          propsResult.error.issues,
        );
      }
      if (node.ports) {
        const declared = typeSpec.ports ?? [];
        for (const port of node.ports) {
          if (!declared.some((candidate) => candidate.id === port.id && candidate.dir === port.dir)) {
            throw new PatchRejected(
              "invariant_violation",
              `Node '${node.id}' has port '${port.id}' not declared by type '${node.type}' in pack '${pack.id}'`,
            );
          }
        }
      }
    }
  }

  for (const edge of graph.edges) {
    const from = nodes.get(edge.from.node);
    const to = nodes.get(edge.to.node);
    if (!from || !to) {
      throw new PatchRejected("invariant_violation", `Edge '${edge.id}' has a dangling node endpoint`);
    }
    const fromPorts = from.ports ?? pack?.vocabulary.nodeTypes[from.type]?.ports ?? [];
    const toPorts = to.ports ?? pack?.vocabulary.nodeTypes[to.type]?.ports ?? [];
    const fromPort = edge.from.port ? fromPorts.find((port) => port.id === edge.from.port) : undefined;
    const toPort = edge.to.port ? toPorts.find((port) => port.id === edge.to.port) : undefined;
    if (edge.from.port && !fromPort) {
      throw new PatchRejected("invariant_violation", `Edge '${edge.id}' references missing source port '${edge.from.port}'`);
    }
    if (edge.to.port && !toPort) {
      throw new PatchRejected("invariant_violation", `Edge '${edge.id}' references missing target port '${edge.to.port}'`);
    }
    if (fromPort && fromPort.dir !== "out") {
      throw new PatchRejected("invariant_violation", `Edge '${edge.id}' source port must have direction 'out'`);
    }
    if (toPort && toPort.dir !== "in") {
      throw new PatchRejected("invariant_violation", `Edge '${edge.id}' target port must have direction 'in'`);
    }
    if (pack && !pack.vocabulary.relations.includes(edge.relation)) {
      throw new PatchRejected("invariant_violation", `Relation '${edge.relation}' is not allowed by pack '${pack.id}'`);
    }
    if (pack && (edge.from.port || edge.to.port)) {
      if (!edge.from.port || !edge.to.port) {
        throw new PatchRejected("invariant_violation", `Edge '${edge.id}' must specify both ports for a pack-validated port pair`);
      }
      const sourceKey = `${from.type}:${edge.from.port}`;
      const targetKey = `${to.type}:${edge.to.port}`;
      const allowed = pack.vocabulary.allowedPortPairs.some(
        ([source, target]) => source === sourceKey && target === targetKey,
      );
      if (!allowed) {
        throw new PatchRejected(
          "invariant_violation",
          `Port pair '${sourceKey}' -> '${targetKey}' is not allowed by pack '${pack.id}'`,
        );
      }
    }
  }

  for (const group of graph.groups) {
    for (const memberId of group.members) {
      if (!nodes.has(memberId)) {
        throw new PatchRejected("invariant_violation", `Group '${group.id}' has dangling member '${memberId}'`);
      }
    }
  }

  for (const diagnostic of graph.diagnostics) {
    for (const target of diagnostic.targets) {
      if (target.node && !nodes.has(target.node)) {
        throw new PatchRejected("invariant_violation", `Diagnostic '${diagnostic.id}' targets missing node '${target.node}'`);
      }
      if (target.edge && !graph.edges.some((edge) => edge.id === target.edge)) {
        throw new PatchRejected("invariant_violation", `Diagnostic '${diagnostic.id}' targets missing edge '${target.edge}'`);
      }
    }
  }

  for (const question of graph.questions) {
    for (const target of question.targets) {
      if (!nodes.has(target) && !graph.edges.some((edge) => edge.id === target)) {
        throw new PatchRejected("invariant_violation", `Question '${question.id}' targets missing item '${target}'`);
      }
    }
  }
}

function requireIndex<T extends { id: string }>(items: T[], id: string, kind: string): number {
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new PatchRejected("not_found", `${kind} '${id}' was not found`);
  return index;
}

function requireUnique<T extends { id: string }>(items: T[], id: string, kind: string): void {
  if (items.some((item) => item.id === id)) {
    throw new PatchRejected("duplicate_id", `${kind} '${id}' already exists`);
  }
}

function applyOp(graph: Graph, op: PatchOp): Graph {
  switch (op.type) {
    case "add_node":
      requireUnique(graph.nodes, op.node.id, "Node");
      graph.nodes.push(clone(NodeSchema.parse(op.node)));
      return graph;
    case "update_node": {
      const index = requireIndex(graph.nodes, op.node.id, "Node");
      graph.nodes[index] = clone(NodeSchema.parse(op.node));
      return graph;
    }
    case "remove_node":
      graph.nodes.splice(requireIndex(graph.nodes, op.id, "Node"), 1);
      return graph;
    case "merge_nodes": {
      if (op.source_id === op.target_id) {
        throw new PatchRejected("invariant_violation", "A node cannot be merged into itself");
      }
      const source = graph.nodes[requireIndex(graph.nodes, op.source_id, "Source node")];
      const targetIndex = requireIndex(graph.nodes, op.target_id, "Target node");
      if (op.label !== undefined) graph.nodes[targetIndex]!.label = op.label;
      for (const edge of graph.edges) {
        if (edge.from.node === op.source_id) edge.from.node = op.target_id;
        if (edge.to.node === op.source_id) edge.to.node = op.target_id;
      }
      for (const group of graph.groups) {
        group.members = [...new Set(group.members.map((id) => (id === op.source_id ? op.target_id : id)))];
      }
      graph.nodes.splice(requireIndex(graph.nodes, source!.id, "Source node"), 1);
      return graph;
    }
    case "add_edge":
      requireUnique(graph.edges, op.edge.id, "Edge");
      graph.edges.push(clone(op.edge));
      return graph;
    case "update_edge": {
      const index = requireIndex(graph.edges, op.edge.id, "Edge");
      graph.edges[index] = clone(op.edge);
      return graph;
    }
    case "remove_edge":
      graph.edges.splice(requireIndex(graph.edges, op.id, "Edge"), 1);
      return graph;
    case "group": {
      const index = graph.groups.findIndex((group) => group.id === op.group.id);
      const parsed = GroupSchema.parse(op.group);
      if (index < 0) graph.groups.push(clone(parsed));
      else graph.groups[index] = clone(parsed);
      return graph;
    }
    case "ungroup":
      graph.groups.splice(requireIndex(graph.groups, op.id, "Group"), 1);
      for (const node of graph.nodes) if (node.group === op.id) delete node.group;
      return graph;
    case "set_domain":
      graph.domain = op.domain;
      return graph;
    case "set_style":
      graph.style = clone(op.style);
      return graph;
    case "set_constraints":
      graph.constraints = clone(op.constraints);
      return graph;
    case "set_source":
      if (op.source === undefined) delete graph.source;
      else graph.source = clone(op.source);
      return graph;
    case "set_diagnostics":
      graph.diagnostics = op.diagnostics.map((diagnostic) => DiagnosticSchema.parse(diagnostic));
      return graph;
    case "add_assumption":
      requireUnique(graph.assumptions, op.assumption.id, "Assumption");
      graph.assumptions.push(clone(AssumptionSchema.parse(op.assumption)));
      return graph;
    case "remove_assumption":
      graph.assumptions.splice(requireIndex(graph.assumptions, op.id, "Assumption"), 1);
      return graph;
    case "ask_question":
      requireUnique(graph.questions, op.question.id, "Question");
      graph.questions.push(clone(QuestionSchema.parse(op.question)));
      return graph;
    case "resolve_question":
      graph.questions.splice(requireIndex(graph.questions, op.question_id, "Question"), 1);
      return graph;
    case "remove_question":
      graph.questions.splice(requireIndex(graph.questions, op.id, "Question"), 1);
      return graph;
    case "replace_all": {
      const { version } = graph;
      const replacement = clone(GraphSchema.parse(op.graph));
      return { ...replacement, version };
    }
  }
}

function isSafeToRebase(ops: PatchOp[]): boolean {
  return ops.every((op) => ["add_node", "add_edge", "add_assumption", "ask_question"].includes(op.type));
}

function diffAsPatch(from: Graph, target: Graph, patchId: string): Patch {
  const ops: PatchOp[] = [];
  const targetNodeIds = new Set(target.nodes.map((item) => item.id));
  const targetEdgeIds = new Set(target.edges.map((item) => item.id));
  const targetGroupIds = new Set(target.groups.map((item) => item.id));
  const targetAssumptionIds = new Set(target.assumptions.map((item) => item.id));
  const targetQuestionIds = new Set(target.questions.map((item) => item.id));

  for (const edge of from.edges) if (!targetEdgeIds.has(edge.id)) ops.push({ type: "remove_edge", id: edge.id });
  for (const node of from.nodes) if (!targetNodeIds.has(node.id)) ops.push({ type: "remove_node", id: node.id });
  for (const group of from.groups) if (!targetGroupIds.has(group.id)) ops.push({ type: "ungroup", id: group.id });
  for (const assumption of from.assumptions) {
    if (!targetAssumptionIds.has(assumption.id)) ops.push({ type: "remove_assumption", id: assumption.id });
  }
  for (const question of from.questions) {
    if (!targetQuestionIds.has(question.id)) ops.push({ type: "remove_question", id: question.id });
  }

  for (const node of target.nodes) {
    const prior = from.nodes.find((item) => item.id === node.id);
    if (!prior) ops.push({ type: "add_node", node: clone(node) });
    else if (!equal(prior, node)) ops.push({ type: "update_node", node: clone(node) });
  }
  for (const edge of target.edges) {
    const prior = from.edges.find((item) => item.id === edge.id);
    if (!prior) ops.push({ type: "add_edge", edge: clone(edge) });
    else if (!equal(prior, edge)) ops.push({ type: "update_edge", edge: clone(edge) });
  }
  for (const group of target.groups) {
    const prior = from.groups.find((item) => item.id === group.id);
    if (!prior || !equal(prior, group)) ops.push({ type: "group", group: clone(group) });
  }
  for (const assumption of target.assumptions) {
    const prior = from.assumptions.find((item) => item.id === assumption.id);
    if (!prior) ops.push({ type: "add_assumption", assumption: clone(assumption) });
    else if (!equal(prior, assumption)) {
      ops.push({ type: "remove_assumption", id: assumption.id });
      ops.push({ type: "add_assumption", assumption: clone(assumption) });
    }
  }
  for (const question of target.questions) {
    const prior = from.questions.find((item) => item.id === question.id);
    if (!prior) ops.push({ type: "ask_question", question: clone(question) });
    else if (!equal(prior, question)) {
      ops.push({ type: "remove_question", id: question.id });
      ops.push({ type: "ask_question", question: clone(question) });
    }
  }

  if (from.domain !== target.domain) ops.push({ type: "set_domain", domain: target.domain });
  if (!equal(from.style, target.style)) ops.push({ type: "set_style", style: clone(target.style) });
  if (!equal(from.constraints, target.constraints)) {
    ops.push({ type: "set_constraints", constraints: clone(target.constraints) });
  }
  if (!equal(from.source, target.source)) {
    const sourceOp: PatchOp = target.source === undefined
      ? { type: "set_source" }
      : { type: "set_source", source: clone(target.source) };
    ops.push(sourceOp);
  }
  if (!equal(from.diagnostics, target.diagnostics)) {
    ops.push({ type: "set_diagnostics", diagnostics: clone(target.diagnostics) });
  }

  if (ops.length === 0) {
    // A no-op inverse still advances the append-only graph version.
    ops.push({ type: "set_style", style: clone(target.style) });
  }
  return {
    id: patchId,
    base_version: from.version,
    origin: "user",
    via: "manual",
    reason: "Compensating patch for undo",
    ops,
  };
}

export function diffGraphsToPatch(
  from: Graph,
  target: Graph,
  metadata: { id: string; origin: Patch["origin"]; via: Patch["via"]; reason: string },
): Patch {
  return {
    ...diffAsPatch(from, target, metadata.id),
    origin: metadata.origin,
    via: metadata.via,
    reason: metadata.reason,
  };
}

export function createEmptyGraph(diagram_id: string, domain = "unknown"): Graph {
  return {
    diagram_id,
    version: 0,
    domain,
    nodes: [],
    edges: [],
    groups: [],
    assumptions: [],
    questions: [],
    diagnostics: [],
    constraints: {},
    style: {},
  };
}

export function createPatchLog(baseGraph: Graph): PatchLog {
  assertGraphInvariants(baseGraph);
  return { baseGraph: clone(baseGraph), entries: [] };
}

export function replayPatchLog(log: PatchLog, pack?: DomainPack): Graph {
  let graph = clone(log.baseGraph);
  for (const patch of log.entries) graph = applyPatch(graph, patch, pack).graph;
  return graph;
}

export function appendPatchLog(log: PatchLog, patch: Patch, pack?: DomainPack): {
  log: PatchLog;
  graph: Graph;
  inverse: Patch;
} {
  if (log.entries.some((entry) => entry.id === patch.id)) {
    throw new PatchRejected("duplicate_id", `Patch id '${patch.id}' already exists in the append-only log`);
  }
  const graph = replayPatchLog(log, pack);
  const result = applyPatch(graph, patch, pack);
  return {
    log: { baseGraph: clone(log.baseGraph), entries: [...log.entries, result.patch] },
    graph: result.graph,
    inverse: result.inverse,
  };
}

export function appendUndo(log: PatchLog, pack?: DomainPack): { log: PatchLog; graph: Graph } {
  if (log.entries.length === 0) throw new PatchRejected("not_found", "There is no patch to undo");
  const current = replayPatchLog(log, pack);
  const priorLog: PatchLog = { baseGraph: clone(log.baseGraph), entries: log.entries.slice(0, -1) };
  const prior = replayPatchLog(priorLog, pack);
  const inverse = diffAsPatch(current, prior, `undo:${log.entries.at(-1)!.id}:${current.version}`);
  const result = applyPatch(current, inverse, pack);
  return {
    log: { baseGraph: clone(log.baseGraph), entries: [...log.entries, result.patch] },
    graph: result.graph,
  };
}

export function applyPatch(graphInput: Graph, patchInput: Patch, pack?: DomainPack): PatchApplication {
  let parsedPatch: Patch;
  try {
    parsedPatch = PatchSchema.parse(patchInput);
  } catch (error) {
    throw new PatchRejected("invalid_patch", "Patch does not match the patch schema", error);
  }
  assertGraphInvariants(graphInput, pack);
  let patch = clone(parsedPatch);
  let rebased = false;
  if (patch.base_version > graphInput.version) {
    throw new PatchRejected("future_base_version", `Patch is based on future version ${patch.base_version}`);
  }
  if (patch.base_version < graphInput.version) {
    if (!isSafeToRebase(patch.ops)) {
      throw new PatchRejected(
        "stale_base_version",
        `Patch base version ${patch.base_version} is stale; current version is ${graphInput.version}`,
      );
    }
    patch = { ...patch, base_version: graphInput.version };
    rebased = true;
  }

  if (patch.ops.some((op) => op.type === "replace_all")) {
    const isEmpty =
      graphInput.version === 0 &&
      graphInput.nodes.length === 0 &&
      graphInput.edges.length === 0 &&
      graphInput.groups.length === 0 &&
      graphInput.assumptions.length === 0 &&
      graphInput.questions.length === 0;
    if (!isEmpty || patch.ops.length !== 1 || patch.base_version !== 0) {
      throw new PatchRejected(
        "replace_all_not_allowed",
        "replace_all is permitted only as a single operation for the first sketch import",
      );
    }
  }

  const before = clone(graphInput);
  let next = clone(graphInput);
  try {
    for (const op of patch.ops) next = applyOp(next, op);
    next.version = graphInput.version + 1;
    assertGraphInvariants(next, pack);
  } catch (error) {
    if (error instanceof PatchRejected) throw error;
    throw new PatchRejected("invariant_violation", "Patch was rejected atomically", error);
  }
  const inverse = diffAsPatch(next, before, `undo:${patch.id}:${next.version}`);
  return { graph: next, patch, inverse, rebased };
}

export function invertPatch(priorGraph: Graph, patch: Patch, pack?: DomainPack): Patch {
  return applyPatch(priorGraph, patch, pack).inverse;
}

export function undoPatch(currentGraph: Graph, inversePatch: Patch, pack?: DomainPack): PatchApplication {
  return applyPatch(currentGraph, inversePatch, pack);
}

