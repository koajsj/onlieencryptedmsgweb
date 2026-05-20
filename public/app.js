"use strict";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const urlParams = new URLSearchParams(window.location.search);
const storageChannel = "BroadcastChannel" in window ? new BroadcastChannel("secure-chat-storage") : null;

const STORAGE = {
  clientIdLegacy: "secure-chat-client-id",
  tabClientId: "secure-chat-tab-client-id",
  deviceId: "secure-chat-device-id",
  name: "secure-chat-name",
  conversations: "secure-chat-conversations-v3",
  previewRoom: "secure-chat-preview-room-v1"
};

const DATABASE = {
  name: "secure-chat-db",
  version: 1,
  store: "kv",
  migrationKey: "migration:indexeddb:v1",
  conversationsKey: "conversations",
  previewRoomKey: "preview-room"
};

const EDIT_WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 512 * 1024;
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_EXPORT_QUALITY = 0.82;
const MAX_SIGNAL_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const RECONNECT_BASE_MS = 1200;
const RECONNECT_MAX_MS = 10000;

const elements = {
  joinForm: $("#joinForm"),
  nameInput: $("#nameInput"),
  roomInput: $("#roomInput"),
  secretInput: $("#secretInput"),
  randomRoomButton: $("#randomRoomButton"),
  joinButton: $("#joinButton"),
  leaveButton: $("#leaveButton"),
  conversationSearchInput: $("#conversationSearchInput"),
  conversationList: $("#conversationList"),
  conversationEmpty: $("#conversationEmpty"),
  connectionStates: $$("[data-role='connection-state']"),
  peerStates: $$("[data-role='peer-state']"),
  cryptoStates: $$("[data-role='crypto-state']"),
  connectionBadge: $("#connectionBadge"),
  peerBadge: $("#peerBadge"),
  peerStatusBadge: $("#peerStatusBadge"),
  roomTitle: $("#roomTitle"),
  roomSubline: $("#roomSubline"),
  secureDot: $("#secureDot"),
  secureText: $("#secureText"),
  safetyCode: $("#safetyCode"),
  cryptoBadge: $("#cryptoBadge"),
  toggleSearchButton: $("#toggleSearchButton"),
  openInfoButton: $("#openInfoButton"),
  messageSearchBar: $("#messageSearchBar"),
  messageSearchInput: $("#messageSearchInput"),
  messageSearchCount: $("#messageSearchCount"),
  searchPrevButton: $("#searchPrevButton"),
  searchNextButton: $("#searchNextButton"),
  closeSearchButton: $("#closeSearchButton"),
  messageList: $("#messageList"),
  emptyState: $("#emptyState"),
  typingIndicator: $("#typingIndicator"),
  messageForm: $("#messageForm"),
  messageInput: $("#messageInput"),
  sendButton: $("#sendButton"),
  composerMeta: $("#composerMeta"),
  composerMetaTitle: $("#composerMetaTitle"),
  composerMetaText: $("#composerMetaText"),
  clearComposerMetaButton: $("#clearComposerMetaButton"),
  attachButton: $("#attachButton"),
  attachmentInput: $("#attachmentInput"),
  attachmentPreview: $("#attachmentPreview"),
  attachmentPreviewMedia: $("#attachmentPreviewMedia"),
  attachmentPreviewName: $("#attachmentPreviewName"),
  attachmentPreviewMeta: $("#attachmentPreviewMeta"),
  removeAttachmentButton: $("#removeAttachmentButton"),
  emojiRow: $("#emojiRow"),
  infoDrawer: $("#infoDrawer"),
  drawerScrim: $("#drawerScrim"),
  closeInfoButton: $("#closeInfoButton"),
  infoRoom: $("#infoRoom"),
  infoPeer: $("#infoPeer"),
  infoSafety: $("#infoSafety"),
  infoMessageCount: $("#infoMessageCount"),
  copyRoomButton: $("#copyRoomButton"),
  rekeyButton: $("#rekeyButton"),
  clearLocalButton: $("#clearLocalButton"),
  drawerLeaveButton: $("#drawerLeaveButton"),
  historyDialog: $("#historyDialog"),
  historyScrim: $("#historyScrim"),
  closeHistoryButton: $("#closeHistoryButton"),
  historyDialogTitle: $("#historyDialogTitle"),
  historyList: $("#historyList"),
  confirmDialog: $("#confirmDialog"),
  confirmScrim: $("#confirmScrim"),
  confirmTitle: $("#confirmTitle"),
  confirmText: $("#confirmText"),
  confirmCancelButton: $("#confirmCancelButton"),
  confirmConfirmButton: $("#confirmConfirmButton"),
  toast: $("#toast")
};

const state = {
  clientId: loadClientId(),
  deviceId: loadDeviceId(),
  room: "",
  previewRoom: "",
  name: "",
  secret: "",
  eventSource: null,
  eventSourceReconnectTimer: 0,
  reconnectAttempt: 0,
  reconnecting: false,
  shouldReconnect: false,
  keyPair: null,
  publicKeyB64: "",
  sessionKey: null,
  peer: null,
  peerTrustState: "unknown",
  peerTrustNote: "",
  peerOnline: false,
  peerLastSeenAt: 0,
  helloEchoedFor: new Set(),
  pendingSecureSignals: [],
  seenSignalIds: new Set(),
  messageStore: new Map(),
  messageOrder: [],
  messageReadStatus: new Set(),
  replyingToMessageId: "",
  replyingQuoteText: "",
  editingMessageId: "",
  typingHideTimer: 0,
  toastTimer: 0,
  readyReceived: false,
  attachmentDraft: null,
  conversationSearchQuery: "",
  conversations: loadConversationSummaries(),
  activeConversationRoom: "",
  messageSearchQuery: "",
  searchMatchIds: [],
  activeSearchIndex: -1,
  longPressTimer: 0,
  swipeState: null,
  sendInFlight: false,
  dragCounter: 0,
  vaultKeyCache: new Map(),
  persistTimer: 0,
  db: null,
  bootReady: false,
  confirmResolver: null,
  dialogStack: [],
  lastFocusBeforeDialog: null
};

function loadClientId() {
  const storageKey = STORAGE.tabClientId;
  const stored = sessionStorage.getItem(storageKey);
  if (stored && /^[a-f0-9]{24,64}$/i.test(stored)) {
    return stored;
  }

  const next = randomHex(16);
  sessionStorage.setItem(storageKey, next);
  return next;
}

function loadDeviceId() {
  const stored = localStorage.getItem(STORAGE.deviceId);
  if (stored && /^[a-f0-9]{24,64}$/i.test(stored)) {
    return stored;
  }

  const next = randomHex(16);
  localStorage.setItem(STORAGE.deviceId, next);
  return next;
}

function conversationVaultKey(room) {
  return `vault:${room}`;
}

function peerPinKey(room) {
  return `peer-pin:${room}`;
}

async function openDatabase() {
  if (state.db) {
    return state.db;
  }

  state.db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE.name, DATABASE.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DATABASE.store)) {
        db.createObjectStore(DATABASE.store, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("indexeddb open failed"));
  });

  return state.db;
}

async function withStore(mode, handler) {
  const db = await openDatabase();
  return await new Promise((resolve, reject) => {
    const transaction = db.transaction(DATABASE.store, mode);
    const store = transaction.objectStore(DATABASE.store);
    let settled = false;

    transaction.oncomplete = () => {
      if (!settled) {
        resolve(undefined);
      }
    };
    transaction.onerror = () => reject(transaction.error || new Error("indexeddb transaction failed"));
    transaction.onabort = () => reject(transaction.error || new Error("indexeddb transaction aborted"));

    Promise.resolve(handler(store, resolve, reject))
      .then((value) => {
        if (value !== undefined && !settled) {
          settled = true;
          resolve(value);
        }
      })
      .catch(reject);
  });
}

async function readStoredValue(key, fallback = null) {
  return await withStore("readonly", (store, resolve) => {
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ? request.result.value : fallback);
    request.onerror = () => resolve(fallback);
  });
}

async function writeStoredValue(key, value) {
  return await withStore("readwrite", (store, resolve, reject) => {
    const request = store.put({ key, value });
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error("indexeddb write failed"));
  });
}

async function deleteStoredValue(key) {
  return await withStore("readwrite", (store, resolve, reject) => {
    const request = store.delete(key);
    request.onsuccess = () => resolve(true);
    request.onerror = () => reject(request.error || new Error("indexeddb delete failed"));
  });
}

async function migrateLegacyStorage() {
  const migrated = await readStoredValue(DATABASE.migrationKey, false);
  if (migrated) {
    return;
  }

  const legacyConversations = readJsonFromLocalStorage(STORAGE.conversations, []);
  if (Array.isArray(legacyConversations) && legacyConversations.length) {
    await writeStoredValue(DATABASE.conversationsKey, legacyConversations);
  }

  const legacyPreviewRoom = localStorage.getItem(STORAGE.previewRoom) || "";
  if (legacyPreviewRoom) {
    await writeStoredValue(DATABASE.previewRoomKey, legacyPreviewRoom);
  }

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key || !key.startsWith("secure-chat-vault:")) {
      continue;
    }
    const room = key.slice("secure-chat-vault:".length);
    const value = readJsonFromLocalStorage(key, null);
    if (value) {
      await writeStoredValue(conversationVaultKey(room), value);
    }
  }

  await writeStoredValue(DATABASE.migrationKey, true);
}

function readJsonFromLocalStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    return fallback;
  }
}

function loadConversationSummaries() {
  return [];
}

async function loadStorageState() {
  await migrateLegacyStorage();
  state.conversations = sortConversations(await readStoredValue(DATABASE.conversationsKey, []));
  state.previewRoom = (await readStoredValue(DATABASE.previewRoomKey, "")) || "";
}

function broadcastStorageUpdate(type, payload = {}) {
  if (storageChannel) {
    storageChannel.postMessage({ type, payload });
  }
}

function setPreviewRoom(room) {
  state.previewRoom = room || "";
  void writeStoredValue(DATABASE.previewRoomKey, state.previewRoom);
  broadcastStorageUpdate("preview-room", { room: state.previewRoom });
}

function clearPreviewRoom() {
  state.previewRoom = "";
  void deleteStoredValue(DATABASE.previewRoomKey);
  broadcastStorageUpdate("preview-room", { room: "" });
}

async function readPeerPin(room) {
  return await readStoredValue(peerPinKey(room), null);
}

async function writePeerPin(room, value) {
  await writeStoredValue(peerPinKey(room), value);
}

async function fingerprintPublicKey(publicKeyB64) {
  const digest = await sha256(base64ToBytes(publicKeyB64));
  return formatSafetyCode(digest);
}

function sanitizeAttachment(attachment) {
  if (!attachment) {
    return null;
  }
  const { previewUrl, ...rest } = attachment;
  return rest;
}

