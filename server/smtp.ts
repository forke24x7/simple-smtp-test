import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import { getMicrosoftToken } from "./oauth.js";
import type { SMTPConfig, TestEvent } from "../shared/model.js";

export function redact(value: string, config: SMTPConfig, accessToken = ""): string {
  const secrets = [config.password, config.username, config.clientSecret, accessToken];
  for (const secret of [config.clientSecret, accessToken].filter(Boolean)) {
    secrets.push(Buffer.from(secret).toString("base64"), encodeURIComponent(secret));
  }
  if (accessToken)
    secrets.push(
      Buffer.from(`user=${config.mailbox}\x01auth=Bearer ${accessToken}\x01\x01`).toString(
        "base64",
      ),
    );
  if (config.password) secrets.push(Buffer.from(config.password).toString("base64"));
  if (config.username) secrets.push(Buffer.from(config.username).toString("base64"));
  if (config.authenticate)
    secrets.push(Buffer.from(`\0${config.username}\0${config.password}`).toString("base64"));
  for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
    value = value.split(secret).join("[redacted]");
  }
  return value.slice(0, 2000);
}

type Dependencies = {
  getToken: typeof getMicrosoftToken;
  createTransport: (options: SMTPTransport.Options) => nodemailer.Transporter;
};
export async function runSMTPTest(
  config: SMTPConfig,
  emit: (event: TestEvent) => void,
  dependencies: Partial<Dependencies> = {},
) {
  const started = Date.now();
  let accessToken = "";
  let tokenAcquired: boolean | null = config.profile === "m365" ? false : null;
  let transport: nodemailer.Transporter | undefined;
  const requiresAuth = config.profile === "m365" || config.authenticate;
  let connected = false;
  let authenticated = false;
  let sent: boolean | null = config.mode === "mail" ? false : null;
  const log = (level: "info" | "success" | "error", message: string) =>
    emit({
      type: "log",
      level,
      message: redact(message, config, accessToken),
      time: new Date().toISOString(),
    });
  try {
    if (config.profile === "m365") {
      emit({ type: "stage", stage: "token" });
      log("info", "Microsoft-Zugriffstoken wird angefordert.");
      accessToken = await (dependencies.getToken || getMicrosoftToken)(config);
      tokenAcquired = true;
      log("success", "Microsoft-Zugriffstoken erhalten.");
    }
    transport = (dependencies.createTransport || nodemailer.createTransport)({
      host: config.host.replace(/^\[|\]$/g, ""),
      port: config.port,
      secure: config.security === "tls",
      requireTLS: config.security === "starttls",
      ignoreTLS: config.security === "none",
      auth:
        config.profile === "m365"
          ? { type: "OAuth2", user: config.mailbox, accessToken }
          : config.authenticate
            ? { user: config.username, pass: config.password }
            : undefined,
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
    emit({ type: "stage", stage: "connection" });
    log("info", `Verbinde mit ${config.host}:${config.port} · ${config.security.toUpperCase()}`);
    if (requiresAuth) log("info", "Verbindung und Anmeldung werden geprüft.");
    await transport.verify();
    connected = true;
    authenticated = requiresAuth;
    log(
      "success",
      requiresAuth
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
      response = redact(info.response, config, accessToken);
      messageId = redact(info.messageId, config, accessToken);
      log("success", "SMTP-Server hat die Test-Mail angenommen.");
      if (response) log("info", response);
    }
    emit({
      type: "done",
      success: true,
      duration: Date.now() - started,
      connected,
      tokenAcquired,
      authenticated: requiresAuth ? true : null,
      sent,
      response,
      messageId,
    });
  } catch (error) {
    const e = error as Error & { code?: string; response?: string };
    if (e.code === "EAUTH") connected = true;
    const message = redact(e.message || "SMTP-Test fehlgeschlagen.", config, accessToken);
    log("error", message);
    emit({
      type: "done",
      success: false,
      duration: Date.now() - started,
      connected,
      tokenAcquired,
      authenticated: requiresAuth ? authenticated : null,
      sent,
      error: message,
      code: e.code ? redact(e.code, config, accessToken) : undefined,
      response: e.response ? redact(e.response, config, accessToken) : undefined,
    });
  } finally {
    transport?.close();
    accessToken = "";
  }
}
