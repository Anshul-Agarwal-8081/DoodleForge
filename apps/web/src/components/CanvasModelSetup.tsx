import { useEffect, useState } from "react";
import { getModelConnectionStatus, saveModelCredential, testModelConnection, type ModelConnectionStatus } from "../api-client.js";

/** The hosted-model credential box is also shown on Canvas so users can enable live image analysis in context. */
export function CanvasModelSetup() {
  const [status, setStatus] = useState<ModelConnectionStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try { setStatus(await getModelConnectionStatus()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not reach the local model service"); }
  };
  useEffect(() => { void refresh(); }, []);

  const saveAndTest = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const saved = await saveModelCredential(apiKey);
      setApiKey("");
      setStatus(await getModelConnectionStatus());
      const result = await testModelConnection();
      if (!result.ok) throw new Error(result.message);
      setMessage(`${saved.message} Connection verified for ${result.model}. Live analysis is ready.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save or test the model key"); }
    finally { setBusy(false); }
  };

  const test = async () => {
    setBusy(true); setMessage(""); setError("");
    try {
      const result = await testModelConnection();
      if (!result.ok) throw new Error(result.message);
      setMessage(`${result.message} · ${result.model}`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Connection check failed"); }
    finally { setBusy(false); }
  };

  return <section className="panel canvas-model-setup" aria-label="Gemini API key setup">
    <div className="canvas-model-copy"><span className="eyebrow">LIVE MODEL · SERVER ONLY</span><strong>{status?.apiKeyConfigured ? "Gemini key is configured" : "Add an API key to use live model features"}</strong><span>Model: {status?.model ?? "Checking…"} · Fixture mode remains available offline.</span></div>
    <div className="canvas-model-controls">
      <label htmlFor="canvas-gemini-key">{status?.apiKeyConfigured ? "Replace key" : "Google AI Studio API key"}<input id="canvas-gemini-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Enter a newly rotated key" /></label>
      <button type="button" className="primary-button" onClick={() => void saveAndTest()} disabled={busy || apiKey.trim().length < 20}>{busy ? "Saving and testing…" : "Save key and test"}</button>
      {status?.apiKeyConfigured && <button type="button" className="secondary-button" onClick={() => void test()} disabled={busy}>{busy ? "Testing…" : "Test saved key"}</button>}
    </div>
    <small className="canvas-key-privacy">The key is sent to this computer’s API server, saved in the ignored local <code>.env</code>, then cleared from this form. Revoke any key previously pasted into chat.</small>
    {error && <p className="inline-error" role="alert">{error}</p>}
    {message && <p className="inline-success" role="status">{message}</p>}
  </section>;
}