function revokeAttachmentPreview(attachment) {
  if (attachment?.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

function randomHex(byteLength) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function setText(nodes, text) {
  for (const node of nodes) {
    node.textContent = text;
  }
}

function setAppConnectedState(connected) {
  document.body.classList.toggle("is-connected", connected);
}

function setConnectionState(text) {
  setText(elements.connectionStates, text);
}

function setPeerState(text) {
  setText(elements.peerStates, text);
}

function setCryptoState(text) {
  setText(elements.cryptoStates, text);
}

function formatSafetyCode(bytes) {
  return [...bytes.slice(0, 8)]
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join("")
    .replace(/(.{4})/g, "$1-")
    .replace(/-$/, "");
}

function formatMessageTime(timestamp) {
  const sentAt = new Date(timestamp);
  const now = new Date();
  const diffMinutes = Math.floor((now - sentAt) / 60000);

  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes}分钟前`;
  }
  if (diffMinutes < 24 * 60) {
    return sentAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  const diffDays = Math.floor(diffMinutes / (24 * 60));
  if (diffDays === 1) {
    return "昨天";
  }
  if (diffDays < 7) {
    return `${diffDays}天前`;
  }

  return sentAt.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatExactTime(timestamp) {
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function summarizeText(value, maxLength = 52) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "空消息";
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}…` : normalized;
}

function isAllowedAttachment(file) {
  if (!file) {
    return false;
  }

  const type = String(file.type || "").toLowerCase();
  return (
    type.startsWith("image/") ||
    [
      "application/pdf",
      "text/plain",
      "application/json",
      "application/zip",
      "application/x-zip-compressed"
    ].includes(type)
  );
}

function isFreshSignalTimestamp(timestamp) {
  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return false;
  }

  const now = Date.now();
  return sentAt <= now + MAX_FUTURE_SKEW_MS && sentAt >= now - MAX_SIGNAL_AGE_MS;
}

function buildSearchRegex(query) {
  if (!query) {
    return null;
  }
  return new RegExp(
    query
      .trim()
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "|"),
    "gi"
  );
}

function highlightText(text, query) {
  const safeText = escapeHtml(text);
  if (!query) {
    return safeText.replaceAll("\n", "<br />");
  }

  const regex = buildSearchRegex(query);
  if (!regex) {
    return safeText.replaceAll("\n", "<br />");
  }

  return safeText.replace(regex, (match) => `<mark>${escapeHtml(match)}</mark>`).replaceAll("\n", "<br />");
}

function setDot(mode) {
  elements.secureDot.className = "status-dot";
  if (mode) {
    elements.secureDot.classList.add(`is-${mode}`);
  }
}

function setBadge(element, text, stateName = "idle") {
  element.textContent = text;
  element.dataset.state = stateName;
}

function setTypingIndicator(visible) {
  elements.typingIndicator.hidden = !visible;
  if (visible) {
    scrollMessageList(false);
  }
}

function setPeerOnlineStatus(online) {
  state.peerOnline = online;
  if (state.peerTrustNote) {
    elements.peerStatusBadge.hidden = false;
    return;
  }
  elements.peerStatusBadge.hidden = !online;
  if (online) {
    setBadge(elements.peerStatusBadge, "对方在线", "secure");
  }
}

function setPeerTrustState(stateName, text = "") {
  state.peerTrustState = stateName;
  state.peerTrustNote = text;
  elements.peerStatusBadge.hidden = !text && !state.peerOnline;

  if (text) {
    setBadge(elements.peerStatusBadge, text, stateName);
    elements.peerStatusBadge.hidden = false;
  } else if (state.peerOnline) {
    setBadge(elements.peerStatusBadge, "对方在线", "secure");
    elements.peerStatusBadge.hidden = false;
  }
}

function setComposerEnabled(enabled) {
  elements.messageInput.disabled = !enabled;
  elements.sendButton.disabled = !enabled || state.sendInFlight;
  elements.attachButton.disabled = !enabled;
  elements.attachmentInput.disabled = !enabled;

  if (!enabled) {
    elements.messageInput.placeholder = "等待加密会话建立";
  } else if (state.editingMessageId) {
    elements.messageInput.placeholder = "修改后按 Enter 保存";
  } else {
    elements.messageInput.placeholder = "输入消息，或拖拽图片/文件到聊天区";
  }
}

function resetMessageComposer() {
  elements.messageInput.value = "";
  autoResizeMessageInput();
  clearComposerMetaState();
  clearAttachmentDraft(false);
}

function updateComposerMeta() {
  if (state.editingMessageId) {
    const message = state.messageStore.get(state.editingMessageId);
    elements.composerMeta.hidden = false;
    elements.composerMetaTitle.textContent = "正在编辑消息";
    elements.composerMetaText.textContent = message ? summarizeText(message.text) : "修改后将覆盖原消息";
    elements.sendButton.textContent = "保存";
  } else if (state.replyingToMessageId) {
    const message = state.messageStore.get(state.replyingToMessageId);
    elements.composerMeta.hidden = false;
    elements.composerMetaTitle.textContent = message
      ? `回复 ${message.mine ? "你" : message.name || "对方"}`
      : "回复消息";
    elements.composerMetaText.textContent =
      state.replyingQuoteText ||
      (message ? summarizeText(message.deleted ? "这条消息已删除" : message.text) : "引用原消息发送");
    elements.sendButton.textContent = "发送";
  } else {
    elements.composerMeta.hidden = true;
    elements.sendButton.textContent = state.sendInFlight ? "发送中..." : "发送";
  }

  if (state.sendInFlight && !state.editingMessageId) {
    elements.sendButton.textContent = "发送中...";
  }

  setComposerEnabled(Boolean(state.sessionKey));
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2600);
}

