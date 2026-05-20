"use strict";

const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "server.js");

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
  const serverProcess = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port)
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
    }
  };
}

function openSse(port, room, clientId) {
  const events = [];
  let buffer = "";
  let request;

  const ready = new Promise((resolve, reject) => {
    request = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: `/events?room=${encodeURIComponent(room)}&client=${encodeURIComponent(clientId)}`,
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

function publicKey() {
  return Buffer.alloc(65, 7).toString("base64");
}

function securePayload(room, clientId, type, patch = {}) {
  return {
    v: 1,
    room,
    from: clientId,
    type,
    id: "abcdefabcdefabcdefabcdef",
    sentAt: Date.now(),
    refId: "",
    nonce: Buffer.alloc(12, 1).toString("base64"),
    ciphertext: Buffer.from(`sealed:${type}`).toString("base64"),
    ...patch
  };
}

async function postSignal(port, body, headers = {}) {
  return fetch(`http://127.0.0.1:${port}/signal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  });
}

test("two clients can connect and only structured same-origin signals are relayed", async () => {
  const server = await startServer();
  const room = "SECURE-E2E";
  const aliceId = "aaaaaaaaaaaaaaaaaaaaaaaa";
  const bobId = "bbbbbbbbbbbbbbbbbbbbbbbb";
  const alice = openSse(server.port, room, aliceId);
  const bob = openSse(server.port, room, bobId);

  try {
    await Promise.all([alice.ready, bob.ready]);
    await waitForEvent(alice, "ready");
    await waitForEvent(bob, "ready");

    const helloResponse = await postSignal(server.port, {
      room,
      clientId: aliceId,
      type: "hello",
      payload: {
        name: "Alice",
        publicKey: publicKey()
      }
    });
    assert.equal(helloResponse.status, 202);

    const hello = await waitForEvent(bob, "signal", (data) => data.type === "hello");
    assert.equal(hello.from, aliceId);
    assert.equal(hello.payload.name, "Alice");

    const statusResponse = await postSignal(server.port, {
      room,
      clientId: aliceId,
      type: "status",
      payload: securePayload(room, aliceId, "status")
    });
    assert.equal(statusResponse.status, 202);

    const status = await waitForEvent(bob, "signal", (data) => data.type === "status");
    assert.equal(status.payload.type, "status");
    assert.equal(status.payload.room, room);

    const forgedDelete = await postSignal(server.port, {
      room,
      clientId: aliceId,
      type: "delete",
      payload: { messageId: "plain-delete" }
    });
    assert.equal(forgedDelete.status, 400);

    const crossOrigin = await postSignal(
      server.port,
      {
        room,
        clientId: aliceId,
        type: "hello",
        payload: {
          name: "Mallory",
          publicKey: publicKey()
        }
      },
      { Origin: "https://evil.example" }
    );
    assert.equal(crossOrigin.status, 403);
  } finally {
    alice.close();
    bob.close();
    await server.stop();
  }
});
