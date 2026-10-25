import { useEffect, useState } from "react";
import { getModelConnectionStatus, saveModelCredential, testModelConnection, type ModelConnectionStatus } from "../api-client.js";

export function ModelSettingsPage() {
  const [status, setStatus] = useState<ModelConnectionStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [retryWaitSeconds, setRetryWaitSeconds] = useState(0);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    setLoading(true); setError("");
    try { setStatus(await getModelConnectionStatus()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Model settings could not load"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    if (retryWaitSeconds <= 0) return;
    const timer = window.setTimeout(() => setRetryWaitSeconds((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [retryWaitSeconds]);

  const testConnection = async () => {
    setTesting(true); setMessage(""); setError("");
    try {
      const result = await testModelConnection();
      if (result.ok) setMessage(`${result.message} · ${result.model} · ${result.mode}`);
      else { setError(result.message); if (result.retryAfterSeconds) setRetryWaitSeconds(result.retryAfterSeconds); }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Connection check failed";
      setError(message);
      if (/rate limit reached|rate-limited/i.test(message)) setRetryWaitSeconds(60);
    }
    finally { setTesting(false); }
  };

  const saveCredential = async () => {
    setSaving(true); setMessage(""); setError("");
    try {
      const result = await saveModelCredential(apiKey);
      setApiKey("");
      setStatus(await getModelConnectionStatus());
      setMessage(`${result.message} Now test the connection.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Credential could not be saved"); }
    finally { setSaving(false); }
  };

  return <section className="panel model-settings" aria-label="Model connection settings">
    <div className="panel-heading"><div><p className="eyebrow">SERVER CONNECTION</p><h2>Gemini 3.8 Flash</h2></div><span className={`status-pill ${status?.apiKeyConfigured ? "status-pill--ready" : ""}`}>{loading ? "Checking settings…" : status?.apiKeyConfigured ? "Credential configured" : "Key required"}</span></div>
    <p className="model-intro">DoodleForge uses Google’s native <code>@google/genai</code> SDK. The API key is sent only to this local API server, saved in the ignored <code>.env</code> file, and never returned to or stored by the browser.</p>
    {status && <div className="model-config-grid">
      <div className="model-config-card"><span>Model ID</span><code>{status.model}</code></div>
      <div className="model-config-card"><span>Provider</span><strong>{status.provider}</strong></div>
      <div className="model-config-card"><span>API key</span><strong>{status.apiKeyConfigured ? "Present · hidden" : "Missing"}</strong></div>
    </div>}
    {error && <div className="model-message model-message--error" role="alert"><span>{error}{retryWaitSeconds > 0 && <><br /><strong>Retry available in {retryWaitSeconds}s.</strong></>}</span><button type="button" className="secondary-button" onClick={() => void testConnection()} disabled={testing || retryWaitSeconds > 0 || !status?.apiKeyConfigured}>{retryWaitSeconds > 0 ? `Wait ${retryWaitSeconds}s` : "Retry connection test"}</button></div>}
    {message && <div className="model-message model-message--success" role="status">{message}</div>}
    {!status && !loading && <div className="model-fix-card"><strong>API settings route unavailable</strong><p>Restart the API server from the project folder with <code>pnpm dev:api</code>, then refresh this page. The currently running server may still be using old settings.</p></div>}
    <div className="model-credential-form"><label htmlFor="gemini-api-key">{status?.apiKeyConfigured ? "Replace server key" : "Add a rotated Google AI Studio key"}</label><div><input id="gemini-api-key" type="password" autoComplete="new-password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="Paste a newly rotated key here" /><button className="secondary-button" type="button" onClick={() => void saveCredential()} disabled={saving || apiKey.trim().length < 20}>{saving ? "Saving on this computer…" : "Save to local server"}</button></div><small>The key previously shared in chat should be revoked. Enter a newly created key here; it will not be saved in browser storage or source code.</small></div>
    <div className="model-actions"><button className="primary-button" type="button" onClick={() => void testConnection()} disabled={!status || testing || loading || retryWaitSeconds > 0}>{testing ? "Testing connection…" : retryWaitSeconds > 0 ? `Wait ${retryWaitSeconds}s to test` : "Test Gemini connection"}</button><button className="secondary-button" type="button" onClick={() => void refresh()} disabled={loading}>Refresh settings</button></div>
    <details className="model-help"><summary>Fix a Gemini key or model error</summary><ol>
      <li>The API server uses the native Google Gen AI SDK and <code>gemini-3.8-flash</code>; there is no configurable compatibility base URL.</li>
      <li>Enter a newly rotated Google AI Studio key above. The server writes it as <code>GEMINI_API_KEY</code> in the ignored local <code>.env</code> file.</li>
      <li>Click “Test Gemini connection.” A rejected key or unavailable model is shown as a server-side SDK error with the key redacted.</li>
    </ol></details>
  </section>;
}
