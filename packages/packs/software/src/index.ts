import { z } from "zod";

export const ApiOperationSchema = z.object({
  id: z.string().min(1), method: z.enum(["get", "post", "put", "delete"]),
  path: z.string().regex(/^\/[a-zA-Z0-9_/{}/-]*$/), summary: z.string().min(1),
  response: z.record(z.string(), z.unknown()).default({ type: "object" }),
}).strict();
export type ApiOperation = z.infer<typeof ApiOperationSchema>;
export const SoftwareSpecSchema = z.object({ name: z.string().min(1), operations: z.array(ApiOperationSchema) }).strict();
export type SoftwareSpec = z.infer<typeof SoftwareSpecSchema>;

export const SoftwareActionSchema = z.enum(["digit", "decimal", "clear", "operator", "equals", "backspace", "none"]);
export const SoftwareComponentSchema = z.object({
  id: z.string().min(1), label: z.string().min(1).max(48),
  component: z.enum(["display", "button", "text", "input", "container"]).default("button"),
  action: SoftwareActionSchema.default("none"),
}).strict();
export const SoftwareComponentNodePropsSchema = z.object({
  component: z.enum(["display", "button", "text", "input", "container"]).optional(),
  action: SoftwareActionSchema.optional(),
}).strict();
export const SoftwareScreenNodePropsSchema = z.object({}).strict();
export const SoftwareUiSchema = z.object({
  appName: z.string().min(1).max(64),
  components: z.array(SoftwareComponentSchema).max(80),
}).strict();
export type SoftwareUi = z.infer<typeof SoftwareUiSchema>;

const defaultCalculator: SoftwareUi = {
  appName: "Calculator",
  components: [
    { id: "display", label: "0", component: "display", action: "none" },
    ...["C", "⌫", "÷", "×", "7", "8", "9", "−", "4", "5", "6", "+", "1", "2", "3", "=", "0", "."].map((label, index) => ({
      id: `calculator-button-${index}`, label, component: "button" as const,
      action: actionFor(label),
    })),
  ],
};

/** Convert only validated UI nodes and containment edges into a deterministic preview spec. */
export function softwareUiFromGraph(graph: {
  diagram_id?: string;
  nodes: Array<{ id: string; type: string; label: string; props: Record<string, unknown>; [key: string]: unknown }>;
  edges: Array<{ id: string; from: { node: string }; to: { node: string }; relation: string; [key: string]: unknown }>;
}): SoftwareUi {
  const screens = graph.nodes.filter((node) => node.type === "screen");
  const uiNodes = graph.nodes.filter((node) => node.type === "ui_component");
  if (screens.length === 0 && uiNodes.length === 0) return structuredClone(defaultCalculator);
  const screen = screens[0];
  for (const node of screens) SoftwareScreenNodePropsSchema.parse(node.props);
  const nodesById = new Map(uiNodes.map((node) => [node.id, node]));
  const containsOrder = graph.edges.filter((edge) => edge.relation === "contains" && nodesById.has(edge.to.node)).map((edge) => edge.to.node);
  const rank = new Map(containsOrder.map((id, index) => [id, index]));
  const components = uiNodes.map((node) => {
    const props = SoftwareComponentNodePropsSchema.parse(node.props);
    const component = props.component;
    const selectedComponent = component === "display" || component === "button" || component === "text" || component === "input" || component === "container" ? component : inferComponent(node.label);
    return SoftwareComponentSchema.parse({
      id: node.id,
      label: node.label,
      component: selectedComponent,
      action: props.action ?? actionFor(node.label),
    });
  }).sort((left, right) => (rank.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(right.id) ?? Number.MAX_SAFE_INTEGER));
  return SoftwareUiSchema.parse({ appName: screen?.label ?? graph.diagram_id ?? "DoodleForge app", components });
}

