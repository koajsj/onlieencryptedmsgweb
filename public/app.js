"use strict";

const STORAGE = {
  token: "private-chat-token",
  activePeer: "private-chat-active-peer",
  authMode: "private-chat-auth-mode",
  conversationPrefs: "private-chat-conversation-prefs",
  drafts: "private-chat-drafts",
  showArchived: "private-chat-show-archived"
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
  pinPeerButton: document.querySelector("#pinPeerButton"),
  mutePeerButton: document.querySelector("#mutePeerButton"),
  archivePeerButton: document.querySelector("#archivePeerButton"),
  exportPeerButton: document.querySelector("#exportPeerButton"),
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
  pendingMessages: new Map(),
  messagePageState: new Map(),
  pendingSequence: 0,
  eventSource: null,
  reconnectTimer: 0,
  reconnectAttempts: 0,
  manualEventSourceClose: false,
  connectionState: "offline",
  searchTimer: 0,
  toastTimer: 0,
  openConversationRequest: 0,
  conversationPrefs: {},
  drafts: {},
  showArchived: localStorage.getItem(STORAGE.showArchived) === "1"
};

function readJsonStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

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

function resetLocalConversationState() {
  state.conversationPrefs = readJsonStorage(STORAGE.conversationPrefs, {});
  state.drafts = readJsonStorage(STORAGE.drafts, {});
}

function saveConversationPrefs() {
  writeJsonStorage(STORAGE.conversationPrefs, state.conversationPrefs);
}

function saveDrafts() {
  writeJsonStorage(STORAGE.drafts, state.drafts);
}

function peerPrefs(username) {
  if (!username) {
    return { pinned: false, muted: false, archived: false };
  }
  const prefs = state.conversationPrefs[username];
  return {
    pinned: Boolean(prefs?.pinned),
    muted: Boolean(prefs?.muted),
    archived: Boolean(prefs?.archived)
  };
}

function updatePeerPrefs(username, patch) {
  if (!username) {
    return;
  }
  const next = {
    ...peerPrefs(username),
    ...patch
  };
  state.conversationPrefs[username] = next;
  saveConversationPrefs();
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

function clearStoredSessionArtifacts(clearToken = true, clearActivePeer = true) {
  if (clearToken) {
    localStorage.removeItem(STORAGE.token);
  }
  if (clearActivePeer) {
    localStorage.removeItem(STORAGE.activePeer);
  }
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
    if (response.status === 401 && state.token && !options.skipAuthReset) {
      clearSession(true);
    }
    throw new Error(payload?.error || `request failed: ${response.status}`);
  }
  return payload;
}

function closeEventStream() {
  if (state.eventSource) {
    state.manualEventSourceClose = true;
    state.eventSource.close();
    state.eventSource = null;
  }
  if (state.reconnectTimer) {
    window.clearTimeout(state.reconnectTimer);
    state.reconnectTimer = 0;
  }
  state.manualEventSourceClose = false;
  state.reconnectAttempts = 0;
  state.connectionState = "offline";
}

function clearSession(showAuth = true, clearToken = true) {
  closeEventStream();

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
  state.pendingMessages.clear();
  state.messagePageState.clear();
  state.pendingSequence = 0;
  state.openConversationRequest += 1;

  clearStoredSessionArtifacts(clearToken, true);
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
  resetLocalConversationState();
  localStorage.setItem(STORAGE.token, token);
  elements.authScreen.hidden = true;
  elements.workspace.hidden = false;
  elements.meUsername.textContent = user.username;
  setAvatar(elements.meAvatar, user.username);
  cachePeerInfo(user);
}

