"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "server.js");
const TEST_ADMIN_USERNAME = "admin";
const TEST_ADMIN_PASSWORD = "test-admin-pass";
const TEST_ADMIN_PASSWORD_HASH = "scrypt:0123456789abcdeffedcba9876543210:1b8da2d25cf5bf40cecd23f19fbd6f225b891a051f41153d3cfb4b3ca8e8950fc8a851e67509171cd20a3484e9d9fecc8577c03810b52327fbfe3bb1b18bc7ff";

const SAMPLE_BUNDLES = {
  Alice_1: {
    publicKey: Buffer.alloc(65, 7).toString("base64"),
    privateKeySalt: Buffer.alloc(16, 1).toString("base64"),
    privateKeyIv: Buffer.alloc(12, 2).toString("base64"),
    encryptedPrivateKey: Buffer.alloc(160, 3).toString("base64")
  },
  Alice: {
    publicKey: Buffer.alloc(65, 9).toString("base64"),
    privateKeySalt: Buffer.alloc(16, 4).toString("base64"),
    privateKeyIv: Buffer.alloc(12, 5).toString("base64"),
    encryptedPrivateKey: Buffer.alloc(160, 6).toString("base64")
  },
  Bob: {
    publicKey: Buffer.alloc(65, 8).toString("base64"),
    privateKeySalt: Buffer.alloc(16, 7).toString("base64"),
    privateKeyIv: Buffer.alloc(12, 8).toString("base64"),
    encryptedPrivateKey: Buffer.alloc(160, 9).toString("base64")
  }
};

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeEncryptedPayload(fillByte) {
  return {
    nonce: Buffer.alloc(12, fillByte).toString("base64"),
    ciphertext: Buffer.alloc(64, fillByte + 1).toString("base64")
  };
}

async function waitForHealth(port, serverProcess) {
  const url = `http://127.0.0.1:${port}/health`;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5000) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`server exited with code ${serverProcess.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) {
        return;
      }
    } catch (error) {
      await delay(80);
    }
  }
  throw new Error("server did not become ready");
}

async function startServer(envOverrides = {}) {
  const port = 3200 + Math.floor(Math.random() * 1200);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-site-test-"));
  const serverProcess = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_USERNAME: TEST_ADMIN_USERNAME,
      ADMIN_PASSWORD_HASH: TEST_ADMIN_PASSWORD_HASH,
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await waitForHealth(port, serverProcess);

  return {
    port,
    stop: async () => {
      if (serverProcess.exitCode === null) {
        serverProcess.kill();
        await delay(80);
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

async function startServerAndWaitForExit(envOverrides = {}) {
  const port = 3200 + Math.floor(Math.random() * 1200);
  const dataDir = typeof envOverrides.DATA_DIR === "string" && envOverrides.DATA_DIR
    ? envOverrides.DATA_DIR
    : fs.mkdtempSync(path.join(os.tmpdir(), "chat-site-test-"));
  const serverProcess = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      ADMIN_USERNAME: TEST_ADMIN_USERNAME,
      ADMIN_PASSWORD_HASH: TEST_ADMIN_PASSWORD_HASH,
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let stderrText = "";
  serverProcess.stderr.on("data", (chunk) => {
    stderrText += chunk.toString("utf8");
  });

  const exitCode = await Promise.race([
    new Promise((resolve) => {
      serverProcess.on("exit", (code) => resolve(code));
    }),
    delay(5000).then(() => {
      serverProcess.kill();
      return null;
    })
  ]);

  if (!envOverrides.DATA_DIR) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
  return { exitCode, stderr: stderrText };
}

test("server fails fast on malformed data files", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-site-bad-data-"));
  fs.writeFileSync(path.join(dataDir, "users.json"), "{not valid json", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "admin_audit.jsonl"), "", "utf8");

  try {
    const result = await startServerAndWaitForExit({
      DATA_DIR: dataDir
    });

    assert.notEqual(result.exitCode, 0);
    assert.match(result.stderr, /failed to parse JSON file .*users\.json/i);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("existing legacy plaintext-only messages remain readable after upgrade", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-site-legacy-data-"));
  const seeded = await startServer({ DATA_DIR: dataDir });
  try {
    const registerA = await postJson(seeded.port, "/api/register", {
      username: "LegacyA",
      password: "pass1234",
      ...SAMPLE_BUNDLES.Alice
    });
    const registerB = await postJson(seeded.port, "/api/register", {
      username: "LegacyB",
      password: "pass1234",
      ...SAMPLE_BUNDLES.Bob
    });
    assert.equal(registerA.status, 201);
    assert.equal(registerB.status, 201);
  } finally {
    await seeded.stop();
  }
  fs.writeFileSync(
    path.join(dataDir, "users.json"),
    fs.readFileSync(path.join(dataDir, "users.json"), "utf8"),
    "utf8"
  );
  fs.writeFileSync(
    path.join(dataDir, "messages.json"),
    JSON.stringify([
      {
        id: "legacy-msg-1",
        from: "LegacyA",
        to: "LegacyB",
        text: "legacy plaintext",
        createdAt: Date.now() - 1000,
        clientId: ""
      }
    ], null, 2),
    "utf8"
  );
  fs.writeFileSync(path.join(dataDir, "messages.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(dataDir, "admin_audit.jsonl"), "", "utf8");

  const upgraded = await startServer({ DATA_DIR: dataDir });
  try {
    const login = await postJson(upgraded.port, "/api/login", {
      username: "LegacyB",
      password: "pass1234"
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const history = await getJson(upgraded.port, "/api/messages?with=LegacyA", token);
    assert.equal(history.response.status, 200);
    assert.equal(history.json.messages.length, 1);
    assert.equal(history.json.messages[0].text, "legacy plaintext");
    assert.equal(history.json.messages[0].ciphertext, undefined);
  } finally {
    await upgraded.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

async function createEventsTicket(port, token) {
  const response = await postJson(port, "/api/events/token", {}, token);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.ok(payload.ticket);
  return payload.ticket;
}

async function openEvents(port, token) {
  const events = [];
  let buffer = "";
  let request;
  const ticket = await createEventsTicket(port, token);

  const ready = new Promise((resolve, reject) => {
    request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/events?ticket=${encodeURIComponent(ticket)}`,
        headers: { Accept: "text/event-stream" }
      },
      (response) => {
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          buffer += chunk;
          const packets = buffer.split("\n\n");
          buffer = packets.pop() || "";
          for (const packet of packets) {
            const event = parseSsePacket(packet);
            if (event) {
              events.push(event);
            }
          }
        });
        resolve();
      }
    );
    request.on("error", reject);
  });

  return {
    ready,
    events,
    close: () => request.destroy()
  };
}

