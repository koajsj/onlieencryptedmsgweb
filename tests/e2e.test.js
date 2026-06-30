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
const TEST_ADMIN_PLAIN_PASSWORD = "plain-admin-pass";
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
  },
  LogoutAllUser: {
    publicKey: Buffer.alloc(65, 31).toString("base64"),
    privateKeySalt: Buffer.alloc(16, 32).toString("base64"),
    privateKeyIv: Buffer.alloc(12, 33).toString("base64"),
    encryptedPrivateKey: Buffer.alloc(160, 34).toString("base64")
  },
  ResetByAdmin: {
    publicKey: Buffer.alloc(65, 35).toString("base64"),
    privateKeySalt: Buffer.alloc(16, 36).toString("base64"),
    privateKeyIv: Buffer.alloc(12, 37).toString("base64"),
    encryptedPrivateKey: Buffer.alloc(160, 38).toString("base64")
  }
};

test("browser client keeps authentication tokens out of web storage", () => {
  const appSource = fs.readFileSync(path.join(ROOT_DIR, "public", "app.js"), "utf8");
  assert.doesNotMatch(appSource, /sessionStorage\.setItem\([^\n]*session-token/);
  assert.doesNotMatch(appSource, /Authorization\s*=\s*`Bearer/);
  assert.match(appSource, /sessionStorage\.removeItem\("private-chat-session-token"\)/);
  assert.match(appSource, /payload\?\.error === "account banned"/);
});

test("mobile chat avoids viewport-scroll rerenders and duplicate message inserts", () => {
  const appSource = fs.readFileSync(path.join(ROOT_DIR, "public", "app.js"), "utf8");
  assert.doesNotMatch(appSource, /visualViewport\?\.addEventListener\("scroll",\s*scheduleResponsiveRender\)/);
  assert.match(appSource, /function upsertMessageInCache\(peer, incoming\)/);
  assert.match(appSource, /messagesShareIdentity\(message, payload\.message\)/);
  assert.match(appSource, /window\.innerWidth >= 768/);
  assert.match(appSource, /elements\.headerDetailsButton\?\.addEventListener\("click", openContactDetailsPanel\)/);
  assert.match(appSource, /LOCK_ICON_MARKUP/);
});

test("deployment defaults keep fixed admin credentials and update passphrase", () => {
  const configSource = fs.readFileSync(path.join(ROOT_DIR, "config.js"), "utf8");
  const deployScript = fs.readFileSync(path.join(ROOT_DIR, "scripts", "deploy-debian.sh"), "utf8");
  const updateScript = fs.readFileSync(path.join(ROOT_DIR, "scripts", "update-debian.sh"), "utf8");
  assert.match(configSource, /DEFAULT_ADMIN_PASSWORD_VALUE = "qwer@1234"/);
  assert.match(configSource, /DEFAULT_ADMIN_UPDATE_PASSPHRASE_VALUE = "admin"/);
  assert.match(deployScript, /ADMIN_PASSWORD="\$\{ADMIN_PASSWORD:-qwer@1234\}"/);
  assert.match(deployScript, /ADMIN_UPDATE_PASSPHRASE="\$\{ADMIN_UPDATE_PASSPHRASE:-admin\}"/);
  assert.match(updateScript, /ADMIN_PASSWORD="\$\{ADMIN_PASSWORD:-qwer@1234\}"/);
  assert.match(updateScript, /ADMIN_UPDATE_PASSPHRASE="\$\{ADMIN_UPDATE_PASSPHRASE:-admin\}"/);
});

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
      ALLOW_BEARER_AUTH: "1",
      ...envOverrides
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  await waitForHealth(port, serverProcess);

  return {
    port,
    stop: async () => {
      if (serverProcess.exitCode === null) {
        const exited = new Promise((resolve) => serverProcess.once("exit", resolve));
        serverProcess.kill("SIGTERM");
        const stoppedGracefully = await Promise.race([
          exited.then(() => true),
          delay(2000).then(() => false)
        ]);
        if (!stoppedGracefully && serverProcess.exitCode === null) {
          serverProcess.kill("SIGKILL");
          await exited;
        }
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
      ALLOW_BEARER_AUTH: "1",
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

test("static assets keep security headers and conditional caching", async () => {
  const server = await startServer();
  try {
    const page = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(page.status, 200);
    assert.match(String(page.headers.get("content-type") || ""), /^text\/html/);
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    const etag = page.headers.get("etag");
    assert.ok(etag);

    const cached = await fetch(`http://127.0.0.1:${server.port}/`, {
      headers: { "If-None-Match": etag }
    });
    assert.equal(cached.status, 304);
  } finally {
    await server.stop();
  }
});

test("cookie-only auth is secure by default and rejects bearer fallback", async () => {
  const server = await startServer({ ALLOW_BEARER_AUTH: "0" });
  try {
    const register = await postJson(server.port, "/api/register", {
      username: "CookieOnly",
      password: "pass1234",
      ...SAMPLE_BUNDLES.Alice
    });
    assert.equal(register.status, 201);
    const payload = await register.json();
    assert.equal(payload.token, undefined);

    const setCookie = String(register.headers.get("set-cookie") || "");
    assert.match(setCookie, /secure_chat_visit=/);
    assert.match(setCookie, /secure_chat_session=/);
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Strict/i);
    const sessionCookie = extractCookiePair(setCookie, "secure_chat_session");
    assert.ok(sessionCookie);

    const cookieMe = await getJsonWithOptions(server.port, "/api/me", { cookie: sessionCookie });
    assert.equal(cookieMe.response.status, 200);

    const bearerMe = await getJsonWithOptions(server.port, "/api/me", { token: "not-a-cookie-session" });
    assert.equal(bearerMe.response.status, 401);
  } finally {
    await server.stop();
  }
});

