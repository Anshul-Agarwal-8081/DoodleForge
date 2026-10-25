import type { ClipboardEvent, FormEvent, ChangeEvent } from "react";
import type { Graph } from "@doodleforge/ir";

export type JobMode = "fixture" | "live";
export type JobProgress = { phase: string; message: string } | null;

const sampleBoards = [
  { id: "member-board", title: "Member experience", image: "/sketches/member-board.svg", note: "Sticky notes · user stories" },
  { id: "release-board", title: "April release", image: "/sketches/release-board.svg", note: "Priority mark · dependency" },
  { id: "support-board", title: "Support flow", image: "/sketches/support-board.svg", note: "A small workflow sketch" },
];
const phases = ["cleaning", "finding", "reading", "tracing", "structuring", "checking"];

type Props = {
  mode: JobMode;
  progress: JobProgress;
  visionStatus: string;
  running: boolean;
  error?: string;
  onRetry?(): void;
  text: string;
  assumptions: Graph["assumptions"];
  questions: Graph["questions"];
  onModeChange(mode: JobMode): void;
  onTextChange(value: string): void;
  onFixture(id: string, image: string): void;
  onImage(file: File): void;
  onText(): void;
};

export function SketchIntake({
  mode,
  progress,
  visionStatus,
  running,
  error,
  onRetry,
  text,
  assumptions,
  questions,
  onModeChange,
  onTextChange,
  onFixture,
  onImage,
  onText,
}: Props) {
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) onImage(file);
    event.currentTarget.value = "";
  };
  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    const item = Array.from(event.clipboardData.items).find((candidate) => candidate.type.startsWith("image/"));
    const file = item?.getAsFile();
    if (file) {
      event.preventDefault();
      onImage(file);
    }
  };
  const submitText = (event: FormEvent) => {
    event.preventDefault();
    onText();
  };
  const activeIndex = progress ? phases.indexOf(progress.phase) : -1;

  return (
    <section className="panel intake-panel" aria-label="Sketch and text intake" onPaste={handlePaste}>
      <div className="panel-heading intake-heading">
        <div>
          <p className="eyebrow">START WITH A SKETCH OR A SENTENCE</p>
          <h2>Bring a rough idea into focus.</h2>
        </div>
        <label className="mode-select-label">
          <span>Interpretation mode</span>
          <select aria-label="Interpretation mode" value={mode} onChange={(event) => onModeChange(event.target.value as JobMode)} disabled={running}>
            <option value="fixture">Fixture replay · offline</option>
            <option value="live">Live model · server</option>
          </select>
        </label>
      </div>

      <div className="intake-grid">
        <div className="fixture-picker">
          <div className="intake-subhead"><strong>Try a sample board</strong><span>Recorded passes · no network</span></div>
          <div className="fixture-cards">
            {sampleBoards.map((board) => (
              <button
                className="fixture-card"
                type="button"
                key={board.id}
                onClick={() => onFixture(board.id, board.image)}
                disabled={running}
                aria-label={`Interpret ${board.title} fixture`}
              >
                <img src={board.image} alt="" />
                <span><strong>{board.title}</strong><small>{board.note}</small></span>
                <span className="fixture-card-arrow" aria-hidden="true">↗</span>
              </button>
            ))}
          </div>
        </div>

        <div className="intake-divider" aria-hidden="true"><span>or</span></div>

        <div className="custom-intake">
          <label className="upload-button">
            <span aria-hidden="true">⌁</span>
            Upload or take a photo
            <input type="file" accept="image/jpeg,image/png,image/heic,image/heif" capture="environment" onChange={handleFile} disabled={running} />
          </label>
          <p className="intake-hint">JPEG · PNG · HEIC · max 15 MB · you can also paste an image</p>
          <form className="text-intake" onSubmit={submitText}>
            <label htmlFor="sketch-text">Or describe the idea</label>
            <textarea
              id="sketch-text"
              placeholder="As a member, I want to sign in so that I can see my workspace…"
              value={text}
              maxLength={20_000}
              onChange={(event) => onTextChange(event.target.value)}
              disabled={running}
            />
            <button className="text-submit" type="submit" disabled={running || !text.trim()}>Structure text <span aria-hidden="true">→</span></button>
          </form>
        </div>
      </div>

      <div className="job-progress" aria-live="polite" aria-busy={running}>
        <div className="progress-steps">
          {phases.map((phase, index) => (
            <span className={`progress-step ${index < activeIndex ? "is-complete" : ""} ${index === activeIndex ? "is-active" : ""}`} key={phase} data-testid={`progress-${phase}`}>
              <i aria-hidden="true">{index < activeIndex ? "✓" : String(index + 1).padStart(2, "0")}</i>{phaseNames[index]}
            </span>
          ))}
        </div>
        <span className="progress-message">{progress?.message ?? (running ? "Preparing the sketch…" : visionStatus || "Ready for an input")}</span>
      </div>
      {error && <div className="feature-model-error" role="alert"><div><strong>Model request failed</strong><p>{error}</p></div><button className="secondary-button" type="button" onClick={onRetry} disabled={running || !onRetry}>Retry</button></div>}

      <details className="assumptions-drawer">
        <summary><span>Assumptions & questions</span><span className="drawer-counts">{assumptions.length} assumptions · {questions.length} questions</span></summary>
        <div className="drawer-content">
          <div><h3>Assumptions</h3>{assumptions.length ? assumptions.map((item) => <p className="drawer-item" key={item.id}>{item.text}<small>{item.status}</small></p>) : <p className="drawer-empty">Guesses from interpretation will appear here.</p>}</div>
          <div><h3>Questions</h3>{questions.length ? questions.map((item) => <div className="drawer-item" key={item.id}><p>{item.text}</p><ul>{item.options.map((option) => <li key={option}>{option}</li>)}</ul></div>) : <p className="drawer-empty">Material ambiguities will appear here.</p>}</div>
        </div>
      </details>
    </section>
  );
}

const phaseNames = ["Cleaning", "Finding shapes", "Reading components", "Tracing wires", "Structuring", "Checking"];
