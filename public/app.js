"use strict";

const STORAGE = {
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
  emptySearchButton: document.querySelector("#emptySearchButton"),
  sidebarSearchButton: document.querySelector("#sidebarSearchButton"),
  sidebarSearchInput: document.querySelector("#sidebarSearchInput"),
  globalSearchInput: document.querySelector("#globalSearchInput"),
  settingsButton: document.querySelector("#settingsButton"),
  navMessagesButton: document.querySelector("#navMessagesButton"),
  navContactsButton: document.querySelector("#navContactsButton"),
  sidebarProfileButton: document.querySelector("#sidebarProfileButton"),
  sidebarProfileAvatar: document.querySelector("#sidebarProfileAvatar"),
  sidebarProfileName: document.querySelector("#sidebarProfileName"),
  sidebarProfileStatus: document.querySelector("#sidebarProfileStatus"),
  accountMenuButton: document.querySelector("#accountMenuButton"),
  accountMenu: document.querySelector("#accountMenu"),
  editAccountButton: document.querySelector("#editAccountButton"),
  logoutMenuButton: document.querySelector("#logoutMenuButton"),
  meAvatar: document.querySelector("#meAvatar"),
  meUsername: document.querySelector("#meUsername"),
  logoutButton: document.querySelector("#logoutButton"),
  meStatus: document.querySelector("#meStatus"),
  meStatusDot: document.querySelector("#meStatusDot"),
  sidebarMeta: document.querySelector("#sidebarMeta"),
  searchGroup: document.querySelector("#searchGroup"),
  pinnedGroup: document.querySelector("#pinnedGroup"),
  pinnedConversationList: document.querySelector("#pinnedConversationList"),
  recentGroup: document.querySelector("#recentGroup"),
  searchResultList: document.querySelector("#searchResultList"),
  conversationList: document.querySelector("#conversationList"),
  conversationEmpty: document.querySelector("#conversationEmpty"),
  chatEmpty: document.querySelector("#chatEmpty"),
  chatThread: document.querySelector("#chatThread"),
  mobileBackButton: document.querySelector("#mobileBackButton"),
  pinPeerButton: document.querySelector("#pinPeerButton"),
  mutePeerButton: document.querySelector("#mutePeerButton"),
  exportPeerButton: document.querySelector("#exportPeerButton"),
  headerSearchButton: document.querySelector("#headerSearchButton"),
  headerCallButton: document.querySelector("#headerCallButton"),
  headerVideoButton: document.querySelector("#headerVideoButton"),
  headerDetailsButton: document.querySelector("#headerDetailsButton"),
  threadSearchInput: document.querySelector("#threadSearchInput"),
  threadSearchMeta: document.querySelector("#threadSearchMeta"),
  securityStatus: document.querySelector("#securityStatus"),
  composerReplyBar: document.querySelector("#composerReplyBar"),
  replyPreviewAuthor: document.querySelector("#replyPreviewAuthor"),
  replyPreviewText: document.querySelector("#replyPreviewText"),
  cancelReplyButton: document.querySelector("#cancelReplyButton"),
  logoutAllButton: document.querySelector("#logoutAllButton"),
  peerAvatar: document.querySelector("#peerAvatar"),
  peerName: document.querySelector("#peerName"),
  peerStatus: document.querySelector("#peerStatus"),
  messageList: document.querySelector("#messageList"),
  typingIndicator: document.querySelector("#typingIndicator"),
  typingAvatar: document.querySelector("#typingAvatar"),
  scrollBottomButton: document.querySelector("#scrollBottomButton"),
  scrollBottomCount: document.querySelector("#scrollBottomCount"),
  composerForm: document.querySelector("#composerForm"),
  messageInput: document.querySelector("#messageInput"),
  sendButton: document.querySelector("#sendButton"),
  emojiPanel: document.querySelector("#emojiPanel"),
  toast: document.querySelector("#toast"),
  messageContextMenu: document.querySelector("#messageContextMenu"),
  contextCopyButton: document.querySelector("#contextCopyButton"),
  contextRecallButton: document.querySelector("#contextRecallButton"),
  contactPanel: document.querySelector("#contactPanel"),
  detailsCloseButton: document.querySelector("#detailsCloseButton"),
  contactDetailsEmpty: document.querySelector("#contactDetailsEmpty"),
  contactDetailsContent: document.querySelector("#contactDetailsContent"),
  detailsAvatar: document.querySelector("#detailsAvatar"),
  detailsName: document.querySelector("#detailsName"),
  detailsStatus: document.querySelector("#detailsStatus"),
  detailsRole: document.querySelector("#detailsRole"),
  detailsAbout: document.querySelector("#detailsAbout"),
  detailsMediaGrid: document.querySelector("#detailsMediaGrid"),
  detailsFilesList: document.querySelector("#detailsFilesList"),
  notificationsToggle: document.querySelector("#notificationsToggle")
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
  resizeRenderRaf: 0,
  toastTimer: 0,
  openConversationRequest: 0,
  conversationPrefs: {},
  drafts: {},
  submitInFlight: false,
  scrollBottomNewCount: 0,
  scrollBottomHideTimer: 0,
  detailsPanelOpen: false,
  activeNavSection: "messages",
  emojiPanelOpen: false,
  accountMenuOpen: false,
  accountMenuAnchor: null,
  contextMenuMessageId: "",
  previewMode: false
};

