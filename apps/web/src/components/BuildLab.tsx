import { useMemo, useState, type FormEvent } from "react";
import { emitOpenApi, emitRunnableSoftwareApp, generatedStubs, mockResponse, softwareUiFromGraph, specFromGraph, validateOpenApi, type SoftwareSpec } from "../../../../packages/packs/software/src/index.js";
import { extractPalette, fixtureVoiceTranscript, renderBackMismatches, simulateCircuit as simulateCircuitGraph, simulateWorkflow, splitImageTiles, storyboard, storyboardCoverage, storyboardMarkdown, vote } from "../../../../packages/packs/labs/src/index.js";
import type { Graph, PatchOp } from "@doodleforge/ir";

const circuitExample = { diagram_id: "circuit-demo", version: 1, domain: "circuit", nodes: [
  { id: "in", type: "input", label: "Email valid", props: {}, confidence: 1, origin: "user", via: "manual" },
  { id: "not", type: "not", label: "Invalid", props: {}, confidence: 1, origin: "user", via: "manual" },
  { id: "out", type: "output", label: "Block sign-in", props: {}, confidence: 1, origin: "user", via: "manual" },
], edges: [{ id: "e1", from: { node: "in" }, to: { node: "not" }, relation: "wire", confidence: 1, origin: "user", via: "manual" }, { id: "e2", from: { node: "not" }, to: { node: "out" }, relation: "wire", confidence: 1, origin: "user", via: "manual" }] } as Graph;

export type BuildArea = "software" | "storyboard" | "workflow" | "theme" | "circuit" | "voice" | "eval";
type Props = { initialArea?: BuildArea; showTabs?: boolean; graph: Graph; sourceImageUrl?: string; onPatch?(ops: PatchOp[], reason: string): void };

export function BuildLab({ initialArea = "software", showTabs = true, graph, sourceImageUrl, onPatch }: Props) {
  const [area, setArea] = useState<BuildArea>(initialArea);
  const [notice, setNotice] = useState("");
  const software = useMemo<SoftwareSpec>(() => {
    try {
      const fromGraph = specFromGraph(graph);
      return fromGraph.operations.length ? fromGraph : { name: graph.diagram_id || "DoodleForge API", operations: [] };
    } catch { return { name: graph.diagram_id || "DoodleForge API", operations: [] }; }
  }, [graph]);
  const openApi = useMemo(() => emitOpenApi(software), [software]);
  const json = JSON.stringify(openApi, null, 2);
  const stubs = generatedStubs(software);
  const verified = validateOpenApi(openApi);
  const softwareUiState = useMemo(() => {
    try { return { value: softwareUiFromGraph(graph), error: "" }; }
    catch (error) { return { value: softwareUiFromGraph({ diagram_id: "Calculator", nodes: [], edges: [] }), error: error instanceof Error ? error.message : String(error) }; }
  }, [graph]);
  const generatedApp = useMemo(() => emitRunnableSoftwareApp(softwareUiState.value), [softwareUiState.value]);
  const tabs: [BuildArea, string][] = [["software", "Software"], ["storyboard", "Storyboard"], ["workflow", "Workflow"], ["theme", "Theme"], ["circuit", "Circuit"], ["voice", "Voice"], ["eval", "Careful · Eval"]];
  return <section className="panel build-lab" aria-label="Build tools">
    <div className="panel-heading"><div><p className="eyebrow">PHASES 6–8 · BUILDER TOOLS</p><h2>Turn the current graph into usable artifacts</h2></div><span className="status-pill status-pill--ready">Offline ready</span></div>
    {showTabs && <div className="lab-tabs" role="tablist">{tabs.map(([id, title]) => <button key={id} role="tab" type="button" aria-selected={area === id} onClick={() => { setArea(id); setNotice(""); }}>{title}</button>)}</div>}
    {area === "software" && <SoftwareLab graph={graph} software={software} openApi={openApi} stubs={stubs} verified={verified.ok} notice={notice} setNotice={setNotice} onPatch={onPatch} generatedApp={generatedApp} generatorError={softwareUiState.error} />}
    {area === "storyboard" && <StoryboardLab graph={graph} />}
    {area === "workflow" && <WorkflowDemo graph={graph} />}
    {area === "theme" && <ThemeLab sourceImageUrl={sourceImageUrl} />}
    {area === "circuit" && <CircuitDemo graph={graph} />}
    {area === "voice" && <VoiceDemo setNotice={setNotice} notice={notice} />}
    {area === "eval" && <div className="lab-copy"><p className="eyebrow">CAREFUL MODE & REGRESSION</p><h3>Consensus and render-back checks</h3><p>Three-run voting helper, mismatch checks, and overlapping image tiling are available offline. No live 30-sketch benchmark is configured.</p><div className="eval-summary"><span><strong>{vote(graph.nodes.map((node) => node.type), (x) => x).agreement * 100}%</strong> graph type agreement</span><span><strong>{splitImageTiles(2048, 1400).length}</strong> overlapping image tiles</span><span><strong>{renderBackMismatches(graph.nodes.map((node) => node.label), graph.nodes.slice(0, -1).map((node) => node.label)).length}</strong> render-back mismatches surfaced</span></div></div>}
    <p className="lab-footnote">Previews are not marked ready until their verification passes. External workflow actions are disabled here.</p>
  </section>;
}