function parseSsePacket(packet) {
  const eventLine = packet.split("\n").find((line) => line.startsWith("event: "));
  const dataLine = packet.split("\n").find((line) => line.startsWith("data: "));
  if (!eventLine || !dataLine) {
    return null;
  }
  return {
    event: eventLine.slice(7),
    data: JSON.parse(dataLine.slice(6))
  };
}

async function waitForEvent(client, eventName, predicate = () => true) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 3000) {
    const match = client.events.find((event) => event.event === eventName && predicate(event.data));
    if (match) {
      return match.data;
    }
    await delay(30);
  }
  throw new Error(`timed out waiting for ${eventName}`);
}

async function postJson(port, pathname, body, token = "") {
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(body)
  });
}

async function postJsonWithOptions(port, pathname, body, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
    ...(options.cookie ? { Cookie: options.cookie } : {})
  };
  return fetch(`http://127.0.0.1:${port}${pathname}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

async function getJson(port, pathname, token = "") {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return {
    response,
    json: await response.json()
  };
}

async function getJsonWithOptions(port, pathname, options = {}) {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.cookie ? { Cookie: options.cookie } : {})
    }
  });
  return {
    response,
    json: await response.json()
  };
}

async function postJsonAndRead(port, pathname, body, token = "") {
  const response = await postJson(port, pathname, body, token);
  return {
    response,
    json: await response.json()
  };
}

test("register and login require unique usernames and return encrypted key bundles", async () => {
  const server = await startServer();

  try {
    const register = await postJson(server.port, "/api/register", {
      username: "Alice_1",
      password: "pass1234",
      ...SAMPLE_BUNDLES.Alice_1
    });
    assert.equal(register.status, 201);
    const registerBody = await register.json();
    assert.equal(registerBody.user.username, "Alice_1");
    assert.ok(registerBody.user.publicKey);
    assert.ok(registerBody.token);
    assert.deepEqual(registerBody.keyBundle, SAMPLE_BUNDLES.Alice_1);
    const registerCookie = register.headers.get("set-cookie") || "";
    assert.match(registerCookie, /secure_chat_session=/);
    assert.match(registerCookie, /HttpOnly/);
    assert.match(registerCookie, /SameSite=Lax/);

    const duplicate = await postJson(server.port, "/api/register", {
      username: "alice_1",
      password: "different",
      ...SAMPLE_BUNDLES.Bob
    });
    assert.equal(duplicate.status, 409);

    const login = await postJson(server.port, "/api/login", {
      username: "ALICE_1",
      password: "pass1234"
    });
    assert.equal(login.status, 200);
    const loginBody = await login.json();
    assert.equal(loginBody.user.username, "Alice_1");
    assert.deepEqual(loginBody.keyBundle, SAMPLE_BUNDLES.Alice_1);

    const aliasLogin = await postJson(server.port, "/api/login", {
      account: "alice_1",
      password: "pass1234"
    });
    assert.equal(aliasLogin.status, 200);

    const me = await getJson(server.port, "/api/me", loginBody.token);
    assert.equal(me.response.status, 200);
    assert.equal(me.json.user.username, "Alice_1");
    assert.equal(me.json.user.publicKey, SAMPLE_BUNDLES.Alice_1.publicKey);

    const cookieMeResponse = await fetch(`http://127.0.0.1:${server.port}/api/me`, {
      headers: { Cookie: registerCookie.split(";")[0] }
    });
    assert.equal(cookieMeResponse.status, 200);
    assert.equal((await cookieMeResponse.json()).user.username, "Alice_1");

    const keyBundle = await getJson(server.port, "/api/me/key-bundle", loginBody.token);
    assert.equal(keyBundle.response.status, 200);
    assert.equal(keyBundle.json.user.username, "Alice_1");
    assert.deepEqual(keyBundle.json.keyBundle, SAMPLE_BUNDLES.Alice_1);
  } finally {
    await server.stop();
  }
});