test("same-origin checks reject protocol downgrade", async () => {
  const server = await startServer();
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: `https://127.0.0.1:${server.port}`
      },
      body: JSON.stringify({ username: "Nobody", password: "invalid" })
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, "forbidden origin");
  } finally {
    await server.stop();
  }
});

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
  const ticket = await createEventsTicket(port, token);
  return openEventsWithTicket(port, ticket);
}

async function openEventsWithTicket(port, ticket) {
  const events = [];
  let buffer = "";
  let request;
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

async function redeemEventsTicket(port, ticket) {
  return new Promise((resolve, reject) => {
    const request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/events?ticket=${encodeURIComponent(ticket)}`,
        headers: { Accept: "text/event-stream" }
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch (error) {
            json = null;
          }
          resolve({
            status: Number(response.statusCode || 0),
            json
          });
        });
        if (response.statusCode === 200) {
          response.destroy();
          resolve({
            status: 200,
            json: null
          });
        }
      }
    );
    request.on("error", reject);
  });
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

function extractCookiePair(setCookieHeader, name) {
  const pattern = new RegExp(`(?:^|,\\s*)(${name}=[^;,]+)`);
  const match = String(setCookieHeader || "").match(pattern);
  return match ? match[1] : "";
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
    assert.match(registerCookie, /SameSite=Strict/);
    const registerSessionCookie = extractCookiePair(registerCookie, "secure_chat_session");
    assert.ok(registerSessionCookie);

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
      headers: { Cookie: registerSessionCookie }
    });
    assert.equal(cookieMeResponse.status, 200);
    assert.equal((await cookieMeResponse.json()).user.username, "Alice_1");

    const keyBundle = await getJson(server.port, "/api/me/key-bundle", loginBody.token);
    assert.equal(keyBundle.response.status, 200);
    assert.equal(keyBundle.json.user.username, "Alice_1");
    assert.deepEqual(keyBundle.json.keyBundle, SAMPLE_BUNDLES.Alice_1);

    const emptySearch = await getJson(server.port, "/api/users?q=", loginBody.token);
    assert.equal(emptySearch.response.status, 200);
    assert.deepEqual(emptySearch.json.users, []);
  } finally {
    await server.stop();
  }
});

test("concurrent registration keeps username unique", async () => {
  const server = await startServer();

  try {
    const responses = await Promise.all([
      postJson(server.port, "/api/register", {
        username: "ConcurrentUser",
        password: "pass1234",
        publicKey: Buffer.alloc(65, 121).toString("base64"),
        privateKeySalt: Buffer.alloc(16, 122).toString("base64"),
        privateKeyIv: Buffer.alloc(12, 123).toString("base64"),
        encryptedPrivateKey: Buffer.alloc(160, 124).toString("base64")
      }),
      postJson(server.port, "/api/register", {
        username: "concurrentuser",
        password: "pass5678",
        publicKey: Buffer.alloc(65, 125).toString("base64"),
        privateKeySalt: Buffer.alloc(16, 126).toString("base64"),
        privateKeyIv: Buffer.alloc(12, 127).toString("base64"),
        encryptedPrivateKey: Buffer.alloc(160, 128).toString("base64")
      })
    ]);
    const statuses = responses.map((response) => response.status).sort((left, right) => left - right);
    assert.deepEqual(statuses, [201, 409]);
    await Promise.all(responses.map((response) => response.json().catch(() => null)));

    const adminToken = (await postJsonAndRead(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    })).json.token;
    const users = await getJson(server.port, "/api/admin/users?q=concurrentuser", adminToken);
    assert.equal(users.response.status, 200);
    assert.equal(users.json.total, 1);
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

test("session expiry closes live SSE connections for expired tokens", async () => {
  const server = await startServer({ SESSION_TTL_MS: "1200" });

  try {
    const register = await postJsonAndRead(server.port, "/api/register", {
      username: "ExpireLiveUser",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 49).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 50).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 51).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 52).toString("base64")
    });
    assert.equal(register.response.status, 201);
    const token = register.json.token;

    const liveEvents = await openEvents(server.port, token);
    await liveEvents.ready;
    await waitForEvent(liveEvents, "ready", (payload) => payload.me === "ExpireLiveUser");
    await delay(1700);

    const systemEvent = await waitForEvent(liveEvents, "system", (payload) => payload.reason === "session expired");
    assert.equal(systemEvent.reason, "session expired");

    const me = await getJson(server.port, "/api/me", token);
    assert.equal(me.response.status, 401);
    liveEvents.close();
  } finally {
    await server.stop();
  }
});

test("password change revokes old sessions, rotates the current token and refreshes the cookie", async () => {
  const server = await startServer();
  try {
    const register = await postJsonAndRead(server.port, "/api/register", {
      username: "RotateMe",
      password: "hello123",
      publicKey: Buffer.alloc(65, 91).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 92).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 93).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 94).toString("base64")
    });
    const oldToken = register.json.token;
    const replacementBundle = {
      publicKey: Buffer.alloc(65, 91).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 95).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 96).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 97).toString("base64")
    };

    const changed = await postJsonAndRead(server.port, "/api/me/password", {
      currentPassword: "hello123",
      newPassword: "hello456",
      ...replacementBundle
    }, oldToken);
    assert.equal(changed.response.status, 200);
    assert.ok(changed.json.token);
    assert.notEqual(changed.json.token, oldToken);
    assert.match(String(changed.response.headers.get("set-cookie") || ""), /secure_chat_session=/);

    const oldSession = await getJson(server.port, "/api/me", oldToken);
    assert.equal(oldSession.response.status, 401);

    const refreshedSession = await fetch(`http://127.0.0.1:${server.port}/api/me`, {
      headers: {
        Authorization: `Bearer ${changed.json.token}`
      }
    });
    assert.equal(refreshedSession.status, 200);
    assert.match(String(refreshedSession.headers.get("set-cookie") || ""), /secure_chat_session=/);

    const oldPasswordLogin = await postJson(server.port, "/api/login", {
      username: "RotateMe",
      password: "hello123"
    });
    assert.equal(oldPasswordLogin.status, 401);

    const newPasswordLogin = await postJsonAndRead(server.port, "/api/login", {
      username: "RotateMe",
      password: "hello456"
    });
    assert.equal(newPasswordLogin.response.status, 200);
    assert.deepEqual(newPasswordLogin.json.keyBundle, replacementBundle);
  } finally {
    await server.stop();
  }
});