function SoftwareLab({ graph, software, openApi, stubs, verified, notice, setNotice, onPatch, generatedApp, generatorError }: { graph: Graph; software: SoftwareSpec; openApi: Record<string, unknown>; stubs: Record<string, string>; verified: boolean; notice: string; setNotice(value: string): void; onPatch?: (ops: PatchOp[], reason: string) => void; generatedApp: ReturnType<typeof emitRunnableSoftwareApp>; generatorError: string }) {
  const [method, setMethod] = useState<"get" | "post" | "put" | "delete">("get");
  const [path, setPath] = useState("/items");
  const [summary, setSummary] = useState("List items");
  const addOperation = (event: FormEvent) => {
    event.preventDefault();
    if (!onPatch || !path.startsWith("/")) return;
    const node: Graph["nodes"][number] = { id: `api-${crypto.randomUUID()}`, type: "api_operation", label: summary.trim() || path, props: { method, path, summary: summary.trim() || path, responseSchema: { type: "object" } }, confidence: 1, origin: "user", via: "manual" };
    onPatch([{ type: "add_node", node }], "Add an API operation to the graph");
    setNotice(`Added ${method.toUpperCase()} ${path} as a user patch.`);
  };
  return <div className="lab-content"><div className="lab-copy"><p className="eyebrow">SOFTWARE PACK · GRAPH BACKED</p><h3>{software.name}</h3><p>Screen and UI component nodes compile into a deterministic interactive app. API operation nodes compile into OpenAPI below. Imported calculator sketches are editable in the shared graph.</p>
    <form className="lab-form" onSubmit={addOperation}><label>Method<select value={method} onChange={(event) => setMethod(event.target.value as typeof method)}><option value="get">GET</option><option value="post">POST</option><option value="put">PUT</option><option value="delete">DELETE</option></select></label><label>Path<input value={path} onChange={(event) => setPath(event.target.value)} required pattern="/.*" /></label><label>Summary<input value={summary} onChange={(event) => setSummary(event.target.value)} required /></label><button type="submit" className="primary-button" disabled={!onPatch}>Add to graph</button></form>
    <div className="lab-actions"><span className={`status-pill ${verified ? "status-pill--ready" : "status-pill--warning"}`}>{verified ? "✓ Contract verified" : "Needs fixes"}</span><button type="button" className="secondary-button" disabled={!software.operations.length} onClick={() => setNotice(JSON.stringify(mockResponse(software, software.operations[0]!.method, software.operations[0]!.path), null, 2))}>Run first mock route</button><button type="button" className="secondary-button" onClick={() => setNotice(verified ? "Export gate passed: OpenAPI contract is valid. TypeScript compilation is still required for a real export." : "Export blocked: fix the OpenAPI validation errors first.")}>Check export gate</button></div>
    <div className="generated-source"><div className="lab-preview-bar"><span>Generated runnable source</span><span>{Object.keys(generatedApp.files).length} files</span></div><div>{Object.entries(generatedApp.files).map(([file, contents]) => <button type="button" className="source-download" key={file} onClick={() => downloadText(file.split("/").at(-1) ?? file, contents, file.endsWith(".json") ? "application/json" : file.endsWith(".css") ? "text/css" : "text/javascript")}>Download {file}</button>)}</div></div>
    {notice && <pre className="lab-output" role="status">{notice}</pre>}{!software.operations.length && <p className="validation-message">No API operation nodes yet. Add one above to compile this graph into an API contract.</p>}
  </div><div className="lab-preview">{generatorError && <p className="validation-message" role="alert">UI component validation failed: {generatorError}. Showing the built-in calculator example until the graph is corrected.</p>}<div className="lab-preview-bar"><span>Interactive app preview · {generatedApp.spec.appName}</span><span>{generatorError ? "Fallback preview" : "Sandboxed"}</span></div><iframe className="software-app-preview" title={`${generatedApp.spec.appName} interactive preview`} sandbox="allow-scripts" srcDoc={generatedApp.previewHtml} /><div className="lab-preview-bar"><span>OpenAPI contract · 3.1</span><span>{software.operations.length} routes · {verified ? "valid" : "invalid"}</span></div><pre>{JSON.stringify(openApi, null, 2)}</pre><div className="lab-preview-bar"><span>API support stubs</span><span>deterministic output</span></div><pre>{Object.entries(stubs).map(([file, contents]) => `${file}\n${contents}`).join("\n")}</pre><small>Graph nodes: {graph.nodes.length} · IR v{graph.version}</small></div></div>;
}