test("private messaging relays ciphertext and enforces encrypted payloads", async () => {
  const server = await startServer();

  try {
    const aliceRegister = await postJson(server.port, "/api/register", {
      username: "Alice",
      password: "hello123",
      ...SAMPLE_BUNDLES.Alice
    });
    const bobRegister = await postJson(server.port, "/api/register", {
      username: "Bob",
      password: "world123",
      ...SAMPLE_BUNDLES.Bob
    });
    const aliceBody = await aliceRegister.json();
    const bobBody = await bobRegister.json();
    const aliceToken = aliceBody.token;
    const bobToken = bobBody.token;

    const aliceEvents = await openEvents(server.port, aliceToken);
    const bobEvents = await openEvents(server.port, bobToken);

    await Promise.all([aliceEvents.ready, bobEvents.ready]);
    const readyPayload = await waitForEvent(aliceEvents, "ready");
    assert.equal(readyPayload.me, "Alice");

    const search = await getJson(server.port, "/api/users?q=bo", aliceToken);
    assert.equal(search.response.status, 200);
    assert.equal(search.json.users[0].username, "Bob");
    assert.equal(search.json.users[0].publicKey, SAMPLE_BUNDLES.Bob.publicKey);

    const firstEncrypted = makeEncryptedPayload(11);
    const send = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        clientId: "client-msg-1",
        nonce: firstEncrypted.nonce,
        ciphertext: firstEncrypted.ciphertext
      },
      aliceToken
    );
    assert.equal(send.status, 201);
    const sendBody = await send.json();
    assert.equal(sendBody.message.peer, "Bob");
    assert.equal(sendBody.message.text, null);
    assert.equal(sendBody.message.nonce, firstEncrypted.nonce);
    assert.equal(sendBody.message.ciphertext, firstEncrypted.ciphertext);
    assert.equal(sendBody.message.publicKey, SAMPLE_BUNDLES.Bob.publicKey);
    assert.equal(sendBody.conversation.latestMessage.text, null);
    assert.equal(sendBody.conversation.latestMessage.ciphertext, firstEncrypted.ciphertext);

    const duplicateSend = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        clientId: "client-msg-1",
        nonce: firstEncrypted.nonce,
        ciphertext: firstEncrypted.ciphertext
      },
      aliceToken
    );
    assert.equal(duplicateSend.status, 200);
    const duplicateBody = await duplicateSend.json();
    assert.equal(duplicateBody.message.id, sendBody.message.id);
    assert.equal(duplicateBody.message.clientId, "client-msg-1");

    const shortCiphertextMessage = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        nonce: Buffer.alloc(12, 33).toString("base64"),
        ciphertext: Buffer.alloc(16, 34).toString("base64")
      },
      aliceToken
    );
    assert.equal(shortCiphertextMessage.status, 201);

    const bulkPayloads = Array.from({ length: 6 }, (_, index) => ({
      to: "Bob",
      ...makeEncryptedPayload(40 + index)
    }));
    const bulkSends = await Promise.all(
      bulkPayloads.map((body) => postJson(server.port, "/api/messages", body, aliceToken))
    );
    for (const response of bulkSends) {
      assert.equal(response.status, 201);
    }

    const missingCiphertext = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        nonce: makeEncryptedPayload(90).nonce
      },
      aliceToken
    );
    assert.equal(missingCiphertext.status, 400);
    assert.equal((await missingCiphertext.json()).error, "invalid message payload");

    const plaintextOnly = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        text: "hello"
      },
      aliceToken
    );
    assert.equal(plaintextOnly.status, 400);
    assert.equal((await plaintextOnly.json()).error, "invalid message payload");

    const invalidNonce = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        nonce: "bad",
        ciphertext: makeEncryptedPayload(91).ciphertext
      },
      aliceToken
    );
    assert.equal(invalidNonce.status, 400);
    assert.equal((await invalidNonce.json()).error, "invalid message payload");

    const hugePayload = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        nonce: makeEncryptedPayload(92).nonce,
        ciphertext: "x".repeat(140000)
      },
      aliceToken
    );
    assert.equal(hugePayload.status, 413);
    assert.equal((await hugePayload.json()).error, "body too large");

    const crossOrigin = await fetch(`http://127.0.0.1:${server.port}/api/users?q=bo`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        Origin: "https://evil.example"
      }
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal((await crossOrigin.json()).error, "forbidden origin");

    const incoming = await waitForEvent(
      bobEvents,
      "message",
      (payload) => payload.from === "Alice" && payload.ciphertext === firstEncrypted.ciphertext
    );
    assert.equal(incoming.peer, "Alice");
    assert.equal(incoming.mine, false);
    assert.equal(incoming.publicKey, SAMPLE_BUNDLES.Alice.publicKey);
    assert.equal(incoming.text, null);
    assert.equal(incoming.nonce, firstEncrypted.nonce);
    assert.equal(incoming.ciphertext, firstEncrypted.ciphertext);

    const history = await getJson(server.port, "/api/messages?with=Alice", bobToken);
    assert.equal(history.response.status, 200);
    assert.equal(history.json.peer.publicKey, SAMPLE_BUNDLES.Alice.publicKey);
    assert.equal(history.json.messages.length, 8);
    assert.equal(history.json.messages[0].ciphertext, firstEncrypted.ciphertext);
    assert.equal(history.json.messages[1].ciphertext, Buffer.alloc(16, 34).toString("base64"));
    assert.deepEqual(
      history.json.messages.slice(2).map((item) => item.ciphertext).sort(),
      bulkPayloads.map((item) => item.ciphertext).sort()
    );

    const page1 = await getJson(server.port, "/api/messages?with=Alice&limit=3", bobToken);
    assert.equal(page1.response.status, 200);
    assert.equal(page1.json.messages.length, 3);
    assert.equal(page1.json.hasMore, true);
    assert.ok(page1.json.nextBefore);

    const page2 = await getJson(
      server.port,
      `/api/messages?with=Alice&limit=3&before=${encodeURIComponent(page1.json.nextBefore)}`,
      bobToken
    );
    assert.equal(page2.response.status, 200);
    assert.equal(page2.json.messages.length, 3);
    assert.equal(page2.json.hasMore, true);
    assert.ok(page2.json.nextBefore);

    const page3 = await getJson(
      server.port,
      `/api/messages?with=Alice&limit=3&before=${encodeURIComponent(page2.json.nextBefore)}`,
      bobToken
    );
    assert.equal(page3.response.status, 200);
    assert.equal(page3.json.messages.length, 2);
    assert.equal(page3.json.hasMore, false);

    bobEvents.close();
    await delay(80);
    const disconnectedPayload = makeEncryptedPayload(120);
    const missed = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        nonce: disconnectedPayload.nonce,
        ciphertext: disconnectedPayload.ciphertext
      },
      aliceToken
    );
    assert.equal(missed.status, 201);

    const bobEventsAfterReconnect = await openEvents(server.port, bobToken);
    await bobEventsAfterReconnect.ready;
    const reconnectPayload = makeEncryptedPayload(121);
    await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        nonce: reconnectPayload.nonce,
        ciphertext: reconnectPayload.ciphertext
      },
      aliceToken
    );
    const postReconnect = await waitForEvent(
      bobEventsAfterReconnect,
      "message",
      (payload) => payload.ciphertext === reconnectPayload.ciphertext
    );
    assert.equal(postReconnect.from, "Alice");

    const historyAfterReconnect = await getJson(server.port, "/api/messages?with=Alice", bobToken);
    assert.equal(historyAfterReconnect.response.status, 200);
    assert.ok(
      historyAfterReconnect.json.messages.some((item) => item.ciphertext === disconnectedPayload.ciphertext)
    );
    bobEventsAfterReconnect.close();

    const conversations = await getJson(server.port, "/api/conversations", aliceToken);
    assert.equal(conversations.response.status, 200);
    assert.equal(conversations.json.conversations.length, 1);
    assert.equal(conversations.json.conversations[0].username, "Bob");
    assert.equal(conversations.json.conversations[0].publicKey, SAMPLE_BUNDLES.Bob.publicKey);
    assert.equal(conversations.json.conversations[0].latestMessage.text, null);
    assert.equal(conversations.json.conversations[0].latestMessage.ciphertext, reconnectPayload.ciphertext);
  } finally {
    await server.stop();
  }
});