test("logout all revokes outstanding event tickets and active user sessions", async () => {
  const server = await startServer();
  try {
    const register = await postJsonAndRead(server.port, "/api/register", {
      username: "LogoutAllUser",
      password: "hello123",
      ...SAMPLE_BUNDLES.LogoutAllUser
    });
    assert.equal(register.response.status, 201);
    const userToken = register.json.token;

    const ticketResponse = await postJsonAndRead(server.port, "/api/events/token", {}, userToken);
    assert.equal(ticketResponse.response.status, 200);
    const ticket = String(ticketResponse.json.ticket || "");
    assert.ok(ticket);

    const logoutAll = await postJsonAndRead(server.port, "/api/logout-all", {}, userToken);
    assert.equal(logoutAll.response.status, 200);
    assert.ok(logoutAll.json.revoked >= 1);

    const expiredSession = await getJson(server.port, "/api/me", userToken);
    assert.equal(expiredSession.response.status, 401);

    const blockedTicket = await fetch(
      `http://127.0.0.1:${server.port}/api/events?ticket=${encodeURIComponent(ticket)}`
    );
    assert.equal(blockedTicket.status, 401);
  } finally {
    await server.stop();
  }
});

test("single-device logout closes the active SSE session for that token", async () => {
  const server = await startServer();
  try {
    const register = await postJsonAndRead(server.port, "/api/register", {
      username: "LogoutLiveUser",
      password: "hello123",
      publicKey: Buffer.alloc(65, 53).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 54).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 55).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 56).toString("base64")
    });
    assert.equal(register.response.status, 201);
    const userToken = register.json.token;

    const liveEvents = await openEvents(server.port, userToken);
    await liveEvents.ready;
    await waitForEvent(liveEvents, "ready", (payload) => payload.me === "LogoutLiveUser");

    const logout = await postJson(server.port, "/api/logout", {}, userToken);
    assert.equal(logout.status, 200);

    const systemEvent = await waitForEvent(liveEvents, "system", (payload) => payload.reason === "logged out");
    assert.equal(systemEvent.reason, "logged out");
    liveEvents.close();
  } finally {
    await server.stop();
  }
});

