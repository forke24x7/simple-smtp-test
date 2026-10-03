import nodemailer from "nodemailer";
import type { SMTPConfig, TestEvent } from "../shared/model.js";

export function redact(value: string, config: SMTPConfig): string {
  const secrets = [config.password, config.username];
  if (config.password) secrets.push(Buffer.from(config.password).toString("base64"));
  if (config.username) secrets.push(Buffer.from(config.username).toString("base64"));
  if (config.authenticate)
    secrets.push(Buffer.from(`\0${config.username}\0${config.password}`).toString("base64"));
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    value = value.split(secret).join("[redacted]");
  }
  return value.slice(0, 2000);
}

export async function runSMTPTest(config: SMTPConfig, emit: (event: TestEvent) => void) {
  const started = Date.now();
  let connected = false;
  let authenticated = false;
  let sent: boolean | null = config.mode === "mail" ? false : null;
  const log = (level: "info" | "success" | "error", message: string) =>
    emit({ type: "log", level, message: redact(message, config), time: new Date().toISOString() });
  const transport = nodemailer.createTransport({
    host: config.host.replace(/^\[|\]$/g, ""),
    port: config.port,
    secure: config.security === "tls",
    requireTLS: config.security === "starttls",
    ignoreTLS: config.security === "none",
    auth: config.authenticate ? { user: config.username, pass: config.password } : undefined,
    tls: {
      rejectUnauthorized: config.validateCertificate,
      ...(config.servername ? { servername: config.servername } : {}),
    },
    connectionTimeout: config.timeout,
    greetingTimeout: config.timeout,
    socketTimeout: config.timeout,
    dnsTimeout: config.timeout,
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  });
  try {
    emit({ type: "stage", stage: "connection" });
    log("info", `Verbinde mit ${config.host}:${config.port} · ${config.security.toUpperCase()}`);
    if (config.authenticate) log("info", "Verbindung und Anmeldung werden geprüft.");
    await transport.verify();
    connected = true;
    authenticated = config.authenticate;
    log(
      "success",
      config.authenticate
        ? "Verbindung und Authentifizierung erfolgreich."
        : "SMTP-Verbindung erfolgreich.",
    );
    let response: string | undefined;
    let messageId: string | undefined;
    if (config.mode === "mail") {
      emit({ type: "stage", stage: "mail" });
      log("info", "Test-Mail wird an den SMTP-Server übergeben.");
      const info = await transport.sendMail({
        from: { address: config.from, name: "Simple SMTP Test" },
        to: { address: config.to, name: "" },
        subject: config.subject,
        ...(config.html ? { html: config.message } : { text: config.message }),
      });
      sent = info.accepted.length > 0 && info.rejected.length === 0;
      if (!sent) throw new Error("Der SMTP-Server hat den Empfänger abgelehnt.");
      response = redact(info.response, config);
      messageId = redact(info.messageId, config);
      log("success", "SMTP-Server hat die Test-Mail angenommen.");
      if (response) log("info", response);
    }
    emit({
      type: "done",
      success: true,
      duration: Date.now() - started,
      connected,
      authenticated: config.authenticate ? true : null,
      sent,
      response,
      messageId,
    });
  } catch (error) {
    const e = error as Error & { code?: string; response?: string };
    if (e.code === "EAUTH") connected = true;
    const message = redact(e.message || "SMTP-Test fehlgeschlagen.", config);
    log("error", message);
    emit({
      type: "done",
      success: false,
      duration: Date.now() - started,
      connected,
      authenticated: config.authenticate ? authenticated : null,
      sent,
      error: message,
      code: e.code ? redact(e.code, config) : undefined,
      response: e.response ? redact(e.response, config) : undefined,
    });
  } finally {
    transport.close();
  }
}
