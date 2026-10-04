import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Socket } from "node:net";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";
import {
  configSchema,
  defaults,
  publicSettings,
  type SMTPConfig,
  type TestEvent,
} from "../shared/model.js";
import { getMicrosoftToken, OAuthError } from "../server/oauth.js";
import { redact, runSMTPTest } from "../server/smtp.js";

const config: SMTPConfig = {
  ...defaults,
  profile: "m365",
  host: "smtp.office365.com",
  port: 587,
  tenantId: "11111111-1111-1111-1111-111111111111",
  clientId: "22222222-2222-2222-2222-222222222222",
  clientSecret: "Secret+Value&123",
  mailbox: "sender@example.test",
  mode: "connection",
  from: "sender@example.test",
  to: "recipient@example.test",
};
const token = "fake-access-token-for-local-tests";

test("Microsoft token request uses the fixed endpoint, encoded secret and SMTP scope", async () => {
  const request = (async (url, options) => {
    assert.equal(url, `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/token`);
    assert.equal(options?.method, "POST");
    assert.equal(options?.redirect, "error");
    assert.ok(options?.signal);
    const body = new URLSearchParams(String(options?.body));
    assert.equal(body.get("client_id"), config.clientId);
    assert.equal(body.get("client_secret"), config.clientSecret);
    assert.equal(body.get("grant_type"), "client_credentials");
    assert.equal(body.get("scope"), "https://outlook.office365.com/.default");
    return Response.json({ token_type: "Bearer", access_token: token });
  }) as typeof fetch;
  assert.equal(await getMicrosoftToken(config, request), token);
});

test("token errors expose AADSTS codes without provider descriptions or credentials", async () => {
  const request = (async () =>
    Response.json(
      {
        error: "invalid_client",
        error_codes: [7000215],
        error_description: `Invalid secret ${config.clientSecret}`,
      },
      { status: 401 },
    )) as typeof fetch;
  await assert.rejects(getMicrosoftToken(config, request), (error) => {
    assert.ok(error instanceof OAuthError);
    assert.equal(error.code, "AADSTS7000215");
    assert.doesNotMatch(error.message, /Secret|123/);
    return true;
  });
});

test("malformed and failed token responses do not produce SMTP credentials", async () => {
  for (const body of [
    {},
    { token_type: "Basic", access_token: token },
    { token_type: "Bearer", access_token: "" },
  ]) {
    await assert.rejects(
      getMicrosoftToken(config, (async () => Response.json(body)) as typeof fetch),
      { code: "OAUTH_INVALID_RESPONSE" },
    );
  }
  await assert.rejects(
    getMicrosoftToken(config, (async () => {
      throw new Error(config.clientSecret);
    }) as typeof fetch),
    { code: "OAUTH_REQUEST_FAILED" },
  );
});

test("OAuth validates IDs, mailbox and mandatory Microsoft transport settings", () => {
  assert.equal(configSchema.safeParse(config).success, true);
  for (const override of [
    { tenantId: "../other" },
    { clientId: "not-a-guid" },
    { clientSecret: "" },
    { mailbox: "invalid" },
    { host: "attacker.example" },
    { port: 25 },
    { security: "none" },
    { validateCertificate: false },
    { servername: "other.example" },
  ]) {
    assert.equal(
      configSchema.safeParse({ ...config, ...override }).success,
      false,
      JSON.stringify(override),
    );
  }
  const parsed = configSchema.parse({
    ...config,
    username: "old-user",
    password: "old-password",
    authenticate: false,
  });
  assert.equal(parsed.authenticate, true);
  assert.equal(parsed.password, "");
  assert.equal(parsed.username, "");
  const smtp = configSchema.parse({ ...config, profile: "smtp" });
  assert.equal(smtp.clientSecret, "");
  assert.equal(smtp.tenantId, "");
});

test("OAuth token failure stops before creating an SMTP transport", async () => {
  const events: TestEvent[] = [];
  await runSMTPTest(config, (event) => events.push(event), {
    getToken: async () => {
      throw new OAuthError("Microsoft hat die Token-Anforderung abgelehnt.", "AADSTS7000215");
    },
    createTransport: () => {
      assert.fail("SMTP must not run after token rejection");
    },
  });
  const result = events.at(-1);
  assert.equal(result?.type, "done");
  if (result?.type !== "done") return;
  assert.equal(result.tokenAcquired, false);
  assert.equal(result.connected, false);
  assert.equal(result.authenticated, false);
  assert.equal(result.code, "AADSTS7000215");
});

