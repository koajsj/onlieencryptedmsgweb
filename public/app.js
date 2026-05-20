"use strict";

const STORAGE = {
  token: "private-chat-token",
  activePeer: "private-chat-active-peer",
  authMode: "private-chat-auth-mode"
};

const AVATAR_TONES = 6;
const PRIVATE_KEY_ITERATIONS = 150000;
const MESSAGE_KEY_INFO = "private-chat-message-key-v1";
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const elements = {
  authScreen: document.querySelector("#authScreen"),
  workspace: document.querySelector("#workspace"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  authForm: document.querySelector("#authForm"),
  authUsernameInput: document.querySelector("#authUsernameInput"),
  authPasswordInput: document.querySelector("#authPasswordInput"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  authTip: document.querySelector("#authTip"),
  globalSearchInput: document.querySelector("#globalSearchInput"),
  meAvatar: document.querySelector("#meAvatar"),
  meUsername: document.querySelector("#meUsername"),
  logoutButton: document.querySelector("#logoutButton"),
  sidebarMeta: document.querySelector("#sidebarMeta"),
  searchGroup: document.querySelector("#searchGroup"),
  searchResultList: document.querySelector("#searchResultList"),
  conversationList: document.querySelector("#conversationList"),
  conversationEmpty: document.querySelector("#conversationEmpty"),
  chatEmpty: document.querySelector("#chatEmpty"),
  chatThread: document.querySelector("#chatThread"),
  mobileBackButton: document.querySelector("#mobileBackButton"),
  peerAvatar: document.querySelector("#peerAvatar"),
  peerName: document.querySelector("#peerName"),
  peerStatus: document.querySelector("#peerStatus"),
  messageList: document.querySelector("#messageList"),
  composerForm: document.querySelector("#composerForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  toast: document.querySelector("#toast")
};

const state = {
  token: "",
  me: null,
  identity: null,
  authMode: localStorage.getItem(STORAGE.authMode) || "login",
  searchQuery: "",
  authBusy: false,
  composerBusy: false,
  conversations: [],
  searchResults: [],
  activePeer: "",
  messageCache: new Map(),
  peerKeys: new Map(),
  importedPeerKeys: new Map(),
  conversationKeys: new Map(),
  eventSource: null,
  searchTimer: 0,
  toastTimer: 0,
  openConversationRequest: 0
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function avatarTone(username) {
  let total = 0;
  for (const char of String(username || "")) {
    total += char.charCodeAt(0);
  }
  return total % AVATAR_TONES;
}

function avatarInitial(username) {
  return String(username || "?").slice(0, 1).toUpperCase();
}

function setAvatar(node, username) {
  node.className = `avatar avatar-tone-${avatarTone(username)}`;
  node.textContent = avatarInitial(username);
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}

function formatTime(timestamp) {
  if (!timestamp) {
    return "";
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelative(timestamp) {
  if (!timestamp) {
    return "";
  }
  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMinutes < 1) {
    return "刚刚";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟前`;
  }
  if (diffMinutes < 24 * 60) {
    return formatTime(timestamp);
  }
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric"
  });
}

function messagePreview(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "还没有消息";
  }
  return normalized.length > 34 ? `${normalized.slice(0, 34)}...` : normalized;
}

function bytesToBase64(bytes) {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  localStorage.setItem(STORAGE.authMode, state.authMode);
  elements.loginTab.classList.toggle("is-active", state.authMode === "login");
  elements.registerTab.classList.toggle("is-active", state.authMode === "register");
  elements.authSubmitButton.textContent = state.authMode === "login" ? "登录" : "注册";
  elements.authTip.textContent =
    state.authMode === "login"
      ? "输入用户名和密码即可，其余流程全部自动完成。"
      : "注册时会自动生成并保存密钥，后续聊天全程自动加密。";
  elements.authPasswordInput.autocomplete = state.authMode === "login" ? "current-password" : "new-password";
}

function setAuthBusy(busy) {
  state.authBusy = busy;
  elements.authSubmitButton.disabled = busy;
  elements.authUsernameInput.disabled = busy;
  elements.authPasswordInput.disabled = busy;
}

function setComposerBusy(busy) {
  state.composerBusy = busy;
  elements.sendButton.disabled = busy || !state.activePeer;
  elements.messageInput.disabled = busy || !state.activePeer;
}

function isMobile() {
  return window.innerWidth <= 900;
}

function syncLayoutState() {
  document.body.classList.toggle("is-mobile", isMobile());
  document.body.classList.toggle("is-chat-open", isMobile() && Boolean(state.activePeer));
}

function clearStoredSessionArtifacts() {
  localStorage.removeItem(STORAGE.token);
  localStorage.removeItem(STORAGE.activePeer);
}

async function api(pathname, options = {}) {
  const headers = {
    Accept: "application/json",
    ...(options.headers || {})
  };

  if (state.token) {
    headers.Authorization = `Bearer ${state.token}`;
  }

  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }

  const response = await fetch(pathname, {
    method: options.method || "GET",
    headers,
    body
  });

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    if (response.status === 401 && state.token) {
      clearSession(false);
    }
    throw new Error(payload?.error || `request failed: ${response.status}`);
  }
  return payload;
}

function clearSession(showAuth = true) {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }

  state.token = "";
  state.me = null;
  state.identity = null;
  state.searchQuery = "";
  state.conversations = [];
  state.searchResults = [];
  state.activePeer = "";
  state.messageCache.clear();
  state.peerKeys.clear();
  state.importedPeerKeys.clear();
  state.conversationKeys.clear();
  state.openConversationRequest += 1;

  clearStoredSessionArtifacts();
  elements.globalSearchInput.value = "";
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  render();
  if (showAuth) {
    elements.workspace.hidden = true;
    elements.authScreen.hidden = false;
  }
}

function setSession(token, user, identity) {
  state.token = token;
  state.me = user;
  state.identity = identity;
  elements.authScreen.hidden = true;
  elements.workspace.hidden = false;
  elements.meUsername.textContent = user.username;
  setAvatar(elements.meAvatar, user.username);
  cachePeerInfo(user);
}

function cachePeerInfo(item) {
  if (item?.username && item?.publicKey) {
    state.peerKeys.set(item.username, item.publicKey);
  }
}

function getConversation(username) {
  return state.conversations.find((item) => item.username === username) || null;
}

function sortConversations() {
  state.conversations.sort((left, right) => {
    if (right.lastAt !== left.lastAt) {
      return right.lastAt - left.lastAt;
    }
    return left.username.localeCompare(right.username);
  });
}

function upsertConversation(patch) {
  const existing = getConversation(patch.username);
  const next = {
    username: patch.username,
    online: Boolean(patch.online),
    avatarSeed: patch.avatarSeed || patch.username,
    publicKey: patch.publicKey || existing?.publicKey || "",
    latestMessage: patch.latestMessage === undefined ? existing?.latestMessage || null : patch.latestMessage,
    previewText: patch.previewText === undefined ? existing?.previewText || "" : patch.previewText,
    lastAt: patch.lastAt || 0,
    unread: Number(patch.unread === undefined ? existing?.unread || 0 : patch.unread)
  };

  cachePeerInfo(next);
  if (existing) {
    Object.assign(existing, next);
  } else {
    state.conversations.push(next);
  }
  sortConversations();
}

function activePeerMeta() {
  if (!state.activePeer) {
    return null;
  }
  return (
    getConversation(state.activePeer) ||
    state.searchResults.find((item) => item.username === state.activePeer) || {
      username: state.activePeer,
      online: false,
      publicKey: state.peerKeys.get(state.activePeer) || "",
      avatarSeed: state.activePeer,
      previewText: "",
      lastAt: 0,
      unread: 0
    }
  );
}

function renderSidebar() {
  const query = state.searchQuery.trim().toLowerCase();
  const conversations = state.conversations.filter((item) => {
    if (!query) {
      return true;
    }
    return (
      item.username.toLowerCase().includes(query) ||
      String(item.previewText || "").toLowerCase().includes(query)
    );
  });

  elements.sidebarMeta.textContent = `${state.conversations.length} 个会话`;
  elements.searchGroup.hidden = !query;

  elements.searchResultList.textContent = "";
  if (query) {
    if (state.searchResults.length === 0) {
      const empty = document.createElement("div");
      empty.className = "list-empty";
      empty.textContent = "没有匹配的用户";
      elements.searchResultList.append(empty);
    } else {
      for (const user of state.searchResults) {
        elements.searchResultList.append(renderListItem(user, true));
      }
    }
  }

  elements.conversationList.textContent = "";
  elements.conversationEmpty.hidden = conversations.length > 0;
  for (const conversation of conversations) {
    elements.conversationList.append(renderListItem(conversation, false));
  }
}

function renderListItem(item, isSearchResult) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "list-item";
  if (item.username === state.activePeer) {
    button.classList.add("is-active");
  }
  button.dataset.username = item.username;

  const avatar = document.createElement("div");
  setAvatar(avatar, item.username);

  const meta = document.createElement("div");
  meta.className = "list-item-meta";
  meta.innerHTML = `
    <div class="list-row">
      <strong>${escapeHtml(item.username)}</strong>
      <span>${escapeHtml(isSearchResult ? (item.online ? "在线" : "离线") : formatRelative(item.lastAt))}</span>
    </div>
    <div class="list-row is-subtle">
      <span>${escapeHtml(isSearchResult ? "点击开始私聊" : messagePreview(item.previewText || "已加密消息"))}</span>
      ${!isSearchResult && item.unread ? `<b class="unread-badge">${item.unread}</b>` : item.online ? '<i class="online-dot"></i>' : ""}
    </div>
  `;

  button.append(avatar, meta);
  return button;
}

function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message ${message.mine ? "is-own" : "is-peer"}`;
  article.innerHTML = `
    ${message.mine ? "" : `<div class="message-avatar avatar avatar-tone-${avatarTone(message.from)}">${escapeHtml(avatarInitial(message.from))}</div>`}
    <div class="message-body">
      <div class="bubble">${escapeHtml(message.text).replaceAll("\n", "<br />")}</div>
      <div class="message-meta">${escapeHtml(formatTime(message.createdAt))}</div>
    </div>
  `;
  return article;
}

function scrollMessagesToBottom() {
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderThread() {
  const peer = activePeerMeta();
  const hasPeer = Boolean(peer);

  elements.chatEmpty.hidden = hasPeer;
  elements.chatThread.hidden = !hasPeer;

  if (!peer) {
    return;
  }

  elements.peerName.textContent = peer.username;
  elements.peerStatus.textContent = peer.online ? "在线 · 自动端到端加密" : "离线 · 自动端到端加密";
  setAvatar(elements.peerAvatar, peer.username);

  const messages = state.messageCache.get(peer.username) || [];
  elements.messageList.textContent = "";

  if (messages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "message-empty";
    empty.innerHTML = `<strong>${escapeHtml(peer.username)}</strong><span>还没有消息。输入第一句，程序会自动完成加密和发送。</span>`;
    elements.messageList.append(empty);
  } else {
    for (const message of messages) {
      elements.messageList.append(renderMessage(message));
    }
  }

  setComposerBusy(false);
  scrollMessagesToBottom();
}

function render() {
  syncLayoutState();
  renderSidebar();
  renderThread();
}

function autoResizeComposer() {
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(elements.messageInput.scrollHeight, 180)}px`;
}

async function derivePasswordKey(password, saltBytes) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: saltBytes,
      iterations: PRIVATE_KEY_ITERATIONS,
      hash: "SHA-256"
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptPrivateKeyBundle(privateKeyBytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await derivePasswordKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, privateKeyBytes);

  return {
    privateKeySalt: bytesToBase64(salt),
    privateKeyIv: bytesToBase64(iv),
    encryptedPrivateKey: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptPrivateKeyBundle(password, keyBundle) {
  const salt = base64ToBytes(keyBundle.privateKeySalt);
  const iv = base64ToBytes(keyBundle.privateKeyIv);
  const encryptedPrivateKey = base64ToBytes(keyBundle.encryptedPrivateKey);
  const wrappingKey = await derivePasswordKey(password, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    wrappingKey,
    encryptedPrivateKey
  );
  return new Uint8Array(decrypted);
}

async function importPublicKey(publicKeyBase64) {
  if (state.importedPeerKeys.has(publicKeyBase64)) {
    return state.importedPeerKeys.get(publicKeyBase64);
  }
  const imported = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(publicKeyBase64),
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );
  state.importedPeerKeys.set(publicKeyBase64, imported);
  return imported;
}

async function createIdentity(password) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const publicKeyBase64 = bytesToBase64(publicKeyRaw);
  const keyBundle = await encryptPrivateKeyBundle(privateKeyPkcs8, password);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyBase64,
    keyBundle: {
      publicKey: publicKeyBase64,
      ...keyBundle
    }
  };
}

async function restoreIdentity(username, password, keyBundle) {
  try {
    const privateKeyBytes = await decryptPrivateKeyBundle(password, keyBundle);
    const publicKey = await importPublicKey(keyBundle.publicKey);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      privateKeyBytes,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    );

    state.importedPeerKeys.delete(keyBundle.publicKey);

    return {
      username,
      publicKey,
      privateKey,
      publicKeyBase64: keyBundle.publicKey
    };
  } catch (error) {
    throw new Error("无法解锁该账号的本地密钥");
  }
}

async function getConversationKey(peerUsername, peerPublicKeyBase64) {
  if (!state.identity || !state.me) {
    throw new Error("本地密钥未就绪");
  }
  const rawPeerKey = peerPublicKeyBase64 || state.peerKeys.get(peerUsername);
  if (!rawPeerKey) {
    throw new Error("缺少对端公钥");
  }

  const cacheKey = `${peerUsername}:${rawPeerKey}`;
  if (state.conversationKeys.has(cacheKey)) {
    return state.conversationKeys.get(cacheKey);
  }

  const peerPublicKey = await importPublicKey(rawPeerKey);
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    state.identity.privateKey,
    256
  );
  const hkdfKey = await crypto.subtle.importKey("raw", sharedSecret, "HKDF", false, ["deriveKey"]);
  const participants = [state.me.username, peerUsername].sort().join(":");
  const keyBinding = [state.identity.publicKeyBase64, rawPeerKey].sort().join(":");
  const salt = await crypto.subtle.digest(
    "SHA-256",
    textEncoder.encode(`${participants}|${keyBinding}|private-chat-v1`)
  );
  const conversationKey = await crypto.subtle.deriveKey(
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

  state.conversationKeys.set(cacheKey, conversationKey);
  return conversationKey;
}

function aadBytes(from, to) {
  return textEncoder.encode(JSON.stringify({ from, to }));
}

async function encryptChatMessage(text, peerUsername) {
  const peerPublicKeyBase64 = state.peerKeys.get(peerUsername);
  const conversationKey = await getConversationKey(peerUsername, peerPublicKeyBase64);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: aadBytes(state.me.username, peerUsername)
    },
    conversationKey,
    textEncoder.encode(text)
  );
  return {
    to: peerUsername,
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptEnvelope(message, peerPublicKeyBase64) {
  const peerUsername = message.mine ? message.to : message.from;
  const conversationKey = await getConversationKey(peerUsername, peerPublicKeyBase64);
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: base64ToBytes(message.nonce),
      additionalData: aadBytes(message.from, message.to)
    },
    conversationKey,
    base64ToBytes(message.ciphertext)
  );
  return textDecoder.decode(plaintext);
}

async function decryptMessageView(message, peerPublicKeyBase64) {
  const text = await decryptEnvelope(message, peerPublicKeyBase64);
  return {
    id: message.id,
    from: message.from,
    to: message.to,
    peer: message.peer,
    mine: message.mine,
    text,
    createdAt: message.createdAt
  };
}

async function decryptPreview(conversation) {
  if (!conversation.latestMessage) {
    return "";
  }
  try {
    return await decryptEnvelope(conversation.latestMessage, conversation.publicKey);
  } catch (error) {
    return "已加密消息";
  }
}

async function loadConversations() {
  const payload = await api("/api/conversations");
  for (const conversation of payload.conversations) {
    cachePeerInfo(conversation);
  }

  const conversations = await Promise.all(
    payload.conversations.map(async (conversation) => ({
      ...conversation,
      unread: getConversation(conversation.username)?.unread || 0,
      previewText: await decryptPreview(conversation)
    }))
  );

  state.conversations = conversations;
  sortConversations();
}

async function loadSearchResults(query) {
  if (!query.trim()) {
    state.searchResults = [];
    renderSidebar();
    return;
  }
  try {
    const payload = await api(`/api/users?q=${encodeURIComponent(query)}`);
    state.searchResults = payload.users;
    for (const user of payload.users) {
      cachePeerInfo(user);
    }
    renderSidebar();
  } catch (error) {
    showToast(error.message);
  }
}

function queueSearch() {
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => {
    void loadSearchResults(state.searchQuery);
  }, 180);
}

function ensureConversationEntry(username) {
  if (!getConversation(username)) {
    upsertConversation({
      username,
      online: false,
      publicKey: state.peerKeys.get(username) || "",
      avatarSeed: username,
      previewText: "",
      lastAt: 0,
      unread: 0
    });
  }
}

async function openConversation(username) {
  if (!username) {
    return;
  }

  ensureConversationEntry(username);
  state.activePeer = username;
  localStorage.setItem(STORAGE.activePeer, username);
  const conversation = getConversation(username);
  if (conversation) {
    conversation.unread = 0;
  }
  render();

  const requestId = ++state.openConversationRequest;
  try {
    const payload = await api(`/api/messages?with=${encodeURIComponent(username)}`);
    if (requestId !== state.openConversationRequest) {
      return;
    }

    cachePeerInfo(payload.peer);
    const decryptedMessages = [];
    for (const message of payload.messages) {
      const peerPublicKey = message.publicKey || payload.peer.publicKey;
      const decrypted = await decryptMessageView(message, peerPublicKey);
      decryptedMessages.push(decrypted);
    }

    state.messageCache.set(username, decryptedMessages);
    upsertConversation({
      username: payload.peer.username,
      online: payload.peer.online,
      avatarSeed: payload.peer.avatarSeed,
      publicKey: payload.peer.publicKey,
      previewText: getConversation(username)?.previewText || "",
      lastAt: getConversation(username)?.lastAt || 0,
      unread: 0
    });
    render();
  } catch (error) {
    showToast(error.message);
  }
}

function closeConversationOnMobile() {
  if (!isMobile()) {
    return;
  }
  state.activePeer = "";
  localStorage.removeItem(STORAGE.activePeer);
  render();
}

function mergePresence(username, online) {
  const conversation = getConversation(username);
  if (conversation) {
    conversation.online = online;
  }
  state.searchResults = state.searchResults.map((item) =>
    item.username === username ? { ...item, online } : item
  );
  render();
}

function messageExists(peer, id) {
  return (state.messageCache.get(peer) || []).some((message) => message.id === id);
}

async function ingestEncryptedMessage(message) {
  const peer = message.peer;
  const peerPublicKey = message.publicKey || state.peerKeys.get(peer);
  if (!peer || !peerPublicKey || messageExists(peer, message.id)) {
    return;
  }

  cachePeerInfo({ username: peer, publicKey: peerPublicKey });

  let decrypted;
  try {
    decrypted = await decryptMessageView(message, peerPublicKey);
  } catch (error) {
    decrypted = {
      id: message.id,
      from: message.from,
      to: message.to,
      peer,
      mine: message.mine,
      text: "[无法解密]",
      createdAt: message.createdAt
    };
  }

  const current = state.messageCache.get(peer) || [];
  current.push(decrypted);
  current.sort((left, right) => left.createdAt - right.createdAt);
  state.messageCache.set(peer, current);

  const previous = getConversation(peer);
  const unread =
    !decrypted.mine && state.activePeer !== peer ? (previous?.unread || 0) + 1 : 0;

  upsertConversation({
    username: peer,
    online: previous?.online || false,
    avatarSeed: peer,
    publicKey: peerPublicKey,
    latestMessage: {
      id: message.id,
      from: message.from,
      to: message.to,
      nonce: message.nonce,
      ciphertext: message.ciphertext,
      createdAt: message.createdAt
    },
    previewText: decrypted.text === "[无法解密]" ? "已加密消息" : decrypted.text,
    lastAt: message.createdAt,
    unread
  });

  if (state.activePeer === peer) {
    renderThread();
  } else {
    renderSidebar();
  }
}

function openEventStream() {
  if (state.eventSource) {
    state.eventSource.close();
  }

  const source = new EventSource(`/api/events?token=${encodeURIComponent(state.token)}`);
  state.eventSource = source;

  source.addEventListener("ready", (event) => {
    const payload = JSON.parse(event.data);
    for (const username of payload.onlineUsers || []) {
      mergePresence(username, true);
    }
  });

  source.addEventListener("presence", (event) => {
    const payload = JSON.parse(event.data);
    mergePresence(payload.username, payload.online);
  });

  source.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    void ingestEncryptedMessage(payload);
  });
}

async function afterLogin() {
  await loadConversations();
  openEventStream();

  const savedPeer = localStorage.getItem(STORAGE.activePeer) || "";
  render();
  if (savedPeer && state.peerKeys.has(savedPeer)) {
    await openConversation(savedPeer);
  }
}

async function submitAuth(event) {
  event.preventDefault();
  if (state.authBusy) {
    return;
  }

  const username = elements.authUsernameInput.value.trim();
  const password = elements.authPasswordInput.value.trim();
  if (!username || !password) {
    showToast("请输入用户名和密码");
    return;
  }

  if (!window.crypto?.subtle) {
    showToast("当前环境不支持 Web Crypto，请使用 HTTPS 或 localhost");
    return;
  }

  setAuthBusy(true);
  try {
    let payload;
    let identity;

    if (state.authMode === "register") {
      identity = await createIdentity(password);
      payload = await api("/api/register", {
        method: "POST",
        body: {
          username,
          password,
          ...identity.keyBundle
        }
      });
      identity.publicKeyBase64 = payload.keyBundle.publicKey;
    } else {
      payload = await api("/api/login", {
        method: "POST",
        body: { username, password }
      });
      identity = await restoreIdentity(payload.user.username, password, payload.keyBundle);
    }

    setSession(payload.token, payload.user, identity);
    elements.authPasswordInput.value = "";
    await afterLogin();
    showToast(state.authMode === "login" ? "登录成功，已自动解锁加密会话" : "注册成功，已自动创建加密会话");
  } catch (error) {
    showToast(error.message || "认证失败");
  } finally {
    setAuthBusy(false);
  }
}

async function logout() {
  try {
    await api("/api/logout", { method: "POST" });
  } catch (error) {
    // Ignore logout errors and clear local state.
  }
  clearSession(true);
}

async function submitMessage(event) {
  event.preventDefault();
  if (!state.activePeer || state.composerBusy) {
    return;
  }

  const text = elements.messageInput.value.trim();
  if (!text) {
    return;
  }

  setComposerBusy(true);
  try {
    const encrypted = await encryptChatMessage(text, state.activePeer);
    const payload = await api("/api/messages", {
      method: "POST",
      body: encrypted
    });
    await ingestEncryptedMessage(payload.message);
    elements.messageInput.value = "";
    autoResizeComposer();
  } catch (error) {
    showToast(error.message);
  } finally {
    setComposerBusy(false);
  }
}

function handleListClick(event) {
  const item = event.target.closest(".list-item");
  if (!item) {
    return;
  }
  void openConversation(item.dataset.username || "");
}

function handleSearchInput() {
  state.searchQuery = elements.globalSearchInput.value;
  renderSidebar();
  queueSearch();
}

function bindEvents() {
  elements.loginTab.addEventListener("click", () => setAuthMode("login"));
  elements.registerTab.addEventListener("click", () => setAuthMode("register"));
  elements.authForm.addEventListener("submit", (event) => {
    void submitAuth(event);
  });
  elements.logoutButton.addEventListener("click", () => {
    void logout();
  });
  elements.globalSearchInput.addEventListener("input", handleSearchInput);
  elements.conversationList.addEventListener("click", handleListClick);
  elements.searchResultList.addEventListener("click", handleListClick);
  elements.composerForm.addEventListener("submit", (event) => {
    void submitMessage(event);
  });
  elements.messageInput.addEventListener("input", autoResizeComposer);
  elements.mobileBackButton.addEventListener("click", closeConversationOnMobile);
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  window.addEventListener("resize", render);
}

function boot() {
  clearStoredSessionArtifacts();
  setAuthMode(state.authMode);
  bindEvents();
  render();

  if (!window.crypto?.subtle) {
    elements.authSubmitButton.disabled = true;
    elements.authTip.textContent = "当前环境缺少 Web Crypto。请用 HTTPS 或 localhost 打开此站点。";
  }
}

boot();