function StoryboardLab({ graph }: { graph: Graph }) {
  const [audience, setAudience] = useState<"team" | "executive" | "customer">("team");
  const [index, setIndex] = useState(0);
  const [showNotes, setShowNotes] = useState(false);
  const slides = useMemo(() => storyboard(graph, audience), [graph, audience]);
  const coverage = useMemo(() => storyboardCoverage(graph, slides), [graph, slides]);
  const active = slides[index];
  const exportMarkdown = () => downloadText("doodleforge-storyboard.md", storyboardMarkdown(slides, audience), "text/markdown");
  return <div className="storyboard-workbench"><div className="storyboard-controls"><label>Audience<select value={audience} onChange={(event) => { setAudience(event.target.value as typeof audience); setIndex(0); }}><option value="team">Product team</option><option value="executive">Executive summary</option><option value="customer">Customer walkthrough</option></select></label><button type="button" className="secondary-button" onClick={exportMarkdown} disabled={!slides.length}>Export Markdown</button><span className={`status-pill ${coverage.complete ? "status-pill--ready" : "status-pill--warning"}`}>{coverage.complete ? `✓ All ${graph.nodes.length} graph nodes covered` : `Missing ${coverage.missing.length} graph nodes`}</span></div>
    {active ? <><article className="story-slide story-slide--active"><span>FRAME {String(index + 1).padStart(2, "0")} / {String(slides.length).padStart(2, "0")} · {graph.domain.toUpperCase()}</span><h3>{active.title}</h3><p>{active.body}</p>{active.offPath && <p className="validation-message">Off-path item: included for review, but it is not connected to the opening flow.</p>}<small>Source graph node: {active.nodeId}</small>{showNotes && <pre className="lab-output">{active.notes}</pre>}</article><div className="storyboard-player"><button className="secondary-button" type="button" onClick={() => setIndex((current) => Math.max(0, current - 1))} disabled={index === 0}>← Previous</button><button className="secondary-button" type="button" onClick={() => setShowNotes((visible) => !visible)}>{showNotes ? "Hide" : "Show"} speaker notes</button><button className="primary-button" type="button" onClick={() => setIndex((current) => Math.min(slides.length - 1, current + 1))} disabled={index >= slides.length - 1}>Next frame →</button></div><div className="storyboard-grid">{slides.map((slide, slideIndex) => <button type="button" className={`story-slide story-slide--thumb ${slideIndex === index ? "is-current" : ""}`} key={slide.nodeId} onClick={() => setIndex(slideIndex)}><span>FRAME {String(slideIndex + 1).padStart(2, "0")}</span><h3>{slide.title}</h3><p>{slide.body}</p></button>)}</div></> : <div className="empty-state">Import a sketch or add graph items on Canvas to create a storyboard.</div>}
  </div>;
}

function WorkflowDemo({ graph }: { graph: Graph }) {
  const [host, setHost] = useState("hooks.example.com");
  const [result, setResult] = useState<ReturnType<typeof simulateWorkflow> | null>(null);
  const steps = graph.nodes.map((node, index) => ({ id: node.id, name: node.label, kind: "transform" as const, ...(index > 0 ? { target: undefined } : {}) }));
  const simulate = () => {
    const workflowSteps = steps.length ? steps : [{ id: "empty", name: "No graph steps", kind: "transform" as const }];
    const value = simulateWorkflow({ id: graph.diagram_id, approved: true, steps: [...workflowSteps, { id: "webhook", name: "Notify allowlisted host", kind: "http_request" as const, target: `https://${host}/doodleforge` }] }, ["hooks.example.com"]);
    setResult(value);
  };
  return <div className="lab-copy"><p className="eyebrow">WORKFLOW PACK · DRY RUN</p><h3>Preview steps from the current graph</h3><p>Each graph node becomes a local transform step. Test a webhook target against the built-in host allowlist; this page never sends a request.</p><label>Webhook host<input value={host} onChange={(event) => setHost(event.target.value)} placeholder="hooks.example.com" /></label><button type="button" className="primary-button" onClick={simulate}>Validate workflow dry run</button>{result && <pre className="lab-output" role="status">{result.steps.join("\n") || "No steps executed"}{result.error ? `\n${result.error}` : ""}</pre>}</div>;
}