test("message recall persists across history reloads and rejects cross-origin requests", async () => {
  const server = await startServer();

  try {
    const aliceRegister = await postJson(server.port, "/api/register", {
      username: "RecallA",
      password: "hello123",
      publicKey: Buffer.alloc(65, 71).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 72).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 73).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 74).toString("base64")
    });
    const bobRegister = await postJson(server.port, "/api/register", {
      username: "RecallB",
      password: "world123",
      publicKey: Buffer.alloc(65, 75).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 76).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 77).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 78).toString("base64")
    });
    const aliceToken = (await aliceRegister.json()).token;
    const bobToken = (await bobRegister.json()).token;

    const encrypted = makeEncryptedPayload(79);
    const sent = await postJson(
      server.port,
      "/api/messages",
      {
        to: "RecallB",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      },
      aliceToken
    );
    assert.equal(sent.status, 201);
    const sentBody = await sent.json();
    const messageId = sentBody.message.id;
    assert.ok(messageId);

    const recall = await postJson(server.port, "/api/messages/recall", { messageId }, aliceToken);
    assert.equal(recall.status, 200);
    assert.equal((await recall.json()).ok, true);

    const aliceHistory = await getJson(server.port, "/api/messages?with=RecallB", aliceToken);
    assert.equal(aliceHistory.response.status, 200);
    assert.equal(aliceHistory.json.messages.length, 1);
    assert.equal(aliceHistory.json.messages[0].id, messageId);
    assert.equal(aliceHistory.json.messages[0].recalled, true);
    assert.equal(aliceHistory.json.messages[0].ciphertext, "");
    assert.equal(aliceHistory.json.messages[0].nonce, "");

    const bobHistory = await getJson(server.port, "/api/messages?with=RecallA", bobToken);
    assert.equal(bobHistory.response.status, 200);
    assert.equal(bobHistory.json.messages.length, 1);
    assert.equal(bobHistory.json.messages[0].recalled, true);

    const crossOriginRecall = await fetch(`http://127.0.0.1:${server.port}/api/messages/recall`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`,
        Origin: "https://evil.example"
      },
      body: JSON.stringify({ messageId })
    });
    assert.equal(crossOriginRecall.status, 403);
    assert.equal((await crossOriginRecall.json()).error, "forbidden origin");
  } finally {
    await server.stop();
  }
});

test("message delete hides only the current viewer and updates conversation summaries", async () => {
  const server = await startServer();

  try {
    const aliceRegister = await postJson(server.port, "/api/register", {
      username: "DeleteA",
      password: "hello123",
      publicKey: Buffer.alloc(65, 91).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 92).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 93).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 94).toString("base64")
    });
    const bobRegister = await postJson(server.port, "/api/register", {
      username: "DeleteB",
      password: "world123",
      publicKey: Buffer.alloc(65, 95).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 96).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 97).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 98).toString("base64")
    });
    const aliceToken = (await aliceRegister.json()).token;
    const bobToken = (await bobRegister.json()).token;

    const firstSend = await postJsonAndRead(
      server.port,
      "/api/messages",
      {
        to: "DeleteB",
        clientId: "delete-msg-1",
        ...makeEncryptedPayload(81)
      },
      aliceToken
    );
    const secondSend = await postJsonAndRead(
      server.port,
      "/api/messages",
      {
        to: "DeleteB",
        clientId: "delete-msg-2",
        ...makeEncryptedPayload(83)
      },
      aliceToken
    );
    assert.equal(firstSend.response.status, 201);
    assert.equal(secondSend.response.status, 201);

    const deletion = await postJson(
      server.port,
      "/api/messages/delete",
      { messageId: secondSend.json.message.id },
      bobToken
    );
    assert.equal(deletion.status, 200);
    assert.equal((await deletion.json()).ok, true);

    const bobHistory = await getJson(server.port, "/api/messages?with=DeleteA", bobToken);
    assert.equal(bobHistory.response.status, 200);
    assert.equal(bobHistory.json.messages.length, 1);
    assert.equal(bobHistory.json.messages[0].id, firstSend.json.message.id);

    const aliceHistory = await getJson(server.port, "/api/messages?with=DeleteB", aliceToken);
    assert.equal(aliceHistory.response.status, 200);
    assert.equal(aliceHistory.json.messages.length, 2);
    assert.equal(aliceHistory.json.messages[1].id, secondSend.json.message.id);

    const bobConversations = await getJson(server.port, "/api/conversations", bobToken);
    assert.equal(bobConversations.response.status, 200);
    const bobConversation = bobConversations.json.conversations.find((item) => item.username === "DeleteA");
    assert.ok(bobConversation);
    assert.equal(bobConversation.latestMessage.id, firstSend.json.message.id);

    const crossOriginDelete = await fetch(`http://127.0.0.1:${server.port}/api/messages/delete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bobToken}`,
        Origin: "https://evil.example"
      },
      body: JSON.stringify({ messageId: firstSend.json.message.id })
    });
    assert.equal(crossOriginDelete.status, 403);
    assert.equal((await crossOriginDelete.json()).error, "forbidden origin");
  } finally {
    await server.stop();
  }
});

test("read receipts clear server unread counts and persist for both sides", async () => {
  const server = await startServer();
  try {
    const left = await postJsonAndRead(server.port, "/api/register", {
      username: "ReadLeft",
      password: "hello123",
      publicKey: Buffer.alloc(65, 111).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 112).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 113).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 114).toString("base64")
    });
    const right = await postJsonAndRead(server.port, "/api/register", {
      username: "ReadRight",
      password: "world123",
      publicKey: Buffer.alloc(65, 115).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 116).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 117).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 118).toString("base64")
    });
    const leftToken = left.json.token;
    const rightToken = right.json.token;
    const rightMirror = await openEvents(server.port, rightToken);
    await rightMirror.ready;
    assert.equal((await postJson(server.port, "/api/messages", {
      to: "ReadRight",
      clientId: "read-receipt-1",
      ...makeEncryptedPayload(119)
    }, leftToken)).status, 201);

    const unread = await getJson(server.port, "/api/conversations", rightToken);
    assert.equal(unread.json.conversations[0].unread, 1);
    const marked = await postJsonAndRead(server.port, "/api/messages/read", { peer: "ReadLeft" }, rightToken);
    assert.equal(marked.response.status, 200);
    assert.equal(marked.json.count, 1);
    const mirroredRead = await waitForEvent(
      rightMirror,
      "conversation-read",
      (payload) => payload.peer === "ReadLeft" && Array.isArray(payload.messageIds) && payload.messageIds.length === 1
    );
    assert.ok(mirroredRead.readAt > 0);
    const cleared = await getJson(server.port, "/api/conversations", rightToken);
    assert.equal(cleared.json.conversations[0].unread, 0);
    const senderHistory = await getJson(server.port, "/api/messages?with=ReadRight", leftToken);
    assert.ok(senderHistory.json.messages[0].readAt > 0);
    rightMirror.close();
  } finally {
    await server.stop();
  }
});

