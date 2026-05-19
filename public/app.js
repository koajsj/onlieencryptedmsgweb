"use strict";

const $ = (selector) => document.querySelector(selector);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const elements = {
  joinForm: $("#joinForm"),
  nameInput: $("#nameInput"),
  roomInput: $("#roomInput"),
  secretInput: $("#secretInput"),
  randomRoomButton: $("#randomRoomButton"),
  joinButton: $("#joinButton"),
  leaveButton: $("#leaveButton"),
  connectionState: $("#connectionState"),
  peerState: $("#peerState"),
  cryptoState: $("#cryptoState"),
  connectionBadge: $("#connectionBadge"),
  peerBadge: $("#peerBadge"),
  peerStatusBadge: $("#peerStatusBadge"),
  roomTitle: $("#roomTitle"),
  secureDot: $("#secureDot"),
  secureText: $("#secureText"),
  safetyCode: $("#safetyCode"),
  cryptoBadge: $("#cryptoBadge"),
  messageList: $("#messageList"),
  emptyState: $("#emptyState"),
  typingIndicator: $("#typingIndicator"),
  messageForm: $("#messageForm"),
  messageInput: $("#messageInput"),
  sendButton: $("#sendButton"),
  toast: $("#toast")
};

const state = {
  clientId: loadClientId(),
  room: "",
  name: "",
  secret: "",
  eventSource: null,
  keyPair: null,
  publicKeyB64: "",
  sessionKey: null,
  peer: null,
  peerOnline: false,
  helloEchoedFor: new Set(),
  pendingMessages: [],
  seenMessageIds: new Set(),
  toastTimer: 0,
  unsendMessages: [],
  peerTyping: false,
  messageReadStatus: new Map(),
  typingTimeout: null,
  messageStore: new Map(),
  editingMessageId: null,
  replyingToMessageId: null
};