function autoResizeMessageInput() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 180)}px`;
}

function closeOpenMenus(exceptMenu = null) {
  for (const menu of $$(".message-menu[open]")) {
    if (menu !== exceptMenu) {
      menu.open = false;
    }
  }
}

function scrollMessageList(force) {
  const threshold = 120;
  const distanceToBottom =
    elements.messageList.scrollHeight - elements.messageList.clientHeight - elements.messageList.scrollTop;

  if (force || distanceToBottom < threshold) {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }
}

function syncEmptyState() {
  elements.emptyState.hidden = Boolean(elements.messageList.querySelector(".message"));
}

function currentRoomKey() {
  return state.room || state.previewRoom || elements.roomInput.value.trim();
}

async function deriveVaultKey(room, secret) {
  const cacheKey = `${room}\u0000${secret}`;
  if (state.vaultKeyCache.has(cacheKey)) {
    return state.vaultKeyCache.get(cacheKey);
  }

  const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(secret), "PBKDF2", false, ["deriveKey"]);
  const salt = await sha256(`SecureRoom local vault v1|${room}`);
  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: 210000
    },
    passwordKey,
    {
      name: "AES-GCM",
      length: 256
    },
    false,
    ["encrypt", "decrypt"]
  );

  state.vaultKeyCache.set(cacheKey, derivedKey);
  return derivedKey;
}

async function encryptVaultPayload(room, secret, payload) {
  const key = await deriveVaultKey(room, secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = encoder.encode(JSON.stringify(payload));
  const ciphertext = bufferToBytes(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext));
  return {
    v: 1,
    nonce: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext),
    updatedAt: Date.now()
  };
}

async function decryptVaultPayload(room, secret) {
  const stored = await readStoredValue(conversationVaultKey(room), null);
  if (!stored || stored.v !== 1 || typeof stored.nonce !== "string" || typeof stored.ciphertext !== "string") {
    return null;
  }

  const key = await deriveVaultKey(room, secret);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(stored.nonce)
    },
    key,
    base64ToBytes(stored.ciphertext)
  );

  return JSON.parse(decoder.decode(plaintext));
}

function latestPersistableMessageSummary() {
  return [...state.messageOrder]
    .reverse()
    .map((messageId) => state.messageStore.get(messageId))
    .find((message) => message && !message.system);
}

async function persistProtectedVault(room) {
  if (!room || !state.secret) {
    return;
  }

  try {
    const payload = {
      messages: state.messageOrder
        .map((messageId) => state.messageStore.get(messageId))
        .filter(Boolean)
        .filter((message) => !message.system)
        .map(serializeMessage),
      draft: {
        text: elements.messageInput.value,
        attachment: sanitizeAttachment(state.attachmentDraft)
      },
      seenSignalIds: [...state.seenSignalIds].slice(-800)
    };

    const sealed = await encryptVaultPayload(room, state.secret, payload);
    await writeStoredValue(conversationVaultKey(room), sealed);

    const latest = latestPersistableMessageSummary();
    upsertConversationSummary({
      room,
      name: state.name || elements.nameInput.value.trim(),
      peerName: state.peer?.name || getConversationSummary(room)?.peerName || "",
      hasDraft: Boolean(payload.draft.text || payload.draft.attachment),
      hasLocalCache: Boolean(payload.messages.length || payload.draft.text || payload.draft.attachment),
      lastKind: latest?.attachment ? latest.attachment.kind : latest ? "text" : "",
      updatedAt: latest?.sentAt || Date.now()
    });
  } catch (error) {
    showToast("受保护缓存写入失败");
  }
}

function scheduleProtectedPersist(room) {
  if (!room || !state.secret) {
    return;
  }

  window.clearTimeout(state.persistTimer);
  state.persistTimer = window.setTimeout(() => {
    void persistProtectedVault(room);
  }, 220);
}

function saveCurrentDraft() {
  const room = currentRoomKey();
  if (!room || !state.secret) {
    return;
  }

  scheduleProtectedPersist(room);
}

async function loadProtectedVault(room, secret) {
  if (!room || !secret) {
    return null;
  }

  try {
    return await decryptVaultPayload(room, secret);
  } catch (error) {
    return null;
  }
}

async function clearConversationStorage(room) {
  await deleteStoredValue(conversationVaultKey(room));
  await deleteStoredValue(peerPinKey(room));
  state.conversations = state.conversations.filter((conversation) => conversation.room !== room);
  saveConversationSummaries();
  renderConversationList();
}

function serializeMessage(message) {
  return {
    id: message.id,
    text: message.text,
    name: message.name,
    mine: message.mine,
    sentAt: message.sentAt,
    editedAt: message.editedAt || 0,
    deleted: Boolean(message.deleted),
    status: message.status || "sent",
    replyTo: message.replyTo || null,
    attachment: sanitizeAttachment(message.attachment),
    editHistory: message.editHistory || []
  };
}

function saveConversationSummaries() {
  void writeStoredValue(DATABASE.conversationsKey, state.conversations);
  broadcastStorageUpdate("conversations");
}

function sortConversations(list) {
  return [...list].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return Number(Boolean(right.pinned)) - Number(Boolean(left.pinned));
    }
    return (right.updatedAt || 0) - (left.updatedAt || 0);
  });
}

function getConversationSummary(room) {
  return state.conversations.find((conversation) => conversation.room === room) || null;
}

function upsertConversationSummary(patch) {
  const existing = getConversationSummary(patch.room);
  const next = {
    room: patch.room,
    name: existing?.name || "",
    peerName: existing?.peerName || "",
    updatedAt: existing?.updatedAt || Date.now(),
    unreadCount: existing?.unreadCount || 0,
    pinned: Boolean(existing?.pinned),
    lastSeenAt: existing?.lastSeenAt || 0,
    hasDraft: Boolean(existing?.hasDraft),
    hasLocalCache: Boolean(existing?.hasLocalCache),
    lastKind: existing?.lastKind || "",
    ...existing,
    ...patch
  };

  state.conversations = state.conversations.filter((conversation) => conversation.room !== next.room);
  state.conversations.push(next);
  state.conversations = sortConversations(state.conversations);
  saveConversationSummaries();
  renderConversationList();
  return next;
}

function toggleConversationPin(room) {
  const summary = getConversationSummary(room);
  if (!summary) {
    return;
  }

  upsertConversationSummary({ room, pinned: !summary.pinned });
}

function formatConversationPreview(summary) {
  if (summary.hasDraft) {
    return "有受保护草稿";
  }
  if (summary.lastKind === "image") {
    return "已保存受保护图片";
  }
  if (summary.lastKind === "file") {
    return "已保存受保护文件";
  }
  if (summary.lastKind === "text") {
    return "已保存受保护消息";
  }
  if (summary.hasLocalCache) {
    return "有受保护本地记录";
  }
  return "暂时没有消息";
}

function renderConversationList() {
  const query = state.conversationSearchQuery.trim().toLowerCase();
  const list = sortConversations(state.conversations).filter((conversation) => {
    if (!query) {
      return true;
    }
    return [conversation.room, conversation.peerName, conversation.name]
      .join(" ")
      .toLowerCase()
      .includes(query);
  });

  elements.conversationList.textContent = "";
  elements.conversationEmpty.hidden = list.length > 0;

  for (const conversation of list) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "conversation-item";
    if (conversation.room === (state.room || state.previewRoom)) {
      button.classList.add("is-active");
    }
    button.dataset.room = conversation.room;
    button.innerHTML = `
      <div class="conversation-avatar">${escapeHtml((conversation.peerName || conversation.room || "#").slice(0, 1).toUpperCase())}</div>
      <div class="conversation-main">
        <div class="conversation-topline">
          <span class="conversation-room">${escapeHtml(conversation.peerName || conversation.room)}</span>
          <span class="conversation-time">${conversation.updatedAt ? escapeHtml(formatMessageTime(conversation.updatedAt)) : ""}</span>
        </div>
        <div class="conversation-preview">${escapeHtml(formatConversationPreview(conversation))}</div>
        <div class="conversation-meta">
          ${conversation.pinned ? '<span class="conversation-pill">置顶</span>' : ""}
          ${conversation.unreadCount ? `<span class="unread-badge">${conversation.unreadCount}</span>` : ""}
        </div>
      </div>
      <span class="pin-button ${conversation.pinned ? "is-pinned" : ""}" data-action="toggle-pin" data-room="${escapeHtml(
      conversation.room
    )}" aria-label="置顶会话">★</span>
    `;
    elements.conversationList.append(button);
  }
}

function updateRoomSubline() {
  if (state.sessionKey) {
    if (state.peerOnline) {
      elements.roomSubline.textContent = state.peer ? `${state.peer.name} 在线` : "对方在线";
    } else if (state.peerLastSeenAt) {
      elements.roomSubline.textContent = `${state.peer?.name || "对方"} 最后在线 ${formatMessageTime(state.peerLastSeenAt)}`;
    } else {
      elements.roomSubline.textContent = state.peer?.name || "等待加入";
    }
  } else if (state.previewRoom) {
    elements.roomSubline.textContent = "本地记录已加密，输入口令后恢复";
  } else {
    elements.roomSubline.textContent = "等待加入";
  }
}

function updateInfoDrawer() {
  const room = state.room || state.previewRoom || "-";
  const messageCount = state.messageOrder.length;
  elements.infoRoom.textContent = room || "-";
  elements.infoPeer.textContent = state.peer?.name || getConversationSummary(room)?.peerName || "-";
  elements.infoSafety.textContent = elements.safetyCode.textContent;
  elements.infoMessageCount.textContent = String(messageCount);
}

function getOpenDialogPanel() {
  const root = state.dialogStack[state.dialogStack.length - 1];
  return root ? root.querySelector("[data-dialog-panel]") : null;
}

function getFocusableNodes(root) {
  return [...root.querySelectorAll("button, [href], input, textarea, select, details, summary, [tabindex]:not([tabindex='-1'])")].filter(
    (node) => !node.disabled && !node.hidden && node.getClientRects().length > 0
  );
}

function trapDialogFocus(event) {
  if (event.key === "Escape") {
    const activeRoot = state.dialogStack[state.dialogStack.length - 1];
    if (activeRoot === elements.confirmDialog) {
      resolveConfirmDialog(false);
      event.preventDefault();
    } else if (activeRoot === elements.historyDialog) {
      closeHistoryDialog();
      event.preventDefault();
    } else if (activeRoot === elements.infoDrawer) {
      closeInfoDrawer();
      event.preventDefault();
    }
    return;
  }

  if (event.key !== "Tab") {
    return;
  }

  const panel = getOpenDialogPanel();
  if (!panel) {
    return;
  }

  const focusables = getFocusableNodes(panel);
  if (!focusables.length) {
    panel.focus();
    event.preventDefault();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    last.focus();
    event.preventDefault();
  } else if (!event.shiftKey && document.activeElement === last) {
    first.focus();
    event.preventDefault();
  }
}

function ensureDialogTrap() {
  if (state.dialogStack.length === 1) {
    document.addEventListener("keydown", trapDialogFocus);
  }
}

function releaseDialogTrapIfNeeded() {
  if (!state.dialogStack.length) {
    document.removeEventListener("keydown", trapDialogFocus);
    if (state.lastFocusBeforeDialog?.focus) {
      state.lastFocusBeforeDialog.focus();
    }
    state.lastFocusBeforeDialog = null;
  }
}

function openDialog(root, panel, initialFocus = null) {
  if (!state.dialogStack.includes(root)) {
    if (!state.dialogStack.length) {
      state.lastFocusBeforeDialog = document.activeElement;
    }
    state.dialogStack.push(root);
  }
  root.hidden = false;
  ensureDialogTrap();
  const focusTarget = initialFocus || getFocusableNodes(panel)[0] || panel;
  window.setTimeout(() => focusTarget.focus(), 0);
}

function closeDialog(root) {
  root.hidden = true;
  state.dialogStack = state.dialogStack.filter((item) => item !== root);
  releaseDialogTrapIfNeeded();
}

function openInfoDrawer() {
  updateInfoDrawer();
  openDialog(elements.infoDrawer, elements.infoDrawer.querySelector("[data-dialog-panel]"), elements.closeInfoButton);
}

function closeInfoDrawer() {
  closeDialog(elements.infoDrawer);
}

function openHistoryDialog(message) {
  elements.historyList.textContent = "";
  elements.historyDialogTitle.textContent = message.mine ? "你发送的消息版本" : `${message.name || "对方"}的消息版本`;

  const versions = [{ at: message.sentAt, text: message.text, current: true }, ...(message.editHistory || [])].sort(
    (left, right) => right.at - left.at
  );

  for (const version of versions) {
    const item = document.createElement("article");
    item.className = "history-item";
    item.innerHTML = `
      <strong>${escapeHtml(version.current ? "当前版本" : formatExactTime(version.at))}</strong>
      <span>${escapeHtml(version.text).replaceAll("\n", "<br />")}</span>
    `;
    elements.historyList.append(item);
  }

  openDialog(elements.historyDialog, elements.historyDialog.querySelector("[data-dialog-panel]"), elements.closeHistoryButton);
}

function closeHistoryDialog() {
  closeDialog(elements.historyDialog);
}

function resolveConfirmDialog(result) {
  if (state.confirmResolver) {
    state.confirmResolver(result);
    state.confirmResolver = null;
  }
  closeDialog(elements.confirmDialog);
}

async function confirmAction(title, text, confirmLabel = "确认") {
  if (window.__secureChatTestBypassConfirm) {
    window.__secureChatTestBypassConfirm = false;
    return true;
  }
  elements.confirmTitle.textContent = title;
  elements.confirmText.textContent = text;
  elements.confirmConfirmButton.textContent = confirmLabel;
  openDialog(elements.confirmDialog, elements.confirmDialog.querySelector("[data-dialog-panel]"), elements.confirmCancelButton);
  return await new Promise((resolve) => {
    state.confirmResolver = resolve;
  });
}

function createMessageNode(message) {
  const article = document.createElement("article");
  article.className = "message";
  article.dataset.messageId = message.id;

  const row = document.createElement("div");
  row.className = "message-row";

  const content = document.createElement("div");
  content.className = "message-content";

  const quote = document.createElement("div");
  quote.className = "message-quote";
  quote.hidden = true;

  const quoteAuthor = document.createElement("strong");
  quoteAuthor.className = "message-quote-author";
  const quoteText = document.createElement("span");
  quoteText.className = "message-quote-text";
  quote.append(quoteAuthor, quoteText);

  const bubble = document.createElement("div");
  bubble.className = "bubble";

  const text = document.createElement("div");
  text.className = "message-text";
  bubble.append(text);

  const attachment = document.createElement("div");
  attachment.className = "message-attachment";
  attachment.hidden = true;

  const meta = document.createElement("div");
  meta.className = "meta";

  content.append(quote, bubble, attachment, meta);
  row.append(content);

  if (!message.system) {
    const menu = document.createElement("details");
    menu.className = "message-menu";
    const summary = document.createElement("summary");
    summary.className = "menu-button";
    summary.setAttribute("aria-label", "消息操作");
    summary.textContent = "⋯";
    const panel = document.createElement("div");
    panel.className = "message-menu-panel";
    menu.append(summary, panel);
    row.append(menu);
  }

  article.append(row);
  return article;
}

function buildMessageAction(label, action, messageId, tone = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "message-action";
  button.dataset.action = action;
  button.dataset.messageId = messageId;
  button.textContent = label;
  if (tone) {
    button.dataset.tone = tone;
  }
  return button;
}

function buildMessageMeta(message) {
  if (message.system) {
    return "";
  }

  const parts = [formatMessageTime(message.sentAt)];
  if (message.status === "sending") {
    parts.push("发送中");
  } else if (message.status === "failed") {
    parts.push("发送失败");
  } else if (message.status === "read" || state.messageReadStatus.has(message.id)) {
    parts.push("已读");
  } else if (message.mine) {
    parts.push("已发送");
  }

  if (message.editedAt) {
    parts.push("已编辑");
  }

  return message.mine ? parts.join(" · ") : `${message.name || "对方"} · ${parts.join(" · ")}`;
}

function normalizeReplyTarget(replyTo) {
  if (!replyTo || typeof replyTo !== "object") {
    return null;
  }

  return {
    messageId: typeof replyTo.messageId === "string" ? replyTo.messageId : "",
    author: String(replyTo.author || "对方").slice(0, 24),
    text: summarizeText(replyTo.text || "", 72)
  };
}

function renderAttachment(container, attachment) {
  container.textContent = "";
  if (!attachment) {
    container.hidden = true;
    return;
  }

  container.hidden = false;

  if (attachment.kind === "image") {
    const image = document.createElement("img");
    image.src = attachment.dataUrl;
    image.alt = attachment.name || "图片";
    const file = document.createElement("div");
    file.className = "attachment-file";
    file.innerHTML = `
      <div class="attachment-file-copy">
        <strong>${escapeHtml(attachment.name || "图片")}</strong>
        <span>${escapeHtml(formatFileSize(attachment.size || 0))}</span>
      </div>
      <a class="download-link" href="${attachment.dataUrl}" download="${escapeHtml(attachment.name || "image")}">下载</a>
    `;
    container.append(image, file);
  } else {
    const file = document.createElement("div");
    file.className = "attachment-file";
    file.innerHTML = `
      <div class="attachment-file-copy">
        <strong>${escapeHtml(attachment.name || "文件")}</strong>
        <span>${escapeHtml(`${formatFileSize(attachment.size || 0)} · ${attachment.mime || "未知类型"}`)}</span>
      </div>
      <a class="download-link" href="${attachment.dataUrl}" download="${escapeHtml(attachment.name || "file")}">下载</a>
    `;
    container.append(file);
  }
}

function updateMessageNode(message) {
  const article = elements.messageList.querySelector(`[data-message-id="${message.id}"]`);
  if (!article) {
    return;
  }

  article.classList.toggle("is-own", Boolean(message.mine));
  article.classList.toggle("is-system", Boolean(message.system));
  article.classList.toggle("is-deleted", Boolean(message.deleted));

  const quote = article.querySelector(".message-quote");
  const quoteAuthor = article.querySelector(".message-quote-author");
  const quoteText = article.querySelector(".message-quote-text");
  const bubble = article.querySelector(".bubble");
  const text = article.querySelector(".message-text");
  const attachment = article.querySelector(".message-attachment");
  const meta = article.querySelector(".meta");
  const menu = article.querySelector(".message-menu");
  const menuPanel = article.querySelector(".message-menu-panel");

  if (quote && quoteAuthor && quoteText) {
    if (message.replyTo && !message.deleted) {
      quote.hidden = false;
      quote.dataset.refId = message.replyTo.messageId || "";
      quoteAuthor.textContent = message.replyTo.author;
      quoteText.textContent = message.replyTo.text;
    } else {
      quote.hidden = true;
      quote.dataset.refId = "";
      quoteAuthor.textContent = "";
      quoteText.textContent = "";
    }
  }

  text.innerHTML = highlightText(message.deleted ? "这条消息已删除" : message.text, state.messageSearchQuery);
  renderAttachment(attachment, message.deleted ? null : message.attachment);
  meta.textContent = buildMessageMeta(message);

  if (!menu || !menuPanel) {
    return;
  }

  menu.hidden = Boolean(message.deleted);
  if (message.deleted) {
    menu.open = false;
    return;
  }

  menuPanel.textContent = "";

  menuPanel.append(buildMessageAction("回复", "reply", message.id));
  menuPanel.append(buildMessageAction("复制", "copy", message.id));

  if (!message.mine) {
    menuPanel.append(buildMessageAction("引用选中", "quote-selection", message.id));
  }

  if (message.mine && message.status === "failed") {
    menuPanel.append(buildMessageAction("重发", "retry", message.id));
  }

  if (message.mine && Date.now() - message.sentAt <= EDIT_WINDOW_MS) {
    menuPanel.append(buildMessageAction("编辑", "edit", message.id));
  }

  if (message.editHistory?.length) {
    menuPanel.append(buildMessageAction("历史版本", "history", message.id));
  }

  if (message.mine) {
    menuPanel.append(buildMessageAction("删除", "delete", message.id, "danger"));
  }
}

function upsertMessage(message, options = {}) {
  const { persist = true, scroll = true } = options;
  const existing = state.messageStore.get(message.id);
  const nextMessage = {
    id: message.id,
    text: "",
    name: "",
    mine: false,
    sentAt: Date.now(),
    editedAt: 0,
    deleted: false,
    status: "sent",
    attachment: null,
    editHistory: [],
    replyTo: null,
    ...existing,
    ...message,
    replyTo: normalizeReplyTarget(message.replyTo ?? existing?.replyTo)
  };

  if (!state.messageStore.has(nextMessage.id)) {
    state.messageOrder.push(nextMessage.id);
  }

  state.messageStore.set(nextMessage.id, nextMessage);

  let node = elements.messageList.querySelector(`[data-message-id="${nextMessage.id}"]`);
  if (!node) {
    node = createMessageNode(nextMessage);
    elements.messageList.insertBefore(node, elements.typingIndicator);
  }

  updateMessageNode(nextMessage);
  syncEmptyState();

  if (persist && state.room) {
    scheduleProtectedPersist(state.room);
    syncConversationSummary();
  }

  if (scroll) {
    scrollMessageList(true);
  }

  updateInfoDrawer();
  updateMessageSearch();
  return nextMessage;
}

function clearRenderedMessages() {
  for (const message of state.messageStore.values()) {
    revokeAttachmentPreview(message.attachment);
  }
  for (const node of $$(".message")) {
    node.remove();
  }
  state.messageStore.clear();
  state.messageOrder = [];
  syncEmptyState();
  updateMessageSearch();
}

function renderSystemMessage(text) {
  const message = {
    id: `system-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    text,
    name: "系统",
    mine: false,
    system: true,
    sentAt: Date.now()
  };

  const node = createMessageNode(message);
  updateMessageNode(message);
  node.classList.add("is-system");
  elements.messageList.insertBefore(node, elements.typingIndicator);
  syncEmptyState();
  scrollMessageList(true);
}