/** Deterministic source files plus a self-contained, script-sandboxed live preview. */
export function emitRunnableSoftwareApp(input: SoftwareUi): { files: Record<string, string>; previewHtml: string; spec: SoftwareUi } {
  const spec = SoftwareUiSchema.parse(input);
  const encoded = JSON.stringify(spec).replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026");
  const files = {
    "package.json": `${JSON.stringify({ name: safeName(spec.appName), private: true, version: "1.0.0", type: "module", scripts: { dev: "vite", build: "vite build" }, dependencies: { react: "^19.3.1", "react-dom": "^19.3.1" }, devDependencies: { "@vitejs/plugin-react": "^6.1.2", vite: "^8.3.5" } }, null, 2)}\n`,
    "vite.config.js": `import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()] });\n`,
    "index.html": `<!doctype html>\n<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1.0"/><title>${escapeHtml(spec.appName)}</title></head><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>\n`,
    "src/main.jsx": `import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App.jsx";\nimport "./styles.css";\n\ncreateRoot(document.getElementById("root")).render(<React.StrictMode><App /></React.StrictMode>);\n`,
    "src/App.jsx": `import { useState } from "react";\n\nconst spec = ${encoded};\nconst actionFor = (label) => { const value = label.trim().toLowerCase(); if (/^[0-9]$/.test(value)) return "digit"; if (value === ".") return "decimal"; if (["c", "ac", "clear"].includes(value)) return "clear"; if (["⌫", "backspace", "delete"].includes(value)) return "backspace"; if (["=", "equals"].includes(value)) return "equals"; if (["+", "-", "−", "*", "×", "/", "÷", "add", "subtract", "multiply", "divide"].includes(value)) return "operator"; return "none"; };\nconst operatorFor = (label) => ({ add: "+", subtract: "-", multiply: "×", divide: "÷", "−": "-", "*": "×", "/": "÷" }[label.trim().toLowerCase()] ?? label);\n\nexport default function App() {\n  const [display, setDisplay] = useState("0"); const [stored, setStored] = useState(null); const [operator, setOperator] = useState(null); const [replace, setReplace] = useState(false); const [message, setMessage] = useState("");\n  const press = (component) => { const action = component.action === "none" ? actionFor(component.label) : component.action; const label = component.label; setMessage("");\n    if (action === "clear") { setDisplay("0"); setStored(null); setOperator(null); setReplace(false); return; }\n    if (action === "digit") { setDisplay((old) => replace || old === "0" ? label : old.length < 16 ? old + label : old); setReplace(false); return; }\n    if (action === "decimal") { setDisplay((old) => replace ? "0." : old.includes(".") ? old : old + "."); setReplace(false); return; }\n    if (action === "backspace") { setDisplay((old) => replace ? "0" : old.length > 1 ? old.slice(0, -1) : "0"); setReplace(false); return; }\n    if (action === "operator") { setStored(Number(display)); setOperator(operatorFor(label)); setReplace(true); return; }\n    if (action === "equals") { if (operator === null || stored === null) return; const right = Number(display); const left = stored; const symbol = operator; const result = symbol === "+" ? left + right : symbol === "-" ? left - right : symbol === "×" ? left * right : right === 0 ? NaN : left / right; setDisplay(Number.isFinite(result) ? String(Number(result.toPrecision(12))) : "Error"); setStored(null); setOperator(null); setReplace(true); return; }\n    setMessage(label);\n  };\n  const displayComponent = spec.components.find((item) => item.component === "display"); const controls = spec.components.filter((item) => item.component === "button"); const isCalculator = controls.some((item) => item.action !== "none" || actionFor(item.label) !== "none");\n  return <main className={isCalculator ? "app calculator" : "app"}><header><span className="eyebrow">DOODLEFORGE · TEMPLATE</span><h1>{spec.appName}</h1></header><section className="preview-card">{isCalculator ? <><output aria-live="polite" aria-label={displayComponent?.label || "Calculator display"}>{display}</output><div className="keypad">{controls.map((item) => <button key={item.id} type="button" className={actionFor(item.label) === "operator" || item.action === "operator" || actionFor(item.label) === "equals" || item.action === "equals" ? "key key-accent" : "key"} onClick={() => press(item)}>{item.label}</button>)}</div></> : <><p>{displayComponent?.label ?? "Interactive component preview"}</p><div className="keypad">{controls.map((item) => <button key={item.id} type="button" className="key" onClick={() => press(item)}>{item.label}</button>)}</div><p role="status">{message}</p></>}</section></main>;\n}\n`,
    "src/styles.css": softwareStyles,
  };
  return { files, previewHtml: buildPreviewHtml(encoded), spec };
}

const softwareStyles = `*{box-sizing:border-box}body{margin:0;min-height:100vh;background:#f4f2ec;color:#222b26;font:15px/1.5 Inter,system-ui,sans-serif}.app{width:min(680px,100%);margin:auto;padding:32px 20px}.app header{margin:0 auto 18px}.eyebrow{color:#688271;font-size:10px;font-weight:800;letter-spacing:.12em}.app h1{margin:3px 0 0;font-size:26px;letter-spacing:-.04em}.preview-card{padding:20px;border:1px solid #e4e1d8;border-radius:20px;background:#fffefa;box-shadow:0 14px 40px #2d33250d}.calculator{max-width:420px}.calculator output{display:block;overflow:hidden;margin-bottom:14px;padding:20px 14px;border-radius:12px;background:#26372f;color:white;text-align:right;font-size:32px;font-variant-numeric:tabular-nums}.keypad{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.key{min-height:54px;border:1px solid #e5e2d9;border-radius:11px;background:#f7f5ee;color:#29352e;font-size:18px;font-weight:650;cursor:pointer}.key:hover{background:#eaf1ea}.key:active{transform:translateY(1px)}.key-accent{border-color:#bdd4c4;background:#e7f1e9;color:#336d53}@media(max-width:400px){.app{padding:18px 12px}.key{min-height:48px}}`;