test("session expires and is rejected after ttl", async () => {
  const server = await startServer({ SESSION_TTL_MS: "1200" });

  try {
    const register = await postJson(server.port, "/api/register", {
      username: "Alice_2",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 21).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 22).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 23).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 24).toString("base64")
    });
    assert.equal(register.status, 201);
    const { token } = await register.json();
    await delay(1400);
    const me = await getJson(server.port, "/api/me", token);
    assert.equal(me.response.status, 401);
    assert.equal(me.json.error, "session expired");
  } finally {
    await server.stop();
  }
});

test("per-conversation message rate limit returns 429 when exceeded", async () => {
  const server = await startServer({ MAX_MESSAGES_PER_CONVERSATION_WINDOW: "2" });

  try {
    const aliceRegister = await postJson(server.port, "/api/register", {
      username: "AliceL",
      password: "hello123",
      publicKey: Buffer.alloc(65, 11).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 12).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 13).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 14).toString("base64")
    });
    const bobRegister = await postJson(server.port, "/api/register", {
      username: "BobL",
      password: "world123",
      publicKey: Buffer.alloc(65, 15).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 16).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 17).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 18).toString("base64")
    });

    const aliceToken = (await aliceRegister.json()).token;
    await bobRegister.json();

    const first = await postJson(server.port, "/api/messages", { to: "BobL", ...makeEncryptedPayload(31) }, aliceToken);
    const second = await postJson(server.port, "/api/messages", { to: "BobL", ...makeEncryptedPayload(32) }, aliceToken);
    const third = await postJson(server.port, "/api/messages", { to: "BobL", ...makeEncryptedPayload(33) }, aliceToken);

    assert.equal(first.status, 201);
    assert.equal(second.status, 201);
    assert.equal(third.status, 429);
    assert.equal((await third.json()).error, "too many messages sent");
  } finally {
    await server.stop();
  }
});

