import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { coreRules, runRules, userStoryRules } from "@doodleforge/rules";
import { cloudRules } from "@doodleforge/pack-cloud";
import { erdRules } from "../../../packages/packs/erd/src/rules.js";
import type { Diagnostic, Patch } from "@doodleforge/ir";
import { BoardCanvas } from "./components/BoardCanvas.js";
import { PhotoAudit } from "./components/PhotoAudit.js";
import { SketchIntake, type JobMode, type JobProgress } from "./components/SketchIntake.js";
import { OutputsTab } from "./components/OutputsTab.js";
import { ErdWorkbench } from "./components/ErdWorkbench.js";
import { postSketchJob, postVoiceJob, prepareImageJob, prepareVoiceJob, type DiagramDomain, type SketchJobRequest } from "./api-client.js";
import { useBoardStore } from "./store.js";
import { compileTextIntent } from "@doodleforge/text";
import { CloudWorkbench } from "./components/CloudWorkbench.js";
import { BuildLab, type BuildArea } from "./components/BuildLab.js";
import { ModelSettingsPage } from "./components/ModelSettingsPage.js";
import { CanvasModelSetup } from "./components/CanvasModelSetup.js";
import { FeatureImageIntake } from "./components/FeatureImageIntake.js";
import { VoiceWorkbench } from "./components/VoiceWorkbench.js";
import { presentationGraph } from "./presentation-demos.js";

const pages: { path: string; label: string; title: string; subtitle: string; kind: "canvas" | "outputs" | "erd" | "cloud" | "build" | "voice" | "model"; area?: BuildArea }[] = [
  { path: "/canvas", label: "Canvas", title: "Sketch canvas", subtitle: "Turn a sketch or sentence into a graph you can edit.", kind: "canvas" },
  { path: "/outputs", label: "Backlog", title: "Story backlog", subtitle: "Review, edit, verify, and approve story outputs.", kind: "outputs" },
  { path: "/erd", label: "ERD", title: "Database designer", subtitle: "Inspect relationships and verify PostgreSQL DDL locally.", kind: "erd" },
  { path: "/cloud", label: "Cloud", title: "Cloud architecture", subtitle: "Review safe Terraform previews and rule findings.", kind: "cloud" },
  { path: "/software", label: "Software", title: "Software app builder", subtitle: "Turn a UI sketch or description into an interactive app preview and API contract.", kind: "build", area: "software" },
  { path: "/storyboard", label: "Storyboard", title: "Storyboard", subtitle: "Turn graph nodes into a readable sequence of frames.", kind: "build", area: "storyboard" },
  { path: "/workflow", label: "Workflow", title: "Workflow simulator", subtitle: "Check steps and host allowlists in a safe dry run.", kind: "build", area: "workflow" },
  { path: "/theme", label: "Theme", title: "Theme explorer", subtitle: "Inspect palette colors and text contrast.", kind: "build", area: "theme" },
  { path: "/circuit", label: "Circuit", title: "Logic simulator", subtitle: "Run conceptual Boolean logic without a SPICE engine.", kind: "build", area: "circuit" },
  { path: "/voice", label: "Voice", title: "Voice to diagram", subtitle: "Record a short technical instruction and review its transcript and graph output.", kind: "voice" },
  { path: "/evaluation", label: "Careful / Eval", title: "Careful mode and evaluation", subtitle: "Inspect voting, tiling, and render-back mismatch helpers.", kind: "build", area: "eval" },
  { path: "/settings/model", label: "Model setup", title: "Gemini connection", subtitle: "Check the native Google SDK connection and manage the server-only API key.", kind: "model" },
];
const pageFromPath = (path: string) => pages.find((page) => page.path === path) ?? pages[0]!;
const imageTargets: Partial<Record<string, { domain: DiagramDomain; feature: string; description: string }>> = {
  "/outputs": { domain: "userstory", feature: "Backlog", description: "Turn a sticky-note board into editable user stories. Incomplete criteria stay visible as drafts." },
  "/erd": { domain: "erd", feature: "ERD", description: "Read entity boxes, columns, and relationships into a database graph and PostgreSQL preview." },
  "/cloud": { domain: "cloud", feature: "Cloud architecture", description: "Convert an architecture drawing into a safe resource draft; uncertain or risky settings remain reviewable." },
  "/software": { domain: "software", feature: "Software app", description: "Read screen and UI wireframes into graph-backed components, an interactive app preview, and OpenAPI output." },
  "/storyboard": { domain: "userstory", feature: "Storyboard", description: "Turn a whiteboard or sequence sketch into user stories, then review them as storyboard frames." },
  "/workflow": { domain: "workflow", feature: "Workflow", description: "Convert a process diagram into ordered steps and transitions for the safe dry-run simulator." },
  "/circuit": { domain: "circuit", feature: "Circuit", description: "Read a logic sketch into a conceptual Boolean graph that can be simulated without SPICE." },
};

