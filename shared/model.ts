// Configuration validation and event types shared by client and server.
import { z } from "zod";

export const configSchema = z
  .object({
    host: z
      .string()
      .trim()
      .min(1, "SMTP-Host fehlt")
      .max(253)
      .regex(/^[a-zA-Z0-9.:[\]-]+$/, "Nur Hostname oder IP-Adresse eingeben"),
    port: z.number().int().min(1).max(65535),
    security: z.enum(["starttls", "tls", "none"]),
    authenticate: z.boolean(),
    username: z.string().max(320),
    password: z.string().max(1024),
    mode: z.enum(["connection", "mail"]),
    from: z.string().max(320),
    to: z.string().max(320),
    subject: z
      .string()
      .max(200)
      .refine((s) => !/[\r\n]/.test(s), "Betreff enthält einen Zeilenumbruch"),
    message: z.string().max(16000),
    html: z.boolean(),
    timeout: z.number().int().min(1000).max(60000),
    validateCertificate: z.boolean(),
    servername: z
      .string()
      .trim()
      .max(253)
      .refine((s) => !s || /^[a-zA-Z0-9.-]+$/.test(s), "Ungültiger TLS-Hostname"),
  })
  .superRefine((c, ctx) => {
    if (c.authenticate) {
      if (!c.username.trim())
        ctx.addIssue({ code: "custom", path: ["username"], message: "Benutzername fehlt" });
      if (!c.password)
        ctx.addIssue({ code: "custom", path: ["password"], message: "Passwort fehlt" });
    }
    if (c.mode === "mail") {
      for (const field of ["from", "to"] as const) {
        if (!z.email().safeParse(c[field]).success)
          ctx.addIssue({
            code: "custom",
            path: [field],
            message: "Gültige E-Mail-Adresse eingeben",
          });
      }
      if (!c.subject.trim())
        ctx.addIssue({ code: "custom", path: ["subject"], message: "Betreff fehlt" });
      if (!c.message.trim())
        ctx.addIssue({ code: "custom", path: ["message"], message: "Nachricht fehlt" });
    }
  });

export type SMTPConfig = z.infer<typeof configSchema>;
export type Stage = "connection" | "mail";
export type TestEvent =
  | { type: "log"; level: "info" | "success" | "error"; message: string; time: string }
  | { type: "stage"; stage: Stage }
  | {
      type: "done";
      success: boolean;
      duration: number;
      connected: boolean;
      authenticated: boolean | null;
      sent: boolean | null;
      response?: string;
      messageId?: string;
      error?: string;
      code?: string;
    };
export type TestOutcome = Extract<TestEvent, { type: "done" }>;
export const defaults: SMTPConfig = {
  host: "",
  port: 587,
  security: "starttls",
  authenticate: false,
  username: "",
  password: "",
  mode: "mail",
  from: "",
  to: "",
  subject: "Simple SMTP Test",
  message: "Dies ist eine Test-Mail von Simple SMTP Test.",
  html: false,
  timeout: 15000,
  validateCertificate: true,
  servername: "",
};