function getReplySnapshot(messageId, excerpt = "") {
  if (!messageId) {
    return null;
  }

  const message = state.messageStore.get(messageId);
  if (!message) {
    return null;
  }

  return {
    messageId,
    author: message.mine ? "你" : message.name || "对方",
    text: excerpt || (message.deleted ? "这条消息已删除" : message.text)
  };
}

function clearComposerMetaState() {
  state.replyingToMessageId = "";
  state.replyingQuoteText = "";
  state.editingMessageId = "";
  updateComposerMeta();
}

function startReply(messageId, excerpt = "") {
  if (!state.messageStore.has(messageId)) {
    return;
  }

  state.editingMessageId = "";
  state.replyingToMessageId = messageId;
  state.replyingQuoteText = excerpt ? summarizeText(excerpt, 72) : "";
  updateComposerMeta();
  elements.messageInput.focus();
}

function startEdit(messageId) {
  const message = state.messageStore.get(messageId);
  if (!message || !message.mine || message.deleted) {
    return;
  }

  if (Date.now() - message.sentAt > EDIT_WINDOW_MS) {
    showToast("消息发送超过 15 分钟后不能再编辑");
    return;
  }

  state.replyingToMessageId = "";
  state.replyingQuoteText = "";
  state.editingMessageId = messageId;
  elements.messageInput.value = message.text;
  updateComposerMeta();
  autoResizeMessageInput();
  elements.messageInput.focus();
  elements.messageInput.setSelectionRange(elements.messageInput.value.length, elements.messageInput.value.length);
}

function getSelectedMessageText(messageId) {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) {
    return "";
  }

  const text = selection.toString().trim();
  if (!text) {
    return "";
  }

  const anchorNode = selection.anchorNode;
  const bubble = anchorNode?.parentElement?.closest?.(".message");
  return bubble?.dataset.messageId === messageId ? text : "";
}

async function copyMessage(messageId) {
  const message = state.messageStore.get(messageId);
  if (!message || message.deleted) {
    showToast("没有可复制的内容");
    return;
  }

  try {
    await navigator.clipboard.writeText(message.text);
    showToast("已复制消息");
  } catch (error) {
    showToast("复制失败");
  }
}

function applyDeleteMessage(messageId, options = {}) {
  const { persist = true } = options;
  const message = state.messageStore.get(messageId);
  if (!message) {
    return;
  }

  message.deleted = true;
  message.editedAt = 0;
  message.status = message.mine ? message.status : "sent";
  state.messageStore.set(messageId, message);
  updateMessageNode(message);

  if (persist && state.room) {
    scheduleProtectedPersist(state.room);
    syncConversationSummary();
  }

  if (state.replyingToMessageId === messageId || state.editingMessageId === messageId) {
    clearComposerMetaState();
    elements.messageInput.value = "";
    autoResizeMessageInput();
  }

  updateMessageSearch();
}

function applyEditedMessage(messageId, newText, editedAt, options = {}) {
  const { persist = true } = options;
  const message = state.messageStore.get(messageId);
  if (!message || message.deleted) {
    return;
  }

  const previousText = message.text;
  if (previousText === newText) {
    return;
  }

  message.editHistory = [{ at: editedAt, text: previousText }, ...(message.editHistory || [])].slice(0, 10);
  message.text = newText;
  message.editedAt = editedAt;
  state.messageStore.set(messageId, message);
  updateMessageNode(message);

  if (persist && state.room) {
    scheduleProtectedPersist(state.room);
    syncConversationSummary();
  }

  updateComposerMeta();
  updateMessageSearch();
}

function jumpToMessage(messageId) {
  if (!messageId) {
    return;
  }
  const node = elements.messageList.querySelector(`[data-message-id="${messageId}"]`);
  if (!node) {
    showToast("原消息不在当前记录中");
    return;
  }
  node.scrollIntoView({ behavior: "smooth", block: "center" });
  node.classList.add("is-search-current");
  window.setTimeout(() => node.classList.remove("is-search-current"), 1400);
}

function matchMessageToSearch(message, query) {
  if (!query || message.system) {
    return false;
  }

  return [message.text, message.replyTo?.text, message.attachment?.name]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query.toLowerCase());
}

function updateMessageSearch() {
  const query = state.messageSearchQuery.trim();
  state.searchMatchIds = [];

  for (const messageId of state.messageOrder) {
    const node = elements.messageList.querySelector(`[data-message-id="${messageId}"]`);
    const message = state.messageStore.get(messageId);
    if (!node || !message) {
      continue;
    }

    const isMatch = matchMessageToSearch(message, query);
    node.classList.toggle("is-search-match", isMatch);
    node.classList.remove("is-search-current");
    if (isMatch) {
      state.searchMatchIds.push(messageId);
    }
    updateMessageNode(message);
  }

  if (!state.searchMatchIds.length) {
    state.activeSearchIndex = -1;
  } else if (state.activeSearchIndex < 0 || state.activeSearchIndex >= state.searchMatchIds.length) {
    state.activeSearchIndex = 0;
  }

  updateSearchCount();

  if (state.activeSearchIndex >= 0) {
    highlightCurrentSearchResult(false);
  }
}

function updateSearchCount() {
  if (!state.searchMatchIds.length) {
    elements.messageSearchCount.textContent = "0 / 0";
  } else {
    elements.messageSearchCount.textContent = `${state.activeSearchIndex + 1} / ${state.searchMatchIds.length}`;
  }
}

function highlightCurrentSearchResult(scroll = true) {
  for (const node of $$(".message.is-search-current")) {
    node.classList.remove("is-search-current");
  }

  if (state.activeSearchIndex < 0 || !state.searchMatchIds.length) {
    updateSearchCount();
    return;
  }

  const messageId = state.searchMatchIds[state.activeSearchIndex];
  const node = elements.messageList.querySelector(`[data-message-id="${messageId}"]`);
  if (node) {
    node.classList.add("is-search-current");
    if (scroll) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  updateSearchCount();
}

function stepSearch(direction) {
  if (!state.searchMatchIds.length) {
    return;
  }
  state.activeSearchIndex =
    (state.activeSearchIndex + direction + state.searchMatchIds.length) % state.searchMatchIds.length;
  highlightCurrentSearchResult();
}

async function readFileAsDataUrl(fileOrBlob) {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("读取附件失败"));
    reader.readAsDataURL(fileOrBlob);
  });
}