function loadClientId() {
  const stored = localStorage.getItem("secure-chat-client-id");
  if (stored && /^[a-f0-9]{24,64}$/i.test(stored)) {
    return stored;
  }
  const next = randomHex(16);
  localStorage.setItem("secure-chat-client-id", next);
  return next;
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bufferToBytes(buffer) {
  return new Uint8Array(buffer);
}

function concatBytes(parts) {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

async function sha256(data) {
  const bytes = data instanceof Uint8Array ? data : encoder.encode(String(data));
  return bufferToBytes(await crypto.subtle.digest("SHA-256", bytes));
}

function formatSafetyCode(bytes) {
  return [...bytes.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("")
    .replace(/(.{4})/g, "$1-")
    .replace(/-$/, "");
}

function formatMessageTime(timestamp) {
  const now = new Date();
  const msgDate = new Date(timestamp);
  const diffMs = now - msgDate;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) {
    return "刚刚";
  }
  if (diffMin < 60) {
    return `${diffMin}分钟前`;
  }

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) {
    return msgDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) {
    return "昨天";
  }
  if (diffDays < 7) {
    return `${diffDays}天前`;
  }

  return msgDate.toLocaleDateString([], { month: "short", day: "numeric" });
}

async function sendTypingIndicator() {
  if (!state.sessionKey || !state.room) {
    return;
  }
  try {
    await sendSignal("typing", { active: true });
  } catch (error) {
    // Ignore typing signal errors
  }
}

async function markMessageAsRead(messageId) {
  if (!state.sessionKey || !state.room) {
    return;
  }
  state.messageReadStatus.set(messageId, true);
  try {
    await sendSignal("read", { messageId });
  } catch (error) {
    // Ignore read signal errors
  }
}

function showReadStatus(element, messageId) {
  if (state.messageReadStatus.has(messageId)) {
    const status = element.querySelector(".read-status");
    if (!status) {
      const statusEl = document.createElement("span");
      statusEl.className = "read-status";
      statusEl.textContent = "✓✓";
      element.append(statusEl);
    }
  }
}

function savePendingMessage(message) {
  const pending = JSON.parse(localStorage.getItem("secure-chat-pending") || "[]");
  pending.push({ ...message, savedAt: Date.now() });
  localStorage.setItem("secure-chat-pending", JSON.stringify(pending));
}

function loadPendingMessages() {
  const pending = JSON.parse(localStorage.getItem("secure-chat-pending") || "[]");
  return pending.filter((msg) => Date.now() - msg.savedAt < 86400000);
}

function clearPendingMessages() {
  localStorage.setItem("secure-chat-pending", "[]");
}

function setPeerOnlineStatus(online) {
  state.peerOnline = online;
  if (elements.peerStatusBadge) {
    elements.peerStatusBadge.hidden = !online;
  }
}

async function sendStatusUpdate() {
  if (!state.sessionKey || !state.room) {
    return;
  }
  try {
    await sendSignal("status", { online: true });
  } catch (error) {
    // Ignore status signal errors
  }
}

async function deleteMessage(messageId) {
  if (!state.sessionKey || !state.room) {
    return;
  }
  try {
    await sendSignal("delete", { messageId });
    const msgElement = elements.messageList.querySelector(`[data-message-id="${messageId}"]`);
    if (msgElement) {
      const bubble = msgElement.querySelector(".bubble");
      if (bubble) {
        bubble.textContent = "[消息已删除]";
        bubble.classList.add("deleted-message");
        msgElement.classList.add("is-deleted");
      }
    }
  } catch (error) {
    showToast("删除失败");
  }
}

async function editMessage(messageId, newText) {
  if (!state.sessionKey || !state.room) {
    return;
  }
  try {
    const originalMsg = state.messageStore.get(messageId);
    if (!originalMsg) {
      showToast("无法编辑此消息");
      return;
    }
    await sendSignal("edit", { messageId, text: newText, editedAt: Date.now() });
    const msgElement = elements.messageList.querySelector(`[data-message-id="${messageId}"]`);
    if (msgElement) {
      const bubble = msgElement.querySelector(".bubble");
      if (bubble) {
        bubble.textContent = newText;
      }
      const meta = msgElement.querySelector(".meta");
      if (meta) {
        meta.textContent += " (已编辑)";
      }
    }
    state.editingMessageId = null;
  } catch (error) {
    showToast("编辑失败");
  }
}

function setReplyTarget(messageId, text, author) {
  state.replyingToMessageId = messageId;
  const replyHint = document.querySelector(".reply-hint") || document.createElement("div");
  replyHint.className = "reply-hint";
  replyHint.innerHTML = `<strong>回复 ${author}:</strong> ${text.substring(0, 40)}...`;
  if (!document.querySelector(".reply-hint")) {
    elements.messageForm.insertBefore(replyHint, elements.messageInput);
  }
}

function clearReplyTarget() {
  state.replyingToMessageId = null;
  const replyHint = document.querySelector(".reply-hint");
  if (replyHint) {
    replyHint.remove();
  }
}

function showCryptoStrength() {
  if (state.sessionKey && elements.cryptoBadge) {
    elements.cryptoBadge.textContent = "✓ E2EE";
    elements.cryptoBadge.title = "AES-256-GCM + ECDH P-256 + PBKDF2-SHA256";
  }
}

function setDot(mode) {
  elements.secureDot.className = "status-dot";
  if (mode) {
    elements.secureDot.classList.add(`is-${mode}`);
  }
}

function setBadge(element, text, stateName) {
  element.textContent = text;
  element.dataset.state = stateName || "idle";
}

function setTypingIndicator(visible) {
  elements.typingIndicator.hidden = !visible;
}

function setComposerEnabled(enabled) {
  elements.messageInput.disabled = !enabled;
  elements.sendButton.disabled = !enabled;
  elements.messageInput.placeholder = enabled ? "输入加密消息" : "等待加密会话建立";
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2800);
}

function renderSystemMessage(text) {
  renderMessage({
    text,
    name: "系统",
    mine: false,
    system: true,
    sentAt: Date.now()
  });
}

