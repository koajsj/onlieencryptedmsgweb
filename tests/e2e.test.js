"use strict";

const assert = require("node:assert/strict");
const nodeCrypto = require("node:crypto");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "server.js");
const APP_SOURCE = path.join(ROOT_DIR, "public", "app.js");
const DEPLOY_SCRIPT = path.join(ROOT_DIR, "scripts", "deploy-debian.sh");
const UPDATE_SCRIPT = path.join(ROOT_DIR, "scripts", "update-debian.sh");
const MESSAGE_KEY_INFO = "private-chat-message-key-v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const webcrypto = nodeCrypto.webcrypto;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

function extractCookiePair(header, cookieName) {
  const value = String(header || "");
  const match = value.match(new RegExp(`${cookieName}=([^;]+)`));
  return match ? `${cookieName}=${match[1]}` : "";
}

async function waitForHealth(port, child, stdoutChunks, stderrChunks) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`server exited with code ${child.exitCode}\n${stderrChunks.join("") || stdoutChunks.join("")}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return;
      }
    } catch (error) {
      // Keep polling until the process is ready or exits.
    }
    await delay(100);
  }
  throw new Error(`server did not become healthy\n${stderrChunks.join("") || stdoutChunks.join("")}`);
}

async function startServer(extraEnv = {}) {
  const port = await getFreePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "secure-chat-e2e-"));
  fs.writeFileSync(path.join(dataDir, "users.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(dataDir, "admin_audit.jsonl"), "", "utf8");

  const stdoutChunks = [];
  const stderrChunks = [];
  const child = spawn(process.execPath, [SERVER_PATH], {
    cwd: ROOT_DIR,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      DATA_DIR: dataDir,
      ENABLE_ACCESS_LOG: "0",
      COOKIE_SECURE: "0",
      NODE_ENV: "test",
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => stdoutChunks.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderrChunks.push(String(chunk)));

  await waitForHealth(port, child, stdoutChunks, stderrChunks);

  return {
    port,
    dataDir,
    child,
    async stop() {
      if (child.exitCode !== null) {
        fs.rmSync(dataDir, { recursive: true, force: true });
        return;
      }
      child.kill("SIGTERM");
      await new Promise((resolve) => child.once("exit", resolve));
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

async function requestJson(port, pathname, { method = "GET", body, session } = {}) {
  const headers = {
    Accept: "application/json"
  };
  if (session?.cookie) {
    headers.Cookie = session.cookie;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (!["GET", "HEAD"].includes(method) && session?.csrfToken) {
    headers["X-CSRF-Token"] = session.csrfToken;
  }

  const response = await fetch(`http://127.0.0.1:${port}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  const nextSession = session ? { ...session } : { cookie: "", csrfToken: "" };
  const setCookie = response.headers.get("set-cookie") || "";
  const cookie = extractCookiePair(setCookie, "secure_chat_session") || extractCookiePair(setCookie, "secure_chat_admin_session");
  if (cookie) {
    nextSession.cookie = cookie;
  }
  if (typeof payload?.csrfToken === "string" && payload.csrfToken) {
    nextSession.csrfToken = payload.csrfToken;
  }
  return {
    status: response.status,
    json: payload,
    session: nextSession
  };
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value) {
  return Buffer.from(value, "base64");
}

async function createIdentity() {
  const keyPair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKeyRaw = new Uint8Array(await webcrypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await webcrypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyBase64: bytesToBase64(publicKeyRaw),
    privateKeyPkcs8Base64: bytesToBase64(privateKeyPkcs8)
  };
}

