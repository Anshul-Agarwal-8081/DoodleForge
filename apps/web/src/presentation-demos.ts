import type { Graph } from "@doodleforge/ir";
type Node = Graph["nodes"][number];
type Edge = Graph["edges"][number];

const makeNode = (id: string, type: string, label: string, props: Record<string, unknown>, box: [number, number, number, number], marker: number): Node => ({
  id, type, label, props, region: { marker, box }, confidence: 1, origin: "user", via: "manual",
});
const makeEdge = (id: string, from: string, to: string, relation: string, label: string, box: [number, number, number, number]): Edge => ({
  id, from: { node: from }, to: { node: to }, relation, label, region: { box }, confidence: 1, origin: "user", via: "manual",
});
const graph = (domain: string, nodes: Node[], edges: Edge[] = [], constraints: Record<string, unknown> = {}): Graph => ({
  diagram_id: `presentation-${domain}`, version: 0, domain,
  source: { image_id: "presentation-board", width: 1000, height: 720 },
  nodes, edges, groups: [], assumptions: [], questions: [], diagnostics: [], constraints, style: { fixture: true, presentationDemo: true },
});

const demos: Record<string, Graph> = {
  cloud: graph("cloud", [
    makeNode("demo-web", "service", "Web App", { resourceName: "member-web" }, [55, 390, 245, 595], 1),
    makeNode("demo-api-1", "service", "Node.js API 1", { resourceName: "member-api-1" }, [285, 175, 525, 485], 2),
    makeNode("demo-api-2", "service", "Node.js API 2", { resourceName: "member-api-2" }, [285, 515, 525, 835], 3),
    makeNode("demo-db", "database", "PostgreSQL", { resourceName: "member-db", engine: "postgres", encryption: false }, [570, 390, 755, 595], 4),
    makeNode("demo-bucket", "bucket", "Public Uploads", { resourceName: "member-uploads", public: true, encryption: false }, [560, 40, 710, 290], 5),
    makeNode("demo-firewall", "security_group", "Open Firewall", { resourceName: "member-firewall", ingress: [{ cidr: "0.0.0.0/0", port: 5432 }] }, [560, 710, 710, 955], 6),
  ], [
    makeEdge("demo-edge-web-api1", "demo-web", "demo-api-1", "connects_to", "HTTPS", [235, 275, 300, 390]),
    makeEdge("demo-edge-web-api2", "demo-web", "demo-api-2", "connects_to", "HTTPS", [235, 595, 300, 700]),
    makeEdge("demo-edge-api-db", "demo-api-1", "demo-db", "connects_to", "SQL", [515, 390, 575, 485]),
  ], { provider: "aws", region: "us-east-1", monthly_budget_usd: 250 }),
  userstory: graph("userstory", [
    makeNode("demo-epic", "epic", "Member Experience", {}, [50, 65, 180, 930], 1),
    makeNode("demo-story-signin", "story", "Sign in with email", { persona: "member", story: "As a member, I want to sign in with email so that I can access my workspace", acceptance: [{ given: "I have an account", when: "I enter valid credentials", then: "I see my workspace" }] }, [230, 80, 435, 480], 2),
    makeNode("demo-story-profile", "story", "View my profile", { persona: "member", story: "As a member, I want to view my profile so I can check my details", acceptance: [{ given: "I am signed in", when: "I open my profile", then: "my saved details are shown" }] }, [230, 530, 435, 930], 3),
    makeNode("demo-story-reset", "story", "Reset a forgotten password", { persona: "member", story: "As a member, I want to reset my password" }, [495, 270, 690, 730], 4),
  ], [makeEdge("demo-story-edge", "demo-story-profile", "demo-story-signin", "depends_on", "requires sign in", [430, 450, 490, 550])]),
  erd: graph("erd", [
    makeNode("demo-entity-users", "entity", "Users", { columns: [{ name: "id", type: "uuid", primaryKey: true }, { name: "email", type: "text", unique: true }, { name: "created_at", type: "timestamptz" }] }, [100, 80, 345, 460], 1),
    makeNode("demo-entity-orders", "entity", "Orders", { columns: [{ name: "id", type: "uuid", primaryKey: true }, { name: "user_id", type: "uuid" }, { name: "total", type: "numeric(12,2)" }] }, [370, 530, 620, 930], 2),
  ], [makeEdge("demo-erd-link", "demo-entity-users", "demo-entity-orders", "one_to_many", "places", [310, 430, 400, 570])]),
  software: graph("software", [
    makeNode("demo-screen", "screen", "Calculator", {}, [75, 220, 220, 780], 1),
    makeNode("demo-display", "ui_component", "Display · 0", { component: "display" }, [245, 250, 360, 750], 2),
    ...["7", "8", "9", "÷", "4", "5", "6", "×", "1", "2", "3", "−", "C", "0", "=", "+"].map((label, index) => makeNode(`demo-calc-${index}`, "ui_component", label, { component: "button", action: /\d/.test(label) ? "digit" : label === "=" ? "equals" : label === "C" ? "clear" : "operator" }, [380 + Math.floor(index / 4) * 75, 250 + (index % 4) * 125, 445 + Math.floor(index / 4) * 75, 350 + (index % 4) * 125], index + 3)),
  ], [makeEdge("demo-screen-display", "demo-screen", "demo-display", "contains", "contains", [210, 460, 245, 540])]),
  workflow: graph("workflow", [
    makeNode("demo-step-submit", "workflow_step", "Submit order", { kind: "transform" }, [120, 80, 280, 400], 1),
    makeNode("demo-step-check", "workflow_step", "Validate address", { kind: "transform" }, [300, 350, 460, 670], 2),
    makeNode("demo-step-notify", "workflow_step", "Send confirmation", { kind: "notify" }, [480, 600, 640, 920], 3),
  ], [makeEdge("demo-flow-1", "demo-step-submit", "demo-step-check", "next", "then", [260, 350, 320, 400]), makeEdge("demo-flow-2", "demo-step-check", "demo-step-notify", "next", "then", [440, 600, 500, 670])]),
  circuit: graph("circuit", [
    makeNode("demo-input-a", "input", "Input A", {}, [220, 65, 390, 290], 1),
    makeNode("demo-input-b", "input", "Input B", {}, [450, 65, 620, 290], 2),
    makeNode("demo-and", "and", "AND Gate", {}, [320, 400, 500, 600], 3),
    makeNode("demo-output", "output", "Output Y", {}, [320, 710, 500, 935], 4),
  ], [makeEdge("demo-circuit-a", "demo-input-a", "demo-and", "signal", "A", [300, 285, 370, 405]), makeEdge("demo-circuit-b", "demo-input-b", "demo-and", "signal", "B", [430, 285, 480, 405]), makeEdge("demo-circuit-out", "demo-and", "demo-output", "signal", "Y", [390, 595, 435, 710])]),
};

export function presentationGraph(domain: string): Graph {
  return demos[domain] ?? demos.userstory!;
}