function renderMessage({ text, name, mine, system = false, sentAt, messageId, replyTo }) {
  elements.emptyState.hidden = true;

  const wrapper = document.createElement("article");
  wrapper.className = `message${mine ? " is-own" : ""}${system ? " is-system" : ""}`;
  if (messageId) {
    wrapper.dataset.messageId = messageId;
    state.messageStore.set(messageId, { text, name, sentAt });
  }

  if (replyTo) {
    const replyBlock = document.createElement("div");
    replyBlock.className = "reply-block";
    replyBlock.innerHTML = `<strong>${replyTo.author}</strong>: ${replyTo.text.substring(0, 50)}...`;
    wrapper.append(replyBlock);
  }

  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.textContent = text;

  const meta = document.createElement("div");
  meta.className = "meta";
  if (system) {
    meta.textContent = "";
  } else {
    const timeStr = formatMessageTime(sentAt);
    meta.textContent = `${name || "匿名"} · ${timeStr}`;
  }

  wrapper.append(bubble, meta);

  if (mine && messageId && !system) {
    const actionBar = document.createElement("div");
    actionBar.className = "message-actions";
    
    const editBtn = document.createElement("button");
    editBtn.textContent = "编辑";
    editBtn.className = "action-btn edit-btn";
    editBtn.onclick = () => {
      const newText = prompt("编辑消息:", text);
      if (newText && newText.trim()) {
        editMessage(messageId, newText.trim());
      }
    };
    
    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "删除";
    deleteBtn.className = "action-btn delete-btn";
    deleteBtn.onclick = () => {
      if (confirm("确认删除此消息?")) {
        deleteMessage(messageId);
      }
    };
    
    actionBar.append(editBtn, deleteBtn);
    wrapper.append(actionBar);
  } else if (!mine && !system && messageId) {
    const replyBtn = document.createElement("button");
    replyBtn.textContent = "回复";
    replyBtn.className = "action-btn reply-btn";
    replyBtn.onclick = () => {
      setReplyTarget(messageId, text, name || "匿名");
    };
    const actionBar = document.createElement("div");
    actionBar.className = "message-actions";
    actionBar.append(replyBtn);
    wrapper.append(actionBar);
  }

  if (mine && messageId) {
    showReadStatus(wrapper, messageId);
  }
  elements.messageList.append(wrapper);
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function setConnectedUi() {
  elements.connectionState.textContent = "已连接";
  elements.cryptoState.textContent = "协商中";
  elements.peerState.textContent = "等待对方";
  elements.roomTitle.textContent = state.room;
  elements.leaveButton.disabled = false;
  elements.joinButton.disabled = true;
  setDot("pending");
  setBadge(elements.connectionBadge, "在线", "pending");
  setBadge(elements.peerBadge, "等待配对", "pending");
  setTypingIndicator(true);
  elements.secureText.textContent = "等待对方加入";
}

function resetSessionUi() {
  elements.connectionState.textContent = "未连接";
  elements.peerState.textContent = "等待";
  elements.cryptoState.textContent = "未建立";
  elements.roomTitle.textContent = "尚未进入房间";
  elements.secureText.textContent = "输入房间号和口令后开始";
  elements.safetyCode.textContent = "----";
  setBadge(elements.connectionBadge, "离线", "idle");
  setBadge(elements.peerBadge, "未配对", "idle");
  elements.leaveButton.disabled = true;
  elements.joinButton.disabled = false;
  elements.messageList.querySelectorAll(".message").forEach((node) => node.remove());
  elements.emptyState.hidden = false;
  setTypingIndicator(false);
  setComposerEnabled(false);
  setDot("");
}

async function createKeyPair() {
  state.keyPair = await crypto.subtle.generateKey(
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    false,
    ["deriveBits"]
  );
  const rawPublicKey = bufferToBytes(await crypto.subtle.exportKey("raw", state.keyPair.publicKey));
  state.publicKeyB64 = bytesToBase64(rawPublicKey);
}

async function derivePasswordMaterial(sortedPublicKeys) {
  const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(state.secret), "PBKDF2", false, ["deriveBits"]);
  const salt = await sha256(`SecureRoom passphrase v1|${state.room}|${sortedPublicKeys.join("|")}`);
  return bufferToBytes(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt,
        iterations: 210000
      },
      passwordKey,
      256
    )
  );
}