function pageStateForPeer(username) {
  const existing = state.messagePageState.get(username);
  if (existing) {
    return existing;
  }
  const created = {
    hasMore: false,
    nextBefore: "",
    loadingOlder: false
  };
  state.messagePageState.set(username, created);
  return created;
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
    const leftPrefs = peerPrefs(left.username);
    const rightPrefs = peerPrefs(right.username);
    if (Number(rightPrefs.pinned) !== Number(leftPrefs.pinned)) {
      return Number(rightPrefs.pinned) - Number(leftPrefs.pinned);
    }
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

function draftTextForPeer(username) {
  return String(state.drafts[username] || "");
}

function setDraftForPeer(username, text) {
  if (!username) {
    return;
  }
  const next = String(text || "");
  if (!next.trim()) {
    delete state.drafts[username];
  } else {
    state.drafts[username] = next.slice(0, 4000);
  }
  saveDrafts();
}

function applyThreadActionState(peer) {
  const prefs = peerPrefs(peer || "");
  const hasPeer = Boolean(peer);
  elements.pinPeerButton.disabled = !hasPeer;
  elements.mutePeerButton.disabled = !hasPeer;
  elements.archivePeerButton.disabled = !hasPeer;
  elements.exportPeerButton.disabled = !hasPeer;
  elements.pinPeerButton.textContent = prefs.pinned ? "取消置顶" : "置顶";
  elements.mutePeerButton.textContent = prefs.muted ? "取消静音" : "静音";
  elements.archivePeerButton.textContent = prefs.archived ? "取消归档" : "归档";
}

function togglePeerPref(peer, key) {
  if (!peer) {
    return;
  }
  const prefs = peerPrefs(peer);
  updatePeerPrefs(peer, { [key]: !prefs[key] });
  sortConversations();
  render();
}

function toggleArchivedView() {
  state.showArchived = !state.showArchived;
  localStorage.setItem(STORAGE.showArchived, state.showArchived ? "1" : "0");
  renderSidebar();
  showToast(state.showArchived ? "已显示归档会话" : "已隐藏归档会话");
}

function exportActiveConversation() {
  const peer = state.activePeer;
  if (!peer) {
    return;
  }
  const messages = state.messageCache.get(peer) || [];
  if (messages.length === 0) {
    showToast("当前会话没有可导出的消息");
    return;
  }
  const lines = messages.map((message) => {
    const who = message.mine ? "我" : message.from;
    return `[${new Date(message.createdAt).toLocaleString()}] ${who}: ${message.text}`;
  });
  const content = lines.join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `chat-${peer}-${Date.now()}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderSidebar() {
  const query = state.searchQuery.trim().toLowerCase();
  const archivedHiddenCount = state.conversations.filter((item) => peerPrefs(item.username).archived).length;
  const conversations = state.conversations.filter((item) => {
    const prefs = peerPrefs(item.username);
    if (!state.showArchived && prefs.archived) {
      return false;
    }
    if (!query) {
      return true;
    }
    return (
      item.username.toLowerCase().includes(query) ||
      String(item.previewText || "").toLowerCase().includes(query)
    );
  });

  const visibleCount = conversations.length;
  const archiveHint = archivedHiddenCount && !state.showArchived ? ` | 已隐藏 ${archivedHiddenCount}` : "";
  elements.sidebarMeta.textContent = `${visibleCount} 个会话${archiveHint} | 双击切换归档`;
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
  const prefs = peerPrefs(item.username);
  const button = document.createElement("button");
  button.type = "button";
  button.className = "list-item";
  if (item.username === state.activePeer) {
    button.classList.add("is-active");
  }
  if (prefs.pinned) {
    button.classList.add("is-pinned");
  }
  if (prefs.archived) {
    button.classList.add("is-archived");
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
      ${!isSearchResult && item.unread && !prefs.muted ? `<b class="unread-badge">${item.unread}</b>` : item.online ? '<i class="online-dot"></i>' : ""}
    </div>
  `;

  if (!isSearchResult) {
    const flags = [];
    if (prefs.pinned) {
      flags.push('<em class="list-flag">置顶</em>');
    }
    if (prefs.muted) {
      flags.push('<em class="list-flag">静音</em>');
    }
    if (prefs.archived) {
      flags.push('<em class="list-flag">归档</em>');
    }
    if (flags.length > 0) {
      const flagRow = document.createElement("div");
      flagRow.className = "list-flags";
      flagRow.innerHTML = flags.join("");
      meta.append(flagRow);
    }
  }

  button.append(avatar, meta);
  return button;
}
function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message ${message.mine ? "is-own" : "is-peer"}${message.pending ? " is-pending" : ""}${message.failed ? " is-failed" : ""}`;
  article.dataset.messageId = message.id;
  article.dataset.messageText = message.text;
  const statusAction = message.pending
    ? '<span class="message-state">发送中</span>'
    : message.failed
      ? `<button class="message-retry-button" type="button" data-temp-id="${escapeHtml(message.tempId || "")}">重试</button>`
      : "";
  const copyAction = `<button class="message-copy-button" type="button" data-copy-id="${escapeHtml(message.id || "")}">复制</button>`;
  article.innerHTML = `
    ${message.mine ? "" : `<div class="message-avatar avatar avatar-tone-${avatarTone(message.from)}">${escapeHtml(avatarInitial(message.from))}</div>`}
    <div class="message-body">
      <div class="bubble">${escapeHtml(message.text).replaceAll("\n", "<br />")}</div>
      <div class="message-meta">${escapeHtml(formatTime(message.createdAt))}${statusAction ? ` | ${statusAction}` : ""} | ${copyAction}</div>
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
  applyThreadActionState(hasPeer ? peer.username : "");

  if (!peer) {
    return;
  }

  elements.peerName.textContent = peer.username;
  let connectionLabel = "";
  if (state.connectionState === "reconnecting") {
    connectionLabel = " | 连接重试中";
  } else if (state.connectionState === "offline") {
    connectionLabel = " | 连接未建立";
  }
  const prefs = peerPrefs(peer.username);
  const statusTags = [];
  if (prefs.pinned) {
    statusTags.push("置顶");
  }
  if (prefs.muted) {
    statusTags.push("静音");
  }
  if (prefs.archived) {
    statusTags.push("归档");
  }
  const statusSuffix = statusTags.length ? ` | ${statusTags.join(" · ")}` : "";
  elements.peerStatus.textContent = `${peer.online ? "在线" : "离线"} | 自动端到端加密${connectionLabel}${statusSuffix}`;
  setAvatar(elements.peerAvatar, peer.username);

  const messages = state.messageCache.get(peer.username) || [];
  const paging = pageStateForPeer(peer.username);
  elements.messageList.textContent = "";

  if (paging.hasMore) {
    const loadOlderWrap = document.createElement("div");
    loadOlderWrap.className = "message-load-older-wrap";
    const loadOlderButton = document.createElement("button");
    loadOlderButton.type = "button";
    loadOlderButton.className = "message-load-older-button";
    loadOlderButton.dataset.loadOlderPeer = peer.username;
    loadOlderButton.textContent = paging.loadingOlder ? "加载中..." : "加载更早消息";
    loadOlderButton.disabled = paging.loadingOlder;
    loadOlderWrap.append(loadOlderButton);
    elements.messageList.append(loadOlderWrap);
  }

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

  if (state.activePeer === peer.username && document.activeElement !== elements.messageInput) {
    const draft = draftTextForPeer(peer.username);
    elements.messageInput.value = draft;
    autoResizeComposer();
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
    throw new Error("鏃犳硶瑙ｉ攣璇ヨ处鍙风殑鏈湴瀵嗛挜");
  }
}