async function optimizeImageFile(file) {
  const previewUrl = URL.createObjectURL(file);

  if (!("createImageBitmap" in window)) {
    return {
      file,
      dataUrl: await readFileAsDataUrl(file),
      previewUrl
    };
  }

  try {
    const image = await createImageBitmap(file);
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { alpha: false });
    context.drawImage(image, 0, 0, width, height);
    image.close();

    const optimizedBlob = await new Promise((resolve) => {
      canvas.toBlob(
        (blob) => resolve(blob || file),
        file.type === "image/png" ? "image/png" : "image/webp",
        IMAGE_EXPORT_QUALITY
      );
    });

    if (optimizedBlob.size >= file.size) {
      return {
        file,
        dataUrl: await readFileAsDataUrl(file),
        previewUrl
      };
    }

    return {
      file: new File([optimizedBlob], file.name, {
        type: optimizedBlob.type || file.type,
        lastModified: Date.now()
      }),
      dataUrl: await readFileAsDataUrl(optimizedBlob),
      previewUrl
    };
  } catch (error) {
    URL.revokeObjectURL(previewUrl);
    return {
      file,
      dataUrl: await readFileAsDataUrl(file),
      previewUrl: URL.createObjectURL(file)
    };
  }
}

function setAttachmentDraft(attachment, shouldPersist = true) {
  revokeAttachmentPreview(state.attachmentDraft);
  state.attachmentDraft = attachment;
  elements.attachmentPreview.hidden = !attachment;
  elements.attachmentPreviewMedia.textContent = "";

  if (attachment) {
    if (attachment.kind === "image") {
      const image = document.createElement("img");
      image.src = attachment.previewUrl || attachment.dataUrl;
      image.alt = attachment.name || "图片";
      elements.attachmentPreviewMedia.append(image);
    } else {
      const icon = document.createElement("span");
      icon.className = "attachment-preview-icon";
      icon.textContent = "文";
      elements.attachmentPreviewMedia.append(icon);
    }

    elements.attachmentPreviewName.textContent = attachment.name || "附件";
    elements.attachmentPreviewMeta.textContent = `${attachment.kind === "image" ? "图片" : "文件"} · ${formatFileSize(
      attachment.size || 0
    )}`;
  } else {
    elements.attachmentPreviewName.textContent = "";
    elements.attachmentPreviewMeta.textContent = "";
  }

  if (shouldPersist) {
    saveCurrentDraft();
  }
}

function clearAttachmentDraft(shouldPersist = true) {
  setAttachmentDraft(null, shouldPersist);
}

async function fileToAttachment(file) {
  if (!file) {
    return null;
  }

  if (!isAllowedAttachment(file)) {
    throw new Error("仅支持图片、TXT、JSON、ZIP 和 PDF 附件");
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`附件超过 ${formatFileSize(MAX_ATTACHMENT_BYTES)} 限制`);
  }

  if (file.type.startsWith("image/")) {
    const optimized = await optimizeImageFile(file);
    if (optimized.file.size > MAX_ATTACHMENT_BYTES) {
      revokeAttachmentPreview({ previewUrl: optimized.previewUrl });
      throw new Error(`图片压缩后仍超过 ${formatFileSize(MAX_ATTACHMENT_BYTES)} 限制`);
    }

    return {
      kind: "image",
      name: optimized.file.name,
      size: optimized.file.size,
      mime: optimized.file.type || file.type || "image/webp",
      dataUrl: optimized.dataUrl,
      previewUrl: optimized.previewUrl
    };
  }

  const dataUrl = await readFileAsDataUrl(file);

  return {
    kind: "file",
    name: file.name,
    size: file.size,
    mime: file.type || "application/octet-stream",
    dataUrl
  };
}

function resetSearchBar() {
  state.messageSearchQuery = "";
  state.searchMatchIds = [];
  state.activeSearchIndex = -1;
  elements.messageSearchInput.value = "";
  elements.messageSearchBar.hidden = true;
  updateMessageSearch();
}

function openMessageSearch() {
  elements.messageSearchBar.hidden = false;
  elements.messageSearchInput.focus();
}

function resetChatSurfaceToBlank() {
  clearRenderedMessages();
  elements.roomTitle.textContent = "尚未进入房间";
  elements.roomSubline.textContent = "等待加入";
  elements.secureText.textContent = "输入房间号和口令后开始";
  elements.safetyCode.textContent = "----";
  elements.cryptoBadge.textContent = "E2EE";
  elements.cryptoBadge.title = "密钥信息";
  setPeerTrustState("idle", "");
  updateInfoDrawer();
}

function resetSessionUi() {
  setAppConnectedState(false);
  setConnectionState("未连接");
  setPeerState("等待加入");
  setCryptoState("未建立");
  setPeerTrustState("idle", "");
  elements.secretInput.placeholder = "双方输入相同口令";
  setBadge(elements.connectionBadge, "离线", "idle");
  setBadge(elements.peerBadge, "未配对", "idle");
  setPeerOnlineStatus(false);
  setDot("");
  setTypingIndicator(false);
  elements.leaveButton.disabled = true;
  elements.joinButton.disabled = false;
  elements.joinButton.textContent = "进入会话";
  state.sendInFlight = false;
  updateComposerMeta();
  setComposerEnabled(false);
  resetSearchBar();
  updateRoomSubline();
}

function setConnectedUi() {
  setAppConnectedState(true);
  const hasSecureSession = Boolean(state.sessionKey);

  setConnectionState("已连接");
  setPeerState(state.peer?.name || "等待加入");
  setCryptoState(hasSecureSession ? "已建立" : "协商中");
  elements.roomTitle.textContent = state.room;
  elements.leaveButton.disabled = false;
  elements.joinButton.disabled = true;
  setBadge(elements.connectionBadge, "在线", hasSecureSession ? "secure" : "pending");
  setBadge(elements.peerBadge, state.peer?.name || "等待配对", state.peer ? "active" : "pending");
  setDot(hasSecureSession ? "secure" : "pending");

  if (!hasSecureSession) {
    elements.secureText.textContent = state.peer ? "正在交换密钥" : "等待对方加入";
    setComposerEnabled(false);
  }

  updateRoomSubline();
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
  const passwordKey = await crypto.subtle.importKey("raw", encoder.encode(state.secret), "PBKDF2", false, [
    "deriveBits"
  ]);
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
  const hadSession = Boolean(state.sessionKey);

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
  const peerFingerprint = await fingerprintPublicKey(peerPublicKeyB64);
  elements.safetyCode.textContent = formatSafetyCode(safetyDigest);
  elements.secureText.textContent = "加密会话已建立，可开始发送消息";
  elements.cryptoBadge.textContent = "AES-256";
  elements.cryptoBadge.title = "ECDH P-256 + HKDF + AES-256-GCM";
  elements.secretInput.placeholder = "当前会话已建立，如需重新加入请重新输入口令";
  setCryptoState("已建立");
  setConnectedUi();
  setDot("secure");
  setComposerEnabled(true);
  updateComposerMeta();
  setTypingIndicator(false);
  updateInfoDrawer();

  const existingPin = await readPeerPin(state.room);
  if (!existingPin || existingPin.fingerprint !== peerFingerprint) {
    await writePeerPin(state.room, {
      room: state.room,
      deviceId: state.deviceId,
      peerName: state.peer?.name || "",
      fingerprint: peerFingerprint,
      updatedAt: Date.now()
    });
  }

  if (state.peerTrustState === "error") {
    elements.secureText.textContent = "安全码已更新，请先核对后再继续";
  } else if (state.peerTrustState === "pending") {
    setPeerTrustState("secure", "设备已记住");
  }

  if (!hadSession) {
    renderSystemMessage("安全会话已建立");
    showToast("安全码已生成，可在信息面板中核对");
  }

  await sendStatusUpdate();
  await flushPendingSecureSignals();
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
  state.peerLastSeenAt = 0;

  setPeerState(state.peer.name);
  setBadge(elements.peerBadge, state.peer.name, "active");
  elements.secureText.textContent = "正在交换密钥";
  setDot("pending");
  updateRoomSubline();
  upsertConversationSummary({
    room: state.room,
    peerName: state.peer.name,
    updatedAt: Date.now()
  });
  const nextFingerprint = await fingerprintPublicKey(payload.publicKey);
  const existingPin = await readPeerPin(state.room);
  if (!existingPin) {
    setPeerTrustState("pending", "首次设备");
  } else if (existingPin.fingerprint !== nextFingerprint) {
    setPeerTrustState("error", "密钥已变更");
    elements.secureText.textContent = "检测到对端设备密钥变更";
    showToast("检测到房间对端密钥变更，请重新核对安全码");
  } else {
    setPeerTrustState("secure", "设备已记住");
  }
  await buildSession(payload.publicKey);

  if (!state.helloEchoedFor.has(from)) {
    state.helloEchoedFor.add(from);
    await sendHello();
  }
}

function buildPayloadAad(payload) {
  return JSON.stringify({
    v: payload.v,
    room: payload.room,
    from: payload.from,
    type: payload.type,
    id: payload.id,
    sentAt: payload.sentAt,
    refId: payload.refId || ""
  });
}

async function encryptSecurePayload(type, body, { refId = "", id = randomHex(12), sentAt = Date.now() } = {}) {
  const payload = {
    v: 1,
    room: state.room,
    from: state.clientId,
    type,
    id,
    sentAt,
    refId
  };

  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = bufferToBytes(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode(buildPayloadAad(payload))
      },
      state.sessionKey,
      encoder.encode(JSON.stringify(body))
    )
  );

  return {
    ...payload,
    nonce: bytesToBase64(iv),
    ciphertext: bytesToBase64(ciphertext)
  };
}

async function decryptSecurePayload(payload) {
  if (
    !payload ||
    typeof payload.nonce !== "string" ||
    typeof payload.ciphertext !== "string" ||
    typeof payload.id !== "string"
  ) {
    throw new Error("invalid secure payload");
  }

  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(payload.nonce),
      additionalData: encoder.encode(buildPayloadAad(payload))
    },
    state.sessionKey,
    base64ToBytes(payload.ciphertext)
  );

  return JSON.parse(decoder.decode(plaintext));
}

async function sendSecureSignal(type, body, options = {}) {
  const payload = await encryptSecurePayload(type, body, options);
  await sendSignal(type, payload);
  return payload;
}

async function sendTypingIndicator() {
  if (!state.sessionKey || !state.room) {
    return;
  }

  try {
    await sendSecureSignal("typing", { active: true });
  } catch (error) {
    // Ignore transient typing failures.
  }
}

async function sendStatusUpdate() {
  if (!state.sessionKey || !state.room) {
    return;
  }

  try {
    await sendSecureSignal("status", { online: true });
  } catch (error) {
    // Ignore transient status failures.
  }
}

async function markMessageAsRead(messageId) {
  if (!state.sessionKey || !state.room || state.messageReadStatus.has(messageId)) {
    return;
  }

  try {
    await sendSecureSignal("read", { messageId }, { refId: messageId });
  } catch (error) {
    // Ignore transient read-receipt failures.
  }
}

