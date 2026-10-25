import type { Diagnostic, Graph } from "@doodleforge/ir";
import type { PureRule } from "@doodleforge/rules";
import { CloudPropsSchema } from "./schema.js";

const makeFinding = (rule: string, node: string, message: string): Diagnostic => ({ id: `${rule}:${node}`, rule, severity: "high", trust: "verified", targets: [{ node }], message });

export const cloudRules: PureRule[] = [
  {
    id: "cloud.public-bucket", pack: "cloud", severity: "high",
    check(graph: Graph) {
      return graph.nodes.filter((node) => node.type === "bucket").flatMap((node) => {
        const parsed = CloudPropsSchema.safeParse(node.props);
        return parsed.success && parsed.data.public === true ? [makeFinding(this.id, node.id, `Bucket '${node.label}' is marked public.`)] : [];
      });
    },
  },
  {
    id: "cloud.open-ingress", pack: "cloud", severity: "high",
    check(graph: Graph) {
      return graph.nodes.filter((node) => node.type === "security_group").flatMap((node) => {
        const parsed = CloudPropsSchema.safeParse(node.props);
        return parsed.success && parsed.data.ingress?.some((item) => item.cidr === "0.0.0.0/0" || item.cidr === "::/0")
          ? [makeFinding(this.id, node.id, `Security group '${node.label}' permits ingress from every IPv4 or IPv6 address.`)] : [];
      });
    },
  },
  {
    id: "cloud.unencrypted-storage", pack: "cloud", severity: "medium",
    check(graph: Graph) {
      return graph.nodes.filter((node) => ["bucket", "database"].includes(node.type)).flatMap((node) => {
        const parsed = CloudPropsSchema.safeParse(node.props);
        return parsed.success && parsed.data.encryption === false ? [{ ...makeFinding(this.id, node.id, `Storage '${node.label}' has encryption disabled.`), severity: "medium" as const }] : [];
      });
    },
  },
];