export function App() {
  const [jobMode, setJobMode] = useState<JobMode>("fixture");
  const [path, setPath] = useState(() => typeof window === "undefined" ? "/canvas" : window.location.pathname);
  const [backendMode, setBackendMode] = useState("fixture");
  const [progress, setProgress] = useState<JobProgress>(null);
  const [visionStatus, setVisionStatus] = useState("");
  const [jobRunning, setJobRunning] = useState(false);
  const [jobError, setJobError] = useState("");
  const [textInput, setTextInput] = useState("");
  const [sourceImageUrl, setSourceImageUrl] = useState("/board1.svg");
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const previewUrlRef = useRef<string | null>(null);
  const retryJobRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    const handlePopState = () => setPath(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  const navigate = (nextPath: string) => {
    if (window.location.pathname !== nextPath) window.history.pushState({}, "", nextPath);
    setPath(nextPath);
  };
  const onFeatureNav = (event: MouseEvent<HTMLAnchorElement>, nextPath: string) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    navigate(nextPath);
  };
  const activatePresentationDemo = (domain?: string, image?: string) => {
    const currentPage = pageFromPath(path);
    const selectedDomain = domain ?? imageTargets[currentPage.path]?.domain ?? "userstory";
    useBoardStore.getState().loadPresentationGraph(presentationGraph(selectedDomain), `Load ${selectedDomain} presentation demo`);
    setBackendMode("fixture");
    setJobError("");
    setProgress(null);
    setVisionStatus("Presentation demo · local fixture data · no Gemini calls");
    updateSourceImage(image ?? (selectedDomain === "cloud" ? "/presentation-cloud.svg" : selectedDomain === "userstory" ? "/sketches/member-board.svg" : "/sketches/analytics-board.svg"));
  };
  const isRateLimit = (message: string) => /429|503|rate.?limit|overloaded|high demand|temporarily unavailable/i.test(message);
  const page = pageFromPath(path);
  const imageTarget = imageTargets[page.path];
  const graph = useBoardStore((state) => state.graph);
  const selectedNodeId = useBoardStore((state) => state.selectedNodeId);
  const selectedEdgeId = useBoardStore((state) => state.selectedEdgeId);
  const selectedFindingId = useBoardStore((state) => state.selectedFindingId);
  const patchLog = useBoardStore((state) => state.patchLog);
  const undoStack = useBoardStore((state) => state.undoStack);
  const redoStack = useBoardStore((state) => state.redoStack);
  const error = useBoardStore((state) => state.error);
  const selectTarget = useBoardStore((state) => state.selectTarget);
  const applyUserPatch = useBoardStore((state) => state.applyUserPatch);
  const undo = useBoardStore((state) => state.undo);
  const redo = useBoardStore((state) => state.redo);
  const clearError = useBoardStore((state) => state.clearError);
  const applyIncomingPatch = useBoardStore((state) => state.applyIncomingPatch);
  const clearForSketchJob = useBoardStore((state) => state.clearForSketchJob);

  const handleTextSubmit = () => {
    if (!textInput.trim()) return;
    const interpretation = compileTextIntent(textInput, graph);
    if (interpretation.intent === "command") {
      if (/^undo/i.test(textInput.trim())) undo(); else redo();
      setVisionStatus(interpretation.message);
      return;
    }
    if (interpretation.patches.length) {
      applyUserPatch(interpretation.patches.flatMap((patch) => patch.ops), interpretation.message);
      setVisionStatus(interpretation.message);
      setTextInput("");
      return;
    }
    if (["modify", "constrain", "explain"].includes(interpretation.intent)) {
      setVisionStatus(interpretation.message);
      return;
    }
    const request: SketchJobRequest = { kind: "text", text: textInput, mode: jobMode };
    retryJobRef.current = () => { void submitJob(request); };
    void submitJob(request);
  };

  const updateSourceImage = (url: string) => {
    if (previewUrlRef.current && previewUrlRef.current !== url) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = url.startsWith("blob:") ? url : null;
    setSourceImageUrl(url);
  };

  const findings = useMemo(() => runRules(graph, [...coreRules, ...(graph.domain === "userstory" ? userStoryRules : graph.domain === "erd" ? erdRules : graph.domain === "cloud" ? cloudRules : [])]), [graph]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const selectedFinding = findings.find((finding) => finding.id === selectedFindingId) ?? null;
  const criterionCount = Array.isArray(selectedNode?.props.acceptance) ? selectedNode.props.acceptance.length : 0;
  const canAddCriteria = selectedNode?.type === "story" && criterionCount === 0;

  const submitJob = async (body: SketchJobRequest, imageUrl?: string, destinationPath?: string) => {
    if (jobRunning) return;
    retryJobRef.current = () => { void submitJob(body, imageUrl, destinationPath); };
    setJobRunning(true);
    setJobError("");
    clearError();
    if (imageUrl) updateSourceImage(imageUrl);
    else if (body.kind === "text") updateSourceImage("/sketches/text-only.svg");
    try {
      await postSketchJob(body, ({ event, data }) => {
        if (event === "begin") {
          clearForSketchJob();
          if (!destinationPath) navigate("/canvas");
          setBackendMode(String(data.mode ?? "fixture"));
        } else if (event === "status") {
          setProgress({ phase: String(data.phase ?? ""), message: String(data.message ?? "Working") });
        } else if (event === "patch") {
          applyIncomingPatch(data.patch as Patch);
        } else if (event === "transcription") {
          const vision = data.vision as { cvAvailable?: boolean; markers?: unknown[]; fallbackReason?: string } | undefined;
          if (vision) setVisionStatus(vision.fallbackReason ?? `${vision.markers?.length ?? 0} numbered regions available`);
        } else if (event === "voice-transcript") {
          setVoiceTranscript(String(data.transcript ?? ""));
        } else if (event === "done") {
          setBackendMode(String(data.mode ?? "fixture"));
          setProgress(null);
          setJobRunning(false);
          if (destinationPath) navigate(destinationPath);
        } else if (event === "error") {
          const message = String(data.message ?? "Sketch interpretation failed");
          if (isRateLimit(message)) activatePresentationDemo(body.kind === "text" ? body.domainHint : undefined);
          else setJobError(message);
          setProgress(null);
          setJobRunning(false);
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isRateLimit(message)) activatePresentationDemo(body.kind === "text" ? body.domainHint : undefined);
      else setJobError(message);
      setProgress(null);
    } finally {
      setJobRunning(false);
    }
  };

  const onVoice = async (blob: Blob, durationMs: number, domain: DiagramDomain) => {
    if (jobRunning) return;
    retryJobRef.current = () => { void onVoice(blob, durationMs, domain); };
    setVoiceTranscript("");
    setJobRunning(true);
    setJobError("");
    clearError();
    setProgress({ phase: "audio", message: "Preparing microphone audio for Gemini" });
    try {
      const request = await prepareVoiceJob(blob, durationMs, domain);
      await postVoiceJob(request, ({ event, data }) => {
        if (event === "voice-transcript") setVoiceTranscript(String(data.transcript ?? ""));
        else if (event === "begin") {
          clearForSketchJob();
          setBackendMode(String(data.mode ?? "hosted"));
        } else if (event === "status") setProgress({ phase: String(data.phase ?? ""), message: String(data.message ?? "Working") });
        else if (event === "patch") applyIncomingPatch(data.patch as Patch);
        else if (event === "done") {
          setBackendMode(String(data.mode ?? "hosted"));
          setProgress(null);
          setJobRunning(false);
        } else if (event === "error") {
          const message = String(data.message ?? "Voice interpretation failed");
          if (isRateLimit(message)) activatePresentationDemo(domain);
          else setJobError(message);
          setProgress(null);
          setJobRunning(false);
        }
      });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (isRateLimit(message)) activatePresentationDemo(domain);
      else setJobError(message);
      setProgress(null);
    } finally { setJobRunning(false); }
  };

  const onFixture = (fixtureId: string, imageUrl: string) => {
    setJobMode("fixture");
    activatePresentationDemo(fixtureId === "support-board" ? "workflow" : "userstory", imageUrl);
  };

  const onImage = async (file: File, target?: { domain: DiagramDomain; destination: string }) => {
    retryJobRef.current = () => { void onImage(file, target); };
    setJobMode("live");
    setJobError("");
    setJobRunning(true);
    setProgress({ phase: "cleaning", message: "Removing metadata and preparing the analysis copy" });
    try {
      const prepared = await prepareImageJob(file, target?.domain);
      setVisionStatus(prepared.analysis.fallbackReason ?? (prepared.analysis.cvAvailable
        ? `OpenCV found ${prepared.analysis.markers.length} regions${prepared.analysis.deskewed ? " · deskewed" : ""}${prepared.analysis.perspectiveCorrected ? " · perspective corrected" : ""}`
        : prepared.analysis.fallbackReason ?? "OpenCV unavailable; server fallback will be used"));
      const imageUrl = URL.createObjectURL(prepared.preview);
      await submitJob(prepared.job, imageUrl, target?.destination);
    } catch (error) {
      setJobRunning(false);
      setProgress(null);
      setJobError(error instanceof Error ? error.message : String(error));
    }
  };

  const onSelectFinding = (finding: Diagnostic) => {
    const target = finding.targets[0];
    selectTarget(target?.node ?? null, target?.edge ?? null, finding.id);
  };

  const addSampleCriteria = () => {
    if (!selectedNode || !canAddCriteria) return;
    applyUserPatch(
      [{
        type: "update_node",
        node: {
          ...selectedNode,
          props: {
            ...selectedNode.props,
            acceptance: [{
              given: "I am a member",
              when: "I submit a valid email and password",
              then: "I see my member home page",
            }],
          },
          origin: "user",
          via: "manual",
        },
      }],
      "Add acceptance criteria to a story",
    );
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="topbar-center">
          <span className="breadcrumb-muted">Workspace</span><span className="breadcrumb-slash">/</span>
          <span className="breadcrumb-current">{page.title}</span>
          <span className="save-indicator"><span className="save-dot" /> Local draft</span>
        </div>
        <div className="topbar-actions">
          <span className="mode-badge"><span aria-hidden="true">◌</span> {backendMode === "hosted" ? "Hosted model" : backendMode === "local" ? "Local model" : "Fixture mode · zero model calls"}</span>
          <button className="avatar-button" type="button" aria-label="Account menu">A</button>
        </div>
      </header>

      <aside className="doodly-sidebar">
        <a className="brand" href="/canvas" onClick={(event) => onFeatureNav(event, "/canvas")} aria-label="DoodleForge home">
          <span className="brand-mark" aria-hidden="true"><span /><span /><span /></span>
          <span>Doodle<br />Forge</span>
        </a>
        <p className="sidebar-tagline">The Architecture Auditor</p>
        <button type="button" className="sidebar-demo-button" onClick={() => activatePresentationDemo()} disabled={jobRunning}>Simulate Gemini 4 sketch scan</button>
        <p className="sidebar-demo-status" role="status">{visionStatus || "Local demo data is ready to present."}</p>
        <nav className="feature-nav" aria-label="Product features">
          {pages.map((item) => <a key={item.path} href={item.path} onClick={(event) => onFeatureNav(event, item.path)} aria-current={page.path === item.path ? "page" : undefined}>{item.label}</a>)}
        </nav>
        <p className="sidebar-footnote">Local-first · no model required for demos</p>
      </aside>

      <section className="workspace-heading" id="top">
        <div>
          <p className="eyebrow">{page.kind === "canvas" ? `BOARD CHECK · VERSION ${graph.version}` : "DOODLEFORGE WORKSPACE"}</p>
          <h1>{page.title}</h1>
          <p className="subtitle">{page.subtitle}</p>
        </div>
        <div className="history-controls" aria-label="Patch history controls">
          <span className="history-label"><span aria-hidden="true">↶</span> {patchLog.length} patches</span>
          <button type="button" className="icon-button" onClick={undo} disabled={undoStack.length === 0} aria-label="Undo" title="Undo">↶</button>
          <button type="button" className="icon-button" onClick={redo} disabled={redoStack.length === 0} aria-label="Redo" title="Redo">↷</button>
        </div>
      </section>

      {page.kind === "canvas" && <CanvasModelSetup />}
      {page.kind === "canvas" && <SketchIntake
        mode={jobMode}
        progress={progress}
        visionStatus={visionStatus}
        running={jobRunning}
        error={jobError}
        onRetry={() => retryJobRef.current?.()}
        text={textInput}
        assumptions={graph.assumptions}
        questions={graph.questions}
        onModeChange={setJobMode}
        onTextChange={setTextInput}
        onFixture={onFixture}
        onImage={(file) => void onImage(file)}
        onText={handleTextSubmit}
      />}

      {imageTarget && <FeatureImageIntake
        feature={imageTarget.feature}
        targetDomain={imageTarget.domain}
        description={imageTarget.description}
        running={jobRunning}
        progress={progress}
        error={jobError}
        onRetry={() => retryJobRef.current?.()}
        onImage={(file, domain) => void onImage(file, { domain, destination: page.path })}
        onText={(text, domain, mode = "live") => { setJobMode(mode); if (mode === "fixture") activatePresentationDemo(domain); else void submitJob({ kind: "text", text, domainHint: domain, mode }, undefined, page.path); }}
      />}

      {imageTarget && page.kind !== "canvas" && <PhotoAudit graph={graph} findings={findings} selectedNodeId={selectedNodeId} selectedEdgeId={selectedEdgeId} selectedFindingId={selectedFindingId} sourceImageUrl={sourceImageUrl} onSelectFinding={onSelectFinding} />}

      {page.kind === "canvas" && <div id="canvas-view" className="workspace-view">
        <div className="workspace-grid">
          <PhotoAudit
            graph={graph}
            findings={findings}
            selectedNodeId={selectedNodeId}
            selectedEdgeId={selectedEdgeId}
            selectedFindingId={selectedFindingId}
            sourceImageUrl={sourceImageUrl}
            onSelectFinding={onSelectFinding}
          />

          <section className="panel canvas-panel" aria-label="Editable graph canvas">
            <div className="panel-heading canvas-heading">
              <div>
                <p className="eyebrow">02 · FORGE CANVAS</p>
                <h2>{graph.domain === "cloud" ? "Cloud architecture" : graph.domain === "erd" ? "Entity relationships" : graph.domain === "software" ? "Calculator UI" : graph.domain === "userstory" ? "Member stories" : `${graph.domain} diagram`}</h2>
              </div>
              <div className="canvas-heading-right">
                <span className="layout-chip"><span aria-hidden="true">⌘</span> ELK · left to right</span>
                <button type="button" className="share-button" disabled title="Available after verification">Export <span aria-hidden="true">↗</span></button>
              </div>
            </div>
            <div className="canvas-wrap" data-testid="graph-canvas">
              <BoardCanvas />
              <span className="canvas-hint">Drag nodes to arrange · connect handles to add a dependency</span>
            </div>
            <div className="canvas-footer">
              <span><span className="legend-dot legend-dot--mint" /> {graph.nodes.length} graph items</span>
              <span><span className="legend-dot legend-dot--slate" /> {graph.edges.length} connections</span>
              <span className="footer-version">IR v{graph.version} · patch log {patchLog.length}</span>
            </div>
          </section>
        </div>

        <section className="inspector panel" aria-label="Selected item inspector">
        <div className="inspector-title">
          <p className="eyebrow">INSPECTOR</p>
          <h2>{selectedNode?.label ?? "Select an item"}</h2>
          <span className="type-pill">{selectedNode?.type ?? "—"}</span>
        </div>
        <div className="inspector-details">
          <div><span className="detail-label">Confidence</span><strong>{selectedNode ? `${Math.round(selectedNode.confidence * 100)}%` : "—"}</strong></div>
          <div><span className="detail-label">Origin</span><strong>{selectedNode ? `${selectedNode.origin} · ${selectedNode.via}` : "—"}</strong></div>
          <div><span className="detail-label">Acceptance criteria</span><strong>{selectedNode?.type === "story" ? criterionCount : "—"}</strong></div>
          {selectedFinding && <div><span className="detail-label">Selected finding</span><strong className="selected-rule">{selectedFinding.trust} · {selectedFinding.severity}</strong></div>}
        </div>
        <div className="inspector-action">
          {canAddCriteria ? (
            <button type="button" className="primary-button" onClick={addSampleCriteria} data-testid="acceptance-fix">
              <span aria-hidden="true">✦</span> Add sample acceptance criteria
            </button>
          ) : (
            <span className="inspector-hint">Edits are applied as user patches.</span>
          )}
        </div>
        </section>
      </div>}
      {page.kind === "outputs" && <div id="outputs-view"><OutputsTab graph={graph} mode={jobMode} onPatch={applyUserPatch} onStartSketch={() => navigate("/canvas")} /></div>}
      {page.kind === "erd" && <div id="erd-view"><ErdWorkbench graph={graph} onPatch={applyUserPatch} /></div>}
      {page.kind === "cloud" && <div id="cloud-view"><CloudWorkbench graph={graph} onPatch={applyUserPatch} /></div>}
      {page.kind === "build" && <div id="build-view"><BuildLab key={page.path} initialArea={page.area} showTabs={false} graph={graph} sourceImageUrl={sourceImageUrl} onPatch={applyUserPatch} /></div>}
      {page.kind === "voice" && <><VoiceWorkbench running={jobRunning} progress={progress} transcript={voiceTranscript} error={jobError} onVoice={(blob, duration, domain) => void onVoice(blob, duration, domain)} onRetry={() => retryJobRef.current?.()} onText={(text, domain, mode = "live") => { setJobMode(mode); if (mode === "fixture") { setVoiceTranscript(text); activatePresentationDemo(domain); } else { const request: SketchJobRequest = { kind: "text", text, domainHint: domain, mode }; retryJobRef.current = () => { void submitJob(request, undefined, "/voice"); }; void submitJob(request, undefined, "/voice"); } }} /><section className="panel voice-graph-output" aria-label="Voice generated graph"><header className="outputs-heading"><div><p className="eyebrow">GRAPH OUTPUT · {graph.domain.toUpperCase()}</p><h2>{graph.nodes.length} items · {graph.edges.length} connections</h2></div><span className="status-pill status-pill--ready">Patch based</span></header><div className="canvas-wrap" data-testid="voice-graph-canvas"><BoardCanvas /></div><p className="lab-footnote">The transcript is interpreted as graph patches and can be undone with the history controls above.</p></section></>}
      {page.kind === "model" && <ModelSettingsPage />}

      {error && (
        <div role="alert" className="toast-error">
          <span>{error}</span>
          <button type="button" onClick={clearError} aria-label="Dismiss error">×</button>
        </div>
      )}

      {jobError && !imageTarget && page.kind !== "canvas" && page.kind !== "voice" && (
        <div role="alert" className="toast-error">
          <span>{jobError}</span>
          <button type="button" onClick={() => setJobError("")} aria-label="Dismiss sketch error">×</button>
        </div>
      )}

      <footer className="app-footer">
        <span>Built on one versioned graph</span><span>All positions are computed; no coordinates come from the model.</span>
      </footer>
    </main>
  );
}