async function handleIncomingChat(payload) {
  if (!payload || typeof payload.id !== "string" || state.seenSignalIds.has(payload.id)) {
    return;
  }

  if (!isFreshSignalTimestamp(payload.sentAt)) {
    return;
  }

  if (!state.sessionKey) {
    state.pendingSecureSignals.push({ type: "chat", payload });
    return;
  }

  try {
    const body = await decryptSecurePayload(payload);
    state.seenSignalIds.add(payload.id);

    const incoming = upsertMessage(
      {
        id: payload.id,
        text: String(body.text || ""),
        name: String(body.name || state.peer?.name || "对方").slice(0, 24),
        mine: false,
        sentAt: Number(payload.sentAt) || Date.now(),
        replyTo: normalizeReplyTarget(body.replyTo),
        attachment: body.attachment || null,
        editedAt: 0,
        deleted: false,
        status: "sent"
      },
      { persist: Boolean(state.room) }
    );

    if (document.hidden) {
      upsertConversationSummary({
        room: state.room,
        unreadCount: (getConversationSummary(state.room)?.unreadCount || 0) + 1
      });
    } else {
      await markMessageAsRead(payload.id);
    }

    if (incoming.replyTo?.messageId) {
      updateMessageNode(incoming);
    }
  } catch (error) {
    setDot("error");
    setCryptoState("解密失败");
    elements.secureText.textContent = "口令或安全码不一致";
    showToast("消息解密失败，请核对双方口令与安全码");
  }
}

async function handleIncomingEdit(payload) {
  if (!payload || typeof payload.id !== "string" || state.seenSignalIds.has(payload.id)) {
    return;
  }

  if (!isFreshSignalTimestamp(payload.sentAt)) {
    return;
  }

  if (!state.sessionKey) {
    state.pendingSecureSignals.push({ type: "edit", payload });
    return;
  }

  try {
    const body = await decryptSecurePayload(payload);
    state.seenSignalIds.add(payload.id);

    if (typeof payload.refId === "string" && typeof body.text === "string") {
      applyEditedMessage(payload.refId, body.text, Number(body.editedAt) || Date.now());
    }
  } catch (error) {
    showToast("同步编辑失败");
  }
}

async function handleIncomingTyping(payload) {
  if (!payload || typeof payload.id !== "string" || state.seenSignalIds.has(payload.id)) {
    return;
  }

  if (!isFreshSignalTimestamp(payload.sentAt)) {
    return;
  }

  if (!state.sessionKey) {
    state.pendingSecureSignals.push({ type: "typing", payload });
    return;
  }

  try {
    const body = await decryptSecurePayload(payload);
    state.seenSignalIds.add(payload.id);
    if (body.active === true) {
      setTypingIndicator(true);
      window.clearTimeout(state.typingHideTimer);
      state.typingHideTimer = window.setTimeout(() => {
        setTypingIndicator(false);
      }, 2200);
    }
  } catch (error) {
    // Ignore unverifiable transient typing signals.
  }
}

async function handleIncomingRead(payload) {
  if (!payload || typeof payload.id !== "string" || state.seenSignalIds.has(payload.id)) {
    return;
  }

  if (!isFreshSignalTimestamp(payload.sentAt)) {
    return;
  }

  if (!state.sessionKey) {
    state.pendingSecureSignals.push({ type: "read", payload });
    return;
  }

  try {
    const body = await decryptSecurePayload(payload);
    state.seenSignalIds.add(payload.id);
    if (typeof body.messageId !== "string") {
      return;
    }
    state.messageReadStatus.add(body.messageId);
    const message = state.messageStore.get(body.messageId);
    if (message) {
      message.status = "read";
      updateMessageNode(message);
      if (state.room) {
        scheduleProtectedPersist(state.room);
      }
    }
  } catch (error) {
    // Ignore unverifiable read receipts.
  }
}

async function handleIncomingDelete(payload) {
  if (!payload || typeof payload.id !== "string" || state.seenSignalIds.has(payload.id)) {
    return;
  }

  if (!isFreshSignalTimestamp(payload.sentAt)) {
    return;
  }

  if (!state.sessionKey) {
    state.pendingSecureSignals.push({ type: "delete", payload });
    return;
  }

  try {
    const body = await decryptSecurePayload(payload);
    state.seenSignalIds.add(payload.id);
    if (typeof body.messageId === "string") {
      applyDeleteMessage(body.messageId);
    }
  } catch (error) {
    showToast("同步删除失败");
  }
}

async function handleIncomingStatus(payload) {
  if (!payload || typeof payload.id !== "string" || state.seenSignalIds.has(payload.id)) {
    return;
  }

  if (!isFreshSignalTimestamp(payload.sentAt)) {
    return;
  }

  if (!state.sessionKey) {
    state.pendingSecureSignals.push({ type: "status", payload });
    return;
  }

  try {
    const body = await decryptSecurePayload(payload);
    state.seenSignalIds.add(payload.id);
    setPeerOnlineStatus(body.online === true);
    if (state.peerOnline) {
      state.peerLastSeenAt = 0;
    }
    updateRoomSubline();
  } catch (error) {
    // Ignore unverifiable presence details; coarse presence still comes from SSE.
  }
}

async function flushPendingSecureSignals() {
  const pendingSignals = state.pendingSecureSignals.splice(0);

  for (const signal of pendingSignals) {
    if (signal.type === "chat") {
      await handleIncomingChat(signal.payload);
    } else if (signal.type === "edit") {
      await handleIncomingEdit(signal.payload);
    } else if (signal.type === "typing") {
      await handleIncomingTyping(signal.payload);
    } else if (signal.type === "read") {
      await handleIncomingRead(signal.payload);
    } else if (signal.type === "delete") {
      await handleIncomingDelete(signal.payload);
    } else if (signal.type === "status") {
      await handleIncomingStatus(signal.payload);
    }
  }
}

async function deleteMessage(messageId) {
  const message = state.messageStore.get(messageId);
  if (!message || !message.mine || message.deleted) {
    return;
  }

  if (!(await confirmAction("删除消息", "删除后双方都会看到“这条消息已删除”。", "删除"))) {
    return;
  }

  try {
    await sendSecureSignal("delete", { messageId }, { refId: messageId });
    applyDeleteMessage(messageId);
    showToast("消息已删除");
  } catch (error) {
    showToast("删除失败");
  }
}

async function retryFailedMessage(messageId) {
  const message = state.messageStore.get(messageId);
  if (!message || !message.mine || message.deleted || message.status !== "failed" || !state.sessionKey) {
    return;
  }

  message.status = "sending";
  state.messageStore.set(messageId, message);
  updateMessageNode(message);

  try {
    await sendSecureSignal(
      "chat",
      {
        text: message.text,
        name: state.name,
        replyTo: message.replyTo,
        attachment: sanitizeAttachment(message.attachment)
      },
      { id: message.id, sentAt: message.sentAt }
    );
    message.status = "sent";
    state.messageStore.set(messageId, message);
    updateMessageNode(message);
    scheduleProtectedPersist(state.room);
    syncConversationSummary();
    showToast("消息已重发");
  } catch (error) {
    message.status = "failed";
    state.messageStore.set(messageId, message);
    updateMessageNode(message);
    showToast("重发失败");
  }
}

async function submitEdit(text) {
  const message = state.messageStore.get(state.editingMessageId);
  if (!message || !message.mine) {
    clearComposerMetaState();
    return;
  }

  try {
    const payload = await sendSecureSignal("edit", { text, editedAt: Date.now() }, { refId: message.id });
    applyEditedMessage(message.id, text, payload.sentAt);
    resetMessageComposer();
    showToast("消息已更新");
  } catch (error) {
    showToast("编辑失败");
  }
}

async function handleSignalEvent(event) {
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
    switch (signal.type) {
      case "hello":
        await handleHello(signal.from, signal.payload);
        break;
      case "chat":
        await handleIncomingChat(signal.payload);
        break;
      case "typing":
        await handleIncomingTyping(signal.payload);
        break;
      case "read":
        await handleIncomingRead(signal.payload);
        break;
      case "edit":
        await handleIncomingEdit(signal.payload);
        break;
      case "delete":
        await handleIncomingDelete(signal.payload);
        break;
      case "status":
        await handleIncomingStatus(signal.payload);
        break;
      default:
        break;
    }
  } catch (error) {
    setDot("error");
    showToast("会话同步失败，请刷新后重试");
  }
}

function handlePresence(event) {
  try {
    const data = JSON.parse(event.data);
    const peerPresent = Number(data.count) >= 2;

    if (!peerPresent) {
      setPeerOnlineStatus(false);
      state.peerLastSeenAt = Date.now();
      setTypingIndicator(false);

      if (state.sessionKey) {
        setPeerState(state.peer ? `${state.peer.name} 暂时离开` : "对方暂时离开");
        setBadge(elements.peerBadge, "等待返回", "idle");
        elements.secureText.textContent = "连接仍保留，等待对方重新加入";
      } else {
        setPeerState("等待加入");
        setBadge(elements.peerBadge, "未配对", "idle");
        elements.secureText.textContent = "等待对方加入";
      }

      updateRoomSubline();
      return;
    }

    if (!state.sessionKey) {
      setPeerState(state.peer?.name || "对方已加入");
      setBadge(elements.peerBadge, state.peer?.name || "正在配对", "pending");
      elements.secureText.textContent = "正在交换密钥";
      setDot("pending");
    } else if (state.peer) {
      setPeerOnlineStatus(true);
      state.peerLastSeenAt = 0;
      setPeerState(state.peer.name);
      setBadge(elements.peerBadge, state.peer.name, "active");
      elements.secureText.textContent = "加密会话已建立，可开始发送消息";
    }

    updateRoomSubline();
  } catch (error) {
    // Ignore malformed presence packets from interrupted connections.
  }
}

function clearReconnectTimer() {
  window.clearTimeout(state.eventSourceReconnectTimer);
  state.eventSourceReconnectTimer = 0;
}

function updateReconnectUi(delayMs = 0) {
  state.reconnecting = true;
  setConnectionState("重连中");
  elements.secureText.textContent = delayMs ? `连接中断，${Math.ceil(delayMs / 1000)} 秒后重试` : "连接中断，正在重试";
  setBadge(elements.connectionBadge, "重连中", "pending");
  setDot("pending");
}

function scheduleReconnect(room) {
  if (!state.shouldReconnect || !room || state.room !== room) {
    return;
  }

  clearReconnectTimer();
  state.reconnectAttempt += 1;
  const delayMs = Math.min(RECONNECT_BASE_MS * 2 ** Math.max(0, state.reconnectAttempt - 1), RECONNECT_MAX_MS);
  updateReconnectUi(delayMs);
  state.eventSourceReconnectTimer = window.setTimeout(() => {
    void openRoomEventStream(room);
  }, delayMs);
}