test("admin can login, view stats/messages and ban users", async () => {
  const server = await startServer();

  try {
    const aliceRegister = await postJson(server.port, "/api/register", {
      username: "AdminA",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 41).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 42).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 43).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 44).toString("base64")
    });
    const bobRegister = await postJson(server.port, "/api/register", {
      username: "AdminB",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 45).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 46).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 47).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 48).toString("base64")
    });
    const aliceToken = (await aliceRegister.json()).token;
    await bobRegister.json();

    const message = await postJson(
      server.port,
      "/api/messages",
      { to: "AdminB", text: "admin-visible-text", ...makeEncryptedPayload(52) },
      aliceToken
    );
    assert.equal(message.status, 201);
    const messageBody = await message.json();

    const adminLogin = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = (await adminLogin.json()).token;
    assert.ok(adminToken);

    const stats = await getJson(server.port, "/api/admin/stats", adminToken);
    assert.equal(stats.response.status, 200);
    assert.ok(stats.json.stats.users >= 2);
    assert.ok(stats.json.stats.messages >= 1);

    const health = await getJson(server.port, "/api/admin/health", adminToken);
    assert.equal(health.response.status, 200);
    assert.equal(health.json.health.ok, true);
    assert.ok(health.json.health.uptimeSeconds >= 0);
    assert.ok(health.json.health.files.messagesLogBytes >= 0);

    const dashboard = await getJson(server.port, "/api/admin/dashboard/stats", adminToken);
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.json.dashboard.currentAdmin.username, TEST_ADMIN_USERNAME);
    assert.ok(dashboard.json.dashboard.userTotal >= 2);
    assert.ok(Array.isArray(dashboard.json.dashboard.recentLogins));
    assert.ok(Array.isArray(dashboard.json.dashboard.recentUsers));
    assert.equal(typeof dashboard.json.dashboard.currentIp, "string");

    const users = await getJson(server.port, "/api/admin/users", adminToken);
    assert.equal(users.response.status, 200);
    assert.ok(users.json.users.some((item) => item.username === "AdminA"));

    const invalidBan = await fetch(`http://127.0.0.1:${server.port}/api/admin/users/AdminA`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ banned: "false" })
    });
    assert.equal(invalidBan.status, 400);
    assert.equal((await invalidBan.json()).error, "banned must be a boolean");

    const allMessages = await getJson(server.port, "/api/admin/messages?limit=20&mask=0", adminToken);
    assert.equal(allMessages.response.status, 200);
    assert.ok(allMessages.json.messages.some((item) => item.auditText === null));
    assert.ok(allMessages.json.messages.some((item) => item.ciphertext === messageBody.message.ciphertext));

    const banResponse = await fetch(`http://127.0.0.1:${server.port}/api/admin/users/AdminA`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ banned: true, bannedReason: "test-ban" })
    });
    assert.equal(banResponse.status, 200);

    const blockedLogin = await postJson(server.port, "/api/login", {
      username: "AdminA",
      password: "pass1234"
    });
    assert.equal(blockedLogin.status, 403);
    assert.equal((await blockedLogin.json()).error, "account banned");
  } finally {
    await server.stop();
  }
});

test("session auth prefers a valid cookie and falls back to a valid bearer token", async () => {
  const server = await startServer();

  try {
    const adminLogin = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(adminLogin.status, 200);
    const adminPayload = await adminLogin.json();
    const adminToken = String(adminPayload.token || "");
    const adminCookie = String(adminLogin.headers.get("set-cookie") || "").split(";")[0];
    assert.ok(adminToken);
    assert.ok(adminCookie);

    const validCookieInvalidBearer = await fetch(`http://127.0.0.1:${server.port}/api/admin/me`, {
      headers: {
        Cookie: adminCookie,
        Authorization: "Bearer stale-token"
      }
    });
    assert.equal(validCookieInvalidBearer.status, 200);
    assert.equal((await validCookieInvalidBearer.json()).admin.username, TEST_ADMIN_USERNAME);

    const invalidCookieValidBearer = await fetch(`http://127.0.0.1:${server.port}/api/admin/me`, {
      headers: {
        Cookie: "secure_chat_admin_session=stale-cookie",
        Authorization: `Bearer ${adminToken}`
      }
    });
    assert.equal(invalidCookieValidBearer.status, 200);
    assert.equal((await invalidCookieValidBearer.json()).admin.username, TEST_ADMIN_USERNAME);
  } finally {
    await server.stop();
  }
});

test("admin login accepts account alias and plain password configuration", async () => {
  const server = await startServer({
    ADMIN_PASSWORD_HASH: "",
    ADMIN_PASSWORD: "qwer@1234"
  });

  try {
    const login = await postJson(server.port, "/api/admin/login", {
      account: "admin",
      password: "qwer@1234"
    });
    assert.equal(login.status, 200);
    const payload = await login.json();
    assert.equal(payload.admin.username, "admin");

    const invalid = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: "bad-pass"
    });
    assert.equal(invalid.status, 401);
    assert.equal((await invalid.json()).error, "管理员账号或密码错误");
  } finally {
    await server.stop();
  }
});

