import assert from "node:assert/strict";
import { createServer, type Socket } from "node:net";
import { test } from "node:test";
import { createApp } from "../server/app.js";
import { redact, runSMTPTest } from "../server/smtp.js";
import { configSchema, defaults, type SMTPConfig, type TestEvent } from "../shared/model.js";

async function fixture(options: { rejectAuth?: boolean; rejectRecipient?: boolean } = {}) {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.setEncoding("utf8");
    socket.setTimeout(3000, () => socket.destroy());
    socket.write("220 test.local ESMTP\r\n");
    let pending = "";
    let data = false;
    let message = "";
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
            socket.write("250 2.0.0 queued locally\r\n");
          } else message += line + "\r\n";
        } else if (/^EHLO|^HELO/.test(line)) socket.write("250-test.local\r\n250 AUTH PLAIN\r\n");
        else if (/^AUTH/.test(line))
          socket.write(
            options.rejectAuth
              ? "535 5.7.8 Authentication rejected\r\n"
              : "235 2.7.0 Authenticated\r\n",
          );
        else if (/^MAIL/.test(line)) socket.write("250 Sender accepted\r\n");
        else if (/^RCPT/.test(line))
          socket.write(
            options.rejectRecipient ? "550 Recipient rejected\r\n" : "250 Recipient accepted\r\n",
          );
        else if (/^DATA/.test(line)) {
          data = true;
          message = "";
          socket.write("354 End with dot\r\n");
        } else if (/^QUIT/.test(line)) socket.end("221 Bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const config: SMTPConfig = {
    ...defaults,
    host: "127.0.0.1",
    port,
    security: "none",
    timeout: 2000,
    from: "sender@example.test",
    to: "recipient@example.test",
  };
  return {
    config,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

test("connection-only verifies SMTP without transmitting a message", async () => {
  const f = await fixture();
  const events: TestEvent[] = [];
  try {
    await runSMTPTest({ ...f.config, mode: "connection" }, (e) => events.push(e));
    const result = events.at(-1);
    assert.equal(result?.type, "done");
    if (result?.type === "done") {
      assert.equal(result.success, true);
      assert.equal(result.sent, null);
    }
    assert.equal(f.messages.length, 0);
  } finally {
    await f.close();
  }
});

test("mail test emits progress and confirms local SMTP acceptance", async () => {
  const f = await fixture();
  const events: TestEvent[] = [];
  try {
    await runSMTPTest(f.config, (e) => events.push(e));
    assert.equal(f.messages.length, 1);
    assert.match(f.messages[0], /Subject: Simple SMTP Test/);
    assert.equal(events[0].type, "stage");
    const result = events.at(-1);
    assert.equal(result?.type, "done");
    if (result?.type === "done") {
      assert.equal(result.sent, true);
      assert.equal(result.success, true);
      assert.match(result.response!, /queued locally/);
    }
  } finally {
    await f.close();
  }
});

test("authentication failure is reported and sends no email", async () => {
  const f = await fixture({ rejectAuth: true });
  const events: TestEvent[] = [];
  try {
    await runSMTPTest(
      { ...f.config, authenticate: true, username: "test-user", password: "secret-value" },
      (e) => events.push(e),
    );
    const result = events.at(-1);
    if (result?.type !== "done") assert.fail("No outcome");
    assert.equal(result.success, false);
    assert.equal(result.code, "EAUTH");
    assert.equal(f.messages.length, 0);
    assert.equal(result.connected, true);
    assert.equal(result.authenticated, false);
    assert.doesNotMatch(JSON.stringify(events), /secret-value|test-user/);
  } finally {
    await f.close();
  }
});

test("STARTTLS cannot silently downgrade on a plain SMTP server", async () => {
  const f = await fixture();
  const events: TestEvent[] = [];
  try {
    await runSMTPTest({ ...f.config, mode: "connection", security: "starttls" }, (e) =>
      events.push(e),
    );
    // Fixture accepts STARTTLS as an unknown command, causing TLS negotiation to fail.
    const result = events.at(-1);
    if (result?.type !== "done") assert.fail("No outcome");
    assert.equal(result.success, false);
    assert.equal(f.messages.length, 0);
  } finally {
    await f.close();
  }
});

test("rejected recipient retains verified connection but fails mail stage", async () => {
  const f = await fixture({ rejectRecipient: true });
  const events: TestEvent[] = [];
  try {
    await runSMTPTest(f.config, (e) => events.push(e));
    const result = events.at(-1);
    if (result?.type !== "done") assert.fail("No outcome");
    assert.equal(result.connected, true);
    assert.equal(result.sent, false);
    assert.equal(result.success, false);
    assert.equal(f.messages.length, 0);
  } finally {
    await f.close();
  }
});

test("validation permits blank mail fields only for connection tests", () => {
  assert.equal(
    configSchema.safeParse({ ...defaults, host: "localhost", mode: "connection" }).success,
    true,
  );
  assert.equal(
    configSchema.safeParse({ ...defaults, host: "localhost", mode: "mail" }).success,
    false,
  );
  assert.equal(
    configSchema.safeParse({ ...defaults, host: "https://localhost/", mode: "connection" }).success,
    false,
  );
  assert.equal(
    configSchema.safeParse({ ...defaults, host: "localhost", port: 0, mode: "connection" }).success,
    false,
  );
});

test("redaction removes passwords and SMTP auth payloads", () => {
  const c = { ...defaults, username: "alice", password: "Secret123", authenticate: true };
  const payload = Buffer.from("\0alice\0Secret123").toString("base64");
  const text = redact(`alice Secret123 ${payload}`, c);
  assert.equal(text, "[redacted] [redacted] [redacted]");
});

test("API rejects invalid input and foreign origins before SMTP work", async () => {
  const app = createApp();
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    assert.equal((await fetch(url + "/api/health")).status, 200);
    const invalid = await fetch(url + "/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    assert.equal(invalid.status, 400);
    const crossOrigin = await fetch(url + "/api/test", {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "https://other.example" },
      body: "{}",
    });
    assert.equal(crossOrigin.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