async function getConversationKey(peerUsername, peerPublicKeyBase64) {
  if (!state.identity || !state.me) {
    throw new Error("本地密钥未就绪");
  }
  const rawPeerKey = peerPublicKeyBase64 || state.peerKeys.get(peerUsername);
  if (!rawPeerKey) {
    throw new Error("缂哄皯瀵圭鍏挜");
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

function peerFromMessage(message, fallbackPeer = "") {
  if (fallbackPeer) {
    return fallbackPeer;
  }
  if (message?.peer) {
    return message.peer;
  }
  if (message?.from && message?.to && state.me?.username) {
    return message.from === state.me.username ? message.to : message.from;
  }
  return "";
}

async function encryptOutboundMessage(peerUsername, text) {
  const peerPublicKey = state.peerKeys.get(peerUsername);
  if (!peerPublicKey) {
    throw new Error("缂哄皯瀵圭鍏挜");
  }
  const conversationKey = await getConversationKey(peerUsername, peerPublicKey);
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
    nonce: bytesToBase64(nonce),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptCiphertextMessage(message, peerPublicKeyBase64, fallbackPeer = "") {
  const peerUsername = peerFromMessage(message, fallbackPeer);
  if (!peerUsername) {
    throw new Error("缂哄皯瀵圭鏍囪瘑");
  }
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

async function decryptMessageView(message, peerPublicKeyBase64, fallbackPeer = "") {
  let text = "";
  if (typeof message.text === "string" && !message.ciphertext) {
    text = message.text;
  } else {
    try {
      text = await decryptCiphertextMessage(message, peerPublicKeyBase64, fallbackPeer);
    } catch (error) {
      text = "[鏃犳硶瑙ｅ瘑]";
    }
  }

  return {
    id: message.id,
    from: message.from,
    to: message.to,
    peer: peerFromMessage(message, fallbackPeer),
    mine: message.mine,
    text,
    createdAt: message.createdAt
  };
}

async function decryptPreview(conversation) {
  if (!conversation.latestMessage) {
    return "";
  }
  const preview = await decryptMessageView(
    {
      ...conversation.latestMessage,
      peer: conversation.username,
      mine: conversation.latestMessage.from === state.me?.username
    },
    conversation.publicKey,
    conversation.username
  );
  return preview.text;
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

function buildTempMessage(peer, text) {
  const tempId = `tmp-${Date.now()}-${++state.pendingSequence}`;
  return {
    id: tempId,
    tempId,
    from: state.me?.username || "",
    to: peer,
    peer,
    mine: true,
    text,
    createdAt: Date.now(),
    pending: true,
    failed: false
  };
}

function removePendingMessageFromCache(tempId) {
  for (const [peer, messages] of state.messageCache) {
    const next = messages.filter((message) => message.tempId !== tempId);
    if (next.length !== messages.length) {
      state.messageCache.set(peer, next);
      return true;
    }
  }
  return false;
}

function setPendingMessageState(tempId, failed) {
  for (const [peer, messages] of state.messageCache) {
    let changed = false;
    const next = messages.map((message) => {
      if (message.tempId !== tempId) {
        return message;
      }
      changed = true;
      return {
        ...message,
        pending: false,
        failed: Boolean(failed)
      };
    });
    if (changed) {
      state.messageCache.set(peer, next);
      return true;
    }
  }
  return false;
}

function addPendingMessage(peer, text) {
  const pending = buildTempMessage(peer, text);
  const current = state.messageCache.get(peer) || [];
  current.push(pending);
  current.sort((left, right) => left.createdAt - right.createdAt);
  state.messageCache.set(peer, current);
  state.pendingMessages.set(pending.tempId, {
    tempId: pending.tempId,
    peer,
    text,
    createdAt: pending.createdAt
  });
  upsertConversation({
    username: peer,
    online: getConversation(peer)?.online || false,
    avatarSeed: peer,
    publicKey: state.peerKeys.get(peer) || "",
    previewText: text,
    lastAt: pending.createdAt
  });
  return pending.tempId;
}

function reconcilePendingMessage(peer, text, createdAt) {
  for (const [tempId, pending] of state.pendingMessages) {
    if (pending.peer !== peer || pending.text !== text) {
      continue;
    }
    if (Math.abs((pending.createdAt || 0) - createdAt) > 60000) {
      continue;
    }
    state.pendingMessages.delete(tempId);
    removePendingMessageFromCache(tempId);
    return;
  }
}

async function openConversation(username) {
  if (!username) {
    return;
  }

  ensureConversationEntry(username);
  state.activePeer = username;
  localStorage.setItem(STORAGE.activePeer, username);
  elements.messageInput.value = draftTextForPeer(username);
  autoResizeComposer();
  const conversation = getConversation(username);
  if (conversation) {
    conversation.unread = 0;
  }
  render();

  const requestId = ++state.openConversationRequest;
  try {
    const payload = await api(`/api/messages?with=${encodeURIComponent(username)}&limit=50`);
    if (requestId !== state.openConversationRequest) {
      return;
    }

    cachePeerInfo(payload.peer);
    const decryptedMessages = [];
    for (const message of payload.messages) {
      const peerPublicKey = message.publicKey || payload.peer.publicKey;
      const decrypted = await decryptMessageView(message, peerPublicKey, payload.peer.username);
      decryptedMessages.push(decrypted);
    }

    state.messageCache.set(username, decryptedMessages);
    state.messagePageState.set(username, {
      hasMore: Boolean(payload.hasMore),
      nextBefore: String(payload.nextBefore || ""),
      loadingOlder: false
    });
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

async function loadOlderMessages(peer) {
  if (!peer || state.activePeer !== peer) {
    return;
  }
  const paging = pageStateForPeer(peer);
  if (!paging.hasMore || paging.loadingOlder || !paging.nextBefore) {
    return;
  }

  paging.loadingOlder = true;
  renderThread();
  const requestId = ++state.openConversationRequest;
  const previous = state.messageCache.get(peer) || [];

  try {
    const payload = await api(
      `/api/messages?with=${encodeURIComponent(peer)}&limit=50&before=${encodeURIComponent(paging.nextBefore)}`
    );
    if (requestId !== state.openConversationRequest) {
      return;
    }
    cachePeerInfo(payload.peer);
    const olderMessages = [];
    for (const message of payload.messages) {
      const peerPublicKey = message.publicKey || payload.peer.publicKey;
      const decrypted = await decryptMessageView(message, peerPublicKey, payload.peer.username);
      olderMessages.push(decrypted);
    }
    const knownIds = new Set(previous.map((message) => message.id));
    const merged = [...olderMessages.filter((message) => !knownIds.has(message.id)), ...previous];
    merged.sort((left, right) => left.createdAt - right.createdAt);
    state.messageCache.set(peer, merged);
    state.messagePageState.set(peer, {
      hasMore: Boolean(payload.hasMore),
      nextBefore: String(payload.nextBefore || ""),
      loadingOlder: false
    });
    renderThread();
  } catch (error) {
    paging.loadingOlder = false;
    renderThread();
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
    decrypted = await decryptMessageView(message, peerPublicKey, peer);
  } catch (error) {
    decrypted = {
      id: message.id,
      from: message.from,
      to: message.to,
      peer,
      mine: message.mine,
      text: String(message.text || "[鏃犳硶瑙ｅ瘑]"),
      createdAt: message.createdAt
    };
  }

  if (decrypted.mine) {
    reconcilePendingMessage(peer, decrypted.text, decrypted.createdAt);
  }

  const current = state.messageCache.get(peer) || [];
  current.push(decrypted);
  current.sort((left, right) => left.createdAt - right.createdAt);
  state.messageCache.set(peer, current);

  const previous = getConversation(peer);
  const muted = peerPrefs(peer).muted;
  const unread =
    !decrypted.mine && state.activePeer !== peer && !muted ? (previous?.unread || 0) + 1 : 0;

  upsertConversation({
    username: peer,
    online: previous?.online || false,
    avatarSeed: peer,
    publicKey: peerPublicKey,
    latestMessage: {
      id: message.id,
      from: message.from,
      to: message.to,
      text: decrypted.text,
      nonce: message.nonce,
      ciphertext: message.ciphertext,
      createdAt: message.createdAt
    },
    previewText: decrypted.text,
    lastAt: message.createdAt,
    unread
  });

  if (state.activePeer === peer) {
    renderThread();
  } else {
    renderSidebar();
  }
}

async function createEventTicket() {
  const payload = await api("/api/events/token", { method: "POST" });
  if (!payload?.ticket) {
    throw new Error("鏃犳硶鍒涘缓瀹炴椂杩炴帴绁ㄦ嵁");
  }
  return payload.ticket;
}

function startEventStream(silent = false) {
  void openEventStream().catch((error) => {
    state.connectionState = "offline";
    renderThread();
    if (!silent) {
      showToast(error.message || "瀹炴椂杩炴帴澶辫触");
    }
  });
}

async function openEventStream() {
  closeEventStream();
  state.connectionState = "connecting";
  renderThread();

  const ticket = await createEventTicket();
  if (!state.token) {
    return;
  }

  const source = new EventSource(`/api/events?ticket=${encodeURIComponent(ticket)}`);
  state.eventSource = source;
  state.manualEventSourceClose = false;

  source.addEventListener("open", () => {
    state.connectionState = "online";
    state.reconnectAttempts = 0;
    renderThread();
  });

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

  source.addEventListener("error", () => {
    if (state.manualEventSourceClose || !state.token) {
      return;
    }
    if (state.eventSource) {
      state.manualEventSourceClose = true;
      state.eventSource.close();
      state.eventSource = null;
      state.manualEventSourceClose = false;
    }
    state.connectionState = "reconnecting";
    renderThread();
    if (state.reconnectTimer) {
      return;
    }
    state.reconnectAttempts += 1;
    const delay = Math.min(10000, 400 * 2 ** Math.max(0, state.reconnectAttempts - 1));
    state.reconnectTimer = window.setTimeout(async () => {
      state.reconnectTimer = 0;
      if (!state.token) {
        return;
      }
      try {
        await api("/api/me");
      } catch (error) {
        if (!state.token) {
          return;
        }
      }
      startEventStream(true);
      try {
        await loadConversations();
        if (state.activePeer) {
          await openConversation(state.activePeer);
        } else {
          render();
        }
      } catch (error) {
        // Ignore refresh failures during reconnect; next event tick will retry.
      }
    }, delay);
  });
}

async function afterLogin() {
  await loadConversations();
  startEventStream();

  const savedPeer = localStorage.getItem(STORAGE.activePeer) || "";
  render();
  if (savedPeer && state.peerKeys.has(savedPeer) && (state.showArchived || !peerPrefs(savedPeer).archived)) {
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
    showToast("褰撳墠鐜涓嶆敮鎸?Web Crypto锛岃浣跨敤 HTTPS 鎴?localhost");
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
    showToast(state.authMode === "login" ? "鐧诲綍鎴愬姛锛屽凡鑷姩瑙ｉ攣鍔犲瘑浼氳瘽" : "娉ㄥ唽鎴愬姛锛屽凡鑷姩鍒涘缓鍔犲瘑浼氳瘽");
  } catch (error) {
    showToast(error.message || "璁よ瘉澶辫触");
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

async function sendMessageWithRetry(tempId, peer, text) {
  try {
    const encrypted = await encryptOutboundMessage(peer, text);
    const payload = await api("/api/messages", {
      method: "POST",
      body: {
        to: peer,
        text,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    state.pendingMessages.delete(tempId);
    removePendingMessageFromCache(tempId);
    await ingestEncryptedMessage(payload.message);
    return true;
  } catch (error) {
    setPendingMessageState(tempId, true);
    renderThread();
    showToast(error.message);
    return false;
  }
}

async function submitMessage(event) {
  event.preventDefault();
  if (!state.activePeer) {
    return;
  }

  const text = elements.messageInput.value.trim();
  if (!text) {
    return;
  }

  const peer = state.activePeer;
  const tempId = addPendingMessage(peer, text);
  setDraftForPeer(peer, "");
  elements.messageInput.value = "";
  autoResizeComposer();
  renderThread();
  void sendMessageWithRetry(tempId, peer, text);
}

async function retryPendingMessage(tempId) {
  const pending = state.pendingMessages.get(tempId);
  if (!pending) {
    return;
  }
  setPendingMessageState(tempId, false);
  renderThread();
  void sendMessageWithRetry(tempId, pending.peer, pending.text);
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

function handleComposerInput() {
  autoResizeComposer();
  if (state.activePeer) {
    setDraftForPeer(state.activePeer, elements.messageInput.value);
  }
}

async function copyMessageFromButton(copyButton) {
  const container = copyButton.closest(".message");
  if (!container) {
    return;
  }
  const text = container.dataset.messageText || "";
  if (!text) {
    showToast("没有可复制的内容");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast("消息已复制");
  } catch (error) {
    showToast("复制失败");
  }
}

function handleMessageListClick(event) {
  const loadOlderButton = event.target.closest(".message-load-older-button");
  if (loadOlderButton) {
    const peer = loadOlderButton.dataset.loadOlderPeer || "";
    void loadOlderMessages(peer);
    return;
  }
  const copyButton = event.target.closest(".message-copy-button");
  if (copyButton) {
    void copyMessageFromButton(copyButton);
    return;
  }
  const retryButton = event.target.closest(".message-retry-button");
  if (!retryButton) {
    return;
  }
  const tempId = retryButton.dataset.tempId || "";
  if (!tempId) {
    return;
  }
  void retryPendingMessage(tempId);
}

function handleThreadActionsClick(action) {
  const peer = state.activePeer;
  if (!peer) {
    return;
  }
  if (action === "pin") {
    togglePeerPref(peer, "pinned");
    return;
  }
  if (action === "mute") {
    togglePeerPref(peer, "muted");
    return;
  }
  if (action === "archive") {
    const willArchive = !peerPrefs(peer).archived;
    togglePeerPref(peer, "archived");
    if (willArchive && !state.showArchived) {
      closeConversationOnMobile();
      if (state.activePeer === peer) {
        state.activePeer = "";
        localStorage.removeItem(STORAGE.activePeer);
      }
      render();
    }
    return;
  }
  if (action === "export") {
    exportActiveConversation();
  }
}

function handleGlobalKeydown(event) {
  const isMeta = event.ctrlKey || event.metaKey;
  if (isMeta && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.globalSearchInput.focus();
    elements.globalSearchInput.select();
    return;
  }
  if (isMeta && event.key.toLowerCase() === "e") {
    event.preventDefault();
    exportActiveConversation();
    return;
  }
  if (isMeta && event.shiftKey && event.key.toLowerCase() === "a") {
    event.preventDefault();
    toggleArchivedView();
    return;
  }
  if (isMeta && event.key === "Enter") {
    if (!state.activePeer) {
      return;
    }
    event.preventDefault();
    elements.composerForm.requestSubmit();
    return;
  }
  if (event.key === "Escape" && document.activeElement === elements.messageInput) {
    elements.messageInput.value = "";
    setDraftForPeer(state.activePeer, "");
    autoResizeComposer();
  }
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
  elements.sidebarMeta.addEventListener("dblclick", () => {
    toggleArchivedView();
  });
  elements.globalSearchInput.addEventListener("input", handleSearchInput);
  elements.conversationList.addEventListener("click", handleListClick);
  elements.searchResultList.addEventListener("click", handleListClick);
  elements.messageList.addEventListener("click", handleMessageListClick);
  elements.pinPeerButton.addEventListener("click", () => handleThreadActionsClick("pin"));
  elements.mutePeerButton.addEventListener("click", () => handleThreadActionsClick("mute"));
  elements.archivePeerButton.addEventListener("click", () => handleThreadActionsClick("archive"));
  elements.exportPeerButton.addEventListener("click", () => handleThreadActionsClick("export"));
  elements.composerForm.addEventListener("submit", (event) => {
    void submitMessage(event);
  });
  elements.messageInput.addEventListener("input", handleComposerInput);
  elements.mobileBackButton.addEventListener("click", closeConversationOnMobile);
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", render);
}

async function restoreSessionFromStorage() {
  const token = localStorage.getItem(STORAGE.token);
  if (!token) {
    return false;
  }
  state.token = token;
  try {
    const payload = await api("/api/me/key-bundle", { skipAuthReset: true });
    const password = window.prompt("璇疯緭鍏ュ瘑鐮佷互瑙ｉ攣鏈湴瀵嗛挜");
    if (!password) {
      clearSession(true, true);
      showToast("已取消恢复，请重新登录");
      return false;
    }
    const identity = await restoreIdentity(payload.user.username, password, payload.keyBundle);
    setSession(token, payload.user, identity);
    await afterLogin();
    showToast("已恢复登录会话");
    return true;
  } catch (error) {
    clearSession(true, true);
    return false;
  }
}

function boot() {
  clearStoredSessionArtifacts(false, false);
  setAuthMode(state.authMode);
  bindEvents();
  render();

  if (!window.crypto?.subtle) {
    elements.authSubmitButton.disabled = true;
    elements.authTip.textContent = "当前环境缺少 Web Crypto，请使用 HTTPS 或 localhost 打开本站。";
    return;
  }

  void restoreSessionFromStorage();
}

boot();