test("blocks suppress delivery and read receipts", async () => {
  const server = await startServer();
  try {
    const sender = await postJsonAndRead(server.port, "/api/register", {
      username: "ReceiptBlockA",
      password: "hello123",
      publicKey: Buffer.alloc(65, 131).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 132).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 133).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 134).toString("base64")
    });
    const recipient = await postJsonAndRead(server.port, "/api/register", {
      username: "ReceiptBlockB",
      password: "world123",
      publicKey: Buffer.alloc(65, 135).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 136).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 137).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 138).toString("base64")
    });
    const senderToken = sender.json.token;
    const recipientToken = recipient.json.token;

    const sent = await postJsonAndRead(server.port, "/api/messages", {
      to: "ReceiptBlockB",
      clientId: "blocked-receipt-1",
      ...makeEncryptedPayload(139)
    }, senderToken);
    assert.equal(sent.response.status, 201);
    assert.equal(sent.json.message.deliveredAt, 0);
    const unreadBeforeBlock = await getJson(server.port, "/api/conversations", recipientToken);
    assert.equal(unreadBeforeBlock.response.status, 200);
    assert.equal(unreadBeforeBlock.json.conversations[0].unread, 1);

    const block = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ReceiptBlockA/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${recipientToken}` },
      body: JSON.stringify({ blocked: true })
    });
    assert.equal(block.status, 200);
    const unreadAfterBlock = await getJson(server.port, "/api/conversations", recipientToken);
    assert.equal(unreadAfterBlock.response.status, 200);
    assert.equal(unreadAfterBlock.json.conversations[0].unread, 0);

    const recipientEvents = await openEvents(server.port, recipientToken);
    await recipientEvents.ready;
    await delay(200);
    recipientEvents.close();

    const marked = await postJsonAndRead(server.port, "/api/messages/read", { peer: "ReceiptBlockA" }, recipientToken);
    assert.equal(marked.response.status, 200);
    assert.equal(marked.json.count, 0);

    const senderHistory = await getJson(server.port, "/api/messages?with=ReceiptBlockB", senderToken);
    assert.equal(senderHistory.response.status, 200);
    assert.equal(senderHistory.json.messages[0].deliveredAt, 0);
    assert.equal(senderHistory.json.messages[0].readAt, 0);
  } finally {
    await server.stop();
  }
});

test("contacts endpoints enforce same-origin and support note, block and delete flows", async () => {
  const server = await startServer();

  try {
    const aliceRegister = await postJson(server.port, "/api/register", {
      username: "ContactA",
      password: "hello123",
      publicKey: Buffer.alloc(65, 101).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 102).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 103).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 104).toString("base64")
    });
    const bobRegister = await postJson(server.port, "/api/register", {
      username: "ContactB",
      password: "world123",
      publicKey: Buffer.alloc(65, 105).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 106).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 107).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 108).toString("base64")
    });
    const aliceToken = (await aliceRegister.json()).token;
    const bobToken = (await bobRegister.json()).token;

    const addContact = await postJson(server.port, "/api/contacts", { username: "ContactB" }, aliceToken);
    assert.equal(addContact.status, 201);
    const duplicateContact = await postJson(server.port, "/api/contacts", { username: "ContactB" }, aliceToken);
    assert.equal(duplicateContact.status, 409);
    assert.equal((await duplicateContact.json()).error, "already a contact");
    assert.equal((await postJson(server.port, "/api/contacts", { username: "ContactA" }, bobToken)).status, 201);

    const noteUpdate = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ContactB`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ note: "同事", pinned: true, muted: true })
    });
    assert.equal(noteUpdate.status, 200);
    const notePayload = await noteUpdate.json();
    assert.equal(notePayload.entry.note, "同事");
    assert.equal(notePayload.contact.username, "ContactB");

    const contactsAfterNote = await getJson(server.port, "/api/contacts", aliceToken);
    assert.equal(contactsAfterNote.response.status, 200);
    assert.equal(contactsAfterNote.json.contacts.length, 1);
    assert.equal(contactsAfterNote.json.contacts[0].note, "同事");
    assert.equal(contactsAfterNote.json.contacts[0].blocked, false);
    assert.equal(contactsAfterNote.json.contacts[0].pinned, true);
    assert.equal(contactsAfterNote.json.contacts[0].muted, true);

    const crossOriginPatch = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ContactB`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`,
        Origin: "https://evil.example"
      },
      body: JSON.stringify({ note: "恶意来源" })
    });
    assert.equal(crossOriginPatch.status, 403);
    assert.equal((await crossOriginPatch.json()).error, "forbidden origin");

    const blockResponse = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ContactB/block`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ blocked: true })
    });
    assert.equal(blockResponse.status, 200);
    const blockPayload = await blockResponse.json();
    assert.ok(blockPayload.blockedUsers.includes("ContactB"));

    const blockedContacts = await getJson(server.port, "/api/contacts", aliceToken);
    assert.equal(blockedContacts.response.status, 200);
    assert.equal(blockedContacts.json.contacts[0].blocked, true);

    const blockedSend = await postJson(
      server.port,
      "/api/messages",
      {
        to: "ContactB",
        ...makeEncryptedPayload(109)
      },
      aliceToken
    );
    assert.equal(blockedSend.status, 403);
    assert.equal((await blockedSend.json()).error, "you blocked peer");

    const blockedPeerContacts = await getJson(server.port, "/api/contacts", bobToken);
    assert.equal(blockedPeerContacts.json.contacts[0].blockedByPeer, true);
    const blockedPeerSend = await postJson(
      server.port,
      "/api/messages",
      { to: "ContactA", ...makeEncryptedPayload(110) },
      bobToken
    );
    assert.equal(blockedPeerSend.status, 403);
    assert.equal((await blockedPeerSend.json()).error, "blocked by peer");

    const crossOriginBlock = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ContactB/block`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`,
        Origin: "https://evil.example"
      },
      body: JSON.stringify({ blocked: false })
    });
    assert.equal(crossOriginBlock.status, 403);
    assert.equal((await crossOriginBlock.json()).error, "forbidden origin");

    const unblockResponse = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ContactB/block`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${aliceToken}`
      },
      body: JSON.stringify({ blocked: false })
    });
    assert.equal(unblockResponse.status, 200);
    assert.deepEqual((await unblockResponse.json()).blockedUsers, []);

    const unblockedSend = await postJson(
      server.port,
      "/api/messages",
      {
        to: "ContactB",
        clientId: "contact-flow-1",
        ...makeEncryptedPayload(110)
      },
      aliceToken
    );
    assert.equal(unblockedSend.status, 201);

    const bobHistory = await getJson(server.port, "/api/messages?with=ContactA", bobToken);
    assert.equal(bobHistory.response.status, 200);
    assert.equal(bobHistory.json.messages.length, 1);

    const deleteResponse = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ContactB`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${aliceToken}`
      }
    });
    assert.equal(deleteResponse.status, 200);
    assert.equal((await deleteResponse.json()).ok, true);

    const contactsAfterDelete = await getJson(server.port, "/api/contacts", aliceToken);
    assert.equal(contactsAfterDelete.response.status, 200);
    assert.equal(contactsAfterDelete.json.contacts.length, 0);

    const crossOriginDelete = await fetch(`http://127.0.0.1:${server.port}/api/contacts/ContactB`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        Origin: "https://evil.example"
      }
    });
    assert.equal(crossOriginDelete.status, 403);
    assert.equal((await crossOriginDelete.json()).error, "forbidden origin");
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

    const userDetail = await getJson(server.port, "/api/admin/users/AdminA", adminToken);
    assert.equal(userDetail.response.status, 200);
    assert.equal(userDetail.json.detail.user.username, "AdminA");
    assert.equal(userDetail.json.detail.access.profile.userId, "AdminA");
    assert.ok(userDetail.json.detail.messageStats.total >= 1);
    assert.ok(userDetail.json.detail.sessions.length >= 1);
    assert.ok(userDetail.json.detail.recentMessages.some((item) => item.ciphertext === messageBody.message.ciphertext));

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

    const bannedDetail = await getJson(server.port, "/api/admin/users/AdminA", adminToken);
    assert.equal(bannedDetail.response.status, 200);
    assert.equal(bannedDetail.json.detail.user.banned, true);
    assert.ok(bannedDetail.json.detail.audit.some((item) => item.action === "admin_user_patch"));

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