async function buildSession(peerPublicKeyB64) {
  const peerPublicKey = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(peerPublicKeyB64),
    {
      name: "ECDH",
      namedCurve: "P-256"
    },
    true,
    []
  );

  const sharedSecret = bufferToBytes(
    await crypto.subtle.deriveBits(
      {
        name: "ECDH",
        public: peerPublicKey
      },
      state.keyPair.privateKey,
      256
    )
  );

  const sortedPublicKeys = [state.publicKeyB64, peerPublicKeyB64].sort();
  const passwordMaterial = await derivePasswordMaterial(sortedPublicKeys);
  const ikm = await sha256(concatBytes([sharedSecret, passwordMaterial]));
  const hkdfKey = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveKey"]);
  const salt = await sha256(`SecureRoom hkdf salt v1|${state.room}|${sortedPublicKeys.join("|")}`);

  state.sessionKey = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt,
      info: encoder.encode("SecureRoom AES-GCM v1")
    },
    hkdfKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );

  const safetyDigest = await sha256(concatBytes([encoder.encode("SecureRoom SAS v1|"), ikm]));
  elements.safetyCode.textContent = formatSafetyCode(safetyDigest);
  elements.cryptoState.textContent = "已建立";
  elements.secureText.textContent = "已建立密钥，请核对安全码";
  setBadge(elements.connectionBadge, "安全", "secure");
  setDot("secure");
  setTypingIndicator(false);
  setComposerEnabled(true);
  showCryptoStrength();
  await sendStatusUpdate();
  await flushPendingMessages();
}

async function sendSignal(type, payload) {
  const response = await fetch("/signal", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      room: state.room,
      clientId: state.clientId,
      type,
      payload
    })
  });

  if (!response.ok) {
    throw new Error(`signal failed: ${response.status}`);
  }
}

async function sendHello() {
  if (!state.publicKeyB64) {
    return;
  }
  await sendSignal("hello", {
    name: state.name,
    publicKey: state.publicKeyB64
  });
}

async function handleHello(from, payload) {
  if (!payload || typeof payload.publicKey !== "string" || payload.publicKey === state.publicKeyB64) {
    return;
  }

  state.peer = {
    id: from,
    name: String(payload.name || "对方").slice(0, 24),
    publicKey: payload.publicKey
  };
  elements.peerState.textContent = state.peer.name;
  elements.cryptoState.textContent = "派生中";
  elements.secureText.textContent = "正在建立密钥";
  setBadge(elements.peerBadge, state.peer.name, "active");
  setDot("pending");
  setTypingIndicator(true);

  await buildSession(payload.publicKey);

  if (!state.helloEchoedFor.has(from)) {
    state.helloEchoedFor.add(from);
    await sendHello();
  }
}

function buildMessageAad(payload) {
  return JSON.stringify({
    v: payload.v,
    room: payload.room,
    from: payload.from,
    id: payload.id,
    sentAt: payload.sentAt
  });
}

async function encryptText(text) {
  const sentAt = Date.now();
  const payload = {
    v: 1,
    room: state.room,
    from: state.clientId,
    id: randomHex(12),
    sentAt
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainText = JSON.stringify({
    text,
    name: state.name,
    sentAt
  });

  const ciphertext = bufferToBytes(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(buildMessageAad(payload))
      },
      state.sessionKey,
      encoder.encode(plainText)
    )
  );

  return {
    ...payload,
    nonce: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  };
}

async function decryptPayload(payload) {
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.nonce),
      additionalData: encoder.encode(buildMessageAad(payload))
    },
    state.sessionKey,
    base64ToBytes(payload.ciphertext)
  );
  return JSON.parse(decoder.decode(plaintext));
}

async function handleEncryptedMessage(payload) {
  if (!payload || typeof payload.id !== "string" || state.seenMessageIds.has(payload.id)) {
    return;
  }

  if (!state.sessionKey) {
    state.pendingMessages.push(payload);
    return;
  }

  try {
    const message = await decryptPayload(payload);
    state.seenMessageIds.add(payload.id);
    renderMessage({
      text: String(message.text || ""),
      name: String(message.name || state.peer?.name || "对方"),
      mine: false,
      sentAt: Number(message.sentAt) || Date.now(),
      messageId: payload.id
    });
    await markMessageAsRead(payload.id);
  } catch (error) {
    elements.cryptoState.textContent = "解密失败";
    elements.secureText.textContent = "口令或安全码不一致";
    setDot("error");
    showToast("消息解密失败，请核对双方口令和安全码");
  }
}

async function flushPendingMessages() {
  const pending = state.pendingMessages.splice(0);
  for (const payload of pending) {
    await handleEncryptedMessage(payload);
  }
}