const CONTACT_DETAIL_PRESETS = [
  {
    role: "\u4ea7\u54c1\u8bbe\u8ba1\u7ec4\u3000\u8bbe\u8ba1\u4e3b\u7406",
    about: "\u8d1f\u8d23\u4f1a\u8bae\u8d44\u6599\u3001\u4efb\u52a1\u8282\u594f\u4e0e\u56e2\u961f\u540c\u6b65\uff0c\u503e\u5411\u7b80\u6d01\u6c9f\u901a\u4e0e\u7a33\u5b9a\u63a8\u8fdb\u3002",
    media: [
      { tone: "workspace", label: "\u8def\u7ebf\u56fe" },
      { tone: "plant", label: "\u529e\u516c\u684c\u9762" },
      { tone: "mountain", label: "\u5916\u51fa\u8bb0\u5f55" },
      { tone: "interior", label: "\u4f1a\u5ba2\u533a" }
    ],
    files: [
      { name: "\u9879\u76ee\u7b80\u62a5\u7ec8\u7a3f.pdf", meta: "PDF \u00b7 2.4 MB", kind: "pdf" },
      { name: "\u53d1\u5e03\u8282\u70b9\u6392\u671f.xlsx", meta: "XLS \u00b7 940 KB", kind: "xls" },
      { name: "\u8bc4\u5ba1\u8bb0\u5f55.docx", meta: "DOC \u00b7 320 KB", kind: "doc" }
    ],
    inlineFile: { name: "\u9879\u76ee\u7b80\u62a5\u7ec8\u7a3f.pdf", meta: "PDF \u00b7 2.4 MB", kind: "pdf" }
  },
  {
    role: "\u54c1\u724c\u89c6\u89c9\u7ec4\u3000\u8bbe\u8ba1\u8d1f\u8d23\u4eba",
    about: "\u64c5\u957f\u628a\u8bc4\u5ba1\u5185\u5bb9\u6574\u7406\u6210\u53ef\u6267\u884c\u7684\u6e05\u5355\uff0c\u540c\u65f6\u4fdd\u6301\u754c\u9762\u7ec6\u8282\u548c\u8282\u594f\u3002",
    media: [
      { tone: "interior", label: "\u6c14\u6c1b\u677f" },
      { tone: "workspace", label: "\u7ebf\u6846\u7a3f" },
      { tone: "plant", label: "\u5de5\u4f5c\u5ba4" },
      { tone: "mountain", label: "\u54c1\u724c\u6d3b\u52a8" }
    ],
    files: [
      { name: "\u8bbe\u8ba1\u8d70\u67e5\u6e05\u5355.pdf", meta: "PDF \u00b7 1.8 MB", kind: "pdf" },
      { name: "\u7d20\u6750\u6c47\u603b.xlsx", meta: "XLS \u00b7 760 KB", kind: "xls" },
      { name: "\u54c1\u724c\u5907\u6ce8.docx", meta: "DOC \u00b7 280 KB", kind: "doc" }
    ],
    inlineFile: { name: "\u8bbe\u8ba1\u8d70\u67e5\u6e05\u5355.pdf", meta: "PDF \u00b7 1.8 MB", kind: "pdf" }
  },
  {
    role: "\u8fd0\u8425\u56e2\u961f\u3000\u6267\u884c\u8d1f\u8d23\u4eba",
    about: "\u4e60\u60ef\u7528\u7ed3\u6784\u5316\u7684\u6d88\u606f\u548c\u6587\u4ef6\u4ea4\u4ed8\u63a8\u8fdb\u9879\u76ee\uff0c\u8ddf\u8fdb\u660e\u786e\u4e14\u9ad8\u6548\u3002",
    media: [
      { tone: "plant", label: "\u6570\u636e\u770b\u677f" },
      { tone: "workspace", label: "\u6392\u671f\u770b\u677f" },
      { tone: "mountain", label: "\u5916\u573a\u8bb0\u5f55" },
      { tone: "interior", label: "\u4f1a\u8bae\u5ba4" }
    ],
    files: [
      { name: "\u5468\u5ea6\u4ea4\u63a5\u5355.pdf", meta: "PDF \u00b7 2.1 MB", kind: "pdf" },
      { name: "\u4eba\u529b\u6a21\u578b.xlsx", meta: "XLS \u00b7 880 KB", kind: "xls" },
      { name: "\u884c\u52a8\u7eaa\u8981.docx", meta: "DOC \u00b7 260 KB", kind: "doc" }
    ],
    inlineFile: { name: "\u5468\u5ea6\u4ea4\u63a5\u5355.pdf", meta: "PDF \u00b7 2.1 MB", kind: "pdf" }
  },
  {
    role: "\u5e02\u573a\u7b56\u7565\u7ec4\u3000\u534f\u540c\u8d1f\u8d23\u4eba",
    about: "\u8d1f\u8d23\u6295\u653e\u8ba1\u5212\u3001\u5ba1\u6279\u8282\u70b9\u4e0e\u6d88\u606f\u7559\u5b58\uff0c\u4f7f\u6bcf\u4e00\u6b21\u53d1\u5e03\u66f4\u6e05\u6670\u3002",
    media: [
      { tone: "mountain", label: "\u6295\u653e\u590d\u76d8" },
      { tone: "workspace", label: "\u8f6c\u5316\u62a5\u8868" },
      { tone: "interior", label: "\u5408\u4f5c\u4f1a\u8bae" },
      { tone: "plant", label: "\u6d3b\u52a8\u6392\u671f" }
    ],
    files: [
      { name: "\u6295\u653e\u590d\u76d8.pdf", meta: "PDF \u00b7 2.0 MB", kind: "pdf" },
      { name: "\u9884\u4f30\u6a21\u578b.xlsx", meta: "XLS \u00b7 1.1 MB", kind: "xls" },
      { name: "\u5408\u4f5c\u603b\u7ed3.docx", meta: "DOC \u00b7 300 KB", kind: "doc" }
    ],
    inlineFile: { name: "\u6295\u653e\u590d\u76d8.pdf", meta: "PDF \u00b7 2.0 MB", kind: "pdf" }
  }
];

const PREVIEW_USER = { username: "\u5f20\u5b50\u8f69" };
const PREVIEW_CONVERSATIONS = [
  { username: "\u6797\u8bed\u6850", online: true, previewText: "\u6587\u4ef6\u5df2\u53d1\u4f60\uff0c\u8bf7\u67e5\u6536", lastAt: Date.now() - 8 * 60 * 1000, unread: 0, pinned: true },
  { username: "\u738b\u601d\u8fdc", online: false, previewText: "\u597d\u7684\uff0c\u6211\u7a0d\u540e\u5904\u7406", lastAt: Date.now() - 23 * 60 * 1000, unread: 2, pinned: false },
  { username: "\u8fd0\u8425\u56e2\u961f", online: true, previewText: "\u6570\u636e\u677f\u5df2\u66f4\u65b0", lastAt: Date.now() - 45 * 60 * 1000, unread: 3, pinned: false },
  { username: "\u9648\u4e00\u5e06", online: false, previewText: "\u8c22\u8c22\u4f60\u7684\u5e2e\u52a9", lastAt: Date.now() - 24 * 60 * 60 * 1000, unread: 0, pinned: false }
];

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

function usernameSeed(username) {
  let total = 0;
  for (const char of String(username || "")) {
    total += char.charCodeAt(0);
  }
  return total;
}

function setAvatar(node, username) {
  node.className = `avatar avatar-tone-${avatarTone(username)}`;
  node.textContent = avatarInitial(username);
}

function contactDetailPreset(username) {
  return CONTACT_DETAIL_PRESETS[usernameSeed(username) % CONTACT_DETAIL_PRESETS.length];
}

function isDetailsDrawerLayout() {
  return window.innerWidth <= 1420;
}

function showToast(message, kind = "info") {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("is-error", kind === "error");
  elements.toast.classList.add("is-visible");
  state.toastTimer = window.setTimeout(() => {
    elements.toast.classList.remove("is-visible");
  }, 2400);
}

function setAccountMenuExpanded(expanded) {
  const value = expanded ? "true" : "false";
  elements.accountMenuButton?.setAttribute("aria-expanded", value);
  elements.sidebarProfileButton?.setAttribute("aria-expanded", value);
}