test("admin cannot reset an encrypted user's password without the private key", async () => {
  const server = await startServer();
  try {
    const userRegister = await postJsonAndRead(server.port, "/api/register", {
      username: "ResetByAdmin",
      password: "pass1234",
      ...SAMPLE_BUNDLES.ResetByAdmin
    });
    assert.equal(userRegister.response.status, 201);
    const userToken = userRegister.json.token;

    const adminLogin = await postJsonAndRead(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(adminLogin.response.status, 200);
    const adminToken = adminLogin.json.token;

    const resetResponse = await fetch(`http://127.0.0.1:${server.port}/api/admin/users/ResetByAdmin`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`
      },
      body: JSON.stringify({ password: "pass5678" })
    });
    assert.equal(resetResponse.status, 409);
    assert.equal((await resetResponse.json()).error, "encrypted account password must be changed by the user");

    const activeSession = await getJson(server.port, "/api/me", userToken);
    assert.equal(activeSession.response.status, 200);

    const oldLogin = await postJson(server.port, "/api/login", {
      username: "ResetByAdmin",
      password: "pass1234"
    });
    assert.equal(oldLogin.status, 200);

    const newLogin = await postJson(server.port, "/api/login", {
      username: "ResetByAdmin",
      password: "pass5678"
    });
    assert.equal(newLogin.status, 401);
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
    const adminCookie = extractCookiePair(adminLogin.headers.get("set-cookie"), "secure_chat_admin_session");
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
    ADMIN_PASSWORD: TEST_ADMIN_PLAIN_PASSWORD
  });

  try {
    const login = await postJson(server.port, "/api/admin/login", {
      account: "admin",
      password: TEST_ADMIN_PLAIN_PASSWORD
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

    const beforeRenameProfile = await getJson(server.port, "/api/me", bobToken);
    assert.equal(beforeRenameProfile.response.status, 200);
    const beforeRenameConversations = await getJson(server.port, "/api/conversations", bobToken);
    assert.equal(beforeRenameConversations.response.status, 200);
    await delay(120);

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

    await delay(120);
    const renamedDetail = await getJson(server.port, "/api/admin/users/RenameC", adminToken);
    assert.equal(renamedDetail.response.status, 200);
    assert.equal(renamedDetail.json.detail.user.username, "RenameC");
    assert.equal(renamedDetail.json.detail.access.profile.userId, "RenameC");
    assert.ok(renamedDetail.json.detail.access.totalLogs >= 2);

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
    const adminSessionCookie = extractCookiePair(cookie, "secure_chat_admin_session");
    assert.ok(adminSessionCookie);

    const me = await fetch(`http://127.0.0.1:${server.port}/api/admin/me`, {
      headers: { Cookie: adminSessionCookie }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).admin.username, "root_admin");
  } finally {
    await server.stop();
  }
});