async function importPublicKey(publicKeyBase64) {
  return webcrypto.subtle.importKey(
    "raw",
    base64ToBytes(publicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
}

async function deriveMessageKey(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64) {
  const peerPublicKey = await importPublicKey(peerPublicKeyBase64);
  const sharedSecret = await webcrypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    selfIdentity.privateKey,
    256
  );
  const hkdfKey = await webcrypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const participants = [selfUsername, peerUsername].sort().join(":");
  const keyBinding = [selfIdentity.publicKeyBase64, peerPublicKeyBase64].sort().join(":");
  const salt = await webcrypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`${participants}|${keyBinding}|private-chat-v1`)
  );
  return webcrypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: textEncoder.encode(MESSAGE_KEY_INFO)
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function aadBytes(from, to) {
  return textEncoder.encode(JSON.stringify({ from, to }));
}

async function encryptMessage(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64, plaintext, nonceFill = 7) {
  const key = await deriveMessageKey(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64);
  const nonce = new Uint8Array(12);
  nonce.fill(nonceFill);
  const ciphertext = await webcrypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aadBytes(selfUsername, peerUsername)
    },
    key,
    textEncoder.encode(plaintext)
  );
  return {
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptMessage(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64, payload) {
  const key = await deriveMessageKey(selfIdentity, selfUsername, peerUsername, peerPublicKeyBase64);
  const plaintext = await webcrypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.nonce),
      additionalData: aadBytes(payload.from, payload.to)
    },
    key,
    base64ToBytes(payload.ciphertext)
  );
  return textDecoder.decode(plaintext);
}

