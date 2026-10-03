import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUpRight,
  Check,
  CheckCircle2,
  ChevronDown,
  Download,
  Eye,
  EyeOff,
  LoaderCircle,
  Mail,
  Monitor,
  Moon,
  RotateCcw,
  Send,
  Server,
  ShieldCheck,
  Sun,
  Terminal,
  XCircle,
} from "lucide-react";
import {
  configSchema,
  defaults,
  type SMTPConfig,
  type Stage,
  type TestEvent,
  type TestOutcome,
} from "../shared/model";

const providers = [
  { name: "Benutzerdefiniert", host: "", port: 587 },
  { name: "Gmail", host: "smtp.gmail.com", port: 587 },
  { name: "Microsoft 365", host: "smtp.office365.com", port: 587 },
  { name: "SendGrid", host: "smtp.sendgrid.net", port: 587 },
  { name: "Mailgun EU", host: "smtp.eu.mailgun.org", port: 587 },
  { name: "Amazon SES · Frankfurt", host: "email-smtp.eu-central-1.amazonaws.com", port: 587 },
];
type Theme = "light" | "dark" | "system";
type Log = Extract<TestEvent, { type: "log" }>;
function Field({
  label,
  id,
  error,
  children,
}: {
  label: string;
  id: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {error && (
        <span className="field-error" id={`${id}-error`}>
          {error}
        </span>
      )}
    </div>
  );
}