test("server uses fixed default admin credentials when env credentials are missing", async () => {
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
    const defaultPayload = await defaultLogin.json();
    const previousAdminToken = String(defaultPayload.token || "");
    assert.ok(previousAdminToken);
    assert.equal(defaultPayload.admin.username, "admin");

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

test("server accepts the explicitly configured legacy admin password", async () => {
  const server = await startServer({
    ADMIN_PASSWORD_HASH: "",
    ADMIN_PASSWORD: "qwer@1234"
  });
  try {
    const health = await getJson(server.port, "/health", "");
    assert.equal(health.response.status, 200);
    assert.deepEqual(health.json, { ok: true });
  } finally {
    await server.stop();
  }
});

test("admin account reset accepts the fixed default update passphrase", async () => {
  const envFile = path.join(os.tmpdir(), `secure-chat-admin-default-passphrase-${Date.now()}.env`);
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

    const reset = await postJson(server.port, "/api/admin/account/reset", {
      passphrase: "admin",
      username: "root_admin",
      password: "next-pass-default"
    });
    assert.equal(reset.status, 200);

    const newLogin = await postJson(server.port, "/api/admin/login", {
      username: "root_admin",
      password: "next-pass-default"
    });
    assert.equal(newLogin.status, 200);
  } finally {
    fs.rmSync(envFile, { force: true });
    await server.stop();
  }
});

test("admin account reset updates runtime credentials and prefers ADMIN_PASSWORD over stale hash", async () => {
  const server = await startServer({
    ADMIN_PASSWORD_HASH: TEST_ADMIN_PASSWORD_HASH,
    ADMIN_PASSWORD: TEST_ADMIN_PLAIN_PASSWORD,
    ADMIN_UPDATE_PASSPHRASE: "test-passphrase",
    ADMIN_CONFIG_ENV_FILE: path.join(os.tmpdir(), `secure-chat-admin-${Date.now()}.env`)
  });

  try {
    const defaultLogin = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: TEST_ADMIN_PLAIN_PASSWORD
    });
    assert.equal(defaultLogin.status, 200);
    const previousAdminToken = String((await defaultLogin.json()).token || "");
    assert.ok(previousAdminToken);

    const reset = await postJson(server.port, "/api/admin/account/reset", {
      passphrase: "test-passphrase",
      username: "root_admin",
      password: "next-pass-123"
    });
    assert.equal(reset.status, 200);
    assert.equal((await reset.json()).admin.username, "root_admin");

    const previousSession = await getJson(server.port, "/api/admin/me", previousAdminToken);
    assert.equal(previousSession.response.status, 401);

    const oldLogin = await postJson(server.port, "/api/admin/login", {
      username: "admin",
      password: TEST_ADMIN_PLAIN_PASSWORD
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
  fs.writeFileSync(envFile, `ADMIN_USERNAME=admin\nADMIN_PASSWORD=${TEST_ADMIN_PLAIN_PASSWORD}\n`, "utf8");
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
      password: TEST_ADMIN_PLAIN_PASSWORD
    });
    assert.equal(defaultLogin.status, 200);

    fs.writeFileSync(
      envFile,
      `ADMIN_USERNAME=admin\nADMIN_PASSWORD=${TEST_ADMIN_PLAIN_PASSWORD}\nADMIN_UPDATE_PASSPHRASE=test-passphrase\n`,
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

    const removedExportResponse = await getJson(
      server.port,
      "/api/admin/messages/export?reason=investigation&from=BatchA",
      adminToken
    );
    assert.equal(removedExportResponse.response.status, 404);
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

    const landing2 = await fetch(`http://127.0.0.1:${server.port}/`);
    assert.equal(landing2.status, 200);
    const accessCookie2 = String(landing2.headers.get("set-cookie") || "")
      .split(",")
      .find((item) => item.includes("secure_chat_visit="))?.split(";")[0] || "";
    assert.match(accessCookie2, /secure_chat_visit=/);

    const register2 = await postJsonWithOptions(
      server.port,
      "/api/register",
      {
        username: "VisitorA2",
        password: "pass1234",
        ...SAMPLE_BUNDLES.Bob
      },
      {
        cookie: accessCookie2
      }
    );
    assert.equal(register2.status, 201);

    const adminLogin = await postJson(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    });
    assert.equal(adminLogin.status, 200);
    const adminToken = (await adminLogin.json()).token;

    await delay(250);

    const summary = await getJson(server.port, "/api/admin/access/summary", adminToken);
    assert.equal(summary.response.status, 200);
    assert.equal(summary.json.summary.days, 7);
    assert.ok(summary.json.summary.totals.logRows >= 3);
    assert.ok(summary.json.summary.totals.pageViews >= 1);
    assert.equal(typeof summary.json.summary.totals.errorRate, "number");
    assert.ok(Array.isArray(summary.json.summary.requestTrend));
    assert.ok(Array.isArray(summary.json.summary.deviceBreakdown));
    assert.ok(summary.json.summary.topPages.some((row) => row.path === "/"));

    const rangedSummary = await getJson(server.port, "/api/admin/access/summary?days=14", adminToken);
    assert.equal(rangedSummary.response.status, 200);
    assert.equal(rangedSummary.json.summary.days, 14);

    const dashboard = await getJson(server.port, "/api/admin/dashboard/stats?days=14", adminToken);
    assert.equal(dashboard.response.status, 200);
    assert.equal(dashboard.json.dashboard.systemStatus.label, "正常");
    assert.equal(dashboard.json.dashboard.rangeDays, 14);
    assert.ok(dashboard.json.dashboard.stats.users >= 2);
    assert.equal(dashboard.json.dashboard.health.ok, true);
    assert.ok(Array.isArray(dashboard.json.dashboard.charts.trends));
    assert.equal(dashboard.json.dashboard.charts.trends.length, 14);
    assert.ok(Array.isArray(dashboard.json.dashboard.charts.userDistribution));
    assert.ok(Array.isArray(dashboard.json.dashboard.securityAlerts));

    const logs = await getJson(server.port, "/api/admin/access/logs?sessionId=" + encodeURIComponent(accessCookie.split("=")[1]), adminToken);
    assert.equal(logs.response.status, 200);
    assert.ok(logs.json.rows.length >= 1);
    assert.ok(logs.json.rows.some((row) => row.language === "zh-CN"));
    assert.ok(logs.json.rows.some((row) => row.userId === "VisitorA"));
    assert.ok(logs.json.rows.every((row) => typeof row.ipAttribution === "string"));
    assert.ok(logs.json.rows.every((row) => Object.prototype.hasOwnProperty.call(row, "ipCountry")));

    const profile = await getJson(server.port, "/api/admin/access/profile?userId=VisitorA", adminToken);
    assert.equal(profile.response.status, 200);
    assert.equal(profile.json.profile.userId, "VisitorA");
    assert.ok(profile.json.profile.visits >= 1);
    assert.equal(profile.json.profile.clientMeta.language, "zh-CN");
    assert.equal(typeof profile.json.profile.ipAttribution, "string");
    assert.equal(profile.json.profile.sessionId, accessCookie.split("=")[1]);
    assert.notEqual(profile.json.profile.sessionId, accessCookie2.split("=")[1]);
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

test("events redemption also caps concurrent SSE connections when tickets were pre-issued", async () => {
  const server = await startServer({
    MAX_CONCURRENT_EVENT_CONNECTIONS_PER_USER: "2"
  });

  try {
    const register = await postJson(server.port, "/api/register", {
      username: "SsePreIssue",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 81).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 82).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 83).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 84).toString("base64")
    });
    const token = (await register.json()).token;

    const tickets = await Promise.all([
      createEventsTicket(server.port, token),
      createEventsTicket(server.port, token),
      createEventsTicket(server.port, token)
    ]);

    const first = await openEventsWithTicket(server.port, tickets[0]);
    const second = await openEventsWithTicket(server.port, tickets[1]);
    await Promise.all([first.ready, second.ready]);

    const rejected = await redeemEventsTicket(server.port, tickets[2]);
    assert.equal(rejected.status, 429);
    assert.equal(rejected.json?.error, "too many concurrent connections");

    first.close();
    second.close();
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

test("typing signal relays to the peer over SSE and is gated by blocks", async () => {
  const server = await startServer();

  try {
    const aliceToken = (await postJsonAndRead(server.port, "/api/register", {
      username: "TypeA",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 71).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 72).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 73).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 74).toString("base64")
    })).json.token;
    const bobToken = (await postJsonAndRead(server.port, "/api/register", {
      username: "TypeB",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 75).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 76).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 77).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 78).toString("base64")
    })).json.token;

    const bobEvents = await openEvents(server.port, bobToken);
    await bobEvents.ready;

    const typing = await postJson(server.port, "/api/messages/typing", { to: "TypeB", typing: true }, aliceToken);
    assert.equal(typing.status, 200);
    const typingEvent = await waitForEvent(bobEvents, "typing", (data) => data.peer === "TypeA");
    assert.equal(typingEvent.typing, true);

    const block = await fetch(`http://127.0.0.1:${server.port}/api/contacts/TypeA/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${bobToken}` },
      body: JSON.stringify({ blocked: true })
    });
    assert.equal(block.status, 200);

    const baselineTypingEvents = bobEvents.events.filter((event) => event.event === "typing").length;
    const blockedTyping = await postJson(server.port, "/api/messages/typing", { to: "TypeB", typing: true }, aliceToken);
    assert.equal(blockedTyping.status, 200);
    await delay(200);
    const afterTypingEvents = bobEvents.events.filter((event) => event.event === "typing").length;
    assert.equal(afterTypingEvents, baselineTypingEvents);

    bobEvents.close();
  } finally {
    await server.stop();
  }
});

