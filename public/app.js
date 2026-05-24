"use strict";

const STORAGE = {
  token: "private-chat-token",
  activePeer: "private-chat-active-peer",
  authMode: "private-chat-auth-mode",
  conversationPrefs: "private-chat-conversation-prefs",
  drafts: "private-chat-drafts",
  pendingOutbox: "private-chat-pending-outbox"
};

const AVATAR_TONES = 6;
const PRIVATE_KEY_ITERATIONS = 150000;
const MESSAGE_KEY_INFO = "private-chat-message-key-v1";
const MESSAGE_VIRTUAL_THRESHOLD = 140;
const MESSAGE_VIRTUAL_OVERSCAN = 480;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const elements = {
  authScreen: document.querySelector("#authScreen"),
  workspace: document.querySelector("#workspace"),
  authHeading: document.querySelector("#authHeading"),
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
  meStatus: document.querySelector("#meStatus"),
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
  exportPeerButton: document.querySelector("#exportPeerButton"),
  threadSearchInput: document.querySelector("#threadSearchInput"),
  threadSearchMeta: document.querySelector("#threadSearchMeta"),
  composerReplyBar: document.querySelector("#composerReplyBar"),
  replyPreviewAuthor: document.querySelector("#replyPreviewAuthor"),
  replyPreviewText: document.querySelector("#replyPreviewText"),
  cancelReplyButton: document.querySelector("#cancelReplyButton"),
  logoutAllButton: document.querySelector("#logoutAllButton"),
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
  threadSearchQuery: "",
  authBusy: false,
  composerBusy: false,
  replyTarget: null,
  conversations: [],
  searchResults: [],
  activePeer: "",
  messageCache: new Map(),
  peerKeys: new Map(),
  importedPeerKeys: new Map(),
  conversationKeys: new Map(),
  previewCache: new Map(),
  conversationSearchIndex: new Map(),
  pendingMessages: new Map(),
  pendingOutbox: [],
  messagePageState: new Map(),
  pendingSequence: 0,
  eventSource: null,
  reconnectTimer: 0,
  reconnectAttempts: 0,
  manualEventSourceClose: false,
  connectionState: "offline",
  outboxFlushing: false,
  searchTimer: 0,
  searchRequestId: 0,
  messageListRenderRaf: 0,
  toastTimer: 0,
  openConversationRequest: 0,
  conversationPrefs: {},
  drafts: {}
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

function connectionStatusLabel() {
  switch (state.connectionState) {
    case "online":
      return "连接在线";
    case "connecting":
      return "连接中";
    case "reconnecting":
      return "重连中";
    default:
      return "连接未建立";
  }
}

function updateWorkspaceStatus() {
  if (!elements.meStatus) {
    return;
  }
  if (!state.me) {
    elements.meStatus.textContent = "等待登录";
    return;
  }
  const pendingCount = state.pendingOutbox.length;
  const pendingSuffix = pendingCount > 0 ? ` · 待补发 ${pendingCount}` : "";
  elements.meStatus.textContent = `${connectionStatusLabel()} · 自动加密${pendingSuffix}`;
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

function replyPreviewText(message) {
  const normalized = String(message?.text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "消息内容为空";
  }
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized;
}

function buildReplyTarget(message) {
  if (!message?.id) {
    return null;
  }
  return {
    id: String(message.id),
    from: String(message.from || ""),
    text: String(message.text || ""),
    createdAt: Number(message.createdAt) || Date.now()
  };
}

function threadMessageMatchesQuery(message, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const haystacks = [
    message.text,
    message.from,
    message.to,
    message.replyTo?.from,
    message.replyTo?.text
  ];
  return haystacks.some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
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
  const rawPrefs = readJsonStorage(STORAGE.conversationPrefs, {});
  const normalizedPrefs = {};
  for (const [username, prefs] of Object.entries(rawPrefs)) {
    if (!username) {
      continue;
    }
    normalizedPrefs[username] = {
      pinned: Boolean(prefs?.pinned),
      muted: Boolean(prefs?.muted)
    };
  }
  state.conversationPrefs = normalizedPrefs;
  state.drafts = readJsonStorage(STORAGE.drafts, {});
  loadPendingOutbox();
}

function saveConversationPrefs() {
  writeJsonStorage(STORAGE.conversationPrefs, state.conversationPrefs);
}

function saveDrafts() {
  writeJsonStorage(STORAGE.drafts, state.drafts);
}

function rebuildConversationSearchIndex(username) {
  if (!username) {
    return;
  }
  const conversation = getConversation(username);
  const historyText = (state.messageCache.get(username) || [])
    .map((message) => message.text || "")
    .join(" ");
  const indexText = [
    conversation?.username || username,
    conversation?.previewText || "",
    historyText
  ]
    .join("\n")
    .toLowerCase();
  state.conversationSearchIndex.set(username, indexText);
}

function normalizePendingOutboxEntry(entry) {
  const tempId = String(entry?.tempId || "").trim();
  const clientId = String(entry?.clientId || tempId || "").trim();
  const peer = String(entry?.peer || "").trim();
  const text = String(entry?.text || "");
  const replyToId = String(entry?.replyToId || "").trim();
  const replyTo = buildReplyTarget(entry?.replyTo);
  const createdAt = Number(entry?.createdAt) || Date.now();
  if (!tempId || !clientId || !peer || !text) {
    return null;
  }
  return {
    tempId,
    clientId,
    peer,
    text: text.slice(0, 4000),
    replyToId,
    replyTo,
    createdAt,
    attempts: Math.max(0, Number(entry?.attempts) || 0),
    failed: Boolean(entry?.failed),
    lastError: String(entry?.lastError || "")
  };
}

function savePendingOutbox() {
  writeJsonStorage(STORAGE.pendingOutbox, state.pendingOutbox);
}

function syncPendingMessagesFromOutbox() {
  state.pendingMessages = new Map(
    state.pendingOutbox.map((entry) => [
      entry.tempId,
      {
        tempId: entry.tempId,
        clientId: entry.clientId,
        peer: entry.peer,
        text: entry.text,
        replyToId: entry.replyToId || "",
        replyTo: entry.replyTo || null,
        createdAt: entry.createdAt,
        attempts: entry.attempts,
        failed: entry.failed,
        lastError: entry.lastError
      }
    ])
  );
}

function loadPendingOutbox() {
  const rawEntries = readJsonStorage(STORAGE.pendingOutbox, []);
  state.pendingOutbox = Array.isArray(rawEntries)
    ? rawEntries.map(normalizePendingOutboxEntry).filter(Boolean)
    : [];
  syncPendingMessagesFromOutbox();
}

function upsertPendingOutboxEntry(entry) {
  const normalized = normalizePendingOutboxEntry(entry);
  if (!normalized) {
    return null;
  }
  const index = state.pendingOutbox.findIndex((item) => item.tempId === normalized.tempId);
  if (index >= 0) {
    state.pendingOutbox[index] = {
      ...state.pendingOutbox[index],
      ...normalized
    };
  } else {
    state.pendingOutbox.push(normalized);
  }
  savePendingOutbox();
  syncPendingMessagesFromOutbox();
  return normalized;
}

function removePendingOutboxEntry(tempId) {
  const next = state.pendingOutbox.filter((entry) => entry.tempId !== tempId);
  if (next.length === state.pendingOutbox.length) {
    return false;
  }
  state.pendingOutbox = next;
  savePendingOutbox();
  syncPendingMessagesFromOutbox();
  return true;
}

function pendingOutboxForPeer(peer) {
  return state.pendingOutbox
    .filter((entry) => entry.peer === peer)
    .sort((left, right) => left.createdAt - right.createdAt);
}

function peerPrefs(username) {
  if (!username) {
    return { pinned: false, muted: false };
  }
  const prefs = state.conversationPrefs[username];
  return {
    pinned: Boolean(prefs?.pinned),
    muted: Boolean(prefs?.muted)
  };
}

function updatePeerPrefs(username, patch) {
  if (!username) {
    return;
  }
  const current = peerPrefs(username);
  const next = {
    pinned: Boolean(current.pinned),
    muted: Boolean(current.muted),
    ...patch
  };
  state.conversationPrefs[username] = {
    pinned: Boolean(next.pinned),
    muted: Boolean(next.muted)
  };
  saveConversationPrefs();
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  localStorage.setItem(STORAGE.authMode, state.authMode);
  elements.loginTab.classList.toggle("is-active", state.authMode === "login");
  elements.registerTab.classList.toggle("is-active", state.authMode === "register");
  if (elements.authHeading) {
    elements.authHeading.textContent = state.authMode === "login" ? "登录私聊" : "创建加密账号";
  }
  elements.authSubmitButton.textContent = state.authMode === "login" ? "登录" : "注册";
  elements.authTip.textContent =
    state.authMode === "login"
      ? "同一账号可多端进入，消息密钥由浏览器自动处理。"
      : "注册后自动生成本地密钥，服务端只保存必要的账号资料。";
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

function isNearBottom(node, threshold = 120) {
  if (!node) {
    return false;
  }
  return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
}

function estimateMessageHeight(message) {
  const text = String(message?.text || "");
  const charactersPerLine = message?.mine ? 38 : 34;
  const lineCount = Math.max(1, Math.ceil(Math.max(text.length, 1) / charactersPerLine));
  let height = message?.mine ? 88 : 106;
  height += (lineCount - 1) * 18;
  if (message?.pending || message?.failed) {
    height += 10;
  }
  return height + 16;
}

function buildMessageVirtualWindow(messages, scrollTop, viewportHeight, anchor = "scroll") {
  if (messages.length <= MESSAGE_VIRTUAL_THRESHOLD) {
    return null;
  }

  const heights = messages.map((message) => estimateMessageHeight(message));
  const prefix = new Array(heights.length + 1);
  prefix[0] = 0;
  for (let index = 0; index < heights.length; index += 1) {
    prefix[index + 1] = prefix[index] + heights[index];
  }

  const totalHeight = prefix[prefix.length - 1];
  const overscan = Math.max(MESSAGE_VIRTUAL_OVERSCAN, Math.round(viewportHeight * 0.75));
  const baseScrollTop = anchor === "bottom" ? Math.max(0, totalHeight - viewportHeight) : scrollTop;
  const startTarget = Math.max(0, baseScrollTop - overscan);
  const endTarget = baseScrollTop + viewportHeight + overscan;

  let start = 0;
  while (start < messages.length && prefix[start + 1] < startTarget) {
    start += 1;
  }

  let end = start;
  while (end < messages.length && prefix[end] < endTarget) {
    end += 1;
  }

  return {
    start,
    end,
    topSpacer: prefix[start],
    bottomSpacer: Math.max(0, totalHeight - prefix[end])
  };
}

function scheduleMessageListRender() {
  if (state.messageListRenderRaf) {
    return;
  }
  state.messageListRenderRaf = window.requestAnimationFrame(() => {
    state.messageListRenderRaf = 0;
    if (!state.activePeer) {
      return;
    }
    renderThread({ scrollBehavior: "preserve" });
  });
}

function createSpacer(height) {
  const spacer = document.createElement("div");
  spacer.className = "message-spacer";
  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function clearStoredSessionArtifacts(clearToken = true, clearActivePeer = true, clearPending = true) {
  if (clearToken) {
    localStorage.removeItem(STORAGE.token);
  }
  if (clearActivePeer) {
    localStorage.removeItem(STORAGE.activePeer);
  }
  if (clearPending) {
    localStorage.removeItem(STORAGE.pendingOutbox);
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

  let response;
  try {
    response = await fetch(pathname, {
      method: options.method || "GET",
      headers,
      body
    });
  } catch (error) {
    throw new Error("网络连接失败，请稍后重试");
  }

  const contentType = response.headers.get("content-type") || "";
  let payload = null;
  if (contentType.includes("application/json")) {
    try {
      payload = await response.json();
    } catch (error) {
      payload = null;
    }
  }

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
  if (state.messageListRenderRaf) {
    window.cancelAnimationFrame(state.messageListRenderRaf);
    state.messageListRenderRaf = 0;
  }

  state.token = "";
  state.me = null;
  state.identity = null;
  state.searchQuery = "";
  state.threadSearchQuery = "";
  state.replyTarget = null;
  state.conversations = [];
  state.searchResults = [];
  state.activePeer = "";
  state.messageCache.clear();
  state.peerKeys.clear();
  state.importedPeerKeys.clear();
  state.conversationKeys.clear();
  state.previewCache.clear();
  state.conversationSearchIndex.clear();
  state.pendingMessages.clear();
  state.pendingOutbox = [];
  state.messagePageState.clear();
  state.pendingSequence = 0;
  state.outboxFlushing = false;
  state.searchRequestId += 1;
  state.openConversationRequest += 1;

  clearStoredSessionArtifacts(clearToken, true);
  elements.globalSearchInput.value = "";
  elements.threadSearchInput.value = "";
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  syncReplyState();
  updateWorkspaceStatus();
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
  state.threadSearchQuery = "";
  state.replyTarget = null;
  elements.threadSearchInput.value = "";
  syncReplyState();
  updateWorkspaceStatus();
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
  elements.exportPeerButton.disabled = !hasPeer;
  elements.pinPeerButton.textContent = prefs.pinned ? "取消置顶" : "置顶";
  elements.mutePeerButton.textContent = prefs.muted ? "取消静音" : "静音";
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

function matchConversationSearchScope(conversation, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return null;
  }
  const prefs = peerPrefs(conversation.username);
  const draft = draftTextForPeer(conversation.username);
  const indexText = state.conversationSearchIndex.get(conversation.username) || "";
  if (!indexText.includes(normalizedQuery)) {
    if (!draft.toLowerCase().includes(normalizedQuery)) {
      return null;
    }
  }
  const matchLabel = draft.trim() && draft.toLowerCase().includes(normalizedQuery)
    ? "草稿匹配"
    : indexText.startsWith(conversation.username.toLowerCase())
      ? "用户名匹配"
      : String(conversation.previewText || "").toLowerCase().includes(normalizedQuery)
        ? "最近消息匹配"
        : "历史消息匹配";
  return {
    username: conversation.username,
    online: conversation.online,
    avatarSeed: conversation.avatarSeed || conversation.username,
    publicKey: conversation.publicKey,
    previewText: conversation.previewText || "",
    lastAt: conversation.lastAt || 0,
    unread: conversation.unread || 0,
    sourceLabel: `会话 · ${matchLabel}`,
    searchHint: matchLabel,
    pinned: prefs.pinned,
    muted: prefs.muted
  };
}

function buildLocalSearchResults(query) {
  const normalizedQuery = String(query || "").trim();
  if (!normalizedQuery) {
    return [];
  }
  return state.conversations
    .map((conversation) => matchConversationSearchScope(conversation, normalizedQuery))
    .filter(Boolean);
}

function renderSidebar() {
  const query = state.searchQuery.trim().toLowerCase();
  const localResults = query ? buildLocalSearchResults(query) : [];
  const conversations = state.conversations.filter((item) => {
    if (!query) {
      return true;
    }
    return (
      item.username.toLowerCase().includes(query) ||
      String(item.previewText || "").toLowerCase().includes(query)
    );
  });

  const visibleCount = conversations.length;
  const mergedSearchRows = query
    ? (() => {
        const remoteResults = state.searchResults.map((user) => ({
          ...user,
          sourceLabel: "用户名结果",
          searchHint: user.online ? "在线用户" : "用户建议"
        }));
        const merged = new Map();
        for (const item of [...localResults, ...remoteResults]) {
          if (!item?.username || merged.has(item.username)) {
            continue;
          }
          merged.set(item.username, item);
        }
        return [...merged.values()];
      })()
    : [];
  elements.sidebarMeta.textContent = query
    ? `${visibleCount} 个会话 | ${mergedSearchRows.length} 个匹配`
    : `${visibleCount} 个会话 | 最近活跃优先`;
  elements.searchGroup.hidden = !query;
  elements.conversationList.parentElement.hidden = Boolean(query);

  elements.searchResultList.textContent = "";
  if (query) {
    const searchRows = mergedSearchRows.sort((left, right) => {
      const leftScore = Number(Boolean(left.online)) + Number(Boolean(left.pinned)) * 2 + Number(left.unread > 0);
      const rightScore = Number(Boolean(right.online)) + Number(Boolean(right.pinned)) * 2 + Number(right.unread > 0);
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }
      return (right.lastAt || 0) - (left.lastAt || 0) || String(left.username).localeCompare(right.username);
    });

    if (searchRows.length === 0) {
      const empty = document.createElement("div");
      empty.className = "list-empty";
      empty.textContent = "没有匹配的用户";
      elements.searchResultList.append(empty);
    } else {
      for (const user of searchRows) {
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
  const draft = isSearchResult ? "" : draftTextForPeer(item.username).trim();
  const indicators = [];
  if (item.unread && !prefs.muted) {
    indicators.push(`<b class="unread-badge">${item.unread}</b>`);
  } else if (item.online) {
    indicators.push('<i class="online-dot"></i>');
  }
  if (!isSearchResult && draft) {
    indicators.push('<span class="draft-badge">草稿</span>');
  }

  const button = document.createElement("button");
  button.type = "button";
  button.className = "list-item";
  if (item.username === state.activePeer) {
    button.classList.add("is-active");
  }
  if (prefs.pinned) {
    button.classList.add("is-pinned");
  }
  button.dataset.username = item.username;

  const avatar = document.createElement("div");
  setAvatar(avatar, item.username);

  const meta = document.createElement("div");
  meta.className = "list-item-meta";
  meta.innerHTML = `
    <div class="list-row">
      <strong>${escapeHtml(item.username)}</strong>
      <span>${escapeHtml(isSearchResult ? (item.sourceLabel || (item.online ? "在线" : "离线")) : formatRelative(item.lastAt))}</span>
    </div>
    <div class="list-row is-subtle">
      <span>${escapeHtml(isSearchResult ? (item.searchHint || "点击开始私聊") : messagePreview(item.previewText || "已加密消息"))}</span>
      ${indicators.join("")}
    </div>
  `;

  const flags = [];
  if (prefs.pinned) {
    flags.push('<em class="list-flag">置顶</em>');
  }
  if (prefs.muted) {
    flags.push('<em class="list-flag">静音</em>');
  }
  if (isSearchResult && item.sourceLabel) {
    flags.push(`<em class="list-flag">${escapeHtml(item.sourceLabel)}</em>`);
  }
  if (flags.length > 0) {
    const flagRow = document.createElement("div");
    flagRow.className = "list-flags";
    flagRow.innerHTML = flags.join("");
    meta.append(flagRow);
  }

  button.append(avatar, meta);
  return button;
}
function renderMessage(message) {
  const article = document.createElement("article");
  article.className = `message ${message.mine ? "is-own" : "is-peer"}${message.pending ? " is-pending" : ""}${message.failed ? " is-failed" : ""}${message.replyTo ? " is-reply" : ""}`;
  article.dataset.messageId = message.id;
  article.dataset.messageText = message.text;
  const replyAction = `<button class="message-reply-button" type="button" data-reply-id="${escapeHtml(message.id || "")}">回复</button>`;
  const statusAction = message.pending
    ? '<span class="message-state">发送中</span>'
    : message.failed
      ? `<button class="message-retry-button" type="button" data-temp-id="${escapeHtml(message.tempId || "")}">重试</button>`
      : "";
  const copyAction = `<button class="message-copy-button" type="button" data-copy-id="${escapeHtml(message.id || "")}">复制</button>`;
  const replyMarkup = message.replyTo
    ? `
      <div class="message-reply">
        <span>回复 ${escapeHtml(message.replyTo.from || "消息")}</span>
        <p>${escapeHtml(replyPreviewText(message.replyTo))}</p>
      </div>
    `
    : "";
  article.innerHTML = `
    ${message.mine ? "" : `<div class="message-avatar avatar avatar-tone-${avatarTone(message.from)}">${escapeHtml(avatarInitial(message.from))}</div>`}
    <div class="message-body">
      ${replyMarkup}
      <div class="bubble">${escapeHtml(message.text).replaceAll("\n", "<br />")}</div>
      <div class="message-meta">${escapeHtml(formatTime(message.createdAt))}${statusAction ? ` | ${statusAction}` : ""} | ${replyAction} | ${copyAction}</div>
    </div>
  `;
  return article;
}

function scrollMessagesToBottom() {
  elements.messageList.scrollTop = elements.messageList.scrollHeight;
}

function renderThread(options = {}) {
  const scrollBehavior = options.scrollBehavior || "preserve";
  const peer = activePeerMeta();
  const hasPeer = Boolean(peer);

  elements.chatEmpty.hidden = hasPeer;
  elements.chatThread.hidden = !hasPeer;
  applyThreadActionState(hasPeer ? peer.username : "");
  updateWorkspaceStatus();

  if (!peer) {
    return;
  }

  const previousScrollHeight = elements.messageList.scrollHeight;
  const previousScrollTop = elements.messageList.scrollTop;
  if (elements.threadSearchInput && elements.threadSearchInput.value !== state.threadSearchQuery) {
    elements.threadSearchInput.value = state.threadSearchQuery;
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
  const threadQuery = state.threadSearchQuery.trim().toLowerCase();
  const statusSuffix = statusTags.length ? ` | ${statusTags.join(" · ")}` : "";
  elements.peerStatus.textContent = `${peer.online ? "在线" : "离线"} | 自动端到端加密${connectionLabel}${statusSuffix}`;
  setAvatar(elements.peerAvatar, peer.username);

  const messages = state.messageCache.get(peer.username) || [];
  const visibleMessages = messages.filter((message) => threadMessageMatchesQuery(message, threadQuery));
  const paging = pageStateForPeer(peer.username);
  const virtualWindow = buildMessageVirtualWindow(
    visibleMessages,
    previousScrollTop,
    elements.messageList.clientHeight || 0,
    scrollBehavior === "bottom" ? "bottom" : "scroll"
  );
  if (elements.threadSearchMeta) {
    elements.threadSearchMeta.textContent = threadQuery
      ? `匹配 ${visibleMessages.length} / ${messages.length} 条`
      : `共 ${messages.length} 条消息`;
  }
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
  } else if (visibleMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "message-empty";
    empty.innerHTML = `<strong>没有匹配的消息</strong><span>试试更短的关键词，或者清空会话内搜索。</span>`;
    elements.messageList.append(empty);
  } else {
    if (virtualWindow && virtualWindow.start > 0) {
      elements.messageList.append(createSpacer(virtualWindow.topSpacer));
    }
    const slice = virtualWindow ? visibleMessages.slice(virtualWindow.start, virtualWindow.end) : visibleMessages;
    for (const message of slice) {
      elements.messageList.append(renderMessage(message));
    }
    if (virtualWindow && virtualWindow.bottomSpacer > 0) {
      elements.messageList.append(createSpacer(virtualWindow.bottomSpacer));
    }
  }

  if (state.activePeer === peer.username && document.activeElement !== elements.messageInput) {
    const draft = draftTextForPeer(peer.username);
    elements.messageInput.value = draft;
    autoResizeComposer();
  }
  setComposerBusy(false);
  if (scrollBehavior === "bottom") {
    scrollMessagesToBottom();
    return;
  }
  if (virtualWindow) {
    elements.messageList.scrollTop = previousScrollTop;
    return;
  }
  if (previousScrollHeight > 0) {
    elements.messageList.scrollTop = previousScrollTop + (elements.messageList.scrollHeight - previousScrollHeight);
  }
  syncReplyState();
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

function syncReplyState() {
  if (!elements.composerReplyBar) {
    return;
  }
  const target = state.replyTarget;
  elements.composerReplyBar.hidden = !target;
  if (!target) {
    return;
  }
  elements.replyPreviewAuthor.textContent = target.from || "消息";
  elements.replyPreviewText.textContent = replyPreviewText(target);
}

function clearReplyTarget() {
  state.replyTarget = null;
  syncReplyState();
}

function setReplyTarget(message) {
  const target = buildReplyTarget(message);
  if (!target) {
    return;
  }
  state.replyTarget = target;
  syncReplyState();
  elements.messageInput.focus();
}

function setThreadSearchQuery(value) {
  state.threadSearchQuery = String(value || "");
  renderThread({ scrollBehavior: "preserve" });
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
    throw new Error("缺少对端公钥");
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
    throw new Error("缺少对端标识");
  }
  const conversationKey = await getConversationKey(peerUsername, peerPublicKeyBase64);
  const iv = base64ToBytes(message.nonce);
  const payload = base64ToBytes(message.ciphertext);
  const aadCandidates = [
    aadBytes(message.from, message.to),
    aadBytes(message.to, message.from),
    null
  ];

  let lastError = null;
  for (const aad of aadCandidates) {
    try {
      const plaintext = await crypto.subtle.decrypt(
        aad
          ? {
              name: "AES-GCM",
              iv,
              additionalData: aad
            }
          : {
              name: "AES-GCM",
              iv
            },
        conversationKey,
        payload
      );
      return textDecoder.decode(plaintext);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("消息解密失败");
}

async function decryptMessageView(message, peerPublicKeyBase64, fallbackPeer = "") {
  let text = "";
  if (typeof message.text === "string" && !message.ciphertext) {
    text = message.text;
  } else {
    try {
      text = await decryptCiphertextMessage(message, peerPublicKeyBase64, fallbackPeer);
    } catch (error) {
      text = "[无法解密]";
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

function previewCacheKey(conversation) {
  const latest = conversation?.latestMessage || null;
  if (!latest) {
    return "";
  }
  return [
    conversation.username || "",
    latest.id || "",
    conversation.publicKey || "",
    latest.nonce || "",
    latest.ciphertext || ""
  ].join("|");
}

async function decryptPreview(conversation) {
  if (!conversation.latestMessage) {
    return "";
  }
  const cacheKey = previewCacheKey(conversation);
  if (cacheKey && state.previewCache.has(cacheKey)) {
    return state.previewCache.get(cacheKey);
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
  if (cacheKey) {
    state.previewCache.set(cacheKey, preview.text);
  }
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
  for (const conversation of state.conversations) {
    rebuildConversationSearchIndex(conversation.username);
  }
  hydratePendingMessagesIntoCache();
}

async function loadSearchResults(query) {
  if (!query.trim()) {
    state.searchResults = [];
    renderSidebar();
    return;
  }
  const requestId = ++state.searchRequestId;
  try {
    const payload = await api(`/api/users?q=${encodeURIComponent(query)}`);
    if (requestId !== state.searchRequestId) {
      return;
    }
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

function buildTempMessage(peer, text, replyTo = null) {
  const tempId = crypto.randomUUID();
  const nextReplyTo = replyTo ? buildReplyTarget(replyTo) : null;
  return {
    id: tempId,
    tempId,
    clientId: tempId,
    from: state.me?.username || "",
    to: peer,
    peer,
    mine: true,
    text,
    createdAt: Date.now(),
    pending: true,
    failed: false,
    replyToId: nextReplyTo?.id || "",
    replyTo: nextReplyTo
  };
}

function removePendingMessageFromCache(tempId) {
  for (const [peer, messages] of state.messageCache) {
    const next = messages.filter((message) => message.tempId !== tempId && message.clientId !== tempId);
    if (next.length !== messages.length) {
      state.messageCache.set(peer, next);
      return true;
    }
  }
  return false;
}

function setPendingMessageState(tempId, failed, lastError = "") {
  for (const [peer, messages] of state.messageCache) {
    let changed = false;
    const next = messages.map((message) => {
      if (message.tempId !== tempId && message.clientId !== tempId) {
        return message;
      }
      changed = true;
      return {
        ...message,
        pending: !Boolean(failed),
        failed: Boolean(failed)
      };
    });
    if (changed) {
      state.messageCache.set(peer, next);
      const entry = state.pendingMessages.get(tempId);
      if (entry) {
        upsertPendingOutboxEntry(
          failed
            ? {
                ...entry,
                failed: true,
                attempts: (entry.attempts || 0) + 1,
                lastError: String(lastError || "发送失败")
              }
            : {
                ...entry,
                failed: false,
                lastError: ""
              }
        );
      }
      return true;
    }
  }
  return false;
}

function addPendingMessage(peer, text, replyTo = null) {
  const pending = buildTempMessage(peer, text, replyTo);
  const current = state.messageCache.get(peer) || [];
  current.push(pending);
  current.sort((left, right) => left.createdAt - right.createdAt);
  state.messageCache.set(peer, current);
  state.pendingMessages.set(pending.tempId, {
    tempId: pending.tempId,
    clientId: pending.clientId,
    peer,
    text,
    replyToId: pending.replyToId || "",
    replyTo: pending.replyTo || null,
    createdAt: pending.createdAt,
    attempts: 0,
    failed: false,
    lastError: ""
  });
  upsertPendingOutboxEntry({
    tempId: pending.tempId,
    clientId: pending.clientId,
    peer,
    text,
    replyToId: pending.replyToId || "",
    replyTo: pending.replyTo || null,
    createdAt: pending.createdAt,
    attempts: 0,
    failed: false,
    lastError: ""
  });
  upsertConversation({
    username: peer,
    online: getConversation(peer)?.online || false,
    avatarSeed: peer,
    publicKey: state.peerKeys.get(peer) || "",
    previewText: text,
    lastAt: pending.createdAt
  });
  rebuildConversationSearchIndex(peer);
  return pending.tempId;
}

function reconcilePendingMessage(peer, incomingMessage) {
  const clientId = String(incomingMessage?.clientId || incomingMessage?.id || "");
  for (const [tempId, pending] of state.pendingMessages) {
    if (pending.peer !== peer) {
      continue;
    }
    if (clientId && pending.clientId === clientId) {
      state.pendingMessages.delete(tempId);
      removePendingMessageFromCache(tempId);
      removePendingOutboxEntry(tempId);
      continue;
    }
    if (!clientId) {
      const sameText = String(pending.text || "") === String(incomingMessage?.text || "");
      const withinWindow = Math.abs((pending.createdAt || 0) - Number(incomingMessage?.createdAt || 0)) <= 60000;
      if (sameText && withinWindow) {
        state.pendingMessages.delete(tempId);
        removePendingMessageFromCache(tempId);
        removePendingOutboxEntry(tempId);
        return;
      }
    }
  }
}

function mergePendingMessagesIntoConversation(peer) {
  const pendingEntries = pendingOutboxForPeer(peer);
  if (pendingEntries.length === 0) {
    return;
  }
  const current = state.messageCache.get(peer) || [];
  const knownIds = new Set(current.map((message) => message.tempId || message.clientId || message.id));
  let changed = false;
  for (const pending of pendingEntries) {
    if (knownIds.has(pending.tempId) || knownIds.has(pending.clientId)) {
      continue;
    }
    current.push({
      id: pending.tempId,
      tempId: pending.tempId,
      clientId: pending.clientId,
      from: state.me?.username || "",
      to: peer,
      peer,
      mine: true,
      text: pending.text,
      createdAt: pending.createdAt,
      pending: !pending.failed,
      failed: pending.failed,
      replyToId: pending.replyToId || "",
      replyTo: pending.replyTo || null
    });
    changed = true;
  }
  if (changed) {
    current.sort((left, right) => left.createdAt - right.createdAt);
    state.messageCache.set(peer, current);
    rebuildConversationSearchIndex(peer);
  }
}

function hydratePendingMessagesIntoCache() {
  for (const entry of state.pendingOutbox) {
    const current = state.messageCache.get(entry.peer) || [];
    const knownIds = new Set(current.map((message) => message.tempId || message.clientId || message.id));
    if (knownIds.has(entry.tempId) || knownIds.has(entry.clientId)) {
      continue;
    }
    current.push({
      id: entry.tempId,
      tempId: entry.tempId,
      clientId: entry.clientId,
      from: state.me?.username || "",
      to: entry.peer,
      peer: entry.peer,
      mine: true,
      text: entry.text,
      createdAt: entry.createdAt,
      pending: !entry.failed,
      failed: entry.failed,
      replyToId: entry.replyToId || "",
      replyTo: entry.replyTo || null
    });
    current.sort((left, right) => left.createdAt - right.createdAt);
    state.messageCache.set(entry.peer, current);
    rebuildConversationSearchIndex(entry.peer);
  }
}

async function flushPendingOutbox() {
  if (state.outboxFlushing || !state.me || state.connectionState !== "online") {
    return;
  }
  state.outboxFlushing = true;
  try {
    const entries = [...state.pendingOutbox].sort((left, right) => left.createdAt - right.createdAt);
    for (const entry of entries) {
      if (!state.pendingMessages.has(entry.tempId)) {
        continue;
      }
      const current = state.pendingMessages.get(entry.tempId);
      if (!current) {
        continue;
      }
      if (!entry.failed && entry.attempts > 0) {
        continue;
      }
      await sendMessageWithRetry(
        entry.tempId,
        entry.peer,
        entry.text,
        entry.clientId,
        true,
        entry.replyToId || ""
      );
    }
  } finally {
    state.outboxFlushing = false;
  }
}

async function openConversation(username) {
  if (!username) {
    return;
  }

  ensureConversationEntry(username);
  state.activePeer = username;
  localStorage.setItem(STORAGE.activePeer, username);
  clearReplyTarget();
  state.threadSearchQuery = "";
  elements.threadSearchInput.value = "";
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
    const decryptedMessages = await Promise.all(
      payload.messages.map(async (message) => {
        const peerPublicKey = message.publicKey || payload.peer.publicKey;
        return decryptMessageView(message, peerPublicKey, payload.peer.username);
      })
    );

    state.messageCache.set(username, decryptedMessages);
    state.messagePageState.set(username, {
      hasMore: Boolean(payload.hasMore),
      nextBefore: String(payload.nextBefore || ""),
      loadingOlder: false
    });
    mergePendingMessagesIntoConversation(username);
    rebuildConversationSearchIndex(username);
    upsertConversation({
      username: payload.peer.username,
      online: payload.peer.online,
      avatarSeed: payload.peer.avatarSeed,
      publicKey: payload.peer.publicKey,
      previewText: getConversation(username)?.previewText || "",
      lastAt: getConversation(username)?.lastAt || 0,
      unread: 0
    });
    rebuildConversationSearchIndex(username);
    renderSidebar();
    renderThread({ scrollBehavior: "bottom" });
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
  renderThread({ scrollBehavior: "preserve" });
  const requestId = ++state.openConversationRequest;
  const previous = state.messageCache.get(peer) || [];

  try {
    const payload = await api(
      `/api/messages?with=${encodeURIComponent(peer)}&limit=50&before=${encodeURIComponent(paging.nextBefore)}`
    );
    if (requestId !== state.openConversationRequest) {
      paging.loadingOlder = false;
      return;
    }
    cachePeerInfo(payload.peer);
    const olderMessages = await Promise.all(
      payload.messages.map(async (message) => {
        const peerPublicKey = message.publicKey || payload.peer.publicKey;
        return decryptMessageView(message, peerPublicKey, payload.peer.username);
      })
    );
    const knownIds = new Set(previous.map((message) => message.id));
    const merged = [...olderMessages.filter((message) => !knownIds.has(message.id)), ...previous];
    merged.sort((left, right) => left.createdAt - right.createdAt);
    state.messageCache.set(peer, merged);
    mergePendingMessagesIntoConversation(peer);
    rebuildConversationSearchIndex(peer);
    state.messagePageState.set(peer, {
      hasMore: Boolean(payload.hasMore),
      nextBefore: String(payload.nextBefore || ""),
      loadingOlder: false
    });
    renderThread({ scrollBehavior: "preserve" });
  } catch (error) {
    paging.loadingOlder = false;
    renderThread({ scrollBehavior: "preserve" });
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

async function handleUserRenamed(payload) {
  const previousUsername = String(payload?.previousUsername || "").trim();
  const nextUsername = String(payload?.username || "").trim();
  if (!previousUsername || !nextUsername || previousUsername === nextUsername) {
    return;
  }

  if (state.me?.username === previousUsername) {
    state.me = {
      ...state.me,
      username: nextUsername
    };
    elements.meUsername.textContent = nextUsername;
    setAvatar(elements.meAvatar, nextUsername);
  }

  if (state.activePeer === previousUsername) {
    state.activePeer = nextUsername;
    localStorage.setItem(STORAGE.activePeer, nextUsername);
  }

  if (Object.prototype.hasOwnProperty.call(state.drafts, previousUsername)) {
    state.drafts[nextUsername] = state.drafts[previousUsername];
    delete state.drafts[previousUsername];
    saveDrafts();
  }

  let pendingChanged = false;
  state.pendingOutbox = state.pendingOutbox.map((entry) => {
    let changed = false;
    const next = { ...entry };
    if (next.peer === previousUsername) {
      next.peer = nextUsername;
      changed = true;
    }
    if (next.replyTo?.from === previousUsername) {
      next.replyTo = {
        ...next.replyTo,
        from: nextUsername
      };
      changed = true;
    }
    if (changed) {
      pendingChanged = true;
      return next;
    }
    return entry;
  });
  if (pendingChanged) {
    savePendingOutbox();
    syncPendingMessagesFromOutbox();
  }

  if (Object.prototype.hasOwnProperty.call(state.conversationPrefs, previousUsername)) {
    state.conversationPrefs[nextUsername] = state.conversationPrefs[previousUsername];
    delete state.conversationPrefs[previousUsername];
    saveConversationPrefs();
  }

  state.conversations = [];
  state.searchResults = [];
  state.messageCache.clear();
  state.messagePageState.clear();
  state.conversationKeys.clear();
  state.previewCache.clear();
  state.conversationSearchIndex.clear();
  state.importedPeerKeys.clear();
  state.peerKeys.clear();
  state.pendingMessages.clear();

  await loadConversations();
  if (state.searchQuery.trim()) {
    await loadSearchResults(state.searchQuery);
  }
  if (state.activePeer) {
    await openConversation(state.activePeer);
    return;
  }
  render();
}

function messageExists(peer, id, clientId = "") {
  return (state.messageCache.get(peer) || []).some((message) => {
    if (message.id === id) {
      return true;
    }
    if (message.pending || message.failed) {
      return false;
    }
    if (!clientId) {
      return false;
    }
    return message.clientId === clientId || message.tempId === clientId;
  });
}

async function ingestEncryptedMessage(message) {
  const peer = message.peer;
  const peerPublicKey = message.publicKey || state.peerKeys.get(peer);
  if (!peer || !peerPublicKey || messageExists(peer, message.id, message.clientId)) {
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
      text: String(message.text || "[无法解密]"),
      createdAt: message.createdAt
    };
  }

  if (decrypted.mine) {
    reconcilePendingMessage(peer, message);
  }

  const current = state.messageCache.get(peer) || [];
  current.push(decrypted);
  current.sort((left, right) => left.createdAt - right.createdAt);
  state.messageCache.set(peer, current);
  rebuildConversationSearchIndex(peer);

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
  rebuildConversationSearchIndex(peer);

  if (state.activePeer === peer) {
    const stickToBottom = message.mine || isNearBottom(elements.messageList);
    renderThread({ scrollBehavior: stickToBottom ? "bottom" : "preserve" });
  } else {
    renderSidebar();
  }
}

async function createEventTicket() {
  const payload = await api("/api/events/token", { method: "POST" });
  if (!payload?.ticket) {
    throw new Error("无法创建实时连接票据");
  }
  return payload.ticket;
}

function startEventStream(silent = false) {
  void openEventStream().catch((error) => {
    state.connectionState = "offline";
    renderThread();
    if (!silent) {
      showToast(error.message || "实时连接失败");
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
    void flushPendingOutbox();
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

  source.addEventListener("user-renamed", (event) => {
    const payload = JSON.parse(event.data);
    void handleUserRenamed(payload);
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
    const jitter = Math.floor(Math.random() * 350);
    const backoff = Math.min(15000, 450 * 2 ** Math.max(0, state.reconnectAttempts - 1));
    const delay = backoff + jitter;
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
  void flushPendingOutbox();

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

async function logoutAllDevices() {
  try {
    await api("/api/logout-all", { method: "POST" });
  } catch (error) {
    // Ignore logout-all errors and clear local state.
  }
  clearSession(true);
  showToast("已退出全部设备");
}

async function sendMessageWithRetry(tempId, peer, text, clientId = tempId, silent = false, replyToId = "") {
  try {
    const encrypted = await encryptOutboundMessage(peer, text);
    const payload = await api("/api/messages", {
      method: "POST",
      body: {
        to: peer,
        text,
        clientId,
        replyToId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    state.pendingMessages.delete(tempId);
    removePendingMessageFromCache(tempId);
    removePendingOutboxEntry(tempId);
    await ingestEncryptedMessage(payload.message);
    if (state.replyTarget?.id === replyToId) {
      clearReplyTarget();
    }
    return true;
  } catch (error) {
    setPendingMessageState(tempId, true, error.message);
    renderThread();
    if (!silent) {
      showToast(error.message);
    }
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
  const replyTo = state.replyTarget ? { ...state.replyTarget } : null;
  const tempId = addPendingMessage(peer, text, replyTo);
  setDraftForPeer(peer, "");
  elements.messageInput.value = "";
  autoResizeComposer();
  renderThread({ scrollBehavior: "bottom" });
  void sendMessageWithRetry(tempId, peer, text, tempId, false, replyTo?.id || "");
}

async function retryPendingMessage(tempId) {
  const pending = state.pendingMessages.get(tempId);
  if (!pending) {
    return;
  }
  setPendingMessageState(tempId, false);
  renderThread({ scrollBehavior: "bottom" });
  void sendMessageWithRetry(
    tempId,
    pending.peer,
    pending.text,
    pending.clientId || tempId,
    false,
    pending.replyToId || ""
  );
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

function handleThreadSearchInput() {
  state.threadSearchQuery = elements.threadSearchInput.value;
  renderThread({ scrollBehavior: "preserve" });
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
  const replyButton = event.target.closest(".message-reply-button");
  if (replyButton) {
    const messageId = replyButton.dataset.replyId || "";
    const peer = state.activePeer;
    const message = (state.messageCache.get(peer) || []).find((item) => item.id === messageId || item.tempId === messageId);
    if (message) {
      setReplyTarget(message);
    }
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
  if (event.key === "Escape" && elements.threadSearchInput && document.activeElement === elements.threadSearchInput) {
    elements.threadSearchInput.value = "";
    state.threadSearchQuery = "";
    renderThread({ scrollBehavior: "preserve" });
    return;
  }
  if (event.key === "Escape" && document.activeElement === elements.messageInput) {
    elements.messageInput.value = "";
    setDraftForPeer(state.activePeer, "");
    autoResizeComposer();
    return;
  }
  if (event.key === "Escape" && state.replyTarget) {
    clearReplyTarget();
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
  elements.logoutAllButton.addEventListener("click", () => {
    void logoutAllDevices();
  });
  elements.globalSearchInput.addEventListener("input", handleSearchInput);
  elements.threadSearchInput.addEventListener("input", handleThreadSearchInput);
  elements.conversationList.addEventListener("click", handleListClick);
  elements.searchResultList.addEventListener("click", handleListClick);
  elements.messageList.addEventListener("click", handleMessageListClick);
  elements.messageList.addEventListener("scroll", () => {
    const peer = state.activePeer;
    if (!peer) {
      return;
    }
    const messages = state.messageCache.get(peer) || [];
    if (messages.length <= MESSAGE_VIRTUAL_THRESHOLD) {
      return;
    }
    scheduleMessageListRender();
  });
  elements.pinPeerButton.addEventListener("click", () => handleThreadActionsClick("pin"));
  elements.mutePeerButton.addEventListener("click", () => handleThreadActionsClick("mute"));
  elements.exportPeerButton.addEventListener("click", () => handleThreadActionsClick("export"));
  elements.composerForm.addEventListener("submit", (event) => {
    void submitMessage(event);
  });
  elements.messageInput.addEventListener("input", handleComposerInput);
  elements.mobileBackButton.addEventListener("click", closeConversationOnMobile);
  elements.cancelReplyButton.addEventListener("click", () => {
    clearReplyTarget();
  });
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", render);
  window.addEventListener("online", () => {
    if (!state.token) {
      return;
    }
    startEventStream(true);
    void flushPendingOutbox();
  });
  window.addEventListener("offline", () => {
    if (state.connectionState !== "offline") {
      state.connectionState = "offline";
      renderThread();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!state.token || document.visibilityState !== "visible") {
      return;
    }
    void flushPendingOutbox();
    if (state.connectionState !== "online" && !state.reconnectTimer) {
      startEventStream(true);
    }
  });
}

function boot() {
  clearStoredSessionArtifacts(true, true);
  setAuthMode(state.authMode);
  bindEvents();
  render();

  if (!window.crypto?.subtle) {
    elements.authSubmitButton.disabled = true;
    elements.authTip.textContent = "当前环境缺少 Web Crypto，请使用 HTTPS 或 localhost 打开本站。";
    return;
  }
}

boot();



