import { useEffect, useMemo, useState } from "react";
import type { Graph, Patch, PatchOp } from "@doodleforge/ir";
import { storyAuditsFromGraph, userStoryMarkdown, type StoryAudit } from "@doodleforge/pack-userstory/schema";
import { topologicalStoryOrder } from "@doodleforge/pack-userstory";

type Mode = "fixture" | "live";
type Settings = { repositories: string[]; dryRun: boolean; githubTokenConfigured: boolean; modelMode: string; jira?: { projects: string[]; dryRun: boolean; credentialsConfigured: boolean; baseUrlConfigured: boolean } };
type Criterion = { given: string; when: string; then: string };
type Draft = { title: string; story: string; persona: string; acceptance: Criterion[]; priority: string; priority_source: string };
type ProposedAction = { id: string; payload: { repository: string; title: string; body: string; idempotency_key: string }; state: string; result?: unknown };
type ProposedJiraAction = { id: string; payload: { project: string; issueType: string; summary: string; description: string; idempotency_key: string }; state: string; result?: unknown };

type Props = { graph: Graph; mode: Mode; onPatch(ops: PatchOp[], reason: string): void; onStartSketch(): void };

export function OutputsTab({ graph, mode, onPatch, onStartSketch }: Props) {
  const rows = useMemo(() => {
    const audits = storyAuditsFromGraph(graph);
    let order: string[];
    try { order = topologicalStoryOrder(graph); } catch { order = graph.nodes.filter((node) => node.type === "story").map((node) => node.id); }
    const byId = new Map(graph.nodes.map((node) => [node.id, node]));
    return order.map((id) => byId.get(id)).filter((node): node is Graph["nodes"][number] => Boolean(node)).map((node) => ({ node, audit: audits.get(node.id)! }));
  }, [graph]);
  const [selection, setSelection] = useState<string[] | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [repository, setRepository] = useState("");
  const [actions, setActions] = useState<ProposedAction[]>([]);
  const [jiraProject, setJiraProject] = useState("");
  const [jiraActions, setJiraActions] = useState<ProposedJiraAction[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [exported, setExported] = useState(false);
  const selectedIds = selection ?? rows.filter((row) => row.audit.status === "verified").map((row) => row.node.id);

  useEffect(() => {
    let active = true;
    void fetch("/api/settings").then(async (response) => {
      if (!response.ok) throw new Error("Could not read action settings");
      return response.json() as Promise<Settings>;
    }).then((next) => {
      if (!active) return;
      setSettings(next);
      setRepository((current) => current || next.repositories[0] || "");
      setJiraProject((current) => current || next.jira?.projects[0] || "");
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason));
    });
    return () => { active = false; };
  }, []);

  const toggle = (id: string) => {
    setSelection((current) => {
      const selected = new Set(current ?? rows.filter((row) => row.audit.status === "verified").map((row) => row.node.id));
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      return [...selected];
    });
  };

  const exportMarkdown = async () => {
    try {
      const markdown = userStoryMarkdown(graph);
      const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = "doodleforge-backlog.md";
      anchor.click();
      URL.revokeObjectURL(url);
      setExported(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  const propose = async () => {
    if (!selectedIds.length || !repository) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/actions/propose", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ graph, selectedNodeIds: selectedIds, repository, mode }),
      });
      const result = await response.json() as { actions?: ProposedAction[]; message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? `Action proposal failed (${response.status})`);
      setActions((current) => {
        const byId = new Map(current.map((action) => [action.id, action]));
        for (const action of result.actions ?? []) byId.set(action.id, action);
        return [...byId.values()];
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const approve = async (action: ProposedAction) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/actions/${encodeURIComponent(action.id)}/approve`, { method: "POST" });
      const result = await response.json() as { status?: string; message?: string; error?: string; url?: string; number?: number };
      if (!response.ok) throw new Error(result.message ?? result.error ?? `Approval failed (${response.status})`);
      setActions((current) => current.map((item) => item.id === action.id ? { ...item, state: result.status ?? "complete", result } : item));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  const proposeJira = async () => {
    if (!selectedIds.length || !jiraProject) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/jira/actions/propose", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ graph, selectedNodeIds: selectedIds, project: jiraProject, mode }) });
      const result = await response.json() as { actions?: ProposedJiraAction[]; message?: string; error?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? `Jira proposal failed (${response.status})`);
      setJiraActions((current) => { const byId = new Map(current.map((action) => [action.id, action])); for (const action of result.actions ?? []) byId.set(action.id, action); return [...byId.values()]; });
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const approveJira = async (action: ProposedJiraAction) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/jira/actions/${encodeURIComponent(action.id)}/approve`, { method: "POST" });
      const result = await response.json() as { status?: string; message?: string; error?: string; key?: string; url?: string };
      if (!response.ok) throw new Error(result.message ?? result.error ?? `Jira approval failed (${response.status})`);
      setJiraActions((current) => current.map((item) => item.id === action.id ? { ...item, state: result.status ?? "complete", result } : item));
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  return (
    <section className="panel outputs-panel" aria-label="User-story backlog outputs">
      <div className="panel-heading outputs-heading">
        <div><p className="eyebrow">03 · IMAGE TO VERIFIED USER STORIES</p><h2>Backlog</h2><p>Upload a sticky-note board on Canvas, then review and edit its stories here. Each story is checked before it can be pushed.</p></div>
        <button type="button" className="secondary-button" onClick={() => void exportMarkdown()}>Export Markdown <span aria-hidden="true">↓</span></button>
      </div>
      {exported && <p className="inline-success" role="status">Markdown export generated from the current graph.</p>}
      {!rows.length ? <div className="empty-state"><p>No stories in this graph yet. Import a photo of your board to generate a draft backlog.</p><button type="button" className="primary-button" onClick={onStartSketch}>Import a board image</button></div> : (
        <div className="story-list">
          {rows.map(({ node, audit }) => (
            <StoryEditor key={node.id} graph={graph} node={node} audit={audit} selected={selectedIds.includes(node.id)} onToggle={() => toggle(node.id)} onPatch={onPatch} />
          ))}
        </div>
      )}
      <section className="github-actions" aria-label="GitHub issue actions">
        <div className="actions-heading"><div><p className="eyebrow">APPROVAL REQUIRED</p><h3>Push selected stories to GitHub</h3></div><span className={`dry-run-pill ${settings?.dryRun ? "" : "is-live"}`}>{settings?.dryRun ? "Dry-run mode" : "Live actions"}</span></div>
        <div className="push-controls">
          <label>Allowed repository
            <select aria-label="Allowed repository" value={repository} onChange={(event) => setRepository(event.target.value)} disabled={!settings?.repositories.length || busy}>
              {settings?.repositories.length ? settings.repositories.map((repo) => <option key={repo} value={repo}>{repo}</option>) : <option value="">Configure GITHUB_REPO_ALLOWLIST</option>}
            </select>
          </label>
          <button type="button" className="primary-button" onClick={() => void propose()} disabled={busy || !repository || !selectedIds.length || !settings?.repositories.includes(repository)}>
            {busy ? "Preparing…" : `Prepare ${selectedIds.length} issue${selectedIds.length === 1 ? "" : "s"}`}
          </button>
        </div>
        <p className="action-note">The model can propose one selected story at a time. Review the exact title and body, then approve each issue. {settings?.dryRun ? "Dry-run approval does not contact GitHub." : settings?.githubTokenConfigured ? "An approval sends this issue to GitHub." : "Configure GITHUB_TOKEN on the API server before live approval."}</p>
        {!settings?.repositories.length && <p className="action-note">Add a comma-separated repository allowlist to the API server’s .env file. Credentials stay server-side.</p>}
        {mode === "live" && settings?.modelMode === "fixture" && <p className="action-note">Live Pass E needs a GEMINI_API_KEY on the API server.</p>}
        {actions.map((action) => (
          <article className="approval-card" key={action.id}>
            <div><strong>Pending issue · {action.payload.repository}</strong><span>{action.state === "pending" ? "Review before sending" : action.state}</span></div>
            <h4>{action.payload.title}</h4>
            <pre>{JSON.stringify({ repository: action.payload.repository, title: action.payload.title, body: action.payload.body }, null, 2)}</pre>
            <small>Idempotency key: {action.payload.idempotency_key}</small>
            {action.state === "pending" ? (
              <button type="button" className="primary-button" onClick={() => void approve(action)} disabled={busy || (settings?.dryRun === false && !settings.githubTokenConfigured)}>
                {settings?.dryRun ? "Approve dry run" : "Approve and create issue"}
              </button>
            ) : <p className="inline-success" role="status">{renderActionResult(action.result)}</p>}
          </article>
        ))}
      </section>
      <section className="github-actions" aria-label="Jira issue actions">
        <div className="actions-heading"><div><p className="eyebrow">JIRA · APPROVAL REQUIRED</p><h3>Create Jira stories</h3></div><span className={`dry-run-pill ${settings?.jira?.dryRun ? "" : "is-live"}`}>{settings?.jira?.dryRun ? "Dry-run mode" : "Live actions"}</span></div>
        <div className="push-controls">
          <label>Allowlisted Jira project
            <select aria-label="Allowlisted Jira project" value={jiraProject} onChange={(event) => setJiraProject(event.target.value)} disabled={!settings?.jira?.projects.length || busy}>
              {settings?.jira?.projects.length ? settings.jira.projects.map((project) => <option key={project} value={project}>{project}</option>) : <option value="">Configure JIRA_PROJECT_ALLOWLIST</option>}
            </select>
          </label>
          <button type="button" className="primary-button" onClick={() => void proposeJira()} disabled={busy || !jiraProject || !selectedIds.length || !settings?.jira?.projects.includes(jiraProject)}>{busy ? "Preparing…" : `Prepare ${selectedIds.length} Jira item${selectedIds.length === 1 ? "" : "s"}`}</button>
        </div>
        <p className="action-note">The server validates the selected verified story and project. Review the exact summary and description before approval. {settings?.jira?.dryRun ? "Dry-run approval does not contact Jira." : settings?.jira?.credentialsConfigured ? "Approval creates an issue in the allowlisted Jira project." : "Configure JIRA_EMAIL and JIRA_API_TOKEN on the API server before live approval."}</p>
        {jiraActions.map((action) => <article className="approval-card" key={action.id}>
          <div><strong>Pending Jira issue · {action.payload.project}</strong><span>{action.state === "pending" ? "Review before sending" : action.state}</span></div>
          <h4>{action.payload.summary}</h4>
          <pre>{JSON.stringify({ project: action.payload.project, issueType: action.payload.issueType, summary: action.payload.summary, description: action.payload.description }, null, 2)}</pre>
          <small>Idempotency key: {action.payload.idempotency_key}</small>
          {action.state === "pending" ? <button type="button" className="primary-button" onClick={() => void approveJira(action)} disabled={busy || (settings?.jira?.dryRun === false && !settings.jira.credentialsConfigured)}>{settings?.jira?.dryRun ? "Approve dry run" : "Approve and create Jira issue"}</button> : <p className="inline-success" role="status">{renderActionResult(action.result)}</p>}
        </article>)}
      </section>
      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}

function StoryEditor({ graph, node, audit, selected, onToggle, onPatch }: {
  graph: Graph; node: Graph["nodes"][number]; audit: StoryAudit; selected: boolean; onToggle(): void; onPatch(ops: PatchOp[], reason: string): void;
}) {
  const [draft, setDraft] = useState<Draft>(() => draftFor(node));
  useEffect(() => { setDraft(draftFor(node)); }, [node]);
  const changed = JSON.stringify(draft) !== JSON.stringify(draftFor(node));
  const addCriterion = () => setDraft((current) => ({ ...current, acceptance: [...current.acceptance, { given: "", when: "", then: "" }] }));
  const updateCriterion = (index: number, key: keyof Criterion, value: string) => setDraft((current) => ({
    ...current,
    acceptance: current.acceptance.map((criterion, currentIndex) => currentIndex === index ? { ...criterion, [key]: value } : criterion),
  }));
  const save = () => {
    const props = { ...node.props, story: draft.story.trim(), persona: draft.persona.trim(), acceptance: draft.acceptance, priority: draft.priority, priority_source: "user" };
    onPatch([{
      type: "update_node",
      node: { ...node, label: draft.title.trim(), props, origin: "user", via: "manual" },
    }], `Edit backlog story ${node.id}`);
  };

  return (
    <article className={`story-editor ${audit.status === "verified" ? "is-verified" : "is-draft"}`}>
      <div className="story-editor-top">
        <label className="story-select"><input type="checkbox" checked={selected} disabled={audit.status !== "verified"} onChange={onToggle} aria-label={`Select ${node.label} for GitHub`} /> Select for GitHub</label>
        <span className={`verification-badge ${audit.status}`}><span aria-hidden="true">{audit.status === "verified" ? "✓" : "!"}</span>{audit.status === "verified" ? "Verified" : "Draft · needs review"}</span>
      </div>
      <div className="story-fields">
        <label>Title<input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} /></label>
        <label>Story<textarea value={draft.story} rows={2} onChange={(event) => setDraft((current) => ({ ...current, story: event.target.value }))} /></label>
        <div className="story-field-row">
          <label>Persona<input value={draft.persona} onChange={(event) => setDraft((current) => ({ ...current, persona: event.target.value }))} /></label>
          <label>Priority<select value={draft.priority} onChange={(event) => setDraft((current) => ({ ...current, priority: event.target.value }))}><option>Must</option><option>Should</option><option>Could</option><option>Won't</option></select></label>
        </div>
        <div className="criteria-editor">
          <div><strong>Acceptance criteria</strong><button type="button" className="text-button" onClick={addCriterion}>+ Add criterion</button></div>
          {draft.acceptance.map((criterion, index) => (
            <fieldset key={index}>
              <legend>Criterion {index + 1}</legend>
              <label>Given<input value={criterion.given} onChange={(event) => updateCriterion(index, "given", event.target.value)} /></label>
              <label>When<input value={criterion.when} onChange={(event) => updateCriterion(index, "when", event.target.value)} /></label>
              <label>Then<input value={criterion.then} onChange={(event) => updateCriterion(index, "then", event.target.value)} /></label>
            </fieldset>
          ))}
          {!draft.acceptance.length && <p className="validation-message">No acceptance criteria. This story stays visible as a draft and cannot be pushed.</p>}
        </div>
      </div>
      <div className="story-editor-bottom">
        <span>Estimate {typeof node.props.estimate === "number" ? node.props.estimate : "—"} <small>advisory</small> · Confidence {Math.round(node.confidence * 100)}%</span>
        <button type="button" className="secondary-button" onClick={save} disabled={!changed}>Save user patch</button>
      </div>
      {audit.errors.length > 0 && <ul className="story-errors">{audit.errors.map((error) => <li key={error}>{error}</li>)}</ul>}
      {audit.record?.depends_on.length ? <p className="story-dependencies">Depends on: {audit.record.depends_on.join(", ")}</p> : null}
    </article>
  );
}

function draftFor(node: Graph["nodes"][number]): Draft {
  const criteria = Array.isArray(node.props.acceptance) ? node.props.acceptance as Criterion[] : [];
  return {
    title: node.label,
    story: typeof node.props.story === "string" ? node.props.story : `As a user, I want ${node.label.toLowerCase()}`,
    persona: typeof node.props.persona === "string" ? node.props.persona : "",
    acceptance: criteria.map((item) => ({ given: item.given, when: item.when, then: item.then })),
    priority: typeof node.props.priority === "string" ? node.props.priority : "Should",
    priority_source: typeof node.props.priority_source === "string" ? node.props.priority_source : "default",
  };
}

function renderActionResult(result: unknown) {
  if (!result || typeof result !== "object") return "Action completed.";
  const value = result as { status?: string; url?: string; number?: number; key?: string };
  if (value.status === "created" && value.key && value.url) return `Created Jira issue ${value.key}: ${value.url}`;
  return value.status === "created" && value.url ? `Created issue #${value.number}: ${value.url}` : value.status === "already-executed" ? "This action was already executed." : "Dry run recorded; no issue was sent.";
}