test("admin rename keeps an existing block from being bypassed", async () => {
  const server = await startServer();

  try {
    const blockerToken = (await postJsonAndRead(server.port, "/api/register", {
      username: "BlockOwner",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 81).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 82).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 83).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 84).toString("base64")
    })).json.token;
    const targetToken = (await postJsonAndRead(server.port, "/api/register", {
      username: "BlockTarget",
      password: "pass1234",
      publicKey: Buffer.alloc(65, 85).toString("base64"),
      privateKeySalt: Buffer.alloc(16, 86).toString("base64"),
      privateKeyIv: Buffer.alloc(12, 87).toString("base64"),
      encryptedPrivateKey: Buffer.alloc(160, 88).toString("base64")
    })).json.token;

    const block = await fetch(`http://127.0.0.1:${server.port}/api/contacts/BlockTarget/block`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${blockerToken}` },
      body: JSON.stringify({ blocked: true })
    });
    assert.equal(block.status, 200);

    const adminToken = (await postJsonAndRead(server.port, "/api/admin/login", {
      username: TEST_ADMIN_USERNAME,
      password: TEST_ADMIN_PASSWORD
    })).json.token;

    const rename = await fetch(`http://127.0.0.1:${server.port}/api/admin/users/BlockTarget`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ username: "BlockTargetRenamed" })
    });
    assert.equal(rename.status, 200);

    // After the rename the block list must reference the new name, so the renamed
    // user still cannot message the person who blocked them.
    const blockedSend = await postJson(
      server.port,
      "/api/messages",
      { to: "BlockOwner", ...makeEncryptedPayload(89) },
      targetToken
    );
    assert.equal(blockedSend.status, 403);
    assert.equal((await blockedSend.json()).error, "blocked by peer");

    const ownerContacts = await getJson(server.port, "/api/contacts", blockerToken);
    const renamedContact = ownerContacts.json.contacts.find((contact) => contact.username === "BlockTargetRenamed");
    assert.ok(renamedContact);
    assert.equal(renamedContact.blocked, true);
  } finally {
    await server.stop();
  }
});