function positionFloatingMenu(menu, anchor) {
  if (!menu || !anchor) {
    return;
  }
  const rect = anchor.getBoundingClientRect();
  const menuWidth = menu.offsetWidth || 188;
  const menuHeight = menu.offsetHeight || 120;
  const gap = 10;
  const viewportGap = 12;
  let left = rect.right - menuWidth;
  let top = rect.bottom + gap;

  if (left < viewportGap) {
    left = rect.left;
  }
  left = Math.max(viewportGap, Math.min(left, window.innerWidth - menuWidth - viewportGap));

  if (top + menuHeight > window.innerHeight - viewportGap) {
    top = rect.top - menuHeight - gap;
  }
  top = Math.max(viewportGap, top);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function closeAccountMenu() {
  state.accountMenuOpen = false;
  state.accountMenuAnchor = null;
  setAccountMenuExpanded(false);
  if (elements.accountMenu) {
    elements.accountMenu.hidden = true;
    elements.accountMenu.style.removeProperty("left");
    elements.accountMenu.style.removeProperty("top");
  }
}

function toggleAccountMenu(force, anchor = elements.accountMenuButton || elements.sidebarProfileButton) {
  state.accountMenuOpen = typeof force === "boolean" ? force : !state.accountMenuOpen;
  state.accountMenuAnchor = state.accountMenuOpen ? (anchor || elements.accountMenuButton || elements.sidebarProfileButton) : null;
  setAccountMenuExpanded(state.accountMenuOpen);
  if (elements.accountMenu) {
    elements.accountMenu.hidden = !state.accountMenuOpen;
    if (state.accountMenuOpen && state.accountMenuAnchor) {
      positionFloatingMenu(elements.accountMenu, state.accountMenuAnchor);
    }
  }
}

function closeEmojiPanel() {
  state.emojiPanelOpen = false;
  if (elements.emojiPanel) {
    elements.emojiPanel.hidden = true;
  }
}

function toggleEmojiPanel(force) {
  state.emojiPanelOpen = typeof force === "boolean" ? force : !state.emojiPanelOpen;
  if (elements.emojiPanel) {
    elements.emojiPanel.hidden = !state.emojiPanelOpen;
  }
}

function hideMessageContextMenu() {
  state.contextMenuMessageId = "";
  if (elements.messageContextMenu) {
    elements.messageContextMenu.hidden = true;
    elements.messageContextMenu.style.removeProperty("left");
    elements.messageContextMenu.style.removeProperty("top");
  }
}

function showMessageContextMenu(messageId, x, y) {
  if (!elements.messageContextMenu || !messageId) {
    return;
  }
  state.contextMenuMessageId = messageId;
  elements.messageContextMenu.hidden = false;
  const maxX = window.innerWidth - 180;
  const maxY = window.innerHeight - 120;
  elements.messageContextMenu.style.left = `${Math.min(x, maxX)}px`;
  elements.messageContextMenu.style.top = `${Math.min(y, maxY)}px`;
}

function insertEmoji(value) {
  if (!elements.messageInput || !value) {
    return;
  }
  const input = elements.messageInput;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = `${input.value.slice(0, start)}${value}${input.value.slice(end)}`;
  const nextPos = start + value.length;
  input.setSelectionRange(nextPos, nextPos);
  input.focus();
  handleComposerInput();
}

function connectionStatusLabel() {
  switch (state.connectionState) {
    case "online":
      return "\u5728\u7ebf";
    case "connecting":
      return "\u8fde\u63a5\u4e2d";
    case "reconnecting":
      return "\u91cd\u8fde\u4e2d";
    default:
      return "\u79bb\u7ebf";
  }
}

function updateWorkspaceStatus() {
  if (!elements.meStatus) {
    return;
  }
  if (!state.me) {
    elements.meStatus.textContent = "\u7b49\u5f85\u767b\u5f55";
    if (elements.sidebarProfileAvatar) {
      setAvatar(elements.sidebarProfileAvatar, "Echo");
    }
    if (elements.sidebarProfileName) {
      elements.sidebarProfileName.textContent = "Echo";
    }
    if (elements.sidebarProfileStatus) {
      elements.sidebarProfileStatus.textContent = "\u70b9\u51fb\u767b\u5f55";
    }
    updateMeStatusDot("offline");
    return;
  }
  const pendingCount = state.pendingOutbox.length;
  const pendingSuffix = pendingCount > 0 ? ` \u00b7 \u5f85\u53d1\u9001 ${pendingCount}` : "";
  elements.meStatus.textContent = `${connectionStatusLabel()} \u00b7 \u5df2\u52a0\u5bc6${pendingSuffix}`;
  if (elements.sidebarProfileAvatar) {
    setAvatar(elements.sidebarProfileAvatar, state.me.username);
  }
  if (elements.sidebarProfileName) {
    elements.sidebarProfileName.textContent = state.me.username;
  }
  if (elements.sidebarProfileStatus) {
    elements.sidebarProfileStatus.textContent = state.previewMode ? "\u754c\u9762\u9884\u89c8" : connectionStatusLabel();
  }
  updateMeStatusDot(state.connectionState);
}

function updateMeStatusDot(connectionState) {
  if (!elements.meStatusDot) {
    return;
  }
  const dot = elements.meStatusDot;
  dot.classList.remove("is-online", "is-connecting", "is-reconnecting", "is-offline");
  const stateClass = connectionState === "online"
    ? "is-online"
    : connectionState === "reconnecting"
      ? "is-reconnecting"
      : connectionState === "connecting"
        ? "is-connecting"
        : "is-offline";
  dot.classList.add(stateClass);
}

function updateTypingIndicator(visible, peer) {
  if (!elements.typingIndicator) {
    return;
  }
  if (visible && peer) {
    elements.typingIndicator.hidden = false;
    if (elements.typingAvatar) {
      setAvatar(elements.typingAvatar, peer);
    }
  } else {
    elements.typingIndicator.hidden = true;
  }
}

function updateScrollBottomButton(force) {
  if (!elements.scrollBottomButton || !elements.messageList) {
    return;
  }
  const near = isNearBottom(elements.messageList, 160);
  if (force === true || near) {
    elements.scrollBottomButton.classList.remove("is-visible");
    state.scrollBottomNewCount = 0;
    if (elements.scrollBottomCount) {
      elements.scrollBottomCount.hidden = true;
      elements.scrollBottomCount.textContent = "";
    }
    return;
  }
  elements.scrollBottomButton.classList.add("is-visible");
  if (elements.scrollBottomCount) {
    if (state.scrollBottomNewCount > 0) {
      elements.scrollBottomCount.hidden = false;
      elements.scrollBottomCount.textContent = String(state.scrollBottomNewCount > 99 ? "99+" : state.scrollBottomNewCount);
    } else {
      elements.scrollBottomCount.hidden = true;
      elements.scrollBottomCount.textContent = "";
    }
  }
}

function scrollMessagesToBottom(smooth) {
  if (!elements.messageList) {
    return;
  }
  if (smooth) {
    elements.messageList.scrollTo({ top: elements.messageList.scrollHeight, behavior: "smooth" });
  } else {
    elements.messageList.scrollTop = elements.messageList.scrollHeight;
  }
  state.scrollBottomNewCount = 0;
  updateScrollBottomButton(true);
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
    return "\u521a\u521a";
  }
  if (diffMinutes < 60) {
    return `${diffMinutes} \u5206\u949f\u524d`;
  }
  if (diffMinutes < 24 * 60) {
    return formatTime(timestamp);
  }
  return new Date(timestamp).toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric"
  });
}

function messagePreview(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "暂无消息";
  }
  return normalized.length > 34 ? `${normalized.slice(0, 34)}...` : normalized;
}

