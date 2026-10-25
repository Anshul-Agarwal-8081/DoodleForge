import { useState, type ChangeEvent, type FormEvent } from "react";
import type { DiagramDomain } from "../api-client.js";
import type { JobProgress } from "./SketchIntake.js";

type Props = {
  feature: string;
  targetDomain: DiagramDomain;
  description: string;
  running: boolean;
  progress: JobProgress;
  error?: string;
  onRetry?(): void;
  onImage(file: File, domain: DiagramDomain): void;
  onText(text: string, domain: DiagramDomain, mode?: "fixture" | "live"): void;
};

export function FeatureImageIntake({ feature, targetDomain, description, running, progress, error, onRetry, onImage, onText }: Props) {
  const [text, setText] = useState("");
  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) onImage(file, targetDomain);
    event.currentTarget.value = "";
  };
  const handleText = (event: FormEvent) => {
    event.preventDefault();
    if (!text.trim() || running) return;
    onText(text.trim(), targetDomain);
  };
  const placeholder = targetDomain === "erd"
    ? "users(id uuid primary key, email text)\norders(id uuid primary key, user_id uuid)\nusers has many orders"
    : targetDomain === "software"
      ? "Build a calculator screen with a display, digit buttons, + − × ÷, clear, and equals."
      : targetDomain === "cloud"
        ? "A private uploads bucket connects to the member API; the API uses a PostgreSQL database."
        : targetDomain === "workflow"
          ? "On order submit, validate the address, charge payment, then send a confirmation."
          : targetDomain === "circuit"
            ? "Input A and B feed an AND gate which feeds output Y."
            : "Members can sign in and reset a password.";

  return (
    <section className="panel feature-image-intake" aria-label={`${feature} image input`} aria-busy={running}>
      <div className="feature-image-intake-copy">
        <p className="eyebrow">IMAGE TO {feature.toUpperCase()}</p>
        <h2>Start with a photo or sketch</h2>
        <p>{description} The result is added to the shared graph and appears here when processing finishes.</p>
      </div>
      <div className="feature-image-intake-action">
        <label className="upload-button">
          <span aria-hidden="true">⌁</span>
          {running ? "Reading image…" : `Generate ${feature} from image`}
          <input
            type="file"
            accept="image/jpeg,image/png,image/heic,image/heif"
            capture="environment"
            onChange={handleFile}
            disabled={running}
            aria-label={`Upload an image for ${feature}`}
          />
        </label>
        <small>JPEG · PNG · HEIC · max 15 MB · processed by the selected feature model</small>
      </div>
      <form className="feature-text-intake" onSubmit={handleText}>
        <label htmlFor={`feature-text-${targetDomain}`}>Or describe the {feature.toLowerCase()}</label>
        <textarea id={`feature-text-${targetDomain}`} rows={3} value={text} onChange={(event) => setText(event.target.value)} placeholder={placeholder} disabled={running} />
        <button type="submit" className="secondary-button" disabled={running || !text.trim()}>{running ? "Generating…" : `Generate ${feature} from text`}</button>
      </form>
      <button className="text-button feature-offline-demo" type="button" disabled={running} onClick={() => onText(text.trim() || placeholder, targetDomain, "fixture")}>Use an offline {feature.toLowerCase()} demo</button>
      {running && <div className="feature-image-progress" role="status" aria-live="polite">
        <span className="progress-spinner" aria-hidden="true" />
        <span>{progress?.message ?? "Preparing image…"}</span>
        {progress?.phase && <small>{progress.phase}</small>}
      </div>}
      {error && <div className="feature-model-error" role="alert"><div><strong>Model request failed</strong><p>{error}</p></div><button className="secondary-button" type="button" onClick={onRetry} disabled={running || !onRetry}>Retry</button><button className="secondary-button" type="button" data-testid="run-offline-feature-demo" onClick={() => onText(text.trim() || placeholder, targetDomain, "fixture")} disabled={running}>Run offline demo now</button></div>}
    </section>
  );
}
