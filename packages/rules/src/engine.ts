import { DiagnosticSchema, type Diagnostic, type Graph } from "@doodleforge/ir";

export type PureRule = {
  id: string;
  pack: string;
  severity: Diagnostic["severity"];
  check(graph: Graph): Diagnostic[];
};

export function runRules(graph: Graph, rules: PureRule[]): Diagnostic[] {
  const findings = rules.flatMap((rule) => rule.check(graph));
  const ids = new Set<string>();
  for (const finding of findings) {
    const parsed = DiagnosticSchema.parse(finding);
    if (ids.has(parsed.id)) throw new Error(`Rule engine produced duplicate diagnostic id '${parsed.id}'`);
    ids.add(parsed.id);
  }
  return findings;
}