async function openRoomEventStream(room) {
  if (!state.shouldReconnect || !room || state.room !== room) {
    return;
  }

  clearReconnectTimer();
  if (state.eventSource) {
    state.eventSource.close();
  }

  const source = new EventSource(`/events?room=${encodeURIComponent(room)}&client=${encodeURIComponent(state.clientId)}`);
  state.eventSource = source;

  source.onopen = () => {
    if (state.eventSource !== source) {
      return;
    }
    setConnectionState("连接中");
    setBadge(elements.connectionBadge, "连接中", "pending");
  };

  source.addEventListener("ready", async () => {
    if (state.eventSource !== source) {
      return;
    }

    const wasReconnecting = state.reconnecting;
    const isFirstReady = !state.readyReceived;
    state.readyReceived = true;
    state.reconnecting = false;
    state.reconnectAttempt = 0;
    setConnectedUi();
    updateRoomSubline();

    if (isFirstReady && !state.messageOrder.length) {
      renderSystemMessage(`已进入房间 ${room}`);
    } else if (wasReconnecting) {
      showToast("连接已恢复");
    }

    upsertConversationSummary({
      room,
      name: state.name,
      unreadCount: 0,
      updatedAt: Date.now()
    });

    try {
      await sendHello();
    } catch (error) {
      showToast("握手发送失败");
    }
  });

  source.addEventListener("presence", handlePresence);
  source.addEventListener("signal", handleSignalEvent);
  source.addEventListener("room-full", () => {
    if (state.eventSource === source) {
      state.shouldReconnect = false;
      clearReconnectTimer();
    }
    showToast("房间已满，请更换房间号");
    leaveRoom(false, { keepPreview: false });
    setPeerState("房间已满");
    setBadge(elements.peerBadge, "已满", "error");
  });

  source.onerror = () => {
    if (state.eventSource !== source || !state.shouldReconnect) {
      return;
    }
    source.close();
    state.eventSource = null;
    scheduleReconnect(room);
  };
}

function syncConversationSummary() {
  const room = state.room || state.previewRoom;
  if (!room) {
    return;
  }

  const latest = latestPersistableMessageSummary();
  const summary = {
    room,
    name: state.name || elements.nameInput.value.trim(),
    peerName: state.peer?.name || getConversationSummary(room)?.peerName || "",
    updatedAt: latest?.sentAt || Date.now(),
    lastKind: latest?.attachment ? latest.attachment.kind : latest ? "text" : getConversationSummary(room)?.lastKind || "",
    unreadCount: room === state.room && !document.hidden ? 0 : getConversationSummary(room)?.unreadCount || 0,
    hasDraft: Boolean(elements.messageInput.value || state.attachmentDraft),
    hasLocalCache: Boolean(state.messageOrder.length || elements.messageInput.value || state.attachmentDraft),
    lastSeenAt: state.peerLastSeenAt || 0
  };

  upsertConversationSummary(summary);
}

function showProtectedConversationPlaceholder(room) {
  clearRenderedMessages();
  setPreviewRoom(room);
  elements.roomTitle.textContent = room;
  elements.secureText.textContent = "本地记录已加密保存，输入正确口令后恢复";
  elements.safetyCode.textContent = "----";
  elements.cryptoBadge.textContent = "受保护";
  elements.cryptoBadge.title = "本地缓存已加密";
  setConnectionState("未连接");
  setPeerState(getConversationSummary(room)?.peerName || "等待加入");
  setCryptoState("待解锁");
  setPeerTrustState("idle", "");
  setBadge(elements.connectionBadge, "离线", "idle");
  setBadge(elements.peerBadge, getConversationSummary(room)?.peerName || "未配对", "idle");
  setPeerOnlineStatus(false);
  setDot("");
  updateRoomSubline();
  updateInfoDrawer();
  renderConversationList();
}

function populateJoinForm(room) {
  const summary = getConversationSummary(room);
  elements.roomInput.value = room;
  if (summary?.name) {
    elements.nameInput.value = summary.name;
  }
  elements.secretInput.value = "";
  elements.messageInput.value = "";
  autoResizeMessageInput();
  clearAttachmentDraft(false);
  clearComposerMetaState();
}

function clearConnectionStateOnly() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  clearReconnectTimer();
  state.eventSource = null;
  state.reconnectAttempt = 0;
  state.reconnecting = false;
  state.shouldReconnect = false;
  state.keyPair = null;
  state.publicKeyB64 = "";
  state.sessionKey = null;
  state.peer = null;
  state.peerTrustState = "unknown";
  state.peerTrustNote = "";
  state.peerOnline = false;
  state.peerLastSeenAt = 0;
  state.secret = "";
  state.readyReceived = false;
  state.helloEchoedFor.clear();
  state.pendingSecureSignals = [];
  state.seenSignalIds.clear();
  state.messageReadStatus.clear();
  state.replyingToMessageId = "";
  state.replyingQuoteText = "";
  state.editingMessageId = "";
  state.sendInFlight = false;
  window.clearTimeout(state.typingHideTimer);
  window.clearTimeout(state.persistTimer);
  state.vaultKeyCache.clear();
  closeOpenMenus();
}

async function connectToRoom({ name, room, secret, restoreHistory = true }) {
  clearConnectionStateOnly();
  resetSessionUi();
  clearRenderedMessages();

  state.room = room;
  setPreviewRoom(room);
  state.name = name.slice(0, 24);
  state.secret = secret;
  state.readyReceived = false;
  state.activeConversationRoom = room;
  state.shouldReconnect = true;
  localStorage.setItem(STORAGE.name, state.name);
  elements.secretInput.value = "";

  if (restoreHistory) {
    const protectedVault = await loadProtectedVault(room, secret);
    if (protectedVault?.messages?.length) {
      for (const message of protectedVault.messages) {
        upsertMessage(message, { persist: false, scroll: false });
      }
      if (Array.isArray(protectedVault.seenSignalIds)) {
        state.seenSignalIds = new Set(protectedVault.seenSignalIds.filter((value) => typeof value === "string"));
      }
      if (protectedVault.draft) {
        elements.messageInput.value = protectedVault.draft.text || "";
        autoResizeMessageInput();
        setAttachmentDraft(protectedVault.draft.attachment || null, false);
      }
      showToast("已恢复受保护本地记录");
    } else if (getConversationSummary(room)?.hasLocalCache) {
      showToast("检测到受保护记录，当前口令未能解锁本地缓存");
    }
  }
  renderConversationList();
  elements.joinButton.disabled = true;
  elements.joinButton.textContent = "进入中...";
  setConnectionState("连接中");
  setPeerState(getConversationSummary(room)?.peerName || "等待加入");
  setCryptoState("准备中");
  elements.roomTitle.textContent = room;
  elements.secureText.textContent = "正在建立会话";
  setBadge(elements.connectionBadge, "连接中", "pending");
  setBadge(elements.peerBadge, "等待配对", "pending");
  setDot("pending");
  updateRoomSubline();
  updateInfoDrawer();

  try {
    await createKeyPair();
    await openRoomEventStream(room);
  } catch (error) {
    showToast("进入会话失败");
    leaveRoom(false, { keepPreview: true });
  } finally {
    if (!state.eventSource) {
      elements.joinButton.disabled = false;
      elements.joinButton.textContent = "进入会话";
    }
  }
}

async function joinRoom(event) {
  event.preventDefault();

  if (!globalThis.crypto?.subtle || !window.EventSource || !window.isSecureContext) {
    showToast("请使用 HTTPS 或 localhost 打开当前页面");
    return;
  }

  const name = elements.nameInput.value.trim();
  const room = elements.roomInput.value.trim();
  const secret = elements.secretInput.value;

  if (!name || !room || secret.length < 8) {
    showToast("请填写昵称、房间号和至少 8 位口令");
    return;
  }

  await connectToRoom({ name, room, secret, restoreHistory: true });
}

async function sendMessage(event) {
  event.preventDefault();

  const text = elements.messageInput.value.trim();
  if ((!text && !state.attachmentDraft) || !state.sessionKey || state.sendInFlight) {
    return;
  }

  if (state.editingMessageId) {
    await submitEdit(text);
    return;
  }

  const replyTo = getReplySnapshot(state.replyingToMessageId, state.replyingQuoteText);
  const draftAttachment = state.attachmentDraft ? { ...state.attachmentDraft } : null;
  const payloadAttachment = sanitizeAttachment(draftAttachment);
  const messageId = randomHex(12);
  const sentAt = Date.now();
  const optimisticMessage = upsertMessage({
    id: messageId,
    text,
    name: state.name,
    mine: true,
    sentAt,
    replyTo,
    attachment: payloadAttachment,
    editedAt: 0,
    deleted: false,
    status: "sending"
  });

  state.sendInFlight = true;
  updateComposerMeta();
  elements.messageInput.value = "";
  autoResizeMessageInput();
  clearComposerMetaState();
  clearAttachmentDraft(false);

  try {
    await sendSecureSignal(
      "chat",
      {
        text,
        name: state.name,
        replyTo,
        attachment: payloadAttachment
      },
      { id: messageId, sentAt }
    );

    optimisticMessage.status = "sent";
    optimisticMessage.sentAt = sentAt;
    state.messageStore.set(messageId, optimisticMessage);
    updateMessageNode(optimisticMessage);
    scheduleProtectedPersist(state.room);
    syncConversationSummary();
  } catch (error) {
    optimisticMessage.status = "failed";
    state.messageStore.set(messageId, optimisticMessage);
    updateMessageNode(optimisticMessage);
    showToast("发送失败，消息已保留在记录里");
  } finally {
    state.sendInFlight = false;
    updateComposerMeta();
  }
}

function leaveRoom(showMessage = true, options = {}) {
  const { keepPreview = true } = options;
  const roomBeforeLeave = state.room || state.previewRoom;

  clearConnectionStateOnly();
  state.room = "";
  resetSessionUi();
  elements.messageInput.value = "";
  autoResizeMessageInput();
  clearAttachmentDraft(false);
  clearComposerMetaState();
  closeInfoDrawer();
  updateInfoDrawer();

  if (keepPreview && roomBeforeLeave) {
    populateJoinForm(roomBeforeLeave);
    showProtectedConversationPlaceholder(roomBeforeLeave);
  } else {
    clearPreviewRoom();
    resetChatSurfaceToBlank();
    renderConversationList();
  }

  if (showMessage) {
    showToast("已离开会话");
  }
}

async function rekeyConversation() {
  const secret = state.secret || elements.secretInput.value.trim();
  if (!state.room || !secret) {
    showToast("请输入当前房间的口令后再重新协商");
    return;
  }

  const name = elements.nameInput.value.trim();
  const room = elements.roomInput.value.trim();
  showToast("正在重新协商密钥");
  await connectToRoom({ name, room, secret, restoreHistory: true });
}

function generateRoomCode() {
  elements.roomInput.value = `SECURE-${randomHex(2).toUpperCase()}-${randomHex(2).toUpperCase()}`;
}

async function handleConversationListClick(event) {
  const pinButton = event.target.closest("[data-action='toggle-pin']");
  if (pinButton) {
    toggleConversationPin(pinButton.dataset.room);
    return;
  }

  const item = event.target.closest(".conversation-item");
  if (!item) {
    return;
  }

  const room = item.dataset.room;
  if (!room) {
    return;
  }

  if (state.room && state.room !== room) {
    if (!(await confirmAction("切换会话", "切换前会先离开当前房间。", "继续"))) {
      return;
    }
    leaveRoom(false, { keepPreview: true });
  }

  populateJoinForm(room);
  showProtectedConversationPlaceholder(room);
  upsertConversationSummary({ room, unreadCount: 0 });
}