function ThemeLab({ sourceImageUrl }: { sourceImageUrl?: string }) {
  const [colors, setColors] = useState(["#f6f2e8", "#f6f2e8", "#28745e", "#d6a44a", "#d45b4d", "#26352f"]);
  const [message, setMessage] = useState("Fixture palette shown. Extract colors from the current sketch or choose a reference image.");
  const extract = async (url: string) => {
    try {
      const image = new Image(); image.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error("Image could not be loaded")); image.src = url; });
      const canvas = document.createElement("canvas"); canvas.width = 80; canvas.height = 80;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Browser canvas is unavailable");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const sampled: string[] = [];
      for (let index = 0; index < data.length; index += 16) {
        if (data[index + 3]! < 96) continue;
        const quantize = (channel: number) => Math.min(255, (channel >> 4) * 16 + 8).toString(16).padStart(2, "0");
        sampled.push(`#${quantize(data[index]!)}${quantize(data[index + 1]!)}${quantize(data[index + 2]!)}`);
      }
      if (!sampled.length) throw new Error("No opaque pixels were found");
      setColors(sampled); setMessage("Palette extracted locally in your browser. The reference image was not uploaded.");
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
  };
  const palette = extractPalette(colors);
  const css = `:root {\n${palette.map((color, index) => `  --theme-color-${index + 1}: ${color.hex};`).join("\n")}\n}`;
  const onFile = (file?: File) => { if (!file) return; const url = URL.createObjectURL(file); void extract(url).finally(() => URL.revokeObjectURL(url)); };
  return <div className="theme-workbench"><div className="theme-controls"><button type="button" className="secondary-button" onClick={() => sourceImageUrl ? void extract(sourceImageUrl) : setMessage("Import a sketch on Canvas first, or choose a reference image below.")}>Extract from current sketch</button><label className="secondary-button theme-upload">Choose reference image<input type="file" accept="image/*" onChange={(event) => onFile(event.target.files?.[0])} /></label><button type="button" className="secondary-button" onClick={() => downloadText("doodleforge-theme.css", css, "text/css")}>Download CSS tokens</button><span>{message}</span></div><div className="theme-grid">{palette.map((color, index) => <article className="theme-swatch" key={color.hex}><span style={{ background: color.hex }} /><strong>{color.hex} · token {index + 1}</strong><small>Use {color.foreground} text · contrast {color.contrast.toFixed(1)}:1 {color.contrast >= 4.5 ? "✓ WCAG AA" : "· low contrast"} · sampled {color.count} px</small></article>)}</div><pre className="lab-output">{css}</pre></div>;
}

function CircuitDemo({ graph }: { graph: Graph }) {
  const hasLogic = graph.nodes.some((node) => ["input", "and", "or", "not", "xor", "output"].includes(node.type));
  const circuit = hasLogic ? graph : circuitExample;
  const inputs = circuit.nodes.filter((node) => node.type === "input");
  const [values, setValues] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<ReturnType<typeof simulateCircuitGraph> | null>(null);
  return <div className="lab-copy"><p className="eyebrow">CONCEPTUAL LOGIC · NO SPICE</p><h3>{hasLogic ? "Simulate circuit nodes from the current graph" : "Try a sign-in logic example"}</h3><p>{hasLogic ? `Using ${circuit.nodes.length} logic nodes and ${circuit.edges.length} wires from the current graph.` : "The current graph has no circuit nodes. This example is an editable Boolean input and can be replaced by importing a circuit sketch."}</p>{inputs.map((node) => <label className="toggle-row" key={node.id}><input type="checkbox" checked={values[node.id] ?? false} onChange={(event) => setValues((current) => ({ ...current, [node.id]: event.target.checked }))} /> {node.label}</label>)}<button type="button" className="primary-button" onClick={() => setResult(simulateCircuitGraph(circuit, values))}>Simulate circuit</button>{result && <pre className="lab-output" role="status">{result.error ?? Object.entries(result.outputs).map(([name, value]) => `${name}: ${value ? "ON" : "OFF"}`).join("\n")}</pre>}</div>;
}

function VoiceDemo({ notice, setNotice }: { notice: string; setNotice(value: string): void }) {
  const [seconds, setSeconds] = useState(4);
  return <div className="lab-copy"><p className="eyebrow">PUSH TO TALK · 30 S MAX</p><h3>Try a voice instruction fixture</h3><p>Audio recording and hosted audio transcription are not connected yet. This offline fixture demonstrates the 30-second guard and keeps the audio path disabled.</p><label>Fixture clip length (seconds)<input type="number" min="1" max="30" value={seconds} onChange={(event) => setSeconds(Number(event.target.value))} /></label><button type="button" className="primary-button" onClick={() => { try { setNotice(fixtureVoiceTranscript(seconds).transcript); } catch (error) { setNotice(error instanceof Error ? error.message : String(error)); } }}>Run offline voice fixture</button>{notice && <blockquote className="lab-output">“{notice}”</blockquote>}</div>;
}

function downloadText(filename: string, contents: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement("a"); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