test("browser client never uploads or restores server-side private key bundles", () => {
  const appSource = fs.readFileSync(APP_SOURCE, "utf8");
  assert.doesNotMatch(appSource, /encryptedPrivateKey/);
  assert.doesNotMatch(appSource, /privateKeySalt/);
  assert.doesNotMatch(appSource, /privateKeyIv/);
  assert.doesNotMatch(appSource, /derivePasswordKey/);
  assert.match(appSource, /window\.indexedDB\.open/);
  assert.match(appSource, /writeDeviceVaultRecord/);
  assert.match(appSource, /publicKey:\s*identity\.publicKeyBase64/);
  assert.match(appSource, /deleteScopedStorageRecord\(STORAGE\.deviceIdentities/);
  assert.doesNotMatch(appSource, /同一账号可多端进入/);
});

test("deployment scripts preserve generated assets and verify the build without rotating admin credentials by default", () => {
  const deployScript = fs.readFileSync(DEPLOY_SCRIPT, "utf8");
  const updateScript = fs.readFileSync(UPDATE_SCRIPT, "utf8");
  assert.match(deployScript, /public\/ui-utils\.min\.js/);
  assert.match(updateScript, /public\/ui-utils\.min\.js/);
  assert.match(deployScript, /npm run lint/);
  assert.match(deployScript, /npm run verify:build/);
  assert.match(updateScript, /npm run lint/);
  assert.match(updateScript, /npm run verify:build/);
  assert.match(updateScript, /read_env_value "ADMIN_PASSWORD_HASH"/);
  assert.doesNotMatch(updateScript, /ensure_line "ADMIN_PASSWORD_HASH" "\$\(hash_password "\$\{ADMIN_PASSWORD\}"\)"/);
});

test("server stores only public keys and ciphertext while clients can decrypt each other", async () => {
  const server = await startServer();
  try {
    const aliceIdentity = await createIdentity();
    const bobIdentity = await createIdentity();

    const aliceRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Alice",
        password: "hello123",
        publicKey: aliceIdentity.publicKeyBase64
      }
    });
    assert.equal(aliceRegister.status, 201);
    assert.equal(aliceRegister.json.user.publicKey, aliceIdentity.publicKeyBase64);
    assert.equal(aliceRegister.json.keyBundle, undefined);

    const bobRegister = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Bob",
        password: "world123",
        publicKey: bobIdentity.publicKeyBase64
      }
    });
    assert.equal(bobRegister.status, 201);
    assert.equal(bobRegister.json.user.publicKey, bobIdentity.publicKeyBase64);
    assert.equal(bobRegister.json.keyBundle, undefined);

    const aliceLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: { username: "Alice", password: "hello123" }
    });
    const bobLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: { username: "Bob", password: "world123" }
    });
    assert.equal(aliceLogin.status, 200);
    assert.equal(bobLogin.status, 200);

    const prekey = await requestJson(server.port, "/prekey-bundle/Bob", {
      session: aliceLogin.session
    });
    assert.equal(prekey.status, 200);
    assert.equal(prekey.json.identityKey, bobIdentity.publicKeyBase64);
    assert.equal(prekey.json.encryptedPrivateKey, undefined);

    const plaintext = "zero knowledge plaintext";
    const encrypted = await encryptMessage(aliceIdentity, "Alice", "Bob", bobIdentity.publicKeyBase64, plaintext, 11);
    const sent = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    assert.equal(sent.status, 201);
    assert.equal(sent.json.message.text, null);
    assert.equal(sent.json.message.ciphertext, encrypted.ciphertext);
    assert.equal(sent.json.message.nonce, encrypted.nonce);

    const plaintextOnly = await requestJson(server.port, "/api/messages", {
      method: "POST",
      session: aliceLogin.session,
      body: {
        to: "Bob",
        text: plaintext
      }
    });
    assert.equal(plaintextOnly.status, 400);
    assert.equal(plaintextOnly.json.error, "invalid message payload");

    const history = await requestJson(server.port, "/api/messages?with=Alice", {
      session: bobLogin.session
    });
    assert.equal(history.status, 200);
    assert.equal(history.json.messages.length, 1);
    assert.equal(history.json.messages[0].text, null);
    assert.equal(history.json.messages[0].ciphertext, encrypted.ciphertext);
    assert.equal(history.json.messages[0].nonce, encrypted.nonce);

    const decrypted = await decryptMessage(
      bobIdentity,
      "Bob",
      "Alice",
      aliceIdentity.publicKeyBase64,
      history.json.messages[0]
    );
    assert.equal(decrypted, plaintext);

    const keyBundle = await requestJson(server.port, "/api/me/key-bundle", {
      session: aliceLogin.session
    });
    assert.equal(keyBundle.status, 410);

    await delay(300);
    const usersJson = fs.readFileSync(path.join(server.dataDir, "users.json"), "utf8");
    const messagesJson = fs.readFileSync(path.join(server.dataDir, "messages.json"), "utf8");
    const messagesLog = fs.readFileSync(path.join(server.dataDir, "messages.jsonl"), "utf8");
    const storedMessages = `${messagesJson}\n${messagesLog}`;
    assert.match(usersJson, new RegExp(aliceIdentity.publicKeyBase64.replace(/[+/=]/g, "\\$&")));
    assert.doesNotMatch(usersJson, /encryptedPrivateKey|privateKeySalt|privateKeyIv|privateKeyPkcs8/i);
    assert.doesNotMatch(storedMessages, /zero knowledge plaintext/);
    assert.doesNotMatch(messagesLog, /zero knowledge plaintext/);
    assert.match(storedMessages, new RegExp(encrypted.ciphertext.replace(/[+/=]/g, "\\$&")));
  } finally {
    await server.stop();
  }
});