test("admin rename broadcasts user rename and keeps the session synchronized", async () => {
  const server = await startServer();

  try {
    const aliceRegister = await postJson(server.port, "/api/register", {
      username: "RenameA",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 51).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 52).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 53).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 54).toString("base64")
    });
    const bobRegister = await postJson(server.port, "/api/register", {
      username: "RenameB",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 55).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 56).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 57).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 58).toString("base64")
    });
    const aliceToken = (await aliceRegister.json()).token;
    const bobToken = (await bobRegister.json()).token;

    const aliceEvents = await openEvents(server.port, aliceToken);
    const bobEvents = await openEvents(server.port, bobToken);
    await Promise.all([aliceEvents.ready, bobEvents.ready]);

    const adminLogin = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = (await adminLogin.json()).token;

    const renameResponse = await fetch(`http://127.0.0.1:${server.port}/api/admin/users/RenameB`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ username: "RenameC" })
    });
    assert.equal(renameResponse.status, 200);

    const renameEvent = await waitForEvent(aliceEvents, "user-renamed", (payload) => {
      return payload.previousUsername === "RenameB" && payload.username === "RenameC";
    });
    assert.equal(renameEvent.previousUsername, "RenameB");
    assert.equal(renameEvent.username, "RenameC");

    const renamedSession = await getJson(server.port, "/api/me", bobToken);
    assert.equal(renamedSession.response.status, 200);
    assert.equal(renamedSession.json.user.username, "RenameC");

    const renamedSend = await postJson(
      server.port,
      "/api/messages",
      { to: "RenameA", ...makeEncryptedPayload(63) },
      bobToken
    );
    assert.equal(renamedSend.status, 201);
    assert.equal((await renamedSend.json()).message.from, "RenameC");

    aliceEvents.close();
    bobEvents.close();
  } finally {
    await server.stop();
  }
});

test("admin credentials must come from environment configuration", async () => {
  const server = await startServer({
    ADMIN_USERNAME: "root_admin",
    ADMIN_PASSWORD_HASH: TEST_ADMIN_PASSWORD_HASH
  });

  try {
    const fixedLogin = await postJson(server.port, "/api/admin/login", {
      username: "root_admin",
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(fixedLogin.status, 200);
    const cookie = fixedLogin.headers.get("set-cookie") || "";
    assert.match(cookie, /secure_chat_admin_session=/);
    assert.match(cookie, /HttpOnly/);

    const me = await fetch(`http://127.0.0.1:${server.port}/api/admin/me`, {
      headers: { Cookie: cookie.split(";")[0] }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).admin.username, "root_admin");
  } finally {
    await server.stop();
  }
});

test("admin login works out of the box with the built-in default credentials", async () => {
  const server = await startServer({
    ADMIN_USERNAME: "",
    ADMIN_PASSWORD_HASH: "",
    ADMIN_PASSWORD: ""
  });

  try {
    const defaultLogin = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: "qwer@1234"
    });
    assert.equal(defaultLogin.status, 200);
    const payload = await defaultLogin.json();
    assert.equal(payload.admin.username, "admin");

    const wrongLogin = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: "not-the-default"
    });
    assert.equal(wrongLogin.status, 401);
    assert.equal((await wrongLogin.json()).error, "管理员账号或密码错误");
  } finally {
    await server.stop();
  }
});

test("admin account reset updates runtime credentials and prefers ADMIN_PASSWORD over stale hash", async () => {
  const server = await startServer({
    ADMIN_PASSWORD_HASH: TEST_ADMIN_PASSWORD_HASH,
    ADMIN_PASSWORD: "qwer@1234",
    ADMIN_UPDATE_PASSPHRASE: "test-passphrase",
    ADMIN_CONFIG_ENV_FILE: path.join(os.tmpdir(), `secure-chat-admin-${Date.now()}.env`)
  });

  try {
    const defaultLogin = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: "qwer@1234"
    });
    assert.equal(defaultLogin.status, 200);

    const reset = await postJson(server.port, "/api/admin/account/reset", {
      passphrase: "test-passphrase",
      username: "root_admin",
      password: "next-pass-123"
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).admin.username, "root_admin");

    const oldLogin = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: "qwer@1234"
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await postJson(server.port, "/api/admin/login", {
      username: "root_admin",
      password: "next-pass-123"
    });
    assert.equal(newLogin.status, 200);
  } finally {
    await server.stop();
  }
});

test("admin login and reset can recover from env file changes without restarting the process", async () => {
  const envFile = path.join(os.tmpdir(), `secure-chat-admin-runtime-${Date.now()}.env`);
  fs.writeFileSync(envFile, "ADMIN_USERNAME=admin\nADMIN_PASSWORD=qwer@1234\n", "utf8");
  const server = await startServer({
    ADMIN_USERNAME: "",
    ADMIN_PASSWORD: "",
    ADMIN_PASSWORD_HASH: "",
    ADMIN_UPDATE_PASSPHRASE: "",
    ADMIN_CONFIG_ENV_FILE: envFile
  });

  try {
    const defaultLogin = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: "qwer@1234"
    });
    assert.equal(defaultLogin.status, 200);

    fs.writeFileSync(
      envFile,
      "ADMIN_USERNAME=admin\nADMIN_PASSWORD=qwer@1234\nADMIN_UPDATE_PASSPHRASE=test-passphrase\n",
      "utf8"
    );

    const reset = await postJson(server.port, "/api/admin/account/reset", {
      passphrase: "test-passphrase",
      username: "root_admin",
      password: "next-pass-456"
    });
    assert.equal(reset.status, 200);

    const nextLogin = await postJson(server.port, "/api/admin/login", {
      username: "root_admin",
      password: "next-pass-456"
    });
    assert.equal(nextLogin.status, 200);
  } finally {
    fs.rmSync(envFile, { force: true });
    await server.stop();
  }
});