async function handleSignal(event) {
  let signal;
  try {
    signal = JSON.parse(event.data);
  } catch (error) {
    return;
  }

  if (!signal || signal.from === state.clientId) {
    return;
  }

  try {
    if (signal.type === "hello") {
      await handleHello(signal.from, signal.payload);
    } else if (signal.type === "chat") {
      await handleEncryptedMessage(signal.payload);
    } else if (signal.type === "typing") {
      state.peerTyping = signal.payload?.active === true;
      setTypingIndicator(state.peerTyping);
    } else if (signal.type === "read") {
      const msgId = signal.payload?.messageId;
      if (msgId) {
        state.messageReadStatus.set(msgId, true);
        const msgElement = elements.messageList.querySelector(`[data-message-id="${msgId}"]`);
        if (msgElement) {
          showReadStatus(msgElement, msgId);
        }
      }
    } else if (signal.type === "edit") {
      const msgId = signal.payload?.messageId;
      const newText = signal.payload?.text;
      if (msgId && newText) {
        const msgElement = elements.messageList.querySelector(`[data-message-id="${msgId}"]`);
        if (msgElement) {
          const bubble = msgElement.querySelector(".bubble");
          if (bubble) {
            bubble.textContent = newText;
            const meta = msgElement.querySelector(".meta");
            if (meta && !meta.textContent.includes("已编辑")) {
              meta.textContent += " (已编辑)";
            }
          }
        }
      }
    } else if (signal.type === "delete") {
      const msgId = signal.payload?.messageId;
      if (msgId) {
        const msgElement = elements.messageList.querySelector(`[data-message-id="${msgId}"]`);
        if (msgElement) {
          const bubble = msgElement.querySelector(".bubble");
          if (bubble) {
            bubble.textContent = "[消息已删除]";
            bubble.classList.add("deleted-message");
            msgElement.classList.add("is-deleted");
          }
        }
      }
    } else if (signal.type === "status") {
      const online = signal.payload?.online === true;
      setPeerOnlineStatus(online);
    } else if (signal.type === "file") {
      showToast("对方分享了文件（功能开发中）");
    }
  } catch (error) {
    setDot("error");
    showToast("会话处理失败，请刷新后重试");
  }
}

function handlePresence(event) {
  try {
    const data = JSON.parse(event.data);
    if (data.count <= 1 && !state.sessionKey) {
      elements.peerState.textContent = "等待对方";
      elements.secureText.textContent = "等待对方加入";
      setBadge(elements.peerBadge, "未配对", "idle");
      setTypingIndicator(true);
    } else if (data.count >= 2 && !state.sessionKey) {
      elements.peerState.textContent = "已加入";
      elements.secureText.textContent = "正在协商密钥";
      setBadge(elements.peerBadge, "已加入", "pending");
      setTypingIndicator(true);
    }
  } catch (error) {
    // Ignore malformed presence packets from interrupted connections.
  }
}

async function joinRoom(event) {
  event.preventDefault();

  if (!globalThis.crypto?.subtle || !window.EventSource) {
    showToast("当前浏览器不支持安全上下文，请使用 HTTPS 或 localhost");
    return;
  }

  const name = elements.nameInput.value.trim();
  const room = elements.roomInput.value.trim();
  const secret = elements.secretInput.value;

  if (!name || !room || secret.length < 8) {
    showToast("请填写昵称、房间号和至少 8 位口令");
    return;
  }

  leaveRoom(false);

  state.name = name.slice(0, 24);
  state.room = room.slice(0, 80);
  state.secret = secret;
  state.sessionKey = null;
  state.peer = null;
  state.helloEchoedFor.clear();
  state.pendingMessages = [];
  state.seenMessageIds.clear();
  localStorage.setItem("secure-chat-name", state.name);

  elements.joinButton.disabled = true;
  elements.joinButton.textContent = "进入中";
  elements.messageList.querySelectorAll(".message").forEach((node) => node.remove());
  elements.emptyState.hidden = false;

  try {
    await createKeyPair();

    const source = new EventSource(`/events?room=${encodeURIComponent(state.room)}&client=${encodeURIComponent(state.clientId)}`);
    state.eventSource = source;

    source.addEventListener("ready", async () => {
      setConnectedUi();
      renderSystemMessage("已进入房间");
      try {
        await sendHello();
      } catch (error) {
        showToast("握手发送失败");
      }
    });

    source.addEventListener("presence", handlePresence);
    source.addEventListener("signal", handleSignal);
    source.addEventListener("room-full", () => {
      showToast("房间已满，请换一个房间号");
      leaveRoom(false);
      elements.peerState.textContent = "房间已满";
      setBadge(elements.peerBadge, "已满", "error");
    });

    source.onerror = () => {
      if (state.eventSource) {
        elements.connectionState.textContent = "重连中";
        elements.secureText.textContent = "连接中断，正在重连";
        setDot("pending");
        setBadge(elements.connectionBadge, "重连中", "pending");
        setTypingIndicator(true);
      }
    };
  } catch (error) {
    showToast("进入房间失败");
    leaveRoom(false);
  } finally {
    elements.joinButton.textContent = "进入会话";
    if (!state.eventSource) {
      elements.joinButton.disabled = false;
    }
  }
}

