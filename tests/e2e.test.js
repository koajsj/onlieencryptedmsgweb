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

async function startServer() {
  const port = 3200 + Math.floor(Math.random() * 1200);
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-site-test-"));
  const serverProcess = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir
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

function openEvents(port, token) {
  const events = [];
  let buffer = "";
  let request;

  const ready = new Promise((resolve, reject) => {
    request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: `/api/events?token=${encodeURIComponent(token)}`,
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

async function getJson(port, pathname, token = "") {
  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  });
  return {
    response,
    json: await response.json()
  };
}

function encryptedMessageEnvelope() {
  return {
    nonce: Buffer.alloc(12, 9).toString("base64"),
    ciphertext: Buffer.alloc(64, 11).toString("base64")
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

    const me = await getJson(server.port, "/api/me", loginBody.token);
    assert.equal(me.response.status, 200);
    assert.equal(me.json.user.username, "Alice_1");
    assert.equal(me.json.user.publicKey, SAMPLE_BUNDLES.Alice_1.publicKey);
  } finally {
    await server.stop();
  }
});

test("private messaging accepts plaintext and returns readable messages", async () => {
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

    const aliceEvents = openEvents(server.port, aliceToken);
    const bobEvents = openEvents(server.port, bobToken);

    await Promise.all([aliceEvents.ready, bobEvents.ready]);
    const readyPayload = await waitForEvent(aliceEvents, "ready");
    assert.equal(readyPayload.me, "Alice");

    const search = await getJson(server.port, "/api/users?q=bo", aliceToken);
    assert.equal(search.response.status, 200);
    assert.equal(search.json.users[0].username, "Bob");
    assert.equal(search.json.users[0].publicKey, SAMPLE_BUNDLES.Bob.publicKey);

    const send = await postJson(
      server.port,
      "/api/messages",
      {
        to: "Bob",
        text: "Hello Bob"
      },
      aliceToken
    );
    assert.equal(send.status, 201);
    const sendBody = await send.json();
    assert.equal(sendBody.message.peer, "Bob");
    assert.equal(sendBody.message.text, "Hello Bob");
    assert.equal(sendBody.message.publicKey, SAMPLE_BUNDLES.Bob.publicKey);
    assert.equal(sendBody.conversation.latestMessage.text, "Hello Bob");

    const incoming = await waitForEvent(
      bobEvents,
      "message",
      (payload) => payload.from === "Alice" && payload.text === "Hello Bob"
    );
    assert.equal(incoming.peer, "Alice");
    assert.equal(incoming.mine, false);
    assert.equal(incoming.publicKey, SAMPLE_BUNDLES.Alice.publicKey);
    assert.equal(incoming.text, "Hello Bob");

    const history = await getJson(server.port, "/api/messages?with=Alice", bobToken);
    assert.equal(history.response.status, 200);
    assert.equal(history.json.peer.publicKey, SAMPLE_BUNDLES.Alice.publicKey);
    assert.equal(history.json.messages.length, 1);
    assert.equal(history.json.messages[0].text, "Hello Bob");

    const conversations = await getJson(server.port, "/api/conversations", aliceToken);
    assert.equal(conversations.response.status, 200);
    assert.equal(conversations.json.conversations.length, 1);
    assert.equal(conversations.json.conversations[0].username, "Bob");
    assert.equal(conversations.json.conversations[0].publicKey, SAMPLE_BUNDLES.Bob.publicKey);
    assert.equal(conversations.json.conversations[0].latestMessage.text, "Hello Bob");
  } finally {
    await server.stop();
  }
});