function handleMessageListClick(event) {
  const trigger = event.target.closest(".message-menu summary");
  if (trigger) {
    closeOpenMenus(trigger.parentElement);
    return;
  }

  const quote = event.target.closest(".message-quote");
  if (quote?.dataset.refId) {
    jumpToMessage(quote.dataset.refId);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  const { action, messageId } = actionButton.dataset;
  const menu = actionButton.closest(".message-menu");
  if (menu) {
    menu.open = false;
  }

  switch (action) {
    case "reply":
      startReply(messageId, getSelectedMessageText(messageId));
      break;
    case "quote-selection": {
      const selected = getSelectedMessageText(messageId);
      if (!selected) {
        showToast("先选中要引用的文字");
        break;
      }
      startReply(messageId, selected);
      break;
    }
    case "copy":
      void copyMessage(messageId);
      break;
    case "retry":
      void retryFailedMessage(messageId);
      break;
    case "edit":
      startEdit(messageId);
      break;
    case "history": {
      const message = state.messageStore.get(messageId);
      if (message) {
        openHistoryDialog(message);
      }
      break;
    }
    case "delete":
      void deleteMessage(messageId);
      break;
    default:
      break;
  }
}

function handleLongPressStart(event) {
  const bubble = event.target.closest(".bubble");
  if (!bubble) {
    return;
  }

  const message = bubble.closest(".message");
  if (!message || message.classList.contains("is-system")) {
    return;
  }

  window.clearTimeout(state.longPressTimer);
  state.longPressTimer = window.setTimeout(() => {
    const menu = message.querySelector(".message-menu");
    if (menu) {
      closeOpenMenus(menu);
      menu.open = true;
    }
  }, 420);

  if (event.pointerType && event.pointerType !== "mouse") {
    state.swipeState = {
      messageId: message.dataset.messageId,
      node: message,
      startX: event.clientX,
      startY: event.clientY
    };
  }
}

function handleLongPressMove(event) {
  if (!state.swipeState) {
    return;
  }

  const dx = event.clientX - state.swipeState.startX;
  const dy = event.clientY - state.swipeState.startY;
  const node = state.swipeState.node;

  if (Math.abs(dy) > 20) {
    window.clearTimeout(state.longPressTimer);
  }

  if (Math.abs(dx) > Math.abs(dy) && dx > 0) {
    node.style.transform = `translateX(${Math.min(dx, 64)}px)`;
  }
}

function handleLongPressEnd(event) {
  window.clearTimeout(state.longPressTimer);

  if (!state.swipeState) {
    return;
  }

  const dx = event.clientX - state.swipeState.startX;
  const dy = event.clientY - state.swipeState.startY;
  const { node, messageId } = state.swipeState;
  node.style.transform = "";

  if (dx > 72 && Math.abs(dy) < 28) {
    startReply(messageId);
  }

  state.swipeState = null;
}

function syncCurrentRoomReadState() {
  if (!state.room) {
    return;
  }

  upsertConversationSummary({ room: state.room, unreadCount: 0 });
  for (const messageId of state.messageOrder) {
    const message = state.messageStore.get(messageId);
    if (message && !message.mine && !message.deleted) {
      void markMessageAsRead(messageId);
    }
  }
}

function insertEmoji(emoji) {
  if (elements.messageInput.disabled) {
    return;
  }

  const { selectionStart, selectionEnd, value } = elements.messageInput;
  elements.messageInput.value = `${value.slice(0, selectionStart)}${emoji}${value.slice(selectionEnd)}`;
  autoResizeMessageInput();
  elements.messageInput.focus();
  const position = selectionStart + emoji.length;
  elements.messageInput.setSelectionRange(position, position);
  saveCurrentDraft();
}

async function applyFile(file) {
  try {
    const attachment = await fileToAttachment(file);
    setAttachmentDraft(attachment);
  } catch (error) {
    showToast(error.message || "添加附件失败");
  }
}

function handleDropAreaActive(active) {
  elements.messageList.classList.toggle("is-dropping", active);
}

function handleVisibilityOrFocus() {
  if (document.hidden) {
    if (state.room && state.secret) {
      void persistProtectedVault(state.room);
    }
    return;
  }

  if (!document.hidden) {
    syncCurrentRoomReadState();
  }
}

function handlePageHide() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  clearReconnectTimer();
  if (state.room && state.secret) {
    void persistProtectedVault(state.room);
  }
  saveCurrentDraft();
}

async function handleStorageChannelMessage(event) {
  const { type, payload } = event.data || {};
  if (type === "conversations") {
    state.conversations = sortConversations(await readStoredValue(DATABASE.conversationsKey, []));
    renderConversationList();
  } else if (type === "preview-room" && !state.room) {
    state.previewRoom = payload?.room || "";
    if (state.previewRoom) {
      bootFromPreview();
    } else {
      resetChatSurfaceToBlank();
      renderConversationList();
    }
  }
}



function bootFromPreview() {
  if (!state.previewRoom) {
    resetChatSurfaceToBlank();
    return;
  }

  populateJoinForm(state.previewRoom);
  showProtectedConversationPlaceholder(state.previewRoom);
}

async function boot() {
  try {
    await loadStorageState();
  } catch (error) {
    showToast("本地存储初始化失败，将继续使用当前页面");
  }
  elements.nameInput.value = localStorage.getItem(STORAGE.name) || "";
  resetSessionUi();
  renderConversationList();
  bootFromPreview();
  state.bootReady = true;

  elements.joinForm.addEventListener("submit", (event) => {
    void joinRoom(event);
  });
  elements.messageForm.addEventListener("submit", (event) => {
    void sendMessage(event);
  });
  elements.randomRoomButton.addEventListener("click", generateRoomCode);
  elements.leaveButton.addEventListener("click", () => leaveRoom(true, { keepPreview: true }));
  elements.clearComposerMetaButton.addEventListener("click", () => {
    clearComposerMetaState();
    elements.messageInput.value = "";
    autoResizeMessageInput();
    saveCurrentDraft();
  });
  elements.attachButton.addEventListener("click", () => elements.attachmentInput.click());
  elements.attachmentInput.addEventListener("change", () => {
    const [file] = elements.attachmentInput.files || [];
    if (file) {
      void applyFile(file);
    }
    elements.attachmentInput.value = "";
  });
  elements.removeAttachmentButton.addEventListener("click", () => clearAttachmentDraft());

  elements.conversationSearchInput.addEventListener("input", () => {
    state.conversationSearchQuery = elements.conversationSearchInput.value;
    renderConversationList();
  });
  elements.conversationList.addEventListener("click", (event) => {
    void handleConversationListClick(event);
  });

  elements.toggleSearchButton.addEventListener("click", () => {
    if (elements.messageSearchBar.hidden) {
      openMessageSearch();
    } else {
      resetSearchBar();
    }
  });
  elements.messageSearchInput.addEventListener("input", () => {
    state.messageSearchQuery = elements.messageSearchInput.value;
    updateMessageSearch();
  });
  elements.searchPrevButton.addEventListener("click", () => stepSearch(-1));
  elements.searchNextButton.addEventListener("click", () => stepSearch(1));
  elements.closeSearchButton.addEventListener("click", resetSearchBar);

  elements.openInfoButton.addEventListener("click", openInfoDrawer);
  elements.closeInfoButton.addEventListener("click", closeInfoDrawer);
  elements.drawerScrim.addEventListener("click", closeInfoDrawer);
  elements.historyScrim.addEventListener("click", closeHistoryDialog);
  elements.closeHistoryButton.addEventListener("click", closeHistoryDialog);
  elements.confirmScrim.addEventListener("click", () => resolveConfirmDialog(false));
  elements.confirmCancelButton.addEventListener("click", () => resolveConfirmDialog(false));
  elements.confirmConfirmButton.addEventListener("click", () => resolveConfirmDialog(true));
  elements.copyRoomButton.addEventListener("click", async () => {
    const room = state.room || state.previewRoom;
    if (!room) {
      return;
    }
    try {
      await navigator.clipboard.writeText(room);
      showToast("已复制房间号");
    } catch (error) {
      showToast("复制失败");
    }
  });
  elements.rekeyButton.addEventListener("click", () => {
    void rekeyConversation();
  });
  elements.clearLocalButton.addEventListener("click", async () => {
    const room = state.room || state.previewRoom;
    if (!room) {
      return;
    }
    if (!(await confirmAction("清空本机记录", "这会删除当前房间在本机上的消息、草稿和会话入口。", "清空"))) {
      return;
    }
    await clearConversationStorage(room);
    if (state.room === room) {
      leaveRoom(false, { keepPreview: false });
    } else if (state.previewRoom === room) {
      clearPreviewRoom();
      resetChatSurfaceToBlank();
    }
    showToast("本地记录已清空");
    closeInfoDrawer();
  });
  elements.drawerLeaveButton.addEventListener("click", () => {
    closeInfoDrawer();
    leaveRoom(true, { keepPreview: true });
  });

  elements.messageInput.addEventListener("input", () => {
    autoResizeMessageInput();
    saveCurrentDraft();

    if (state.sessionKey && elements.messageInput.value.trim()) {
      void sendTypingIndicator();
    }
  });

  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.messageForm.requestSubmit();
    } else if (event.key === "Escape") {
      clearComposerMetaState();
      saveCurrentDraft();
    }
  });

  elements.messageInput.addEventListener("paste", (event) => {
    const file = [...(event.clipboardData?.files || [])][0];
    if (file) {
      event.preventDefault();
      void applyFile(file);
    }
  });

  elements.messageList.addEventListener("click", handleMessageListClick);
  elements.messageList.addEventListener("pointerdown", handleLongPressStart);
  elements.messageList.addEventListener("pointermove", handleLongPressMove);
  elements.messageList.addEventListener("pointerup", handleLongPressEnd);
  elements.messageList.addEventListener("pointercancel", handleLongPressEnd);

  for (const button of $$(".emoji-chip")) {
    button.addEventListener("click", () => insertEmoji(button.dataset.emoji || ""));
  }

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".message-menu")) {
      closeOpenMenus();
    }
  });

  for (const dropTarget of [elements.messageList, elements.messageForm]) {
    dropTarget.addEventListener("dragenter", (event) => {
      event.preventDefault();
      state.dragCounter += 1;
      handleDropAreaActive(true);
    });
    dropTarget.addEventListener("dragover", (event) => {
      event.preventDefault();
    });
    dropTarget.addEventListener("dragleave", () => {
      state.dragCounter = Math.max(0, state.dragCounter - 1);
      handleDropAreaActive(state.dragCounter > 0);
    });
    dropTarget.addEventListener("drop", (event) => {
      event.preventDefault();
      state.dragCounter = 0;
      handleDropAreaActive(false);
      const [file] = [...(event.dataTransfer?.files || [])];
      if (file) {
        void applyFile(file);
      }
    });
  }

  window.addEventListener("focus", handleVisibilityOrFocus);
  document.addEventListener("visibilitychange", handleVisibilityOrFocus);
  window.addEventListener("pagehide", handlePageHide);
  window.addEventListener("beforeunload", handlePageHide);
  window.addEventListener("pageshow", () => {
    if (state.room && state.shouldReconnect && !state.eventSource) {
      void openRoomEventStream(state.room);
    }
  });

  if (storageChannel) {
    storageChannel.addEventListener("message", (event) => {
      void handleStorageChannelMessage(event);
    });
  }


}

void boot();