test("exports and redaction exclude secrets, tokens and XOAUTH2 payloads", () => {
  const payload = Buffer.from(`user=${config.mailbox}\x01auth=Bearer ${token}\x01\x01`).toString(
    "base64",
  );
  const input = [config.clientSecret, encodeURIComponent(config.clientSecret), token, payload].join(
    " ",
  );
  assert.equal(redact(input, config, token), "[redacted] [redacted] [redacted] [redacted]");
  const settings = publicSettings({
    ...config,
    username: "private-user",
    password: "private-password",
  });
  assert.equal("clientSecret" in settings, false);
  assert.equal("password" in settings, false);
  assert.equal("username" in settings, false);
  assert.equal("message" in settings, false);
  assert.equal(settings.profile, "m365");
});

async function oauthFixture(reject: boolean) {
  const authPayloads: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.setTimeout(3000, () => socket.destroy());
    socket.write("220 test.local ESMTP\r\n");
    let pending = "",
      data = false,
      message = "";
    socket.on("data", (chunk) => {
      pending += chunk;
      while (pending.includes("\r\n")) {
        const index = pending.indexOf("\r\n");
        const line = pending.slice(0, index);
        pending = pending.slice(index + 2);
        if (data) {
          if (line === ".") {
            data = false;
            messages.push(message);
            socket.write("250 queued locally\r\n");
          } else message += line + "\r\n";
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250-test.local\r\n250 AUTH XOAUTH2\r\n");
        else if (line.startsWith("AUTH XOAUTH2 ")) {
          authPayloads.push(Buffer.from(line.slice(13), "base64").toString());
          socket.write(reject ? "535 OAuth rejected\r\n" : "235 Authenticated\r\n");
        } else if (/^DATA/.test(line)) {
          data = true;
          message = "";
          socket.write("354 End with dot\r\n");
        } else if (/^QUIT/.test(line)) socket.end("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    authPayloads,
    messages,
    dependencies: {
      getToken: async () => token,
      createTransport: (options: Parameters<typeof nodemailer.createTransport>[0]) => {
        // Override the destination only inside this test; production always enforces Microsoft TLS.
        const opts = options as SMTPTransport.Options;
        assert.equal(opts.host, "smtp.office365.com");
        assert.equal(opts.requireTLS, true);
        assert.equal(opts.tls?.rejectUnauthorized, true);
        return nodemailer.createTransport({
          ...opts,
          host: "127.0.0.1",
          port: (server.address() as { port: number }).port,
          requireTLS: false,
          ignoreTLS: true,
          secure: false,
        });
      },
    },
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

for (const mode of ["connection", "mail"] as const) {
  test(`OAuth SMTP ${mode} uses XOAUTH2 without leaking the access token`, async () => {
    const f = await oauthFixture(false);
    const events: TestEvent[] = [];
    try {
      await runSMTPTest({ ...config, mode }, (event) => events.push(event), f.dependencies);
      const result = events.at(-1);
      if (result?.type !== "done") assert.fail("No outcome");
      assert.equal(result.success, true);
      assert.equal(result.tokenAcquired, true);
      assert.equal(result.authenticated, true);
      assert.equal(f.messages.length, mode === "mail" ? 1 : 0);
      assert.ok(f.authPayloads.length > 0);
      for (const payload of f.authPayloads)
        assert.equal(payload, `user=${config.mailbox}\x01auth=Bearer ${token}\x01\x01`);
      assert.doesNotMatch(JSON.stringify(events), new RegExp(token));
      assert.doesNotMatch(JSON.stringify(events), /Secret\+Value/);
    } finally {
      await f.close();
    }
  });
}

test("OAuth SMTP rejection distinguishes a valid token from failed mailbox authentication", async () => {
  const f = await oauthFixture(true);
  const events: TestEvent[] = [];
  try {
    await runSMTPTest(config, (event) => events.push(event), f.dependencies);
    const result = events.at(-1);
    if (result?.type !== "done") assert.fail("No outcome");
    assert.equal(result.tokenAcquired, true);
    assert.equal(result.connected, true);
    assert.equal(result.authenticated, false);
    assert.equal(result.success, false);
    assert.equal(result.code, "EAUTH");
    assert.equal(f.messages.length, 0);
  } finally {
    await f.close();
  }
});