function buildPreviewHtml(encodedSpec: string) {
  const script = `const spec=${encodedSpec};const root=document.getElementById("root");document.title=spec.appName;const main=document.createElement("main");const controls=spec.components.filter(x=>x.component==="button");const displaySpec=spec.components.find(x=>x.component==="display");const actionFor=(x)=>{if(x.action&&x.action!=="none")return x.action;const t=x.label.trim().toLowerCase();if(/^\\d$/.test(t))return"digit";if(t===".")return"decimal";if(["c","ac","clear"].includes(t))return"clear";if(["⌫","backspace","delete"].includes(t))return"backspace";if(["=","equals"].includes(t))return"equals";if(["+","-","−","*","×","/","÷","add","subtract","multiply","divide"].includes(t))return"operator";return"none"};const operatorFor=(label)=>({add:"+",subtract:"-",multiply:"×",divide:"÷","−":"-","*":"×","/":"÷"}[label.trim().toLowerCase()]||label);const isCalculator=controls.some(x=>actionFor(x)!=="none");main.className=isCalculator?"app calculator":"app";main.innerHTML='<header><span class="eyebrow">DOODLEFORGE · TEMPLATE</span><h1></h1></header><section class="preview-card"></section>';main.querySelector("h1").textContent=spec.appName;const card=main.querySelector(".preview-card");let display="0",stored=null,operator=null,replace=false;const output=document.createElement("output");output.setAttribute("aria-live","polite");output.setAttribute("aria-label",displaySpec?.label||"Calculator display");output.textContent=display;const keypad=document.createElement("div");keypad.className="keypad";const message=document.createElement("p");message.setAttribute("role","status");const render=()=>{output.textContent=display};const press=(item)=>{const action=actionFor(item);const label=item.label;if(action==="clear"){display="0";stored=null;operator=null;replace=false}else if(action==="digit"){display=replace||display==="0"?label:display.length<16?display+label:display;replace=false}else if(action==="decimal"){display=replace?"0.":display.includes(".")?display:display+".";replace=false}else if(action==="backspace"){display=replace?"0":display.length>1?display.slice(0,-1):"0";replace=false}else if(action==="operator"){stored=Number(display);operator=operatorFor(label);replace=true}else if(action==="equals"&&operator!==null&&stored!==null){const right=Number(display),left=stored,s=operator;const result=s==="+"?left+right:s==="-"?left-right:s==="×"?left*right:right===0?NaN:left/right;display=Number.isFinite(result)?String(Number(result.toPrecision(12))):"Error";stored=null;operator=null;replace=true}else if(action==="none"){message.textContent=label}render()};for(const item of controls){const button=document.createElement("button");button.type="button";button.className="key"+(actionFor(item)==="operator"||actionFor(item)==="equals"?" key-accent":"");button.textContent=item.label;button.addEventListener("click",()=>press(item));keypad.append(button)}if(isCalculator){card.append(output,keypad)}else{const copy=document.createElement("p");copy.textContent=displaySpec?.label||"Interactive component preview";card.append(copy,keypad,message)}root.append(main);`;
  return `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>DoodleForge preview</title><style>${softwareStyles}</style></head><body><div id="root"></div><script>${script}</script></body></html>`;
}

function inferComponent(label: string): SoftwareComponentSchemaShape["component"] { return actionFor(label) === "none" ? "text" : "button"; }
function actionFor(label: string): z.infer<typeof SoftwareActionSchema> {
  const value = label.trim().toLowerCase();
  if (/^[0-9]$/.test(value)) return "digit";
  if (value === ".") return "decimal";
  if (["c", "ac", "clear"].includes(value)) return "clear";
  if (["⌫", "backspace", "delete"].includes(value)) return "backspace";
  if (["=", "equals"].includes(value)) return "equals";
  if (["+", "-", "−", "*", "×", "/", "÷"].includes(value)) return "operator";
  return "none";
}
function escapeHtml(value: string) { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }
type SoftwareComponentSchemaShape = z.infer<typeof SoftwareComponentSchema>;