test("admin user pagination, batch ban and event ticket blocking work", async () => {
  const server = await startServer();
  try {
    const usersToCreate = ["BatchA", "BatchB", "BatchC"];
    const userTokens = {};
    for (let i = 0; i < usersToCreate.length; i += 1) {
      const username = usersToCreate[i];
      const register = await postJson(server.port, "/api/register", {
        username,
        password: "pass1234",
        publicKey: Buffer.alloc(65, 81 + i).toString("base64"),
        privateKeySalt: Buffer.alloc(16, 91 + i).toString("base64"),
        privateKeyIv: Buffer.alloc(12, 101 + i).toString("base64"),
        encryptedPrivateKey: Buffer.alloc(160, 111 + i).toString("base64")
      });
      assert.equal(register.status, 201);
      userTokens[username] = (await register.json()).token;
    }
    const ticketBeforeBan = await postJson(server.port, "/api/events/token", {}, userTokens.BatchA);
    assert.equal(ticketBeforeBan.status, 200);
    const ticketValue = (await ticketBeforeBan.json()).ticket;

    const adminLogin = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    const adminToken = (await adminLogin.json()).token;

    const page1 = await getJson(server.port, "/api/admin/users?limit=2&page=1&sort=username&order=asc", adminToken);
    assert.equal(page1.response.status, 200);
    assert.equal(page1.json.limit, 2);
    assert.ok(page1.json.total >= 3);
    assert.equal(page1.json.users.length, 2);

    const batchResponse = await fetch(`http://127.0.0.1:${server.port}/api/admin/users/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ usernames: ["BatchA", "BatchB"], banned: true, bannedReason: "batch-test" })
    });
    assert.equal(batchResponse.status, 200);
    const batchPayload = await batchResponse.json();
    assert.equal(batchPayload.updated, 2);

    const invalidBatch = await fetch(`http://127.0.0.1:${server.port}/api/admin/users/batch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ usernames: ["BatchA"], banned: "false" })
    });
    assert.equal(invalidBatch.status, 400);
    assert.equal((await invalidBatch.json()).error, "banned must be a boolean");

    const bannedOnly = await getJson(server.port, "/api/admin/users?status=banned&q=batch", adminToken);
    assert.equal(bannedOnly.response.status, 200);
    assert.ok(bannedOnly.json.users.length >= 2);

    const loginBlocked = await postJson(server.port, "/api/login", {
      username: "BatchA",
      password: "pass1234"
    });
    assert.equal(loginBlocked.status, 403);

    const oldTicketBlocked = await fetch(
      `http://127.0.0.1:${server.port}/api/events?ticket=${encodeURIComponent(ticketValue)}`
    );
    assert.ok([401, 403].includes(oldTicketBlocked.status));

    const bannedToken = userTokens.BatchA;
    const ticketResponse = await postJson(server.port, "/api/events/token", {}, bannedToken);
    assert.ok([401, 403].includes(ticketResponse.status));

    const exportResponse = await getJson(
      server.port,
      "/api/admin/messages/export?reason=investigation&from=BatchA",
      adminToken
    );
    assert.equal(exportResponse.response.status, 200);
    assert.ok(String(exportResponse.json.content || "").includes("EXPORT WATERMARK"));
    assert.ok(!String(exportResponse.json.content || "").includes("admin-visible-text"));
  } finally {
    await server.stop();
  }
});

test("access log collection stores client metadata and exposes admin analytics", async () => {
  const server = await startServer({
    ENABLE_ACCESS_LOG: "1"
  });

  try {
    const landing = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(landing.status, 200);
    const accessCookie = String(landing.headers.get("set-cookie") || "")
      .split(",")
      .find((item) => item.includes("secure_chat_visit="))?.split(";")[0] || "";
    assert.match(accessCookie, /secure_chat_visit=/);

    const metaResponse = await postJsonWithOptions(
      server.port,
      "/api/client-meta",
      {
        language: "zh-CN",
        screenResolution: "1440x900",
        timezone: "Asia/Shanghai",
        platform: "Windows"
      },
      {
        cookie: accessCookie
      }
    );
    assert.equal(metaResponse.status, 200);

    const register = await postJsonWithOptions(
      server.port,
      "/api/register",
      {
        username: "VisitorA",
        password: "pass1234",
        ...SAMPLE_BUNDLES.Alice
      },
      {
        cookie: accessCookie
      }
    );
    assert.equal(register.status, 201);
    const registerBody = await register.json();

    const conversations = await getJsonWithOptions(server.port, "/api/conversations", {
      token: registerBody.token,
      cookie: accessCookie
    });
    assert.equal(conversations.response.status, 200);

    const adminLogin = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = (await adminLogin.json()).token;

    await delay(250);

    const summary = await getJson(server.port, "/api/admin/access/summary", adminToken);
    assert.equal(summary.response.status, 200);
    assert.ok(summary.json.summary.totals.logRows >= 3);
    assert.ok(summary.json.summary.totals.pageViews >= 1);
    assert.ok(summary.json.summary.topPages.some((row) => row.path === "/"));

    const logs = await getJson(server.port, "/api/admin/access/logs?sessionId=" + encodeURIComponent(accessCookie.split("=")[1]), adminToken);
    assert.equal(logs.response.status, 200);
    assert.ok(logs.json.rows.length >= 1);
    assert.ok(logs.json.rows.some((row) => row.language === "zh-CN"));
    assert.ok(logs.json.rows.some((row) => row.userId === "VisitorA"));

    const profile = await getJson(server.port, "/api/admin/access/profile?userId=VisitorA", adminToken);
    assert.equal(profile.response.status, 200);
    assert.equal(profile.json.profile.userId, "VisitorA");
    assert.ok(profile.json.profile.visits >= 1);
    assert.equal(profile.json.profile.clientMeta.language, "zh-CN");
  } finally {
    await server.stop();
  }
});