async function sendMessage(event) {
  event.preventDefault();
  const text = elements.messageInput.value.trim();
  if (!text || !state.sessionKey) {
    return;
  }

  elements.messageInput.value = "";
  autoResizeMessageInput();

  try {
    const encrypted = await encryptText(text);
    state.seenMessageIds.add(encrypted.id);
    
    const replyTo = state.replyingToMessageId ? {
      author: state.messageStore.get(state.replyingToMessageId)?.name || "匿名",
      text: state.messageStore.get(state.replyingToMessageId)?.text || ""
    } : null;
    
    renderMessage({
      text,
      name: state.name,
      mine: true,
      sentAt: encrypted.sentAt,
      messageId: encrypted.id,
      replyTo
    });
    state.peerTyping = false;
    setTypingIndicator(false);
    
    const payload = { ...encrypted, replyTo: state.replyingToMessageId || null };
    await sendSignal("chat", payload);
    clearReplyTarget();
  } catch (error) {
    const failedMsg = { text, sentAt: Date.now() };
    savePendingMessage(failedMsg);
    showToast("网络不稳定，消息已保存，将在恢复后重试");
  }
}

function leaveRoom(showMessage = true) {
  if (state.eventSource) {
    state.eventSource.close();
  }
  state.eventSource = null;
  state.keyPair = null;
  state.publicKeyB64 = "";
  state.sessionKey = null;
  state.peer = null;
  state.peerOnline = false;
  state.secret = "";
  state.pendingMessages = [];
  state.helloEchoedFor.clear();
  state.peerTyping = false;
  state.messageReadStatus.clear();
  state.messageStore.clear();
  state.editingMessageId = null;
  state.replyingToMessageId = null;
  if (state.typingTimeout) {
    clearTimeout(state.typingTimeout);
    state.typingTimeout = null;
  }
  resetSessionUi();
  if (showMessage) {
    showToast("已离开会话");
  }
}

function generateRoomCode() {
  const first = randomHex(2).toUpperCase();
  const second = randomHex(2).toUpperCase();
  elements.roomInput.value = `SECURE-${first}-${second}`;
}

function autoResizeMessageInput() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 160)}px`;
}

function boot() {
  elements.nameInput.value = localStorage.getItem("secure-chat-name") || "";
  elements.joinForm.addEventListener("submit", joinRoom);
  elements.messageForm.addEventListener("submit", sendMessage);
  elements.randomRoomButton.addEventListener("click", generateRoomCode);
  elements.leaveButton.addEventListener("click", () => leaveRoom(true));
  elements.messageInput.addEventListener("input", autoResizeMessageInput);
  elements.messageInput.addEventListener("input", () => {
    if (state.sessionKey && elements.messageInput.value.trim()) {
      sendTypingIndicator();
      if (state.typingTimeout) {
        clearTimeout(state.typingTimeout);
      }
      state.typingTimeout = setTimeout(() => {
        state.peerTyping = false;
        setTypingIndicator(false);
      }, 3000);
    }
  });
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.messageForm.requestSubmit();
    }
  });
  window.addEventListener("beforeunload", () => {
    if (state.eventSource) {
      state.eventSource.close();
    }
  });
}

boot();
