import { useEffect, useRef, useState, type FormEvent } from "react";
import type { DiagramDomain } from "../api-client.js";
import type { JobProgress } from "./SketchIntake.js";

const domains: Array<[DiagramDomain, string]> = [
  ["userstory", "Stories"], ["software", "Software app"], ["erd", "Database ERD"],
  ["cloud", "Cloud blueprint"], ["workflow", "Workflow"], ["circuit", "Circuit"],
];

type Props = {
  running: boolean;
  progress: JobProgress;
  transcript: string;
  error: string;
  onVoice(blob: Blob, durationMs: number, domain: DiagramDomain): void;
  onRetry(): void;
  onText(text: string, domain: DiagramDomain, mode?: "fixture" | "live"): void;
};

export function VoiceWorkbench({ running, progress, transcript, error, onVoice, onRetry, onText }: Props) {
  const [domain, setDomain] = useState<DiagramDomain>("software");
  const [recording, setRecording] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [typedText, setTypedText] = useState("");
  const [micError, setMicError] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const startedAt = useRef(0);
  const stopTimer = useRef<number | undefined>(undefined);
  const tickTimer = useRef<number | undefined>(undefined);

  useEffect(() => () => {
    if (stopTimer.current) window.clearTimeout(stopTimer.current);
    if (tickTimer.current) window.clearInterval(tickTimer.current);
    recorder.current?.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const stopRecording = () => {
    if (recorder.current?.state === "recording") recorder.current.stop();
  };

  const startRecording = async () => {
    setMicError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setMicError("This browser does not support microphone recording. Use the text input below.");
      return;
    }
    try {
      const currentStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
      const currentRecorder = new MediaRecorder(currentStream, mimeType ? { mimeType } : undefined);
      stream.current = currentStream;
      recorder.current = currentRecorder;
      chunks.current = [];
      startedAt.current = performance.now();
      currentRecorder.ondataavailable = (event) => { if (event.data.size) chunks.current.push(event.data); };
      currentRecorder.onerror = () => setMicError("The browser could not record this clip. Try the text input below.");
      currentRecorder.onstop = () => {
        const duration = Math.min(30_000, Math.round(performance.now() - startedAt.current));
        const clip = new Blob(chunks.current, { type: currentRecorder.mimeType || "audio/webm" });
        currentStream.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setRecording(false);
        setElapsedMs(duration);
        if (stopTimer.current) window.clearTimeout(stopTimer.current);
        if (tickTimer.current) window.clearInterval(tickTimer.current);
        if (clip.size > 0) onVoice(clip, duration, domain);
        else setMicError("No audio was captured. Hold the button while speaking and try again.");
      };
      currentRecorder.start(250);
      setRecording(true);
      setElapsedMs(0);
      tickTimer.current = window.setInterval(() => setElapsedMs(Math.min(30_000, performance.now() - startedAt.current)), 100);
      stopTimer.current = window.setTimeout(stopRecording, 30_000);
    } catch (caught) {
      setMicError(caught instanceof Error ? caught.message : "Microphone permission was denied.");
    }
  };

  const submitText = (event: FormEvent) => {
    event.preventDefault();
    if (typedText.trim() && !running) onText(typedText.trim(), domain);
  };

  return <section className="panel voice-workbench" aria-label="Voice to diagram input and output" aria-busy={running}>
    <div className="voice-input">
      <div><p className="eyebrow">VOICE → VALIDATED GRAPH</p><h2>Speak a diagram into existence</h2><p>Record up to 30 seconds. Audio is converted to compact WAV, sent to the server-side Gemini adapter, transcribed, and passed through the same graph patch pipeline. Audio is discarded after the request.</p></div>
      <label>Feature output<select value={domain} onChange={(event) => setDomain(event.target.value as DiagramDomain)} disabled={recording || running}>{domains.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
      <div className="voice-record-row"><button type="button" className={recording ? "voice-record is-recording" : "voice-record"} onClick={() => recording ? stopRecording() : void startRecording()} disabled={running}>{recording ? "Stop recording" : "●  Hold to speak"}</button><span>{recording ? `Recording · ${(elapsedMs / 1000).toFixed(1)} / 30 s` : elapsedMs ? `Last clip · ${(elapsedMs / 1000).toFixed(1)} s` : "Microphone idle"}</span></div>
      <form className="voice-text-fallback" onSubmit={submitText}><label htmlFor="voice-text">Or type a technical instruction</label><textarea id="voice-text" rows={3} value={typedText} onChange={(event) => setTypedText(event.target.value)} placeholder="Create a calculator screen with a display, number buttons, operators, and equals." disabled={running || recording} /><button type="submit" className="secondary-button" disabled={running || recording || !typedText.trim()}>Interpret text as {domains.find(([id]) => id === domain)?.[1]}</button></form>
      <button type="button" className="text-button" onClick={() => onText("Create a calculator screen with a display, digit buttons, decimal, clear, addition, subtraction, multiplication, division, and equals.", "software", "fixture")} disabled={running || recording}>Try a no-microphone offline demo</button>
      {(micError || error) && <div className="feature-model-error" role="alert"><div><strong>{micError ? "Microphone input failed" : "Voice interpretation failed"}</strong><p>{micError || error}</p></div>{error && <button className="secondary-button" type="button" onClick={onRetry} disabled={running}>Retry voice request</button>}</div>}
      {running && <div className="feature-image-progress" role="status" aria-live="polite"><span className="progress-spinner" aria-hidden="true" /><span>{progress?.message ?? "Processing voice instruction…"}</span><small>{progress?.phase}</small></div>}
    </div>
    <div className="voice-output"><div className="voice-output-heading"><div><p className="eyebrow">TRANSCRIPT & RESULT</p><h3>Latest interpretation</h3></div><span className={`status-pill ${transcript ? "status-pill--ready" : "status-pill--warning"}`}>{transcript ? "Audio not stored" : "Waiting for input"}</span></div>
      {transcript ? <blockquote className="voice-transcript">“{transcript}”</blockquote> : <div className="empty-state">Your transcript and resulting graph appear here after interpretation.</div>}
      {progress?.phase === "checking" && <p className="lab-footnote">Rule checks are running on the generated graph. Live response time depends on browser audio conversion and model service latency.</p>}
    </div>
  </section>;
}