test("login always runs password verification regardless of whether the account exists", async () => {
  const server = await startServer();

  try {
    const register = await postJson(server.port, "/api/register", {
      username: "TimingA",
      password: "rightpass1",
      publicKey: Buffer.alloc(65, 31).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 32).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 33).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 34).toString("base64")
    });
    assert.equal(register.status, 201);

    const existingWrong = await postJson(server.port, "/api/login", {
      username: "TimingA",
      password: "wrongpass1"
    });
    assert.equal(existingWrong.status, 401);
    assert.equal((await existingWrong.json()).error, "invalid username or password");

    const missingUser = await postJson(server.port, "/api/login", {
      username: "NoSuchUser",
      password: "wrongpass1"
    });
    assert.equal(missingUser.status, 401);
    assert.equal((await missingUser.json()).error, "invalid username or password");
  } finally {
    await server.stop();
  }
});

test("admin login locks the account after repeated failed attempts", async () => {
  const server = await startServer({
    ADMIN_LOGIN_MAX_FAILURES: "3",
    ADMIN_LOGIN_LOCKOUT_MS: "1200",
    ADMIN_LOGIN_FAILURE_WINDOW_MS: "60000"
  });

  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await postJson(server.port, "/api/admin/login", {
        username: TEST_ADMIN_USERNAME,
        password: "wrong-password"
      });
      assert.equal(failed.status, 401, `attempt ${attempt + 1} should be 401`);
    }
    const locked = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: "wrong-password"
    });
    assert.equal(locked.status, 429);
    assert.match((await locked.json()).error, /too many failed attempts/);

    const stillLocked = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(stillLocked.status, 429);

    await delay(1300);

    const recovered = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(recovered.status, 200);
  } finally {
    await server.stop();
  }
});

test("events ticket creation caps concurrent SSE connections per user", async () => {
  const server = await startServer({
    MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER: "2"
  });

  try {
    const register = await postJson(server.port, "/api/register", {
      username: "SseCap",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 71).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 72).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 73).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 74).toString("base64")
    });
    const token = (await register.json()).token;

    const first = await openEvents(server.port, token);
    const second = await openEvents(server.port, token);
    await Promise.all([first.ready, second.ready]);

    const rejected = await postJson(server.port, "/api/events/token", {}, token);
    assert.equal(rejected.status, 429);
    assert.equal((await rejected.json()).error, "too many concurrent connections");

    first.close();
    second.close();
    await delay(50);

    const allowed = await postJson(server.port, "/api/events/token", {}, token);
    assert.equal(allowed.status, 200);
  } finally {
    await server.stop();
  }
});

test("admin audit log uses HMAC and the chain verifies on startup", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-audit-test-"));
  const server = await startServer({
    DATA_DIR: dataDir,
    AUDIT_HMAC_KEY: ""
  });

  try {
    const adminLogin = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(adminLogin.status, 200);

    const adminLogout = await postJson(
      server.port,
      "/api/admin/logout",
      {},
      (await adminLogin.json()).token
    );
    assert.equal(adminLogout.status, 200);
  } finally {
    await server.stop();
  }

  const auditFile = path.join(dataDir, "admin_audit.jsonl");
  const lines = fs.readFileSync(auditFile, "utf8").split(/\r?\n/).filter(Boolean);
  assert.ok(lines.length >= 2);
  const entries = lines.map((line) => JSON.parse(line));
  for (const entry of entries) {
    assert.equal(entry.hashAlgo, "hmac-sha256");
    assert.match(entry.hash, /^[a-f0-9]{64}$/);
  }
  assert.equal(entries[0].prevHash, "GENESIS");
  for (let i = 1; i < entries.length; i += 1) {
    assert.equal(entries[i].prevHash, entries[i - 1].hash);
  }

  const verifyServer = await startServer({ DATA_DIR: dataDir });
  try {
    const health = await getJson(verifyServer.port, "/health", "");
    assert.equal(health.response.status, 200);
  } finally {
    await verifyServer.stop();
  }
});