export function specFromGraph(graph: { diagram_id: string; nodes: { id: string; type: string; label: string; props: Record<string, unknown> }[] }): SoftwareSpec {
  const operations = graph.nodes.filter((node) => node.type === "api_operation").map((node, index) => ApiOperationSchema.parse({
    id: node.id, method: node.props.method ?? "get", path: node.props.path ?? `/items/${index + 1}`,
    summary: node.props.summary ?? node.label, response: node.props.responseSchema ?? { type: "object" },
  }));
  return SoftwareSpecSchema.parse({ name: graph.diagram_id || "DoodleForge API", operations });
}

export function emitOpenApi(input: SoftwareSpec): Record<string, unknown> {
  const spec = SoftwareSpecSchema.parse(input);
  const paths: Record<string, Record<string, unknown>> = {};
  for (const operation of spec.operations) {
    if (paths[operation.path]?.[operation.method]) throw new Error(`Duplicate operation: ${operation.method.toUpperCase()} ${operation.path}`);
    paths[operation.path] ??= {};
    paths[operation.path]![operation.method] = {
      operationId: safeName(operation.id), summary: operation.summary,
      responses: { "200": { description: "Successful response", content: { "application/json": { schema: operation.response } } } },
    };
  }
  return { openapi: "3.1.0", info: { title: spec.name, version: "1.0.0" }, paths };
}

export function validateOpenApi(contract: Record<string, unknown>): { ok: boolean; errors: string[] } {
  const schema = {
    type: "object", required: ["openapi", "info", "paths"], additionalProperties: true,
    properties: { openapi: { type: "string", const: "3.1.0" }, info: { type: "object", required: ["title", "version"], additionalProperties: true, properties: { title: { type: "string" }, version: { type: "string" } } }, paths: { type: "object", additionalProperties: true } },
  };
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) return { ok: false, errors: ["/ must be an object"] };
  const value = contract as Record<string, unknown>;
  const errors: string[] = [];
  if (value.openapi !== "3.1.0") errors.push("/openapi must equal 3.1.0");
  if (!value.info || typeof value.info !== "object" || typeof (value.info as Record<string, unknown>).title !== "string" || typeof (value.info as Record<string, unknown>).version !== "string") errors.push("/info requires title and version");
  if (!value.paths || typeof value.paths !== "object" || Array.isArray(value.paths)) errors.push("/paths must be an object");
  else for (const [path, methods] of Object.entries(value.paths as Record<string, unknown>)) {
    if (!path.startsWith("/") || !methods || typeof methods !== "object" || Array.isArray(methods)) { errors.push(`/paths/${path} must contain operations`); continue; }
    for (const [method, operation] of Object.entries(methods as Record<string, unknown>)) if (!["get", "post", "put", "delete"].includes(method) || !operation || typeof operation !== "object" || !("responses" in operation)) errors.push(`/paths/${path}/${method} must declare responses`);
  }
  return { ok: errors.length === 0, errors };
}

export function mockResponse(spec: SoftwareSpec, method: ApiOperation["method"], path: string): unknown {
  const op = SoftwareSpecSchema.parse(spec).operations.find((item) => item.method === method && item.path === path);
  if (!op) return { status: 404, body: { error: "No mock route" } };
  const body = op.response.example ?? (op.response.type === "array" ? [] : {});
  return { status: 200, body };
}

export function generatedStubs(spec: SoftwareSpec): Record<string, string> {
  const parsed = SoftwareSpecSchema.parse(spec);
  const safe = safeName(parsed.name);
  return {
    [`src/${safe}.routes.ts`]: `// @generated by DoodleForge. Edit the graph to regenerate.\nexport const routes = ${JSON.stringify(parsed.operations.map(({ id, method, path }) => ({ id, method, path })), null, 2)} as const;\n`,
    [`src/${safe}.client.ts`]: `// @generated by DoodleForge. Edit the graph to regenerate.\nexport type ApiResponse<T> = { status: number; body: T };\nexport const apiName = ${JSON.stringify(parsed.name)};\n`,
  };
}

export function checkExportConflicts(generated: Record<string, string>, existing: Record<string, string>): string[] {
  return Object.keys(generated).filter((path) => path in existing && !existing[path]?.startsWith("// @generated by DoodleForge."));
}

export async function verifyGeneratedTypeScript(files: Record<string, string>, runner: (files: Record<string, string>) => Promise<{ exitCode: number; output: string }>): Promise<{ verified: boolean; output: string }> {
  const result = await runner(files);
  return { verified: result.exitCode === 0, output: result.output };
}

function safeName(value: string): string {
  return value.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "doodleforge";
}