export default function App() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const saved = localStorage.getItem("smtp-theme");
      return saved === "light" || saved === "dark" ? saved : "system";
    } catch {
      return "system";
    }
  });
  const [config, setConfig] = useState<SMTPConfig>({ ...defaults });
  const [provider, setProvider] = useState("Benutzerdefiniert");
  const [visiblePassword, setVisiblePassword] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logs, setLogs] = useState<Log[]>([]);
  const [result, setResult] = useState<TestOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<Stage | null>(null);
  const [notice, setNotice] = useState("");
  const [tested, setTested] = useState<SMTPConfig | null>(null);
  const consoleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const media = matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === "system" ? (media.matches ? "dark" : "light") : theme;
    };
    apply();
    try {
      localStorage.setItem("smtp-theme", theme);
    } catch {
      /* Storage is optional. */
    }
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  useEffect(() => {
    const el = consoleRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs]);
  const update = <K extends keyof SMTPConfig>(key: K, value: SMTPConfig[K]) => {
    setConfig((c) => ({ ...c, [key]: value }));
    setErrors((e) => {
      const next = { ...e };
      delete next[key];
      return next;
    });
    if (key === "host" || key === "port") setProvider("Benutzerdefiniert");
  };
  const input = (
    key: "host" | "username" | "password" | "from" | "to" | "subject" | "servername",
    placeholder: string,
    type = "text",
  ) => (
    <input
      id={key}
      value={config[key]}
      placeholder={placeholder}
      type={type}
      autoComplete={key === "password" ? "new-password" : "off"}
      onChange={(e) => update(key, e.target.value)}
      aria-invalid={!!errors[key]}
      aria-describedby={errors[key] ? `${key}-error` : undefined}
    />
  );

  const start = async (event: React.FormEvent) => {
    event.preventDefault();
    const parsed = configSchema.safeParse(config);
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues) next[String(issue.path[0])] = issue.message;
      setErrors(next);
      setNotice("Bitte die markierten Felder prüfen.");
      document.getElementById(Object.keys(next)[0])?.focus();
      return;
    }
    setBusy(true);
    setLogs([]);
    setResult(null);
    setStage("connection");
    setNotice("");
    // Keep only non-secret settings for the result and export.
    setTested({ ...parsed.data, username: "", password: "", message: "" });
    let completed = false;
    try {
      const response = await fetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Test konnte nicht gestartet werden.");
      }
      if (!response.body) throw new Error("Der Server hat keinen Ergebnisstream geliefert.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        const packets = buffer.split("\n\n");
        buffer = packets.pop() || "";
        for (const packet of packets) {
          if (!packet.startsWith("data: ")) continue;
          const data: TestEvent = JSON.parse(packet.slice(6));
          if (data.type === "log") setLogs((l) => [...l, data]);
          if (data.type === "stage") setStage(data.stage);
          if (data.type === "done") {
            setResult(data);
            completed = true;
          }
        }
        if (done) break;
      }
      if (!completed)
        throw new Error("Verbindung zum Testserver unterbrochen. Ergebnis unbekannt.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Test fehlgeschlagen.");
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const reset = () => {
    setConfig({ ...defaults });
    setProvider("Benutzerdefiniert");
    setResult(null);
    setLogs([]);
    setErrors({});
    setNotice("");
    setTested(null);
    setVisiblePassword(false);
  };
  const exportResult = () => {
    if (!result || !tested) return;
    const { username: _user, password: _password, message: _message, ...settings } = tested;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ settings, result, logs }, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `simple-smtp-test-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const status = busy
    ? stage === "mail"
      ? "Mail wird gesendet"
      : "Verbindung wird geprüft"
    : result
      ? result.success
        ? "Test erfolgreich"
        : "Test fehlgeschlagen"
      : "Bereit für deinen Test";

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <a className="brand" href="/" aria-label="Simple SMTP Test Startseite">
            <span className="brand-symbol">
              <Mail size={23} strokeWidth={1.8} />
            </span>
            <span>
              Simple <b>SMTP</b> Test<span className="brand-caption">MAIL SERVER DIAGNOSTICS</span>
            </span>
          </a>
          <div className="header-right">
            <span className="self-hosted">
              <span /> Self-hosted
            </span>
            <div className="theme-switch" aria-label="Darstellung">
              {(
                [
                  ["light", Sun, "Hell"],
                  ["dark", Moon, "Dunkel"],
                  ["system", Monitor, "System"],
                ] as const
              ).map(([value, Icon, name]) => (
                <button
                  key={value}
                  type="button"
                  title={name}
                  aria-label={`${name}modus`}
                  aria-pressed={theme === value}
                  onClick={() => setTheme(value)}
                >
                  <Icon size={16} />
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>
      <main className="shell">
        <section className="intro">
          <div>
            <div className="eyebrow">
              <span /> SIMPLE TOOLS. CLEAR RESULTS.
            </div>
            <h1>
              SMTP testen<span>.</span>
            </h1>
            <p>Verbindung prüfen. Test-Mail senden. Ergebnis sehen.</p>
          </div>
          <div
            className={`status-pill ${busy ? "running" : result ? (result.success ? "success" : "failed") : ""}`}
            role="status"
          >
            {busy ? <LoaderCircle size={15} className="spin" /> : <span className="status-dot" />}
            {status}
          </div>
        </section>

        <form onSubmit={start}>
          <fieldset disabled={busy} className="form-fieldset">
            <div className="workspace">
              <section className="panel server-panel">
                <div className="panel-heading">
                  <div className="panel-title">
                    <span className="step">01</span>
                    <h2>Mailserver</h2>
                  </div>
                  <Server size={19} className="muted" />
                </div>
                <div className="panel-body">
                  <div className="field">
                    <label htmlFor="provider">Anbietervorlage</label>
                    <div className="select-wrap">
                      <select
                        id="provider"
                        value={provider}
                        onChange={(e) => {
                          const p = providers.find((p) => p.name === e.target.value)!;
                          setProvider(p.name);
                          setConfig((c) => ({
                            ...c,
                            host: p.host,
                            port: p.port,
                            security: "starttls",
                            authenticate: !!p.host,
                          }));
                          setErrors({});
                        }}
                      >
                        {providers.map((p) => (
                          <option key={p.name}>{p.name}</option>
                        ))}
                      </select>
                      <ChevronDown size={15} />
                    </div>
                  </div>
                  <div className="host-row">
                    <Field id="host" label="SMTP-Host" error={errors.host}>
                      {input("host", "smtp.example.com")}
                    </Field>
                    <Field id="port" label="Port" error={errors.port}>
                      <input
                        id="port"
                        type="number"
                        min="1"
                        max="65535"
                        value={config.port || ""}
                        onChange={(e) => update("port", Number(e.target.value))}
                        aria-invalid={!!errors.port}
                      />
                    </Field>
                  </div>
                  <div className="field">
                    <span className="field-label" id="encryption-label">
                      Verschlüsselung
                    </span>
                    <div className="segments" role="group" aria-labelledby="encryption-label">
                      {(
                        [
                          ["starttls", "STARTTLS"],
                          ["tls", "TLS / SSL"],
                          ["none", "Keine"],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          type="button"
                          aria-pressed={config.security === value}
                          onClick={() => update("security", value)}
                        >
                          {config.security === value && <Check size={13} />}
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="auth-section">
                    <label className="toggle-label" htmlFor="authenticate">
                      <span>
                        <ShieldCheck size={17} /> Authentifizierung
                      </span>
                      <input
                        id="authenticate"
                        type="checkbox"
                        role="switch"
                        checked={config.authenticate}
                        onChange={(e) => update("authenticate", e.target.checked)}
                      />
                    </label>
                    {config.authenticate && (
                      <div className="auth-fields">
                        <Field id="username" label="Benutzername" error={errors.username}>
                          {input("username", "name@example.com")}
                        </Field>
                        <Field id="password" label="Passwort" error={errors.password}>
                          <div className="password-wrap">
                            {input(
                              "password",
                              "Passwort oder App-Passwort",
                              visiblePassword ? "text" : "password",
                            )}
                            <button
                              type="button"
                              aria-label={
                                visiblePassword ? "Passwort verbergen" : "Passwort anzeigen"
                              }
                              aria-pressed={visiblePassword}
                              onClick={() => setVisiblePassword((v) => !v)}
                            >
                              {visiblePassword ? <EyeOff size={17} /> : <Eye size={17} />}
                            </button>
                          </div>
                        </Field>
                      </div>
                    )}
                  </div>
                  <details className="advanced">
                    <summary>
                      Erweiterte Einstellungen
                      <ChevronDown size={14} />
                    </summary>
                    <div className="advanced-body">
                      <Field
                        id="timeout"
                        label="Timeout pro Schritt (Sekunden)"
                        error={errors.timeout}
                      >
                        <input
                          id="timeout"
                          type="number"
                          min="1"
                          max="60"
                          value={config.timeout / 1000}
                          onChange={(e) => update("timeout", Number(e.target.value) * 1000)}
                        />
                      </Field>
                      <Field
                        id="servername"
                        label="TLS-Hostname (optional)"
                        error={errors.servername}
                      >
                        {input("servername", "Für Zertifikatsprüfung bei IP-Adressen")}
                      </Field>
                      <label className="checkbox-label">
                        <input
                          type="checkbox"
                          checked={config.validateCertificate}
                          onChange={(e) => update("validateCertificate", e.target.checked)}
                        />{" "}
                        TLS-Zertifikat prüfen
                      </label>
                    </div>
                  </details>
                </div>
              </section>

              <section className="panel message-panel">
                <div className="panel-heading">
                  <div className="panel-title">
                    <span className="step">02</span>
                    <h2>Testnachricht</h2>
                  </div>
                  <Mail size={19} className="muted" />
                </div>
                <div className="panel-body">
                  <div className="segments test-mode" role="group" aria-label="Testart">
                    <button
                      type="button"
                      aria-pressed={config.mode === "connection"}
                      onClick={() => update("mode", "connection")}
                    >
                      Nur Verbindung
                    </button>
                    <button
                      type="button"
                      aria-pressed={config.mode === "mail"}
                      onClick={() => update("mode", "mail")}
                    >
                      Mit Test-Mail <ArrowUpRight size={14} />
                    </button>
                  </div>
                  {config.mode === "connection" ? (
                    <div className="connection-note">
                      <div className="connection-icon">
                        <Server size={30} strokeWidth={1.5} />
                      </div>
                      <h3>Einfach die Verbindung prüfen.</h3>
                      <p>
                        Prüft den SMTP-Handshake und, wenn aktiviert, die Anmeldung. Es wird keine
                        Mail versendet.
                      </p>
                      <span>
                        <ShieldCheck size={14} /> Verbindungstest
                      </span>
                    </div>
                  ) : (
                    <>
                      <div className="email-row">
                        <Field id="from" label="Absender" error={errors.from}>
                          {input("from", "sender@example.com", "email")}
                        </Field>
                        <Field id="to" label="Empfänger" error={errors.to}>
                          {input("to", "recipient@example.com", "email")}
                        </Field>
                      </div>
                      <Field id="subject" label="Betreff" error={errors.subject}>
                        {input("subject", "Betreff der Test-Mail")}
                      </Field>
                      <Field id="message" label="Nachricht" error={errors.message}>
                        <textarea
                          id="message"
                          rows={5}
                          value={config.message}
                          onChange={(e) => update("message", e.target.value)}
                          aria-invalid={!!errors.message}
                        />
                      </Field>
                      <label className="checkbox-label format-label">
                        <input
                          type="checkbox"
                          checked={config.html}
                          onChange={(e) => update("html", e.target.checked)}
                        />{" "}
                        Als HTML senden<span>TEXT / HTML</span>
                      </label>
                    </>
                  )}
                </div>
              </section>
            </div>
          </fieldset>
          <div className="action-bar">
            <span className="action-note">
              <ShieldCheck size={16} />
              {config.mode === "mail"
                ? "Verbindung, Anmeldung und Mailversand"
                : "Verbindung und optionale Anmeldung"}
            </span>
            <div className="action-buttons">
              <button type="button" className="secondary-button" disabled={busy} onClick={reset}>
                <RotateCcw size={15} />
                <span>Zurücksetzen</span>
              </button>
              <button className="primary-button" type="submit" disabled={busy}>
                {busy ? <LoaderCircle size={17} className="spin" /> : <Send size={17} />}
                {busy ? "Test läuft …" : "Test starten"}
                <span className="button-arrow">↗</span>
              </button>
            </div>
          </div>
        </form>
        {notice && (
          <div className="notice" role="alert">
            <XCircle size={18} />
            {notice}
          </div>
        )}

        <section className="results-section">
          <div className="results-heading">
            <div>
              <div className="eyebrow">LIVE DIAGNOSTICS</div>
              <h2>Das Ergebnis zählt.</h2>
            </div>
            <button
              className="export-button"
              type="button"
              disabled={!result || busy}
              onClick={exportResult}
            >
              <Download size={15} /> JSON exportieren
            </button>
          </div>
          <div className="metrics">
            {[
              {
                label: "Verbindung",
                icon: Server,
                value: result
                  ? result.connected
                    ? "Erfolgreich"
                    : "Fehlgeschlagen"
                  : busy
                    ? "Wird geprüft …"
                    : "Noch nicht geprüft",
                ok: result?.connected,
              },
              {
                label: "Authentifizierung",
                icon: ShieldCheck,
                value: result
                  ? result.authenticated === null
                    ? "Ohne Anmeldung"
                    : result.authenticated
                      ? "Erfolgreich"
                      : "Nicht bestätigt"
                  : busy && tested?.authenticate
                    ? "Wird geprüft …"
                    : "Noch nicht geprüft",
                ok: result?.authenticated,
              },
              {
                label: "Mailversand",
                icon: Mail,
                value: result
                  ? result.sent === null
                    ? "Nicht angefordert"
                    : result.sent
                      ? "Server hat angenommen"
                      : "Nicht gesendet"
                  : stage === "mail"
                    ? "Wird gesendet …"
                    : "Noch nicht geprüft",
                ok: result?.sent,
              },
              {
                label: "Dauer",
                icon: Terminal,
                value: result ? `${(result.duration / 1000).toFixed(2)} s` : busy ? "Läuft …" : "—",
                ok: null,
              },
            ].map(({ label, icon: Icon, value, ok }) => (
              <div className="metric" key={label}>
                <div className="metric-label">
                  <Icon size={15} />
                  {label}
                </div>
                <div className={`metric-value ${ok === true ? "good" : ""}`}>
                  {ok === true && <CheckCircle2 size={15} />}
                  {value}
                </div>
              </div>
            ))}
          </div>
          {result && (
            <div className={`outcome ${result.success ? "ok" : "error"}`} role="status">
              {result.success ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
              <div>
                <strong>
                  {result.success
                    ? result.sent
                      ? "Test-Mail angenommen"
                      : "Verbindung erfolgreich geprüft"
                    : "Test fehlgeschlagen"}
                </strong>
                <span>
                  {result.success
                    ? result.sent
                      ? "Die Zustellung ins Postfach hängt vom empfangenden Mailserver ab."
                      : "Der Mailserver antwortet auf SMTP-Anfragen."
                    : result.error}
                </span>
              </div>
              {result.code && <code>{result.code}</code>}
            </div>
          )}
          <div className="console-panel">
            <div className="console-toolbar">
              <div>
                <Terminal size={16} />
                <span>Testprotokoll</span>
                <span className="console-count">
                  {logs.length.toString().padStart(2, "0")} EVENTS
                </span>
              </div>
              <span className={`console-state ${busy ? "live" : ""}`}>
                <span />
                {busy ? "LIVE" : result ? "ABGESCHLOSSEN" : "STANDBY"}
              </span>
            </div>
            <div
              className="console-body"
              ref={consoleRef}
              role="log"
              aria-label="SMTP-Testprotokoll"
            >
              {!logs.length ? (
                <div className="console-empty">
                  <span className="prompt">›</span>
                  <div>
                    Bereit, wenn du es bist.
                    <span>Starte einen Test. Hier erscheinen die einzelnen Schritte.</span>
                  </div>
                  <span className="cursor" />
                </div>
              ) : (
                logs.map((log, i) => (
                  <div className={`log-line ${log.level}`} key={i}>
                    <time>{new Date(log.time).toLocaleTimeString("de-DE", { hour12: false })}</time>
                    <span className="log-level">
                      {log.level === "success" ? "OK" : log.level === "error" ? "ERR" : "INFO"}
                    </span>
                    <span>{log.message}</span>
                  </div>
                ))
              )}
            </div>
            <div className="console-footer">
              <span>
                {tested
                  ? `${tested.host}:${tested.port} · ${tested.security.toUpperCase()}`
                  : "Kein Test ausgeführt"}
              </span>
              <span>SMTP / TCP</span>
            </div>
          </div>
        </section>
        <footer className="footer">
          <span>
            <span className="footer-dot" /> Simple SMTP Test
          </span>
          <span>Ein Werkzeug. Ein klarer Befund.</span>
        </footer>
      </main>
    </>
  );
}