test("startup strips legacy server-side private key material from user records", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "secure-chat-legacy-"));
  const legacyUser = {
    id: "legacy-user",
    username: "Legacy",
    usernameKey: "legacy",
    passwordHash: "scrypt:00000000000000000000000000000000:0000000000000000000000000000000000000000000000000000000000000000",
    publicKey: Buffer.alloc(65, 8).toString("base64"),
    privateKeySalt: Buffer.alloc(16, 9).toString("base64"),
    privateKeyIv: Buffer.alloc(12, 10).toString("base64"),
    encryptedPrivateKey: Buffer.alloc(160, 11).toString("base64"),
    createdAt: Date.now()
  };
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify([legacyUser], null, 2), "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.json"), "[]", "utf8");
  fs.writeFileSync(path.join(dataDir, "messages.jsonl"), "", "utf8");
  fs.writeFileSync(path.join(dataDir, "admin_audit.jsonl"), "", "utf8");

  const server = await startServer({ DATA_DIR: dataDir });
  try {
    await delay(200);
    const persisted = fs.readFileSync(path.join(dataDir, "users.json"), "utf8");
    assert.doesNotMatch(persisted, /encryptedPrivateKey|privateKeySalt|privateKeyIv/);
    assert.match(persisted, /"publicKey":/);
  } finally {
    await server.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("password change no longer sends or requires private key material", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Changer",
        password: "hello123",
        publicKey: identity.publicKeyBase64
      }
    });
    assert.equal(register.status, 201);

    const changed = await requestJson(server.port, "/api/me/password", {
      method: "POST",
      session: register.session,
      body: {
        currentPassword: "hello123",
        newPassword: "hello456"
      }
    });
    assert.equal(changed.status, 200);

    const oldLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "Changer",
        password: "hello123"
      }
    });
    assert.equal(oldLogin.status, 401);

    const newLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "Changer",
        password: "hello456"
      }
    });
    assert.equal(newLogin.status, 200);
    assert.equal(newLogin.json.keyBundle, undefined);
  } finally {
    await server.stop();
  }
});

test("session management can revoke another active device without logging out the current one", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "SessionRevokeUser",
        password: "hello123",
        publicKey: identity.publicKeyBase64
      }
    });
    assert.equal(register.status, 201);

    const secondLogin = await requestJson(server.port, "/api/login", {
      method: "POST",
      body: {
        username: "SessionRevokeUser",
        password: "hello123"
      }
    });
    assert.equal(secondLogin.status, 200);

    const sessionsBefore = await requestJson(server.port, "/api/me/sessions", {
      session: register.session
    });
    assert.equal(sessionsBefore.status, 200);
    assert.equal(sessionsBefore.json.sessions.length, 2);
    assert.equal(sessionsBefore.json.sessions.filter((item) => item.current).length, 1);

    const otherSession = sessionsBefore.json.sessions.find((item) => !item.current);
    assert.ok(otherSession?.id);

    const revoked = await requestJson(server.port, "/api/me/sessions/revoke", {
      method: "POST",
      session: register.session,
      body: {
        sessionId: otherSession.id
      }
    });
    assert.equal(revoked.status, 200);
    assert.equal(revoked.json.revokedSessionId, otherSession.id);
    assert.equal(revoked.json.sessions.length, 1);
    assert.equal(revoked.json.sessions[0].current, true);

    const currentStillWorks = await requestJson(server.port, "/api/me", {
      session: register.session
    });
    assert.equal(currentStillWorks.status, 200);

    const revokedSession = await requestJson(server.port, "/api/me", {
      session: secondLogin.session
    });
    assert.equal(revokedSession.status, 401);
  } finally {
    await server.stop();
  }
});

test("public key rotation endpoint accepts only public key material", async () => {
  const server = await startServer();
  try {
    const identity = await createIdentity();
    const nextIdentity = await createIdentity();
    const register = await requestJson(server.port, "/api/register", {
      method: "POST",
      body: {
        username: "Rotator",
        password: "hello123",
        publicKey: identity.publicKeyBase64
      }
    });
    assert.equal(register.status, 201);

    const upload = await requestJson(server.port, "/upload-public-key", {
      method: "POST",
      session: register.session,
      body: {
        publicKey: nextIdentity.publicKeyBase64
      }
    });
    assert.equal(upload.status, 200);
    assert.equal(upload.json.ok, true);
    assert.equal(upload.json.publicKey.identityKey, nextIdentity.publicKeyBase64);
    assert.equal(upload.json.keyBundle, undefined);

    await delay(200);
    const usersJson = fs.readFileSync(path.join(server.dataDir, "users.json"), "utf8");
    assert.match(usersJson, new RegExp(nextIdentity.publicKeyBase64.replace(/[+/=]/g, "\\$&")));
    assert.doesNotMatch(usersJson, /encryptedPrivateKey|privateKeySalt|privateKeyIv/);
  } finally {
    await server.stop();
  }
});