function replyPreviewText(message) {
  const normalized = String(message?.text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "空消息";
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
    sendStatus: ["queued", "sending", "failed"].includes(entry?.sendStatus)
      ? entry.sendStatus
      : Boolean(entry?.failed)
        ? "failed"
        : "queued",
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
        sendStatus: entry.sendStatus,
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
  setAuthFeedback(
    state.authMode === "login"
      ? "同一账号可多端进入，消息密钥由浏览器自动处理。"
      : "注册后自动生成本地密钥，服务端只保存必要的账号资料。"
  );
  elements.authPasswordInput.autocomplete = state.authMode === "login" ? "current-password" : "new-password";
}

function setAuthFeedback(message, isError = false) {
  elements.authTip.textContent = message;
  elements.authTip.classList.toggle("is-error", Boolean(isError));
}

function validateAuthInput(username, password) {
  if (!username) {
    return { ok: false, field: elements.authUsernameInput, message: "请输入用户名。" };
  }
  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    return {
      ok: false,
      field: elements.authUsernameInput,
      message: "用户名需为 3-24 位，只能使用字母、数字或下划线。"
    };
  }
  if (!password) {
    return { ok: false, field: elements.authPasswordInput, message: "请输入密码。" };
  }
  if (password.length < 4 || password.length > 72) {
    return { ok: false, field: elements.authPasswordInput, message: "密码长度需为 4-72 位。" };
  }
  return { ok: true };
}

function updateSecurityStatus(peer = activePeerMeta()) {
  if (!elements.securityStatus) {
    return;
  }
  if (!peer) {
    elements.securityStatus.textContent = "\u8bf7\u9009\u62e9\u4f1a\u8bdd\u67e5\u770b\u52a0\u5bc6\u72b6\u6001\u3002";
    return;
  }
  const parts = [];
  parts.push(state.identity?.privateKey ? "\u5bc6\u94a5\u5df2\u5c31\u7eea" : "\u5bc6\u94a5\u5df2\u9501\u5b9a");
  parts.push(state.peerKeys.has(peer.username) ? "\u5bf9\u7aef\u5bc6\u94a5\u5df2\u540c\u6b65" : "\u7b49\u5f85\u5bf9\u7aef\u5bc6\u94a5");
  if (state.connectionState === "online") {
    parts.push("\u5b9e\u65f6\u8fde\u63a5\u6b63\u5e38");
  } else if (state.connectionState === "reconnecting") {
    parts.push("\u6b63\u5728\u5c1d\u8bd5\u91cd\u8fde");
  } else if (state.connectionState === "connecting") {
    parts.push("\u6b63\u5728\u5efa\u7acb\u8fde\u63a5");
  } else {
    parts.push("\u79bb\u7ebf\u961f\u5217\u53ef\u7528");
  }
  const pendingCount = pendingOutboxForPeer(peer.username).length;
  if (pendingCount > 0) {
    parts.push(`\u5f85\u53d1\u9001 ${pendingCount}`);
  }
  elements.securityStatus.textContent = parts.join(" \u00b7 ");
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
  return window.innerWidth <= 960;
}

function syncLayoutState() {
  if (!isDetailsDrawerLayout()) {
    state.detailsPanelOpen = false;
  }
  document.body.classList.toggle("is-mobile", isMobile());
  document.body.classList.toggle("is-chat-open", isMobile() && Boolean(state.activePeer));
  document.body.classList.toggle("is-details-open", isDetailsDrawerLayout() && state.detailsPanelOpen);
  if (state.accountMenuOpen && elements.accountMenu && state.accountMenuAnchor) {
    positionFloatingMenu(elements.accountMenu, state.accountMenuAnchor);
  }
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

function scheduleResponsiveRender() {
  if (state.resizeRenderRaf) {
    return;
  }
  state.resizeRenderRaf = window.requestAnimationFrame(() => {
    state.resizeRenderRaf = 0;
    render();
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
      credentials: "same-origin",
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
  state.previewMode = false;

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
  state.token = token ? "cookie" : "";
  state.me = user;
  state.identity = identity;
  state.previewMode = false;
  resetLocalConversationState();
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
  elements.pinPeerButton.textContent = prefs.pinned ? "\u53d6\u6d88\u7f6e\u9876" : "\u7f6e\u9876";
  elements.mutePeerButton.textContent = prefs.muted ? "\u53d6\u6d88\u514d\u6253\u6270" : "\u514d\u6253\u6270";
  elements.exportPeerButton.textContent = "\u5bfc\u51fa";
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
    ? "\u8349\u7a3f\u547d\u4e2d"
    : indexText.startsWith(conversation.username.toLowerCase())
      ? "\u540d\u79f0\u547d\u4e2d"
      : String(conversation.previewText || "").toLowerCase().includes(normalizedQuery)
        ? "\u6700\u8fd1\u6d88\u606f"
        : "\u5386\u53f2\u6d88\u606f";
  return {
    username: conversation.username,
    online: conversation.online,
    avatarSeed: conversation.avatarSeed || conversation.username,
    publicKey: conversation.publicKey,
    previewText: conversation.previewText || "",
    lastAt: conversation.lastAt || 0,
    unread: conversation.unread || 0,
    sourceLabel: `\u4f1a\u8bdd \u00b7 ${matchLabel}`,
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

function setDetailsPanelOpen(force) {
  state.detailsPanelOpen = typeof force === "boolean" ? force : !state.detailsPanelOpen;
  syncLayoutState();
}

function renderDetailFileRow(file) {
  const wrapper = document.createElement("div");
  wrapper.className = "detail-file-row";

  const icon = document.createElement("div");
  icon.className = "detail-file-icon";
  icon.dataset.kind = file.kind || "doc";
  icon.textContent = String(file.kind || "doc").toUpperCase();

  const copy = document.createElement("div");
  copy.className = "detail-file-copy";
  copy.innerHTML = `
    <strong>${escapeHtml(file.name || "\u672a\u547d\u540d\u6587\u4ef6")}</strong>
    <span class="detail-file-meta">${escapeHtml(file.meta || "\u6587\u4ef6")}</span>
  `;

  const download = document.createElement("button");
  download.type = "button";
  download.className = "detail-file-download";
  download.dataset.detailAction = "download";
  download.setAttribute("aria-label", `\u4e0b\u8f7d ${file.name || "\u6587\u4ef6"}`);
  download.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
      <polyline points="7 10 12 15 17 10"></polyline>
      <line x1="12" y1="15" x2="12" y2="3"></line>
    </svg>
  `;

  wrapper.append(icon, copy, download);
  return wrapper;
}

function renderInlineFileCard(file) {
  const article = document.createElement("article");
  article.className = "message message-file";

  const body = document.createElement("div");
  body.className = "message-body";

  const card = document.createElement("div");
  card.className = "bubble bubble-file";
  card.innerHTML = `
    <div class="inline-file-card">
      <div class="inline-file-icon" data-kind="${escapeHtml(file.kind || "pdf")}">${escapeHtml(String(file.kind || "pdf").toUpperCase())}</div>
      <div class="inline-file-copy">
        <strong>${escapeHtml(file.name || "\u52a0\u5bc6\u6587\u4ef6")}</strong>
        <span>${escapeHtml(file.meta || "\u5b89\u5168\u6587\u4ef6")}</span>
      </div>
      <button class="inline-file-action" type="button" data-detail-action="download" aria-label="\u4e0b\u8f7d ${escapeHtml(file.name || "\u6587\u4ef6")}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="7 10 12 15 17 10"></polyline>
          <line x1="12" y1="15" x2="12" y2="3"></line>
        </svg>
      </button>
    </div>
  `;

  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = "\u5df2\u5171\u4eab\u6587\u4ef6";

  body.append(card, meta);
  article.append(body);
  return article;
}

function renderContactDetails(peer) {
  if (!elements.contactDetailsEmpty || !elements.contactDetailsContent) {
    return;
  }
  if (!peer) {
    elements.contactDetailsEmpty.hidden = false;
    elements.contactDetailsContent.hidden = true;
    if (isDetailsDrawerLayout()) {
      setDetailsPanelOpen(false);
    }
    return;
  }

  const preset = contactDetailPreset(peer.username);
  const prefs = peerPrefs(peer.username);
  elements.contactDetailsEmpty.hidden = true;
  elements.contactDetailsContent.hidden = false;
  setAvatar(elements.detailsAvatar, peer.username);
  elements.detailsName.textContent = peer.username;
  elements.detailsStatus.textContent = peer.online ? "在线" : "最近活跃";
  elements.detailsRole.textContent = preset.role;
  elements.detailsAbout.textContent = preset.about;
  elements.notificationsToggle.checked = !prefs.muted;

  elements.detailsMediaGrid.textContent = "";
  for (const item of preset.media) {
    const thumb = document.createElement("div");
    thumb.className = "media-thumb";
    thumb.dataset.tone = item.tone;
    thumb.setAttribute("role", "img");
    thumb.setAttribute("aria-label", item.label);
    elements.detailsMediaGrid.append(thumb);
  }

  elements.detailsFilesList.textContent = "";
  for (const file of preset.files) {
    elements.detailsFilesList.append(renderDetailFileRow(file));
  }
}

function renderSidebar() {
  const query = state.searchQuery.trim().toLowerCase();
  if (elements.globalSearchInput && elements.globalSearchInput.value !== state.searchQuery) {
    elements.globalSearchInput.value = state.searchQuery;
  }
  if (elements.sidebarSearchInput && elements.sidebarSearchInput.value !== state.searchQuery) {
    elements.sidebarSearchInput.value = state.searchQuery;
  }
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

  const pinnedConversations = conversations.filter((item) => peerPrefs(item.username).pinned);
  const recentConversations = conversations.filter((item) => !peerPrefs(item.username).pinned);
  const visibleCount = conversations.length;
  const mergedSearchRows = query
    ? (() => {
        const remoteResults = state.searchResults.map((user) => ({
          ...user,
          sourceLabel: "联系人",
          searchHint: user.online ? "当前在线" : "可发起会话"
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
    ? `${mergedSearchRows.length} 条结果`
    : `${visibleCount} 个会话`;
  elements.searchGroup.hidden = !query;
  if (elements.pinnedGroup) {
    elements.pinnedGroup.hidden = query || pinnedConversations.length === 0;
  }
  if (elements.recentGroup) {
    elements.recentGroup.hidden = Boolean(query) || recentConversations.length === 0;
  }

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
      empty.textContent = "没有匹配的联系人或会话";
      elements.searchResultList.append(empty);
    } else {
      for (const user of searchRows) {
        elements.searchResultList.append(renderListItem(user, true));
      }
    }
  }

  if (elements.pinnedConversationList) {
    elements.pinnedConversationList.textContent = "";
    for (const conversation of pinnedConversations) {
      elements.pinnedConversationList.append(renderListItem(conversation, false));
    }
  }

  elements.conversationList.textContent = "";
  elements.conversationEmpty.hidden = query || conversations.length > 0;
  for (const conversation of recentConversations) {
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
  const avatarWrap = document.createElement("div");
  avatarWrap.className = "list-item-avatar";
  avatarWrap.append(avatar);
  if (item.online) {
    const presence = document.createElement("i");
    presence.className = "online-dot";
    presence.setAttribute("aria-hidden", "true");
    avatarWrap.append(presence);
  }

  const meta = document.createElement("div");
  meta.className = "list-item-meta";
  meta.innerHTML = `
    <div class="list-row">
      <strong>${escapeHtml(item.username)}</strong>
      <span>${escapeHtml(isSearchResult ? (item.sourceLabel || (item.online ? "在线" : "离线")) : formatRelative(item.lastAt))}</span>
    </div>
    <div class="list-row is-subtle">
      <span class="list-preview">${escapeHtml(isSearchResult ? (item.searchHint || "发起新的加密会话") : messagePreview(item.previewText || "加密消息"))}</span>
      <span class="list-indicators">${indicators.join("")}</span>
    </div>
  `;

  const flags = [];
  if (prefs.pinned) {
    flags.push('<em class="list-flag">已置顶</em>');
  }
  if (prefs.muted) {
    flags.push('<em class="list-flag">免打扰</em>');
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

  button.append(avatarWrap, meta);
  return button;
}
function isSameDay(a, b) {
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate();
}

function formatDaySeparator(timestamp) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (isSameDay(date, today)) return "\u4eca\u5929";
  if (isSameDay(date, yesterday)) return "\u6628\u5929";
  return date.toLocaleDateString("zh-CN", {
    month: "numeric",
    day: "numeric",
    weekday: "long"
  });
}

function createDaySeparator(timestamp) {
  const sep = document.createElement("div");
  sep.className = "message-day-sep";
  sep.innerHTML = `<span>${escapeHtml(formatDaySeparator(timestamp))}</span>`;
  return sep;
}

function isMessageConsecutive(prev, current) {
  if (!prev || !current) return false;
  if (prev.mine !== current.mine) return false;
  if (prev.from !== current.from) return false;
  const gap = Math.abs((current.createdAt || 0) - (prev.createdAt || 0));
  if (gap > 5 * 60 * 1000) return false;
  if (!isSameDay(prev.createdAt, current.createdAt)) return false;
  if (prev.pending || prev.failed || current.pending || current.failed) return false;
  return true;
}

function renderMessage(message, options = {}) {
  const article = document.createElement("article");
  const isConsecutive = options.consecutive ? " is-consecutive" : "";
  article.className = `message ${message.mine ? "is-own" : "is-peer"}${message.pending ? " is-pending" : ""}${message.failed ? " is-failed" : ""}${message.replyTo ? " is-reply" : ""}${message.recalled ? " is-recalled" : ""}${isConsecutive}`;
  article.dataset.messageId = message.id || message.tempId || "";
  article.dataset.messageText = message.text;
  article.dataset.mine = message.mine ? "1" : "0";
  const replyAction = `<button class="message-reply-button" type="button" data-reply-id="${escapeHtml(message.id || message.tempId || "")}">\u56de\u590d</button>`;
  let statusAction = "";
  if (message.failed) {
    statusAction = `<span class="message-state is-error"><i class="dot"></i>\u53d1\u9001\u5931\u8d25</span><span class="message-meta-sep">·</span><button class="message-retry-button" type="button" data-temp-id="${escapeHtml(message.tempId || "")}">\u91cd\u8bd5</button>`;
  } else if (message.pending) {
    const stateClass = message.sendStatus === "queued" ? "is-queued" : "is-sending";
    const stateLabel = message.sendStatus === "queued" ? "\u5f85\u53d1\u9001" : "\u53d1\u9001\u4e2d";
    statusAction = `<span class="message-state ${stateClass}"><i class="dot"></i>${stateLabel}</span>`;
  } else if (message.mine && message.sendStatus === "sent") {
    statusAction = `<span class="message-state is-sent"><i class="dot"></i>\u5df2\u53d1\u9001</span>`;
  }
  const copyAction = `<button class="message-copy-button" type="button" data-copy-id="${escapeHtml(message.id || message.tempId || "")}">\u590d\u5236</button>`;
  const replyMarkup = message.replyTo
    ? `
      <div class="message-reply">
        <span>\u56de\u590d ${escapeHtml(message.replyTo.from || "\u6d88\u606f")}</span>
        <p>${escapeHtml(replyPreviewText(message.replyTo))}</p>
      </div>
    `
    : "";
  const bubbleMarkup = message.recalled
    ? `<div class="bubble bubble-recalled">\u4f60\u64a4\u56de\u4e86\u4e00\u6761\u6d88\u606f</div>`
    : `<div class="bubble">${escapeHtml(message.text).replaceAll("\n", "<br />")}</div>`;
  const metaParts = [escapeHtml(formatTime(message.createdAt))];
  if (statusAction && !message.recalled) metaParts.push(statusAction);
  if (!message.recalled && (!isConsecutive || !message.mine)) {
    metaParts.push(replyAction);
  }
  if (!message.recalled) {
    metaParts.push(copyAction);
  }
  const avatarMarkup = isConsecutive
    ? ""
    : `<div class="message-avatar avatar avatar-tone-${avatarTone(message.from)}">${escapeHtml(avatarInitial(message.from))}</div>`;
  article.innerHTML = `
    ${message.mine ? "" : avatarMarkup}
    <div class="message-body">
      ${replyMarkup}
      ${bubbleMarkup}
      <div class="message-meta">${metaParts.join('<span class="message-meta-sep">·</span>')}</div>
    </div>
  `;
  return article;
}

function renderThread(options = {}) {
  const scrollBehavior = options.scrollBehavior || "preserve";
  const peer = activePeerMeta();
  const hasPeer = Boolean(peer);

  elements.chatEmpty.hidden = hasPeer;
  elements.chatThread.hidden = !hasPeer;
  applyThreadActionState(hasPeer ? peer.username : "");
  updateWorkspaceStatus();
  updateSecurityStatus(peer);
  renderContactDetails(peer);

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
    connectionLabel = " · 重连中";
  } else if (state.connectionState === "offline") {
    connectionLabel = " · 离线队列";
  }
  const prefs = peerPrefs(peer.username);
  const statusTags = [];
  if (prefs.pinned) {
    statusTags.push("已置顶");
  }
  if (prefs.muted) {
    statusTags.push("免打扰");
  }
  const threadQuery = state.threadSearchQuery.trim().toLowerCase();
  const statusSuffix = statusTags.length ? ` · ${statusTags.join(" · ")}` : "";
  elements.peerStatus.textContent = `${peer.online ? "在线" : "离线"} · 端到端加密${connectionLabel}${statusSuffix}`;
  updateSecurityStatus(peer);
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
      ? `\u5df2\u7b5b\u9009 ${visibleMessages.length} / ${messages.length} \u6761\u6d88\u606f`
      : `\u5171 ${messages.length} \u6761\u6d88\u606f`;
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
    empty.innerHTML = `<strong>${escapeHtml(peer.username)}</strong><span>暂无消息，发送第一条加密消息开始会话。</span>`;
    elements.messageList.append(empty);
  } else if (visibleMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "message-empty";
    empty.innerHTML = `<strong>没有匹配的消息</strong><span>请尝试缩短关键词，或清空当前会话搜索。</span>`;
    elements.messageList.append(empty);
  } else {
    if (virtualWindow && virtualWindow.start > 0) {
      elements.messageList.append(createSpacer(virtualWindow.topSpacer));
    }
    const slice = virtualWindow ? visibleMessages.slice(virtualWindow.start, virtualWindow.end) : visibleMessages;
    let prevMessage = null;
    let lastDayKey = "";
    const inlineFile = !threadQuery && !virtualWindow ? contactDetailPreset(peer.username).inlineFile : null;
    const inlineFileAfterIndex = inlineFile ? Math.min(2, Math.max(0, slice.length - 1)) : -1;
    for (let index = 0; index < slice.length; index += 1) {
      const message = slice[index];
      const dayKey = new Date(message.createdAt || 0).toDateString();
      if (dayKey && dayKey !== lastDayKey) {
        elements.messageList.append(createDaySeparator(message.createdAt || Date.now()));
        lastDayKey = dayKey;
        prevMessage = null;
      }
      const consecutive = isMessageConsecutive(prevMessage, message);
      elements.messageList.append(renderMessage(message, { consecutive }));
      if (inlineFile && index === inlineFileAfterIndex) {
        elements.messageList.append(renderInlineFileCard(inlineFile));
      }
      prevMessage = message;
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
    scrollMessagesToBottom(true);
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
  updateScrollBottomButton();
}

function render() {
  syncLayoutState();
  setActiveNavSection(state.activeNavSection);
  renderSidebar();
  renderThread();
  updateMeStatusDot(state.connectionState);
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
  if (state.previewMode) {
    state.searchResults = [];
    renderSidebar();
    return;
  }
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
  const sendStatus = state.connectionState === "online" ? "sending" : "queued";
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
    sendStatus,
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

function setPendingMessageState(tempId, status, lastError = "") {
  const failed = status === "failed";
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
        failed: Boolean(failed),
        sendStatus: failed ? "failed" : status
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
                sendStatus: "failed",
                attempts: (entry.attempts || 0) + 1,
                lastError: String(lastError || "发送失败")
              }
            : {
                ...entry,
                failed: false,
                sendStatus: status,
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
    sendStatus: pending.sendStatus,
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
    sendStatus: pending.sendStatus,
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
      sendStatus: pending.sendStatus,
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
      sendStatus: entry.sendStatus,
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

  closeEmojiPanel();
  hideMessageContextMenu();
  ensureConversationEntry(username);
  state.activePeer = username;
  state.detailsPanelOpen = false;
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
  state.detailsPanelOpen = false;
  localStorage.removeItem(STORAGE.activePeer);
  render();
}

function focusGlobalSearch() {
  if (isMobile() && state.activePeer) {
    state.activePeer = "";
    state.detailsPanelOpen = false;
    localStorage.removeItem(STORAGE.activePeer);
    render();
  }
  window.setTimeout(() => {
    elements.globalSearchInput.focus();
    elements.globalSearchInput.select();
  }, 0);
}

function focusSidebarSearch() {
  if (!elements.sidebarSearchInput) {
    focusGlobalSearch();
    return;
  }
  if (isMobile() && state.activePeer) {
    state.activePeer = "";
    state.detailsPanelOpen = false;
    localStorage.removeItem(STORAGE.activePeer);
    render();
  }
  window.setTimeout(() => {
    elements.sidebarSearchInput.focus();
    elements.sidebarSearchInput.select();
  }, 0);
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
    decrypted.sendStatus = "sent";
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
    if (!stickToBottom) {
      state.scrollBottomNewCount += 1;
    }
    updateScrollBottomButton();
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
  const validation = validateAuthInput(username, password);
  if (!validation.ok) {
    setAuthFeedback(validation.message, true);
    validation.field?.focus();
    return;
  }

  if (!window.crypto?.subtle) {
    setAuthFeedback("当前环境不支持 Web Crypto，请使用 HTTPS 或 localhost。", true);
    return;
  }

  setAuthBusy(true);
  setAuthFeedback(state.authMode === "login" ? "正在验证账号并解锁密钥..." : "正在创建账号和本地密钥...");
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
    const message = error.message || "认证失败";
    setAuthFeedback(message, true);
    showToast(message);
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
  if (state.connectionState !== "online") {
    setPendingMessageState(tempId, "queued");
    renderThread({ scrollBehavior: "bottom" });
    if (!silent) {
      showToast("当前离线，消息已加入待发送队列");
    }
    return false;
  }
  setPendingMessageState(tempId, "sending");
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
    if (!silent) {
      showToast("\u5df2\u53d1\u9001");
    }
    return true;
  } catch (error) {
    setPendingMessageState(tempId, "failed", error.message);
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
  if (state.submitInFlight) {
    return;
  }

  const text = elements.messageInput.value.trim();
  if (!text) {
    return;
  }

  state.submitInFlight = true;
  if (elements.sendButton) {
    elements.sendButton.setAttribute("data-busy", "true");
  }
  window.setTimeout(() => {
    state.submitInFlight = false;
    if (elements.sendButton) {
      elements.sendButton.removeAttribute("data-busy");
    }
  }, 480);

  const peer = state.activePeer;
  const replyTo = state.replyTarget ? { ...state.replyTarget } : null;
  const tempId = addPendingMessage(peer, text, replyTo);
  setDraftForPeer(peer, "");
  elements.messageInput.value = "";
  autoResizeComposer();
  closeEmojiPanel();
  renderThread({ scrollBehavior: "bottom" });
  if (state.previewMode) {
    const pending = findMessageById(peer, tempId);
    if (pending) {
      pending.pending = false;
      pending.sendStatus = "sent";
      pending.createdAt = Date.now();
      const conversation = getConversation(peer);
      if (conversation) {
        conversation.previewText = text;
        conversation.lastAt = pending.createdAt;
      }
      sortConversations();
      renderSidebar();
      renderThread({ scrollBehavior: "bottom" });
      showToast("\u5df2\u53d1\u9001");
    }
    return;
  }
  void sendMessageWithRetry(tempId, peer, text, tempId, false, replyTo?.id || "");
}

async function retryPendingMessage(tempId) {
  const pending = state.pendingMessages.get(tempId);
  if (!pending) {
    return;
  }
  setPendingMessageState(tempId, "sending");
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

function findMessageById(peer, messageId) {
  if (!peer || !messageId) {
    return null;
  }
  return (state.messageCache.get(peer) || []).find((item) => item.id === messageId || item.tempId === messageId) || null;
}

function recallMessageById(peer, messageId) {
  const messageNode = elements.messageList?.querySelector(`[data-message-id="${messageId}"]`);
  if (messageNode) {
    messageNode.classList.add("is-recalling");
  }
  window.setTimeout(() => {
  const messages = state.messageCache.get(peer) || [];
  const target = messages.find((item) => (item.id === messageId || item.tempId === messageId) && item.mine);
  if (!target) {
    return;
  }
  target.recalled = true;
  target.text = "";
  if (target.tempId) {
    removePendingOutboxEntry(target.tempId);
    state.pendingMessages.delete(target.tempId);
  }
  const conversation = getConversation(peer);
  if (conversation && conversation.latestMessage && (conversation.latestMessage.id === target.id || conversation.latestMessage.id === target.tempId)) {
    conversation.previewText = "\u4f60\u64a4\u56de\u4e86\u4e00\u6761\u6d88\u606f";
  }
  renderSidebar();
  renderThread({ scrollBehavior: "preserve" });
  showToast("\u6d88\u606f\u5df2\u64a4\u56de");
  }, messageNode ? 180 : 0);
}

function handleListClick(event) {
  const item = event.target.closest(".list-item");
  if (!item) {
    return;
  }
  void openConversation(item.dataset.username || "");
}

function syncSearchInputs(source) {
  const value = source === "sidebar"
    ? String(elements.sidebarSearchInput?.value || "")
    : String(elements.globalSearchInput?.value || "");
  if (elements.globalSearchInput && source !== "global" && elements.globalSearchInput.value !== value) {
    elements.globalSearchInput.value = value;
  }
  if (elements.sidebarSearchInput && source !== "sidebar" && elements.sidebarSearchInput.value !== value) {
    elements.sidebarSearchInput.value = value;
  }
  return value;
}

function handleSearchInput(event) {
  const source = event?.currentTarget === elements.sidebarSearchInput ? "sidebar" : "global";
  state.searchQuery = syncSearchInputs(source);
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
  hideMessageContextMenu();
  const loadOlderButton = event.target.closest(".message-load-older-button");
  if (loadOlderButton) {
    const peer = loadOlderButton.dataset.loadOlderPeer || "";
    void loadOlderMessages(peer);
    return;
  }
  const downloadButton = event.target.closest("[data-detail-action='download']");
  if (downloadButton) {
    showToast("文件下载示例已展示，后续可接入真实附件接口");
    return;
  }
  const replyButton = event.target.closest(".message-reply-button");
  if (replyButton) {
    const messageId = replyButton.dataset.replyId || "";
    const peer = state.activePeer;
    const message = findMessageById(peer, messageId);
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

function setPeerMutedState(peer, muted) {
  if (!peer) {
    return;
  }
  updatePeerPrefs(peer, { muted: Boolean(muted) });
  sortConversations();
  render();
}

function setActiveNavSection(section) {
  state.activeNavSection = section === "contacts" ? "contacts" : "messages";
  elements.navMessagesButton?.classList.toggle("is-active", state.activeNavSection === "messages");
  elements.navContactsButton?.classList.toggle("is-active", state.activeNavSection === "contacts");
  if (state.activeNavSection === "contacts") {
    showToast("\u8054\u7cfb\u4eba\u89c6\u56fe\u5df2\u9884\u7559\uff0c\u53ef\u5148\u901a\u8fc7\u641c\u7d22\u53d1\u8d77\u4f1a\u8bdd");
  }
}

function ensurePreviewWorkspace() {
  if (state.me || state.previewMode || state.conversations.length > 0) {
    return;
  }
  state.previewMode = true;
  state.me = { ...PREVIEW_USER };
  state.connectionState = "online";
  elements.meUsername.textContent = PREVIEW_USER.username;
  setAvatar(elements.meAvatar, PREVIEW_USER.username);
  for (const item of PREVIEW_CONVERSATIONS) {
    updatePeerPrefs(item.username, { pinned: item.pinned, muted: false });
    upsertConversation({
      username: item.username,
      online: item.online,
      avatarSeed: item.username,
      previewText: item.previewText,
      lastAt: item.lastAt,
      unread: item.unread
    });
    state.messageCache.set(item.username, []);
    rebuildConversationSearchIndex(item.username);
  }
  const primaryPeer = PREVIEW_CONVERSATIONS[0]?.username || "";
  if (!primaryPeer) {
    return;
  }
  const now = Date.now();
  state.messageCache.set(primaryPeer, [
    {
      id: "preview-1",
      from: primaryPeer,
      to: PREVIEW_USER.username,
      peer: primaryPeer,
      mine: false,
      text: "\u4f60\u597d\uff0c\u4eca\u5929\u7684\u4f1a\u8bae\u8d44\u6599\u51c6\u5907\u597d\u4e86\u5417\uff1f",
      createdAt: now - 26 * 60 * 60 * 1000,
      sendStatus: "sent"
    },
    {
      id: "preview-2",
      from: PREVIEW_USER.username,
      to: primaryPeer,
      peer: primaryPeer,
      mine: true,
      text: "\u51c6\u5907\u597d\u4e86\uff0c\u7a0d\u540e\u53d1\u4f60\u3002",
      createdAt: now - 26 * 60 * 60 * 1000 + 60 * 1000,
      sendStatus: "sent"
    },
    {
      id: "preview-3",
      from: PREVIEW_USER.username,
      to: primaryPeer,
      peer: primaryPeer,
      mine: true,
      text: "\u6587\u4ef6\u5df2\u53d1\u4f60\uff0c\u8bf7\u67e5\u6536\u3002",
      createdAt: now - 10 * 60 * 1000,
      sendStatus: "sent"
    }
  ]);
  state.activePeer = primaryPeer;
  localStorage.setItem(STORAGE.activePeer, primaryPeer);
}

function focusThreadSearch() {
  if (!elements.threadSearchInput) {
    return;
  }
  elements.threadSearchInput.focus();
  elements.threadSearchInput.select();
}

function handlePresenceAction(kind) {
  if (!state.activePeer) {
    showToast("请先选择会话");
    return;
  }
  if (kind === "call") {
    showToast("语音通话功能即将提供");
    return;
  }
  if (kind === "video") {
    showToast("视频通话功能即将提供");
    return;
  }
  showToast("更多会话工具将很快提供");
}

function handleComposerActionClick(event) {
  const actionButton = event.target.closest("[data-composer-action]");
  const emojiButton = event.target.closest("[data-emoji-value]");
  if (emojiButton) {
    insertEmoji(emojiButton.dataset.emojiValue || "");
    closeEmojiPanel();
    return;
  }
  if (!actionButton) {
    return;
  }
  const action = actionButton.dataset.composerAction || "";
  if (action === "emoji") {
    toggleEmojiPanel();
    return;
  }
}

function handleDetailActionClick(event) {
  const actionButton = event.target.closest("[data-detail-action]");
  if (!actionButton) {
    return;
  }
  const action = actionButton.dataset.detailAction || "";
  if (action === "message") {
    if (isDetailsDrawerLayout()) {
      setDetailsPanelOpen(false);
    }
    elements.messageInput.focus();
    return;
  }
  if (action === "download") {
    showToast("文件下载示例已展示，后续可接入真实附件接口");
    return;
  }
  if (action === "call" || action === "video" || action === "more") {
    handlePresenceAction(action);
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
  if (event.key === "Escape" && state.emojiPanelOpen) {
    closeEmojiPanel();
    return;
  }
  if (event.key === "Escape" && state.accountMenuOpen) {
    closeAccountMenu();
    return;
  }
  if (event.key === "Escape" && state.contextMenuMessageId) {
    hideMessageContextMenu();
    return;
  }
  if (event.key === "Escape" && state.detailsPanelOpen) {
    setDetailsPanelOpen(false);
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
  elements.settingsButton?.addEventListener("click", () => {
    showToast("\u8bbe\u7f6e\u9762\u677f\u5373\u5c06\u63d0\u4f9b");
  });
  elements.accountMenuButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAccountMenu(undefined, event.currentTarget);
  });
  elements.editAccountButton?.addEventListener("click", () => {
    closeAccountMenu();
    showToast("\u8d26\u53f7\u4fe1\u606f\u7f16\u8f91\u529f\u80fd\u5373\u5c06\u63d0\u4f9b");
  });
  elements.logoutMenuButton?.addEventListener("click", () => {
    closeAccountMenu();
    void logout();
  });
  elements.sidebarProfileButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleAccountMenu(undefined, event.currentTarget);
  });
  elements.navMessagesButton?.addEventListener("click", () => setActiveNavSection("messages"));
  elements.navContactsButton?.addEventListener("click", () => setActiveNavSection("contacts"));
  elements.globalSearchInput.addEventListener("input", handleSearchInput);
  elements.sidebarSearchInput?.addEventListener("input", handleSearchInput);
  elements.emptySearchButton?.addEventListener("click", focusSidebarSearch);
  elements.sidebarSearchButton?.addEventListener("click", focusSidebarSearch);
  elements.threadSearchInput.addEventListener("input", handleThreadSearchInput);
  elements.pinnedConversationList?.addEventListener("click", handleListClick);
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
      updateScrollBottomButton();
      return;
    }
    scheduleMessageListRender();
    updateScrollBottomButton();
  }, { passive: true });
  elements.messageList.addEventListener("contextmenu", (event) => {
    const message = event.target.closest(".message");
    if (!message || message.dataset.mine !== "1") {
      hideMessageContextMenu();
      return;
    }
    event.preventDefault();
    showMessageContextMenu(message.dataset.messageId || "", event.clientX, event.clientY);
  });
  elements.pinPeerButton.addEventListener("click", () => handleThreadActionsClick("pin"));
  elements.mutePeerButton.addEventListener("click", () => handleThreadActionsClick("mute"));
  elements.exportPeerButton.addEventListener("click", () => handleThreadActionsClick("export"));
  elements.headerSearchButton?.addEventListener("click", focusThreadSearch);
  elements.headerCallButton?.addEventListener("click", () => handlePresenceAction("call"));
  elements.headerVideoButton?.addEventListener("click", () => handlePresenceAction("video"));
  elements.headerDetailsButton?.addEventListener("click", () => setDetailsPanelOpen());
  elements.detailsCloseButton?.addEventListener("click", () => setDetailsPanelOpen(false));
  elements.contactPanel?.addEventListener("click", handleDetailActionClick);
  elements.notificationsToggle?.addEventListener("change", () => {
    if (!state.activePeer) {
      return;
    }
    setPeerMutedState(state.activePeer, !elements.notificationsToggle.checked);
  });
  elements.scrollBottomButton?.addEventListener("click", () => {
    scrollMessagesToBottom(true);
    state.scrollBottomNewCount = 0;
    updateScrollBottomButton();
  });
  elements.composerForm.addEventListener("submit", (event) => {
    void submitMessage(event);
  });
  elements.composerForm.addEventListener("click", handleComposerActionClick);
  elements.messageInput.addEventListener("input", handleComposerInput);
  elements.contextCopyButton?.addEventListener("click", () => {
    const target = state.contextMenuMessageId ? elements.messageList.querySelector(`[data-message-id="${state.contextMenuMessageId}"] .message-copy-button`) : null;
    if (target) {
      void copyMessageFromButton(target);
    }
    hideMessageContextMenu();
  });
  elements.contextRecallButton?.addEventListener("click", () => {
    if (state.activePeer && state.contextMenuMessageId) {
      recallMessageById(state.activePeer, state.contextMenuMessageId);
    }
    hideMessageContextMenu();
  });
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
  window.addEventListener("resize", scheduleResponsiveRender);
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".account-menu-wrap")) {
      closeAccountMenu();
    }
    if (!event.target.closest(".composer")) {
      closeEmojiPanel();
    }
    if (!event.target.closest(".message-context-menu")) {
      hideMessageContextMenu();
    }
  });
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
  ensurePreviewWorkspace();
  bindEvents();
  render();

  if (!window.crypto?.subtle) {
    elements.authSubmitButton.disabled = true;
    elements.authTip.textContent = "当前环境缺少 Web Crypto，请使用 HTTPS 或 localhost 打开本站。";
    return;
  }
}

boot();
