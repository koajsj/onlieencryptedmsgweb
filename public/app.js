"use strict";

const STORAGE = {
  activePeer: "private-chat-active-peer",
  accountProfile: "private-chat-account-profile",
  authMode: "private-chat-auth-mode",
  contactProfiles: "private-chat-contact-profiles",
  conversationPrefs: "private-chat-conversation-prefs",
  deviceIdentities: "private-chat-device-identities",
  drafts: "private-chat-drafts",
  pendingOutbox: "private-chat-pending-outbox",
  peerSecurityMeta: "private-chat-peer-security-meta",
  peerKeyPins: "private-chat-peer-key-pins",
  sessionIdentity: "private-chat-session-identity"
};

const AVATAR_TONES = 6;
const DEVICE_VAULT_DB = "private-chat-device-vault";
const DEVICE_VAULT_STORE = "identities";
const DEVICE_VAULT_VERSION = 1;
const KEY_BUNDLE_VERSION = 1;
const KEY_BUNDLE_ITERATIONS = 210000;
const MESSAGE_KEY_INFO = "private-chat-message-key-v1";
const MESSAGE_VIRTUAL_THRESHOLD = 140;
const MESSAGE_VIRTUAL_OVERSCAN = 480;
const ATTACHMENT_MARKER = "[[echo-attachment-v1]]";
const MAX_ATTACHMENT_BYTES = 4 * 1024 * 1024;
const MAX_ATTACHMENT_BATCH_BYTES = 8 * 1024 * 1024;
const SAFE_ATTACHMENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.rar",
  "application/x-rar-compressed",
  "application/x-7z-compressed",
  "audio/mpeg",
  "video/mp4",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const SAFE_ATTACHMENT_EXTENSIONS = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "pdf",
  "txt",
  "zip",
  "rar",
  "7z",
  "mp3",
  "mp4",
  "doc",
  "docx",
  "xls",
  "xlsx"
]);
const ZIP_FAMILY_ATTACHMENT_TYPES = new Set([
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const ZIP_FAMILY_ATTACHMENT_EXTENSIONS = new Set(["zip", "docx", "xlsx"]);
const DANGEROUS_ATTACHMENT_TYPES = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "application/javascript",
  "text/javascript"
]);
const DANGEROUS_ATTACHMENT_EXTENSIONS = new Set([
  "html",
  "htm",
  "svg",
  "js",
  "mjs",
  "cjs",
  "bat",
  "cmd",
  "com",
  "exe",
  "msi",
  "ps1",
  "sh"
]);
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const { escapeHtml, formatDateTime, isElementNode, scheduleClientMetaReport } = window.EchoUi;
const LOCK_ICON_MARKUP = '<span class="inline-lock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg></span>';

const elements = {
  authScreen: document.querySelector("#authScreen"),
  workspace: document.querySelector("#workspace"),
  authHeading: document.querySelector("#authHeading"),
  authModeDescription: document.querySelector("#authModeDescription"),
  loginTab: document.querySelector("#loginTab"),
  registerTab: document.querySelector("#registerTab"),
  authForm: document.querySelector("#authForm"),
  authUsernameInput: document.querySelector("#authUsernameInput"),
  authPasswordInput: document.querySelector("#authPasswordInput"),
  passwordVisibilityButton: document.querySelector("#passwordVisibilityButton"),
  authSubmitButton: document.querySelector("#authSubmitButton"),
  authTip: document.querySelector("#authTip"),
  emptySearchButton: document.querySelector("#emptySearchButton"),
  sidebarSearchButton: document.querySelector("#sidebarSearchButton"),
  sidebarSearchInput: document.querySelector("#sidebarSearchInput"),
  globalSearchInput: document.querySelector("#globalSearchInput"),
  settingsButton: document.querySelector("#settingsButton"),
  notificationBellButton: document.querySelector("#notificationBellButton"),
  notificationPanel: document.querySelector("#notificationPanel"),
  navMessagesButton: document.querySelector("#navMessagesButton"),
  navContactsButton: document.querySelector("#navContactsButton"),
  accountMenuButton: document.querySelector("#accountMenuButton"),
  accountMenu: document.querySelector("#accountMenu"),
  editAccountButton: document.querySelector("#editAccountButton"),
  logoutMenuButton: document.querySelector("#logoutMenuButton"),
  meAvatar: document.querySelector("#meAvatar"),
  meUsername: document.querySelector("#meUsername"),
  logoutButton: document.querySelector("#logoutButton"),
  meStatus: document.querySelector("#meStatus"),
  meStatusDot: document.querySelector("#meStatusDot"),
  sidebarTitle: document.querySelector(".sidebar-head h2"),
  sidebarEyebrow: document.querySelector(".sidebar-head .eyebrow"),
  sidebarMeta: document.querySelector("#sidebarMeta"),
  addContactButton: document.querySelector("#addContactButton"),
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
  attachmentInput: document.querySelector("#attachmentInput"),
  attachmentTransferList: document.querySelector("#attachmentTransferList"),
  emojiPanel: document.querySelector("#emojiPanel"),
  toast: document.querySelector("#toast"),
  messageContextMenu: document.querySelector("#messageContextMenu"),
  contextReplyButton: document.querySelector("#contextReplyButton"),
  contextCopyButton: document.querySelector("#contextCopyButton"),
  contextRecallButton: document.querySelector("#contextRecallButton"),
  contextDeleteButton: document.querySelector("#contextDeleteButton"),
  contactPanel: document.querySelector("#contactPanel"),
  editContactButton: document.querySelector("#editContactButton"),
  detailsCollapseButton: document.querySelector("#detailsCollapseButton"),
  detailsCloseButton: document.querySelector("#detailsCloseButton"),
  contactDetailsEmpty: document.querySelector("#contactDetailsEmpty"),
  contactDetailsContent: document.querySelector("#contactDetailsContent"),
  detailsAvatar: document.querySelector("#detailsAvatar"),
  detailsName: document.querySelector("#detailsName"),
  detailsStatus: document.querySelector("#detailsStatus"),
  detailsStatusDot: document.querySelector("#detailsStatusDot"),
  detailsRole: document.querySelector("#detailsRole"),
  detailsNote: document.querySelector("#detailsNote"),
  detailsAccountId: document.querySelector("#detailsAccountId"),
  detailsLastSeen: document.querySelector("#detailsLastSeen"),
  detailsSafetyCode: document.querySelector("#detailsSafetyCode"),
  detailsVerifyCodeButton: document.querySelector("#detailsVerifyCodeButton"),
  detailsTrustKeyButton: document.querySelector("#detailsTrustKeyButton"),
  detailsAbout: document.querySelector("#detailsAbout"),
  notificationsToggle: document.querySelector("#notificationsToggle"),
  copyContactIdButton: document.querySelector("#copyContactIdButton"),
  deleteContactButton: document.querySelector("#deleteContactButton"),
  blockContactButton: document.querySelector("#blockContactButton"),
  blockContactButtonLabel: document.querySelector("#blockContactButtonLabel"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsDialogCloseButton: document.querySelector("#settingsDialogCloseButton"),
  settingsDialogTabs: document.querySelector("#settingsDialogTabs"),
  accountSettingsTab: document.querySelector("#accountSettingsTab"),
  accountSettingsForm: document.querySelector("#accountSettingsForm"),
  accountUsernameInput: document.querySelector("#accountUsernameInput"),
  accountDisplayNameInput: document.querySelector("#accountDisplayNameInput"),
  accountStatusInput: document.querySelector("#accountStatusInput"),
  accountAboutInput: document.querySelector("#accountAboutInput"),
  presenceVisibleToggle: document.querySelector("#presenceVisibleToggle"),
  allowSearchToggle: document.querySelector("#allowSearchToggle"),
  deviceSessionsList: document.querySelector("#deviceSessionsList"),
  blockedUsersList: document.querySelector("#blockedUsersList"),
  settingsResetButton: document.querySelector("#settingsResetButton"),
  settingsSaveButton: document.querySelector("#settingsSaveButton")
};

const state = {
  authenticated: false,
  me: null,
  identity: null,
  csrfToken: "",
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
  peerKeyPins: {},
  peerObservedKeys: new Map(),
  peerKeyMismatches: new Set(),
  peerKeyUnverified: new Set(),
  importedPeerKeys: new Map(),
  conversationKeys: new Map(),
  previewCache: new Map(),
  conversationSearchIndex: new Map(),
  pendingMessages: new Map(),
  pendingOutbox: [],
  outboundInFlight: new Set(),
  messagePageState: new Map(),
  pendingSequence: 0,
  eventSource: null,
  reconnectTimer: 0,
  reconnectAttempts: 0,
  manualEventSourceClose: false,
  realtimeTakeoverPaused: false,
  connectionState: "offline",
  accountProfile: {},
  contactProfiles: {},
  contacts: [],
  deviceSessions: [],
  peerSecurityMeta: {},
  securitySettings: {
    showOnlineStatus: true,
    allowUserSearch: true,
    blockedUsers: []
  },
  attachmentTransfers: [],
  outboxFlushing: false,
  searchTimer: 0,
  searchRequestId: 0,
  messageListRenderRaf: 0,
  resizeRenderRaf: 0,
  toastTimer: 0,
  longPressTimer: 0,
  longPressTouchX: 0,
  longPressTouchY: 0,
  openConversationRequest: 0,
  conversationPrefs: {},
  drafts: {},
  submitInFlight: false,
  scrollBottomNewCount: 0,
  scrollBottomHideTimer: 0,
  detailsPanelOpen: false,
  detailsPanelCollapsed: false,
  appViewportHeight: 0,
  activeNavSection: "messages",
  emojiPanelOpen: false,
  emojiPanelAnchor: null,
  notificationPanelOpen: false,
  notificationPanelAnchor: null,
  accountMenuOpen: false,
  accountMenuAnchor: null,
  settingsDialogOpen: false,
  settingsDialogSection: "account",
  settingsDialogReturnFocus: null,
  contextMenuMessageId: "",
  contextMenuX: 0,
  contextMenuY: 0,
  previewMode: false,
  workspaceLoading: false,
  typingPeer: "",
  typingHideTimer: 0,
  typingSentAt: 0,
  typingSelfPeer: "",
  typingStopTimer: 0
};

for (const floatingSurface of [
  elements.accountMenu,
  elements.emojiPanel,
  elements.messageContextMenu,
  elements.notificationPanel
]) {
  if (floatingSurface && floatingSurface.parentElement !== document.body) {
    document.body.append(floatingSurface);
  }
}

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

function readJsonSessionStorage(key, fallback) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) {
      return fallback;
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch (error) {
    return fallback;
  }
}

function writeJsonSessionStorage(key, value) {
  sessionStorage.setItem(key, JSON.stringify(value));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("本地安全存储不可用"));
  });
}

function transactionToPromise(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error("本地安全存储不可用"));
    transaction.onerror = () => reject(transaction.error || new Error("本地安全存储不可用"));
  });
}

let deviceVaultPromise = null;

function openDeviceVault() {
  if (deviceVaultPromise) {
    return deviceVaultPromise;
  }
  deviceVaultPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("当前浏览器不支持安全本地密钥存储，请使用新版浏览器"));
      return;
    }
    const request = window.indexedDB.open(DEVICE_VAULT_DB, DEVICE_VAULT_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DEVICE_VAULT_STORE)) {
        db.createObjectStore(DEVICE_VAULT_STORE, { keyPath: "username" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("无法打开本地安全存储"));
  }).catch((error) => {
    deviceVaultPromise = null;
    throw error;
  });
  return deviceVaultPromise;
}

async function readDeviceVaultRecord(username) {
  if (!username) {
    return null;
  }
  const db = await openDeviceVault();
  const transaction = db.transaction(DEVICE_VAULT_STORE, "readonly");
  const request = transaction.objectStore(DEVICE_VAULT_STORE).get(username);
  const result = await requestToPromise(request);
  await transactionToPromise(transaction);
  return result && typeof result === "object" ? result : null;
}

async function writeDeviceVaultRecord(record) {
  const db = await openDeviceVault();
  const transaction = db.transaction(DEVICE_VAULT_STORE, "readwrite");
  transaction.objectStore(DEVICE_VAULT_STORE).put(record);
  await transactionToPromise(transaction);
}

async function renameDeviceVaultRecord(previousUsername, nextUsername) {
  if (!previousUsername || !nextUsername || previousUsername === nextUsername) {
    return;
  }
  const db = await openDeviceVault();
  const transaction = db.transaction(DEVICE_VAULT_STORE, "readwrite");
  const store = transaction.objectStore(DEVICE_VAULT_STORE);
  const current = await requestToPromise(store.get(previousUsername));
  if (current && typeof current === "object") {
    store.put({
      ...current,
      username: nextUsername
    });
    store.delete(previousUsername);
  }
  await transactionToPromise(transaction);
}

function clearLegacySessionToken() {
  try {
    sessionStorage.removeItem("private-chat-session-token");
  } catch (error) {
    // Ignore storage failures. Authentication uses the HttpOnly cookie only.
  }
}

function normalizeAccountProfile(profile) {
  return {
    displayName: String(profile?.displayName || "").trim().slice(0, 32),
    statusText: String(profile?.statusText || "").trim().slice(0, 48),
    about: String(profile?.about || "").trim().slice(0, 240),
    avatarTone: Number.isFinite(Number(profile?.avatarTone)) ? Math.max(0, Math.min(5, Number(profile.avatarTone))) : 0
  };
}

function normalizeContactProfile(profile) {
  return {
    displayName: String(profile?.displayName || "").trim().slice(0, 32),
    role: String(profile?.role || "").trim().slice(0, 48),
    about: String(profile?.about || "").trim().slice(0, 240)
  };
}

function normalizePeerSecurityMeta(meta) {
  return {
    firstTrustedAt: Number.parseInt(String(meta?.firstTrustedAt || "0"), 10) || 0,
    lastVerifiedAt: Number.parseInt(String(meta?.lastVerifiedAt || "0"), 10) || 0,
    lastKeyChangeAt: Number.parseInt(String(meta?.lastKeyChangeAt || "0"), 10) || 0,
    pinnedKey: String(meta?.pinnedKey || ""),
    observedKey: String(meta?.observedKey || "")
  };
}

function currentStorageOwner() {
  return String(state.me?.username || "");
}

function readScopedStorageRecord(key, owner) {
  const store = readJsonStorage(key, {});
  const scoped = owner && store && typeof store === "object" ? store[owner] : {};
  return scoped && typeof scoped === "object" ? scoped : {};
}

function writeScopedStorageRecord(key, owner, value) {
  if (!owner) {
    return;
  }
  const storedValue = readJsonStorage(key, {});
  const store = Array.isArray(storedValue) ? {} : storedValue;
  store[owner] = value;
  writeJsonStorage(key, store);
}

function deleteScopedStorageRecord(key, owner) {
  if (!owner) {
    return;
  }
  const store = readJsonStorage(key, {});
  if (!store || typeof store !== "object" || !Object.prototype.hasOwnProperty.call(store, owner)) {
    return;
  }
  delete store[owner];
  writeJsonStorage(key, store);
}

function renameScopedStorageOwner(key, previousOwner, nextOwner) {
  if (!previousOwner || !nextOwner || previousOwner === nextOwner) {
    return;
  }
  const store = readJsonStorage(key, {});
  if (!store || typeof store !== "object" || !store[previousOwner]) {
    return;
  }
  store[nextOwner] = store[previousOwner];
  delete store[previousOwner];
  writeJsonStorage(key, store);
}

function loadEditableProfiles() {
  const owner = currentStorageOwner();
  state.accountProfile = normalizeAccountProfile(readScopedStorageRecord(STORAGE.accountProfile, owner));
  const rawContacts = readScopedStorageRecord(STORAGE.contactProfiles, owner);
  const normalized = {};
  for (const [username, profile] of Object.entries(rawContacts)) {
    if (!username) {
      continue;
    }
    normalized[username] = normalizeContactProfile(profile);
  }
  state.contactProfiles = normalized;
}

function loadPeerSecurityMeta() {
  const owner = currentStorageOwner();
  const raw = readScopedStorageRecord(STORAGE.peerSecurityMeta, owner);
  const normalized = {};
  for (const [username, meta] of Object.entries(raw)) {
    if (!username) {
      continue;
    }
    normalized[username] = normalizePeerSecurityMeta(meta);
  }
  state.peerSecurityMeta = normalized;
}

function saveAccountProfile() {
  writeScopedStorageRecord(STORAGE.accountProfile, currentStorageOwner(), state.accountProfile);
}

function saveContactProfiles() {
  writeScopedStorageRecord(STORAGE.contactProfiles, currentStorageOwner(), state.contactProfiles);
}

function savePeerSecurityMeta() {
  writeScopedStorageRecord(STORAGE.peerSecurityMeta, currentStorageOwner(), state.peerSecurityMeta);
}

function accountDisplayName() {
  return state.accountProfile.displayName || state.me?.username || "Echo";
}

function accountStatusText() {
  return state.accountProfile.statusText || "";
}

function activeContactProfile(username) {
  return normalizeContactProfile(state.contactProfiles[username]);
}

function contactRecord(username) {
  return state.contacts.find((item) => item.username === username) || null;
}

function contactDisplayName(username) {
  return contactRecord(username)?.note || activeContactProfile(username).displayName || String(username || "");
}

function contactRoleLabel(username) {
  return activeContactProfile(username).role || `账号 ID · @${String(username || "")}`;
}

function contactAboutText(username) {
  return activeContactProfile(username).about || "暂无简介，可在设置面板中自定义。";
}

function formatLastSeen(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) {
    return "暂不可见";
  }
  const diff = Date.now() - value;
  if (diff < 60 * 1000) {
    return "刚刚在线";
  }
  if (diff < 60 * 60 * 1000) {
    return `${Math.max(1, Math.floor(diff / 60000))} 分钟前`;
  }
  if (diff < 24 * 60 * 60 * 1000) {
    return formatTime(value);
  }
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
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
  if (!node) {
    return;
  }
  node.className = `avatar avatar-tone-${avatarTone(username)}`;
  node.textContent = avatarInitial(username);
}

function isDetailsDrawerLayout() {
  return window.innerWidth < 1280;
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

function addNotification(from, text, timestamp) {
  const list = document.querySelector("#notificationList");
  if (!list) return;
  const emptyEl = list.querySelector(".notification-empty");
  if (emptyEl) emptyEl.remove();
  const item = document.createElement("div");
  item.className = "notification-item";
  item.dataset.peer = from;
  const tone = avatarTone(from);
  const avatar = document.createElement("div");
  avatar.className = `avatar avatar-tone-${tone}`;
  avatar.textContent = avatarInitial(from);
  const copy = document.createElement("div");
  copy.className = "notification-item-copy";
  const strong = document.createElement("strong");
  strong.textContent = contactDisplayName(from);
  const preview = document.createElement("span");
  preview.textContent = String(text || "").slice(0, 60);
  const time = document.createElement("small");
  time.textContent = formatTime(timestamp || Date.now());
  copy.append(strong, preview, time);
  item.append(avatar, copy);
  item.addEventListener("click", () => {
    closeNotificationPanel();
    void openConversation(from);
  });
  list.prepend(item);
  while (list.children.length > 50) {
    list.lastElementChild?.remove();
  }
}

function updateNotificationBadge() {
  const badge = document.querySelector("#notificationBadge");
  if (!badge) return;
  let total = 0;
  for (const conv of state.conversations) {
    total += conv.unread || 0;
  }
  if (total > 0) {
    badge.textContent = total > 99 ? "99+" : String(total);
    badge.hidden = false;
  } else {
    badge.hidden = true;
  }
  document.title = total > 0 ? `(${total > 99 ? "99+" : total}) Echo` : "Echo";
}

function setAccountMenuExpanded(expanded) {
  const value = expanded ? "true" : "false";
  elements.accountMenuButton?.setAttribute("aria-expanded", value);
}

function isAccountMenuEventTarget(target) {
  if (!isElementNode(target)) {
    return false;
  }
  return Boolean(
    target.closest(".account-menu-wrap") ||
    target.closest("#accountMenu")
  );
}

function isNotificationPanelEventTarget(target) {
  if (!isElementNode(target)) {
    return false;
  }
  return Boolean(
    target.closest("#notificationBellButton") ||
    target.closest("#notificationPanel")
  );
}

function isEmojiPanelEventTarget(target) {
  if (!isElementNode(target)) {
    return false;
  }
  return Boolean(
    target.closest("[data-composer-action='emoji']") ||
    target.closest("#emojiPanel")
  );
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

function positionFloatingMenuAtPoint(menu, x, y) {
  if (!menu) {
    return;
  }
  const viewportGap = 12;
  const width = menu.offsetWidth || 188;
  const height = menu.offsetHeight || 120;
  const left = Math.max(viewportGap, Math.min(Number(x || 0), window.innerWidth - width - viewportGap));
  const top = Math.max(viewportGap, Math.min(Number(y || 0), window.innerHeight - height - viewportGap));
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

function closeNotificationPanel() {
  state.notificationPanelOpen = false;
  state.notificationPanelAnchor = null;
  if (elements.notificationPanel) {
    elements.notificationPanel.hidden = true;
    elements.notificationPanel.style.removeProperty("left");
    elements.notificationPanel.style.removeProperty("top");
    elements.notificationPanel.style.removeProperty("right");
  }
}

function toggleNotificationPanel(force, anchor = elements.notificationBellButton) {
  state.notificationPanelOpen = typeof force === "boolean" ? force : !state.notificationPanelOpen;
  state.notificationPanelAnchor = state.notificationPanelOpen ? (anchor || elements.notificationBellButton) : null;
  if (state.notificationPanelOpen) {
    closeAccountMenu();
    closeEmojiPanel();
    hideMessageContextMenu();
  }
  if (elements.notificationPanel) {
    elements.notificationPanel.hidden = !state.notificationPanelOpen;
    if (state.notificationPanelOpen && state.notificationPanelAnchor) {
      positionFloatingMenu(elements.notificationPanel, state.notificationPanelAnchor);
      elements.notificationPanel.style.removeProperty("right");
    }
  }
}

function toggleAccountMenu(force, anchor = elements.accountMenuButton) {
  state.accountMenuOpen = typeof force === "boolean" ? force : !state.accountMenuOpen;
  state.accountMenuAnchor = state.accountMenuOpen ? (anchor || elements.accountMenuButton) : null;
  if (state.accountMenuOpen) {
    closeNotificationPanel();
    closeEmojiPanel();
  }
  setAccountMenuExpanded(state.accountMenuOpen);
  if (elements.accountMenu) {
    elements.accountMenu.hidden = !state.accountMenuOpen;
    if (state.accountMenuOpen && state.accountMenuAnchor) {
      positionFloatingMenu(elements.accountMenu, state.accountMenuAnchor);
    }
  }
}

function setSettingsDialogSection(section) {
  const nextSection = section === "security" ? "security" : section === "other" ? "other" : "account";
  state.settingsDialogSection = nextSection;
  const settingsTabs = [
    [elements.accountSettingsTab, "account"],
    [document.querySelector("#securitySettingsTab"), "security"],
    [document.querySelector("#otherSettingsTab"), "other"]
  ];
  for (const [tab, key] of settingsTabs) {
    if (!tab) continue;
    const active = nextSection === key;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
  if (elements.accountSettingsForm) {
    elements.accountSettingsForm.hidden = nextSection !== "account";
  }
  const securityForm = document.querySelector("#securitySettingsForm");
  if (securityForm) securityForm.hidden = nextSection !== "security";
  const otherForm = document.querySelector("#otherSettingsForm");
  if (otherForm) otherForm.hidden = nextSection !== "other";
  if (elements.settingsSaveButton) {
    elements.settingsSaveButton.hidden = nextSection !== "account";
  }
  if (elements.settingsResetButton) {
    elements.settingsResetButton.hidden = nextSection === "other";
  }
  if ((nextSection === "security" || nextSection === "other") && state.authenticated) {
    void refreshSecuritySettingsPanel().catch(() => {});
  }
}

function populateSettingsDialog() {
  const accountProfile = normalizeAccountProfile(state.accountProfile);
  if (elements.accountUsernameInput) {
    elements.accountUsernameInput.value = state.me?.username || "";
  }
  if (elements.accountDisplayNameInput) {
    elements.accountDisplayNameInput.value = accountProfile.displayName;
  }
  if (elements.accountStatusInput) {
    elements.accountStatusInput.value = accountProfile.statusText;
  }
  if (elements.accountAboutInput) {
    elements.accountAboutInput.value = accountProfile.about;
  }
  const avatarPicker = document.querySelector("#avatarPicker");
  if (avatarPicker) {
    const currentTone = state.accountProfile?.avatarTone ?? 0;
    for (const btn of avatarPicker.querySelectorAll(".avatar-pick")) {
      const tone = Number(btn.dataset.avatarTone || 0);
      btn.classList.toggle("is-selected", tone === currentTone);
      const initial = avatarInitial(state.me?.username || "我");
      btn.textContent = initial;
    }
  }
  const currentPw = document.querySelector("#currentPasswordInput");
  const newPw = document.querySelector("#newPasswordInput");
  const confirmPw = document.querySelector("#confirmPasswordInput");
  const passwordUsername = document.querySelector("#accountPasswordUsernameInput");
  if (passwordUsername) passwordUsername.value = state.me?.username || "";
  if (currentPw) currentPw.value = "";
  if (newPw) newPw.value = "";
  if (confirmPw) confirmPw.value = "";
}

function openSettingsDialog(section = "account") {
  const nextSection = section === "security" ? "security" : "account";
  state.settingsDialogReturnFocus = isElementNode(document.activeElement) ? document.activeElement : null;
  state.settingsDialogOpen = true;
  if (elements.settingsDialog) {
    elements.settingsDialog.hidden = false;
  }
  setSettingsDialogSection(nextSection);
  populateSettingsDialog();
  syncLayoutState();
  window.requestAnimationFrame(() => elements.settingsDialogCloseButton?.focus());
}

function closeSettingsDialog() {
  const returnFocus = state.settingsDialogReturnFocus;
  state.settingsDialogReturnFocus = null;
  state.settingsDialogOpen = false;
  if (elements.settingsDialog) {
    elements.settingsDialog.hidden = true;
  }
  syncLayoutState();
  if (returnFocus?.isConnected) {
    returnFocus.focus();
  }
}

function trapSettingsDialogFocus(event) {
  if (event.key !== "Tab" || !elements.settingsDialog) {
    return;
  }
  const focusable = [...elements.settingsDialog.querySelectorAll(
    "button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex='-1'])"
  )].filter((element) => !element.hidden && element.offsetParent !== null);
  if (focusable.length === 0) {
    event.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function closeEmojiPanel() {
  state.emojiPanelOpen = false;
  state.emojiPanelAnchor = null;
  if (elements.emojiPanel) {
    elements.emojiPanel.hidden = true;
    elements.emojiPanel.style.removeProperty("left");
    elements.emojiPanel.style.removeProperty("top");
  }
}

function toggleEmojiPanel(force, anchor = document.querySelector("[data-composer-action='emoji']")) {
  state.emojiPanelOpen = typeof force === "boolean" ? force : !state.emojiPanelOpen;
  state.emojiPanelAnchor = state.emojiPanelOpen ? anchor : null;
  if (state.emojiPanelOpen) {
    closeAccountMenu();
    closeNotificationPanel();
  }
  if (elements.emojiPanel) {
    elements.emojiPanel.hidden = !state.emojiPanelOpen;
    if (state.emojiPanelOpen && state.emojiPanelAnchor) {
      positionFloatingMenu(elements.emojiPanel, state.emojiPanelAnchor);
    }
  }
}

function hideMessageContextMenu() {
  state.contextMenuMessageId = "";
  state.contextMenuX = 0;
  state.contextMenuY = 0;
  if (elements.messageContextMenu) {
    elements.messageContextMenu.hidden = true;
    elements.messageContextMenu.style.removeProperty("left");
    elements.messageContextMenu.style.removeProperty("top");
  }
}

function setContextMenuButtonState(button, enabled, hidden = false) {
  if (!button) {
    return;
  }
  button.hidden = hidden;
  button.disabled = !enabled;
}

function showMessageContextMenu(messageId, x, y) {
  if (!elements.messageContextMenu || !messageId) {
    return;
  }
  const message = findMessageById(state.activePeer, messageId);
  const hasText = Boolean(messagePlaintext(message).trim());
  const canReply = Boolean(message && !message.recalled && message.id);
  const canRecall = Boolean(message?.mine && !message?.pending && !message?.failed && !message?.recalled && message?.id);
  const canDelete = Boolean(message && (message.id || message.tempId));
  setContextMenuButtonState(elements.contextReplyButton, canReply);
  setContextMenuButtonState(elements.contextCopyButton, hasText);
  setContextMenuButtonState(elements.contextRecallButton, canRecall, !message?.mine);
  setContextMenuButtonState(elements.contextDeleteButton, canDelete);
  state.contextMenuMessageId = messageId;
  state.contextMenuX = x;
  state.contextMenuY = y;
  elements.messageContextMenu.hidden = false;
  positionFloatingMenuAtPoint(elements.messageContextMenu, x, y);
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

function fileKindLabel(file) {
  if (!file) {
    return "文件";
  }
  if (String(file.type || "").startsWith("image/")) {
    return "图片";
  }
  if (String(file.type || "").startsWith("video/")) {
    return "视频";
  }
  if (String(file.type || "").startsWith("audio/")) {
    return "音频";
  }
  return "文件";
}

function formatBytes(bytes) {
  const size = Number(bytes || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? Math.round(value) : value.toFixed(1)} ${units[unitIndex]}`;
}

function sanitizeAttachmentName(value) {
  return String(value || "未命名文件").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim().slice(0, 80) || "未命名文件";
}

function base64DecodedByteLength(value) {
  const encoded = String(value || "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
    return -1;
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return (encoded.length / 4) * 3 - padding;
}

function parseAttachmentMessage(text) {
  const value = String(text || "");
  if (!value.startsWith(ATTACHMENT_MARKER)) {
    return null;
  }
  try {
    const payload = JSON.parse(value.slice(ATTACHMENT_MARKER.length));
    const name = sanitizeAttachmentName(payload?.name);
    const ext = attachmentExtension(name);
    const type = String(payload?.type || "application/octet-stream").toLowerCase().slice(0, 100);
    const size = Number(payload?.size || 0);
    const data = String(payload?.data || "");
    if (
      !Number.isInteger(size) ||
      size <= 0 ||
      size > MAX_ATTACHMENT_BYTES ||
      DANGEROUS_ATTACHMENT_TYPES.has(type) ||
      DANGEROUS_ATTACHMENT_EXTENSIONS.has(ext) ||
      !isAllowedAttachmentType(type, ext)
    ) {
      return null;
    }
    const decodedSize = base64DecodedByteLength(data);
    if (decodedSize !== size) {
      return null;
    }
    return {
      name,
      type,
      size,
      data,
      isImage: ["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)
    };
  } catch (error) {
    return null;
  }
}

function attachmentExtension(name) {
  const value = String(name || "");
  const index = value.lastIndexOf(".");
  return index >= 0 ? value.slice(index + 1).trim().toLowerCase() : "";
}

function isAllowedAttachmentType(type, ext) {
  return SAFE_ATTACHMENT_TYPES.has(type) || SAFE_ATTACHMENT_EXTENSIONS.has(ext);
}

function attachmentMagicMatches(type, ext, magicType) {
  if (!magicType) {
    return true;
  }
  if (magicType === "application/zip") {
    return ZIP_FAMILY_ATTACHMENT_TYPES.has(type) || ZIP_FAMILY_ATTACHMENT_EXTENSIONS.has(ext);
  }
  return !type || type === magicType;
}

function detectAttachmentMagic(bytes) {
  if (!bytes || bytes.length < 4) {
    return "";
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return "image/gif";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
    return "application/pdf";
  }
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    return "application/zip";
  }
  return "";
}

async function validateAttachmentFile(file) {
  const type = String(file?.type || "").trim().toLowerCase();
  const ext = attachmentExtension(file?.name || "");
  if (DANGEROUS_ATTACHMENT_TYPES.has(type) || DANGEROUS_ATTACHMENT_EXTENSIONS.has(ext)) {
    throw new Error("为避免脚本或可执行文件传播，禁止发送该附件类型");
  }
  if (!isAllowedAttachmentType(type, ext)) {
    throw new Error("当前仅允许发送常见图片、文档、压缩包、音频和视频附件");
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magicType = detectAttachmentMagic(bytes);
  if (!attachmentMagicMatches(type, ext, magicType)) {
    throw new Error("附件类型与文件头不匹配，已拒绝发送");
  }
  return bytes;
}

function renderAttachmentTransfers() {
  if (!elements.attachmentTransferList) {
    return;
  }
  elements.attachmentTransferList.textContent = "";
  const visibleTransfers = state.attachmentTransfers.slice(-3);
  for (const transfer of visibleTransfers) {
    const row = document.createElement("div");
    row.className = `attachment-transfer is-${transfer.stage}`;
    const copy = document.createElement("div");
    copy.className = "attachment-transfer-copy";
    const strong = document.createElement("strong");
    strong.textContent = transfer.name;
    const note = document.createElement("span");
    note.textContent = transfer.note || formatBytes(transfer.size || 0);
    copy.append(strong, note);
    const status = document.createElement("span");
    status.className = "attachment-transfer-state";
    status.textContent = transfer.label;
    row.append(copy, status);
    elements.attachmentTransferList.append(row);
  }
  elements.attachmentTransferList.hidden = visibleTransfers.length === 0;
}

function upsertAttachmentTransfer(transferId, patch) {
  const index = state.attachmentTransfers.findIndex((item) => item.id === transferId);
  const existing = index >= 0 ? state.attachmentTransfers[index] : { id: transferId };
  const next = {
    ...existing,
    ...patch
  };
  if (index >= 0) {
    state.attachmentTransfers[index] = next;
  } else {
    state.attachmentTransfers.push(next);
  }
  renderAttachmentTransfers();
}

function finishAttachmentTransfer(transferId, success = true) {
  renderAttachmentTransfers();
  window.setTimeout(() => {
    state.attachmentTransfers = state.attachmentTransfers.filter((item) => item.id !== transferId);
    renderAttachmentTransfers();
  }, success ? 2400 : 4200);
}

function setAttachmentTransferForTempId(tempId, stage, note = "") {
  const transfer = state.attachmentTransfers.find((item) => item.tempId === tempId);
  if (!transfer) {
    return;
  }
  const labels = {
    encrypting: "加密中",
    sending: "发送中",
    done: "已发送",
    failed: "发送失败"
  };
  upsertAttachmentTransfer(transfer.id, {
    stage,
    label: labels[stage] || transfer.label || "处理中",
    note: note || transfer.note
  });
  if (stage === "done" || stage === "failed") {
    finishAttachmentTransfer(transfer.id, stage === "done");
  }
}
async function buildAttachmentMessageText(file, validatedBytes = null) {
  const bytes = validatedBytes instanceof Uint8Array
    ? validatedBytes
    : new Uint8Array(await file.arrayBuffer());
  return `${ATTACHMENT_MARKER}${JSON.stringify({
    name: sanitizeAttachmentName(file.name),
    type: String(file.type || "application/octet-stream").toLowerCase().slice(0, 100),
    size: bytes.byteLength,
    data: bytesToBase64(bytes)
  })}`;
}

async function sendAttachmentFiles(fileList) {
  if (!state.activePeer) {
    return;
  }
  if (state.peerKeyMismatches.has(state.activePeer)) {
    showToast("联系人密钥已变化，请先在联系人详情中确认", "error");
    return;
  }
  if (state.peerKeyUnverified.has(state.activePeer)) {
    showToast("请先在联系人详情中核对安全码并信任该密钥", "error");
    return;
  }
  if (state.connectionState !== "online") {
    showToast("附件需联网发送，避免大文件占满本地存储", "error");
    return;
  }
  const contact = contactRecord(state.activePeer);
  if (contact?.blocked || contact?.blockedByPeer) {
    showToast(contact.blocked ? "您已拉黑对方，解除后才能继续互动" : "对方已将您拉黑，暂时无法发送消息", "error");
    return;
  }
  const files = Array.from(fileList || []).filter(Boolean).slice(0, 3);
  const totalBytes = files.reduce((sum, file) => sum + Math.max(0, Number(file?.size || 0)), 0);
  if (totalBytes > MAX_ATTACHMENT_BATCH_BYTES) {
    showToast("单次最多发送 8MB 附件，请分批发送", "error");
    return;
  }
  const batchReplyTarget = state.replyTarget ? { ...state.replyTarget } : null;
  for (const file of files) {
    const transferId = crypto.randomUUID();
    upsertAttachmentTransfer(transferId, {
      id: transferId,
      name: sanitizeAttachmentName(file.name),
      size: Number(file.size || 0),
      stage: "validating",
      label: "校验中",
      note: "检查文件类型与大小"
    });
    if (file.size > MAX_ATTACHMENT_BYTES) {
      upsertAttachmentTransfer(transferId, {
        stage: "failed",
        label: "发送失败",
        note: "超过 4MB，已拒绝发送"
      });
      finishAttachmentTransfer(transferId, false);
      showToast(`${file.name} 超过 4MB，未发送`, "error");
      continue;
    }
    try {
      const bytes = await validateAttachmentFile(file);
      upsertAttachmentTransfer(transferId, {
        stage: "encrypting",
        label: "加密中",
        note: "正在生成端到端密文"
      });
      const text = await buildAttachmentMessageText(file, bytes);
      const replyTo = batchReplyTarget ? { ...batchReplyTarget } : null;
      const tempId = addPendingMessage(state.activePeer, text, replyTo);
      upsertAttachmentTransfer(transferId, {
        tempId,
        stage: "sending",
        label: "发送中",
        note: "正在上传密文附件"
      });
      renderSidebar();
      renderThread({ scrollBehavior: "bottom" });
      await sendMessageWithRetry(tempId, state.activePeer, text, tempId, false, replyTo?.id || "");
    } catch (error) {
      upsertAttachmentTransfer(transferId, {
        stage: "failed",
        label: "发送失败",
        note: error?.message || "读取或发送失败"
      });
      finishAttachmentTransfer(transferId, false);
      showToast(error?.message || `${file.name} 读取或发送失败`, "error");
    }
  }
  if (elements.attachmentInput) {
    elements.attachmentInput.value = "";
  }
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
    if (elements.meUsername) {
      elements.meUsername.textContent = "未登录";
    }
    elements.meStatus.textContent = "\u7b49\u5f85\u767b\u5f55";
    updateMeStatusDot("offline");
    return;
  }
  const displayName = accountDisplayName();
  const profileStatus = accountStatusText();
  const pendingCount = state.pendingOutbox.length;
  const pendingSuffix = pendingCount > 0 ? ` \u00b7 \u5f85\u53d1\u9001 ${pendingCount}` : "";
  if (elements.meUsername) {
    elements.meUsername.textContent = displayName;
  }
  elements.meStatus.textContent = `${profileStatus || connectionStatusLabel()} \u00b7 \u5df2\u52a0\u5bc6${pendingSuffix}`;
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

function sendTypingState(peer, typing) {
  if (!peer || state.previewMode || state.connectionState !== "online") {
    return;
  }
  void api("/api/messages/typing", { method: "POST", body: { to: peer, typing: Boolean(typing) } }).catch(() => {});
}

// Throttle "正在输入" pings to once per 3s and auto-send a stop after a 4s idle gap.
function notifyTypingActivity() {
  const peer = state.activePeer;
  if (!peer) {
    return;
  }
  const now = Date.now();
  if (state.typingSelfPeer !== peer || now - state.typingSentAt > 3000) {
    state.typingSelfPeer = peer;
    state.typingSentAt = now;
    sendTypingState(peer, true);
  }
  if (state.typingStopTimer) {
    window.clearTimeout(state.typingStopTimer);
  }
  state.typingStopTimer = window.setTimeout(stopTypingSignal, 4000);
}

function stopTypingSignal() {
  if (state.typingStopTimer) {
    window.clearTimeout(state.typingStopTimer);
    state.typingStopTimer = 0;
  }
  const peer = state.typingSelfPeer;
  state.typingSelfPeer = "";
  state.typingSentAt = 0;
  if (peer) {
    sendTypingState(peer, false);
  }
}

function clearIncomingTyping() {
  if (state.typingHideTimer) {
    window.clearTimeout(state.typingHideTimer);
    state.typingHideTimer = 0;
  }
  if (state.typingPeer) {
    state.typingPeer = "";
    updateTypingIndicator(false);
  }
}

function handleIncomingTyping(payload) {
  const peer = String(payload?.peer || "");
  if (!peer || peer !== state.activePeer) {
    return;
  }
  if (state.typingHideTimer) {
    window.clearTimeout(state.typingHideTimer);
    state.typingHideTimer = 0;
  }
  if (payload.typing) {
    state.typingPeer = peer;
    updateTypingIndicator(true, peer);
    state.typingHideTimer = window.setTimeout(() => {
      state.typingHideTimer = 0;
      state.typingPeer = "";
      updateTypingIndicator(false);
    }, 6000);
  } else {
    state.typingPeer = "";
    updateTypingIndicator(false);
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

function resolveReplyTargetText(replyTo, peer, knownMessages = []) {
  const target = buildReplyTarget(replyTo);
  if (!target) {
    return null;
  }
  if (target.text) {
    return target;
  }
  const candidates = [...knownMessages, ...(state.messageCache.get(peer) || [])];
  const source = candidates.find((message) => {
    const id = String(message?.id || message?.tempId || "").trim();
    return id && id === target.id;
  });
  return {
    ...target,
    from: target.from || String(source?.from || ""),
    text: source ? String(source.text || "") : "",
    createdAt: target.createdAt || Number(source?.createdAt) || Date.now()
  };
}

function hydrateReplyTargets(messages, peer) {
  return messages.map((message) => ({
    ...message,
    replyTo: resolveReplyTargetText(message.replyTo, peer, messages)
  }));
}

function messagePlaintext(message) {
  return typeof message?.text === "string" ? message.text : "";
}

function recalledMessageLabel(message) {
  return message?.mine ? "你撤回了一条消息" : "对方撤回了一条消息";
}

function conversationMessageLabel(message) {
  if (!message) {
    return "";
  }
  if (message.recalled) {
    return recalledMessageLabel(message);
  }
  const attachment = parseAttachmentMessage(messagePlaintext(message));
  return attachment ? `[${attachment.isImage ? "图片" : "文件"}] ${attachment.name}` : messagePlaintext(message);
}

function syncConversationFromCache(peer) {
  if (!peer) {
    return;
  }
  const conversation = getConversation(peer);
  if (!conversation) {
    return;
  }
  const messages = state.messageCache.get(peer) || [];
  const latest = messages.at(-1) || null;
  conversation.latestMessage = latest
    ? {
        id: latest.id || latest.tempId || "",
        clientId: latest.clientId || latest.tempId || "",
        from: latest.from,
        to: latest.to,
        mine: Boolean(latest.mine),
        text: messagePlaintext(latest) || null,
        recalled: Boolean(latest.recalled),
        replyTo: latest.replyTo || null,
        nonce: "",
        ciphertext: "",
        createdAt: Number(latest.createdAt || 0)
      }
    : null;
  conversation.previewText = latest ? conversationMessageLabel(latest) : "";
  conversation.lastAt = Number(latest?.createdAt || 0);
  sortConversations();
  rebuildConversationSearchIndex(peer);
}

function threadMessageMatchesQuery(message, query) {
  const normalizedQuery = String(query || "").trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }
  const haystacks = [
    conversationMessageLabel(message),
    message.from,
    message.to,
    message.replyTo?.from,
    message.replyTo?.text
  ];
  return haystacks.some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}

function bytesToBase64(bytes) {
  const chunks = [];
  for (let index = 0; index < bytes.length; index += 32768) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + 32768)));
  }
  return btoa(chunks.join(""));
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
  const owner = currentStorageOwner();
  const legacyPrefs = readJsonStorage(STORAGE.conversationPrefs, {});
  if (Object.values(legacyPrefs).some((value) => value && typeof value === "object" && ("pinned" in value || "muted" in value))) {
    writeJsonStorage(STORAGE.conversationPrefs, {});
  }
  const rawPrefs = readScopedStorageRecord(STORAGE.conversationPrefs, owner);
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
  deleteScopedStorageRecord(STORAGE.drafts, owner);
  deleteScopedStorageRecord(STORAGE.pendingOutbox, owner);
  state.drafts = {};
  state.peerKeyPins = readScopedStorageRecord(STORAGE.peerKeyPins, owner);
  state.peerObservedKeys.clear();
  state.peerKeyMismatches.clear();
  state.peerKeyUnverified.clear();
  loadEditableProfiles();
  loadPeerSecurityMeta();
  loadPendingOutbox();
}

function saveConversationPrefs() {
  writeScopedStorageRecord(STORAGE.conversationPrefs, currentStorageOwner(), state.conversationPrefs);
}

function saveDrafts() {
  // Drafts stay in-memory only to avoid persisting plaintext locally.
}

function savePeerKeyPins() {
  writeScopedStorageRecord(STORAGE.peerKeyPins, currentStorageOwner(), state.peerKeyPins);
}

function readActivePeer() {
  return String(readScopedStorageRecord(STORAGE.activePeer, currentStorageOwner()).username || "");
}

function saveActivePeer(username) {
  writeScopedStorageRecord(STORAGE.activePeer, currentStorageOwner(), username ? { username } : {});
}

function clearSessionIdentityCache() {
  try {
    sessionStorage.removeItem(STORAGE.sessionIdentity);
  } catch (error) {
    // Ignore sessionStorage cleanup failures.
  }
}

function normalizeStoredIdentity(value) {
  return {
    publicKeyBase64: String(value?.publicKeyBase64 || ""),
    privateKeyPkcs8Base64: String(value?.privateKeyPkcs8Base64 || "")
  };
}

function normalizeKeyBundlePayload(value) {
  if (!value || typeof value !== "object") {
    return null;
  }
  const version = Number.parseInt(String(value.version || KEY_BUNDLE_VERSION), 10) || 0;
  const iterations = Number.parseInt(String(value.iterations || "0"), 10) || 0;
  const salt = String(value.salt || "").trim();
  const iv = String(value.iv || "").trim();
  const ciphertext = String(value.ciphertext || "").trim();
  if (!salt || !iv || !ciphertext || version !== KEY_BUNDLE_VERSION || iterations < 100000) {
    return null;
  }
  return {
    version,
    iterations,
    salt,
    iv,
    ciphertext
  };
}

function normalizeVaultIdentityRecord(record) {
  if (!record || typeof record !== "object") {
    return null;
  }
  const publicKeyBase64 = String(record.publicKeyBase64 || "").trim();
  if (!publicKeyBase64 || !record.privateKey || !record.storageKey) {
    return null;
  }
  return {
    publicKeyBase64,
    privateKey: record.privateKey,
    storageKey: record.storageKey,
    privateKeyPkcs8Base64: String(record.privateKeyPkcs8Base64 || ""),
    privateKeyPkcs8Iv: String(record.privateKeyPkcs8Iv || ""),
    privateKeyPkcs8Ciphertext: String(record.privateKeyPkcs8Ciphertext || "")
  };
}

async function createDeviceStorageKey() {
  return crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

async function encryptLocalPrivateKeyExport(privateKeyPkcs8Base64, storageKey) {
  if (!privateKeyPkcs8Base64 || !storageKey) {
    return {
      privateKeyPkcs8Iv: "",
      privateKeyPkcs8Ciphertext: ""
    };
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    storageKey,
    base64ToBytes(privateKeyPkcs8Base64)
  );
  return {
    privateKeyPkcs8Iv: bytesToBase64(iv),
    privateKeyPkcs8Ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

async function decryptLocalPrivateKeyExport(record) {
  if (!record) {
    return "";
  }
  if (record.privateKeyPkcs8Iv && record.privateKeyPkcs8Ciphertext && record.storageKey) {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(record.privateKeyPkcs8Iv)
      },
      record.storageKey,
      base64ToBytes(record.privateKeyPkcs8Ciphertext)
    );
    return bytesToBase64(new Uint8Array(plaintext));
  }
  return String(record.privateKeyPkcs8Base64 || "");
}

async function writeIdentityVaultRecord(username, identity) {
  if (!username || !identity?.publicKeyBase64 || !identity?.privateKey) {
    return;
  }
  const storageKey = identity.storageKey || await createDeviceStorageKey();
  const encryptedExport = await encryptLocalPrivateKeyExport(String(identity.privateKeyPkcs8Base64 || ""), storageKey);
  await writeDeviceVaultRecord({
    username,
    publicKeyBase64: String(identity.publicKeyBase64 || ""),
    privateKey: identity.privateKey,
    storageKey,
    ...encryptedExport
  });
}

async function buildPortableKeyBundle(privateKeyPkcs8Base64, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const material = await crypto.subtle.importKey(
    "raw",
    textEncoder.encode(String(password || "")),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt,
      iterations: KEY_BUNDLE_ITERATIONS
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv
    },
    key,
    base64ToBytes(privateKeyPkcs8Base64)
  );
  return {
    version: KEY_BUNDLE_VERSION,
    iterations: KEY_BUNDLE_ITERATIONS,
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(ciphertext))
  };
}

function base64UrlToBytes(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return base64ToBytes(`${normalized}${padding}`);
}

async function publicKeyFromPrivateKeyPkcs8(privateKeyPkcs8Base64) {
  const extractablePrivateKey = await importPrivateKey(privateKeyPkcs8Base64, true);
  const jwk = await crypto.subtle.exportKey("jwk", extractablePrivateKey);
  if (!jwk?.x || !jwk?.y) {
    throw new Error("私钥材料无效");
  }
  const x = base64UrlToBytes(jwk.x);
  const y = base64UrlToBytes(jwk.y);
  const raw = new Uint8Array(1 + x.length + y.length);
  raw[0] = 4;
  raw.set(x, 1);
  raw.set(y, 1 + x.length);
  return bytesToBase64(raw);
}

async function restoreIdentityFromPortableBundle(username, expectedPublicKeyBase64, keyBundle, password) {
  const bundle = normalizeKeyBundlePayload(keyBundle);
  if (!bundle) {
    return null;
  }
  try {
    const material = await crypto.subtle.importKey(
      "raw",
      textEncoder.encode(String(password || "")),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        salt: base64ToBytes(bundle.salt),
        iterations: bundle.iterations
      },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"]
    );
    const pkcs8 = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: base64ToBytes(bundle.iv)
      },
      key,
      base64ToBytes(bundle.ciphertext)
    );
    const privateKeyPkcs8Base64 = bytesToBase64(new Uint8Array(pkcs8));
    const derivedPublicKeyBase64 = await publicKeyFromPrivateKeyPkcs8(privateKeyPkcs8Base64);
    if (expectedPublicKeyBase64 && derivedPublicKeyBase64 !== expectedPublicKeyBase64) {
      throw new Error("账号加密身份校验失败");
    }
    const privateKey = await importPrivateKey(privateKeyPkcs8Base64, false);
    const publicKey = await importPublicKey(derivedPublicKeyBase64);
    return {
      username,
      publicKey,
      privateKey,
      publicKeyBase64: derivedPublicKeyBase64,
      privateKeyPkcs8Base64,
      storageKey: await createDeviceStorageKey()
    };
  } catch (error) {
    throw new Error("无法恢复该账号的加密身份，请检查密码后重试");
  }
}

async function migrateLegacyStoredIdentity(username) {
  if (!username) {
    return null;
  }
  const legacy = normalizeStoredIdentity(readScopedStorageRecord(STORAGE.deviceIdentities, username));
  if (!legacy.publicKeyBase64 || !legacy.privateKeyPkcs8Base64) {
    return null;
  }
  const migratedPrivateKey = await importPrivateKey(legacy.privateKeyPkcs8Base64, false);
  const migratedStorageKey = await createDeviceStorageKey();
  await writeIdentityVaultRecord(username, {
    username,
    publicKeyBase64: legacy.publicKeyBase64,
    privateKey: migratedPrivateKey,
    storageKey: migratedStorageKey,
    privateKeyPkcs8Base64: legacy.privateKeyPkcs8Base64
  });
  deleteScopedStorageRecord(STORAGE.deviceIdentities, username);
  return {
    publicKeyBase64: legacy.publicKeyBase64,
    privateKey: migratedPrivateKey,
    storageKey: migratedStorageKey,
    privateKeyPkcs8Base64: legacy.privateKeyPkcs8Base64
  };
}

async function readStoredIdentity(username) {
  if (!username) {
    return null;
  }
  const stored = normalizeVaultIdentityRecord(await readDeviceVaultRecord(username));
  if (stored) {
    const privateKeyPkcs8Base64 = await decryptLocalPrivateKeyExport(stored);
    if (stored.privateKeyPkcs8Base64 && privateKeyPkcs8Base64) {
      await writeIdentityVaultRecord(username, {
        publicKeyBase64: stored.publicKeyBase64,
        privateKey: stored.privateKey,
        storageKey: stored.storageKey,
        privateKeyPkcs8Base64
      });
    }
    return {
      ...stored,
      privateKeyPkcs8Base64
    };
  }
  return migrateLegacyStoredIdentity(username);
}

async function persistSessionIdentity(identity, username = state.me?.username || "") {
  clearSessionIdentityCache();
  if (!username || !identity?.publicKeyBase64 || !identity?.privateKey) {
    return;
  }
  await writeIdentityVaultRecord(username, identity);
  deleteScopedStorageRecord(STORAGE.deviceIdentities, username);
}

async function restoreIdentityFromSessionCache(user) {
  clearSessionIdentityCache();
  return restoreIdentity(String(user?.username || ""), String(user?.publicKey || ""));
}

function rebuildConversationSearchIndex(username) {
  if (!username) {
    return;
  }
  const conversation = getConversation(username);
  const historyText = (state.messageCache.get(username) || [])
    .map((message) => conversationMessageLabel(message))
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
  // Offline retries stay in-memory only to avoid persisting plaintext locally.
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
  state.pendingOutbox = [];
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

async function persistPeerPrefs(username, patch) {
  const previous = peerPrefs(username);
  updatePeerPrefs(username, patch);
  render();
  try {
    const payload = await api(`/api/contacts/${encodeURIComponent(username)}`, {
      method: "PATCH",
      body: patch
    });
    const index = state.contacts.findIndex((item) => item.username === username);
    if (payload.contact && index >= 0) {
      state.contacts[index] = payload.contact;
    }
    showToast(patch.pinned !== undefined
      ? (patch.pinned ? "会话已置顶" : "已取消置顶")
      : (patch.muted ? "已开启免打扰，仍会保留未读数" : "已恢复消息提醒"));
  } catch (error) {
    updatePeerPrefs(username, previous);
    render();
    throw error;
  }
}

function setAuthMode(mode) {
  state.authMode = mode === "register" ? "register" : "login";
  localStorage.setItem(STORAGE.authMode, state.authMode);
  elements.loginTab.classList.toggle("is-active", state.authMode === "login");
  elements.registerTab.classList.toggle("is-active", state.authMode === "register");
  elements.loginTab.setAttribute("aria-selected", state.authMode === "login" ? "true" : "false");
  elements.registerTab.setAttribute("aria-selected", state.authMode === "register" ? "true" : "false");
  elements.loginTab.tabIndex = state.authMode === "login" ? 0 : -1;
  elements.registerTab.tabIndex = state.authMode === "register" ? 0 : -1;
  elements.authForm.setAttribute("aria-labelledby", state.authMode === "login" ? "loginTab" : "registerTab");
  if (elements.authHeading) {
    elements.authHeading.textContent = state.authMode === "login" ? "登录私聊" : "创建加密账号";
  }
  if (elements.authModeDescription) {
    elements.authModeDescription.textContent = state.authMode === "login"
      ? "使用你的 Echo 账号继续会话。"
      : "创建账号后即可开始端到端加密会话。";
  }
  elements.authSubmitButton.textContent = state.authMode === "login" ? "登录" : "注册";
  setAuthFeedback(
    state.authMode === "login"
      ? "登录后会优先恢复当前设备密钥；新设备会使用登录密码同步加密身份。"
      : "注册后会创建本机私钥，并同步保存一份仅密码可解密的加密身份备份。"
  );
  elements.authPasswordInput.autocomplete = state.authMode === "login" ? "current-password" : "new-password";
  setPasswordVisibility(false);
}

function setPasswordVisibility(visible) {
  elements.authPasswordInput.type = visible ? "text" : "password";
  elements.passwordVisibilityButton?.setAttribute("aria-pressed", visible ? "true" : "false");
  if (elements.passwordVisibilityButton) {
    elements.passwordVisibilityButton.textContent = visible ? "隐藏" : "显示";
  }
}

function handleAuthTabKeydown(event) {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
    return;
  }
  event.preventDefault();
  const nextMode = event.key === "Home" || event.key === "ArrowLeft" ? "login" : "register";
  setAuthMode(nextMode);
  (nextMode === "login" ? elements.loginTab : elements.registerTab).focus();
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
  return { ok: true };
}

function renderSecurityStatusCard({ tone, title, summary, actions = [] }) {
  elements.securityStatus.className = `security-status is-${tone}`;
  elements.securityStatus.textContent = "";
  const copy = document.createElement("div");
  copy.className = "security-status-copy";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.textContent = summary;
  copy.append(strong, span);
  elements.securityStatus.append(copy);
  if (actions.length > 0) {
    const actionsWrap = document.createElement("div");
    actionsWrap.className = "security-status-actions";
    for (const action of actions) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = action.className;
      button.dataset.securityCardAction = action.action;
      button.textContent = action.label;
      actionsWrap.append(button);
    }
    elements.securityStatus.append(actionsWrap);
  }
}

function updateSecurityStatus(peer = activePeerMeta()) {
  if (!elements.securityStatus) {
    return;
  }
  if (!peer) {
    renderSecurityStatusCard({
      tone: "idle",
      title: "请选择会话查看加密状态",
      summary: "打开任意会话后，这里会显示密钥固定、连接和核验状态。"
    });
    return;
  }
  const parts = [];
  const actions = [{ className: "ghost-button compact", action: "verify", label: "核对安全码" }];
  const securityMeta = peerSecurityMetaFor(peer.username);
  let headline = "端到端会话已建立";
  let tone = "ok";
  if (state.peerKeyMismatches.has(peer.username)) {
    headline = "检测到联系人密钥变化";
    tone = "warn";
    parts.push("发送已暂停");
    parts.push("请先线下核验对方身份");
    actions.push({ className: "primary-button compact security-status-cta", action: "trust", label: "信任新密钥" });
  } else if (!state.peerKeys.has(peer.username)) {
    headline = "等待联系人公钥";
    tone = "idle";
    parts.push("首次会话将自动固定对方密钥");
  }
  if (state.peerKeyUnverified.has(peer.username)) {
    renderSecurityStatusCard({
      tone: "warn",
      title: "首次看到该联系人的密钥",
      summary: "发送已暂停，请先核对安全码，再手动信任这把密钥。",
      actions: [
        { className: "ghost-button compact", action: "verify", label: "核对安全码" },
        { className: "primary-button compact security-status-cta", action: "trust", label: "验证并信任" }
      ]
    });
    return;
  }
  parts.push(state.identity?.privateKey ? "\u5bc6\u94a5\u5df2\u5c31\u7eea" : "\u5bc6\u94a5\u5df2\u9501\u5b9a");
  parts.push(state.peerKeys.has(peer.username) ? "\u5df2\u56fa\u5b9a\u8054\u7cfb\u4eba\u5bc6\u94a5" : "\u7b49\u5f85\u5bf9\u7aef\u5bc6\u94a5");
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
  if (securityMeta.firstTrustedAt) {
    parts.push(`首次信任 ${formatDateTime(securityMeta.firstTrustedAt)}`);
  }
  if (securityMeta.lastKeyChangeAt) {
    parts.push(`最近变更 ${formatDateTime(securityMeta.lastKeyChangeAt)}`);
  }
  if (securityMeta.lastVerifiedAt) {
    parts.push(`最近核验 ${formatDateTime(securityMeta.lastVerifiedAt)}`);
  }
  if (contactRecord(peer.username)?.blocked) {
    parts.push("您已拉黑对方，解除后才能继续互动");
  } else if (contactRecord(peer.username)?.blockedByPeer) {
    parts.push("对方已将您拉黑，暂时无法发送消息");
  }
  renderSecurityStatusCard({
    tone,
    title: headline,
    summary: parts.join(" · "),
    actions
  });
}

function setAuthBusy(busy) {
  state.authBusy = busy;
  elements.authSubmitButton.disabled = busy;
  elements.authUsernameInput.disabled = busy;
  elements.authPasswordInput.disabled = busy;
  if (busy) {
    elements.authSubmitButton.dataset.originalText = elements.authSubmitButton.textContent;
    elements.authSubmitButton.textContent = state.authMode === "login" ? "登录中…" : "注册中…";
  } else {
    elements.authSubmitButton.textContent = elements.authSubmitButton.dataset.originalText || (state.authMode === "login" ? "登录" : "注册");
  }
}

function setComposerBusy(busy) {
  state.composerBusy = busy;
  const activeContact = state.activePeer ? contactRecord(state.activePeer) : null;
  const blocked = Boolean(
    activeContact?.blocked ||
    activeContact?.blockedByPeer ||
    state.peerKeyMismatches.has(state.activePeer) ||
    state.peerKeyUnverified.has(state.activePeer)
  );
  elements.sendButton.disabled = busy || state.submitInFlight || !state.activePeer || blocked;
  elements.messageInput.disabled = busy || !state.activePeer || blocked;
}

function setSubmitInFlight(inFlight) {
  state.submitInFlight = Boolean(inFlight);
  if (!elements.sendButton) {
    return;
  }
  const label = elements.sendButton.querySelector(".send-label");
  if (state.submitInFlight) {
    elements.sendButton.setAttribute("data-busy", "true");
    elements.sendButton.setAttribute("aria-busy", "true");
    elements.sendButton.setAttribute("aria-label", "正在发送消息");
    if (label) {
      label.textContent = "发送中";
    }
  } else {
    elements.sendButton.removeAttribute("data-busy");
    elements.sendButton.removeAttribute("aria-busy");
    elements.sendButton.setAttribute("aria-label", "发送消息");
    if (label) {
      label.textContent = "发送";
    }
  }
  setComposerBusy(state.composerBusy);
}

function isMobile() {
  return window.innerWidth <= 767;
}

function syncLayoutState() {
  if (!isDetailsDrawerLayout()) {
    state.detailsPanelOpen = false;
  }
  const detailsDrawerClosed = isDetailsDrawerLayout() && !state.detailsPanelOpen;
  document.body.classList.toggle("is-mobile", isMobile());
  document.body.classList.toggle("is-chat-open", isMobile() && Boolean(state.activePeer));
  document.body.classList.toggle("is-details-open", isDetailsDrawerLayout() && state.detailsPanelOpen);
  document.body.classList.toggle("is-details-collapsed", !isDetailsDrawerLayout() && state.detailsPanelCollapsed);
  document.body.classList.toggle("is-dialog-open", state.settingsDialogOpen);
  if (elements.workspace) {
    elements.workspace.inert = state.settingsDialogOpen;
    elements.workspace.setAttribute("aria-hidden", state.settingsDialogOpen ? "true" : "false");
  }
  if (elements.contactPanel) {
    elements.contactPanel.inert = detailsDrawerClosed;
    elements.contactPanel.setAttribute("aria-hidden", detailsDrawerClosed ? "true" : "false");
  }
  if (elements.headerDetailsButton) {
    const label = isDetailsDrawerLayout()
      ? "打开联系人详情"
      : state.detailsPanelCollapsed
        ? "展开联系人详情"
        : "联系人详情";
    elements.headerDetailsButton.setAttribute("aria-label", label);
    elements.headerDetailsButton.setAttribute("title", label);
  }
  if (state.accountMenuOpen && state.accountMenuAnchor && state.accountMenuAnchor.offsetParent === null) {
    closeAccountMenu();
    return;
  }
  if (state.accountMenuOpen && elements.accountMenu && state.accountMenuAnchor) {
    positionFloatingMenu(elements.accountMenu, state.accountMenuAnchor);
  }
  if (state.notificationPanelOpen && state.notificationPanelAnchor && state.notificationPanelAnchor.offsetParent === null) {
    closeNotificationPanel();
    return;
  }
  if (state.notificationPanelOpen && elements.notificationPanel && state.notificationPanelAnchor) {
    positionFloatingMenu(elements.notificationPanel, state.notificationPanelAnchor);
    elements.notificationPanel.style.removeProperty("right");
  }
  if (state.emojiPanelOpen && state.emojiPanelAnchor && state.emojiPanelAnchor.offsetParent === null) {
    closeEmojiPanel();
    return;
  }
  if (state.emojiPanelOpen && elements.emojiPanel && state.emojiPanelAnchor) {
    positionFloatingMenu(elements.emojiPanel, state.emojiPanelAnchor);
  }
  if (state.contextMenuMessageId && elements.messageContextMenu && !elements.messageContextMenu.hidden) {
    positionFloatingMenuAtPoint(elements.messageContextMenu, state.contextMenuX, state.contextMenuY);
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
  const attachment = message?.recalled ? null : parseAttachmentMessage(text);
  const charactersPerLine = message?.mine ? 38 : 34;
  const lineCount = Math.max(1, Math.ceil(Math.max(text.length, 1) / charactersPerLine));
  let height = message?.mine ? 88 : 106;
  if (message?.replyTo) {
    height += 44;
  }
  if (message?.recalled) {
    height -= 12;
  }
  if (attachment) {
    height += attachment.isImage ? 180 : 72;
  }
  height += (lineCount - 1) * 18;
  if (message?.pending || message?.failed) {
    height += 10;
  }
  return height + 16;
}

function shouldVirtualizeMessages(messages) {
  return messages.length > MESSAGE_VIRTUAL_THRESHOLD && window.innerWidth >= 768;
}

function buildMessageVirtualWindow(messages, scrollTop, viewportHeight, anchor = "scroll") {
  if (!shouldVirtualizeMessages(messages)) {
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
    const viewportChanged = syncViewportHeight();
    if (!viewportChanged) {
      return;
    }
    if (document.activeElement === elements.messageInput) {
      syncLayoutState();
      updateScrollBottomButton();
      return;
    }
    render();
  });
}

function scheduleViewportOnlySync() {
  if (state.resizeRenderRaf) {
    return;
  }
  const keepBottomAnchored = Boolean(
    elements.messageList &&
    document.activeElement !== elements.messageInput &&
    isNearBottom(elements.messageList, 120)
  );
  state.resizeRenderRaf = window.requestAnimationFrame(() => {
    state.resizeRenderRaf = 0;
    const viewportChanged = syncViewportHeight();
    syncLayoutState();
    updateScrollBottomButton();
    if (viewportChanged && keepBottomAnchored && state.activePeer) {
      scrollMessagesToBottom(false);
    }
  });
}

function createSpacer(height) {
  const spacer = document.createElement("div");
  spacer.className = "message-spacer";
  spacer.style.height = `${Math.max(0, Math.round(height))}px`;
  spacer.setAttribute("aria-hidden", "true");
  return spacer;
}

function clearStoredSessionArtifacts(owner, clearIdentity = true, clearActivePeer = true, clearPending = true) {
  if (clearActivePeer) {
    deleteScopedStorageRecord(STORAGE.activePeer, owner);
  }
  if (clearPending) {
    deleteScopedStorageRecord(STORAGE.pendingOutbox, owner);
  }
  deleteScopedStorageRecord(STORAGE.accountProfile, owner);
  deleteScopedStorageRecord(STORAGE.contactProfiles, owner);
  deleteScopedStorageRecord(STORAGE.conversationPrefs, owner);
  deleteScopedStorageRecord(STORAGE.peerSecurityMeta, owner);
  deleteScopedStorageRecord(STORAGE.peerKeyPins, owner);
  if (clearIdentity) {
    clearSessionIdentityCache();
  }
}

function translateApiError(pathname, status, payload) {
  const raw = String(payload?.error || "").trim();
  const route = String(pathname || "").split("?")[0];
  const authMessages = {
    "username and password are required": "请输入账号和密码",
    "invalid username or password": "账号或密码错误",
    "username must be 3-24 characters using letters, numbers, or underscore": "用户名需为 3-24 位，只能使用字母、数字或下划线。",
    "username already exists": "用户名已存在",
    "username is reserved": "该用户名不可使用",
    "account banned": "账号已被禁用",
    "account key material is missing": "账号缺少加密身份，请重新登录后恢复。",
    "invalid account key bundle": "账号加密身份数据无效，请重新登录后重试。",
    "forbidden origin": "当前请求来源不受信任，请从本站页面重新操作。",
    "too many auth requests": "请求过于频繁，请稍后再试",
    "current password invalid": "当前密码不正确",
    "invalid private key bundle": "服务端不再接受私钥材料",
    "public key cannot be changed with password": "修改密码不会变更本地设备密钥",
    "encrypted account password must be changed by the user": "账号密码只能由用户本人修改",
    "private key bundles are not available in zero-knowledge mode": "当前环境无法恢复加密身份，请重新登录。",
    "peer unavailable": "对方当前不可接收消息",
    "you blocked peer": "您已拉黑对方，解除后才能继续互动",
    "blocked by peer": "对方已将您拉黑，暂时无法发送消息",
    "invalid csrf token": "当前页面安全令牌已失效，请重新登录。",
    "clientId required": "消息缺少幂等编号，请刷新页面后重试。",
    "clientId already used": "消息幂等编号重复，请勿重复提交。",
    "recall window expired": "撤回时间窗口已过。",
    "relationship is blocked": "当前关系处于拉黑状态，无法直接切换免打扰。",
    "already a contact": "该用户已经是好友",
    "user not found": "用户不存在",
    "session not found": "未找到该设备会话",
    "current session cannot be revoked here": "当前设备请使用退出登录",
    unauthorized: "请先登录",
    "session expired": "登录已过期，请重新登录"
  };

  if (raw in authMessages) {
    return authMessages[raw];
  }
  if (route === "/api/login" && status === 401) {
    return "登录失败，请检查账号和密码";
  }
  if (route === "/api/register" && status >= 400 && status < 500 && raw) {
    return authMessages[raw] || "注册失败，请检查输入内容";
  }
  if (route === "/api/me" && status === 401) {
    return "请先登录";
  }
  return raw || `请求失败：${status}`;
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
  if (!["GET", "HEAD"].includes((options.method || "GET").toUpperCase()) && state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
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
  if (payload?.csrfToken) {
    state.csrfToken = String(payload.csrfToken);
  }

  if (!response.ok) {
    const shouldResetAuth =
      response.status === 401 || (response.status === 403 && payload?.error === "account banned");
    if (shouldResetAuth && state.authenticated && !options.skipAuthReset) {
      clearSession(true);
    }
    throw new Error(translateApiError(pathname, response.status, payload));
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
  // Keep this true until openEventStream installs the next source; stale error
  // events from the previous EventSource must not schedule a phantom reconnect.
  state.reconnectAttempts = 0;
  state.connectionState = "offline";
  if (state.typingStopTimer) {
    window.clearTimeout(state.typingStopTimer);
    state.typingStopTimer = 0;
  }
  state.typingSelfPeer = "";
  state.typingSentAt = 0;
  clearIncomingTyping();
}

function clearSession(showAuth = true, clearIdentity = true) {
  const storageOwner = currentStorageOwner();
  closeEventStream();
  if (state.messageListRenderRaf) {
    window.cancelAnimationFrame(state.messageListRenderRaf);
    state.messageListRenderRaf = 0;
  }

  state.authenticated = false;
  state.me = null;
  state.identity = null;
  state.csrfToken = "";
  state.searchQuery = "";
  state.threadSearchQuery = "";
  state.replyTarget = null;
  state.conversations = [];
  state.searchResults = [];
  state.activePeer = "";
  state.messageCache.clear();
  state.peerKeys.clear();
  state.peerKeyPins = {};
  state.peerObservedKeys.clear();
  state.peerKeyMismatches.clear();
  state.peerKeyUnverified.clear();
  state.importedPeerKeys.clear();
  state.conversationKeys.clear();
  state.previewCache.clear();
  state.conversationSearchIndex.clear();
  state.pendingMessages.clear();
  state.pendingOutbox = [];
  state.outboundInFlight.clear();
  state.drafts = {};
  state.messagePageState.clear();
  state.pendingSequence = 0;
  state.accountProfile = {};
  state.contactProfiles = {};
  state.contacts = [];
  state.deviceSessions = [];
  state.peerSecurityMeta = {};
  state.securitySettings = {
    showOnlineStatus: true,
    allowUserSearch: true,
    blockedUsers: []
  };
  state.attachmentTransfers = [];
  state.outboxFlushing = false;
  state.searchRequestId += 1;
  state.openConversationRequest += 1;
  state.detailsPanelOpen = false;
  state.activeNavSection = "messages";
  state.settingsDialogOpen = false;
  state.settingsDialogSection = "account";
  state.settingsDialogReturnFocus = null;
  state.previewMode = false;
  state.detailsPanelCollapsed = false;
  state.workspaceLoading = false;

  clearStoredSessionArtifacts(storageOwner, clearIdentity, true);
  elements.globalSearchInput.value = "";
  elements.threadSearchInput.value = "";
  elements.messageInput.value = "";
  elements.messageInput.style.height = "auto";
  if (elements.settingsDialog) {
    elements.settingsDialog.hidden = true;
  }
  syncReplyState();
  updateWorkspaceStatus();
  render();
  if (showAuth) {
    elements.workspace.hidden = true;
    elements.authScreen.hidden = false;
    setAuthMode("login");
  }
}

function setSession(user, identity) {
  state.authenticated = true;
  state.realtimeTakeoverPaused = false;
  state.me = user;
  state.identity = identity;
  state.previewMode = false;
  resetLocalConversationState();
  elements.authScreen.hidden = true;
  elements.workspace.hidden = false;
  if (elements.meUsername) {
    elements.meUsername.textContent = accountDisplayName();
  }
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
  const username = String(item?.username || "");
  const observedKey = String(item?.publicKey || "");
  if (!username || !observedKey || username === state.me?.username) {
    return;
  }
  state.peerObservedKeys.set(username, observedKey);
  const securityMeta = normalizePeerSecurityMeta(state.peerSecurityMeta[username]);
  const pinnedKey = String(state.peerKeyPins[username] || "");
  if (!pinnedKey) {
    state.peerKeys.set(username, observedKey);
    state.peerKeyMismatches.delete(username);
    state.peerKeyUnverified.add(username);
    state.peerSecurityMeta[username] = normalizePeerSecurityMeta({
      ...securityMeta,
      pinnedKey: observedKey,
      observedKey
    });
    savePeerSecurityMeta();
    return;
  }
  state.peerKeyUnverified.delete(username);
  state.peerKeys.set(username, pinnedKey);
  if (pinnedKey === observedKey) {
    state.peerKeyMismatches.delete(username);
    if (securityMeta.pinnedKey !== pinnedKey || securityMeta.observedKey !== observedKey) {
      state.peerSecurityMeta[username] = normalizePeerSecurityMeta({
        ...securityMeta,
        pinnedKey,
        observedKey
      });
      savePeerSecurityMeta();
    }
  } else {
    state.peerKeyMismatches.add(username);
    if (securityMeta.observedKey !== observedKey) {
      state.peerSecurityMeta[username] = normalizePeerSecurityMeta({
        ...securityMeta,
        pinnedKey,
        observedKey,
        lastKeyChangeAt: Date.now()
      });
      savePeerSecurityMeta();
    }
  }
}

async function safetyCodeForPeer(username) {
  const material = await safetyMaterialForPeer(username);
  return material ? material.fullCode : "不可用";
}

function peerSecurityMetaFor(username) {
  return normalizePeerSecurityMeta(state.peerSecurityMeta[username]);
}

async function safetyMaterialForPeer(username) {
  const peerKey = state.peerKeys.get(username);
  if (!peerKey || !state.identity?.publicKeyBase64) {
    return null;
  }
  const keys = [state.identity.publicKeyBase64, peerKey].sort().join(":");
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", textEncoder.encode(keys)));
  const digits = Array.from(digest.slice(0, 10), (value) => String(value).padStart(3, "0")).join("");
  const shortCode = Array.from(digest.slice(0, 6), (value) => value.toString(16).padStart(2, "0"))
    .join("")
    .match(/.{1,4}/g)
    .join("-");
  const owner = [state.me?.username || "", username].filter(Boolean).sort().join(":");
  return {
    digest,
    shortCode,
    fullCode: digits.match(/.{1,5}/g).join(" "),
    shareText: `echo-verify:${owner}:${shortCode}:${digits}`
  };
}

function safetyPatternMarkup(digest) {
  const cells = [];
  const size = 9;
  let bitIndex = 0;
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      const mirroredCol = col < Math.ceil(size / 2) ? col : (size - 1 - col);
      const digestIndex = (row * Math.ceil(size / 2) + mirroredCol) % digest.length;
      const bit = (digest[digestIndex] >> (bitIndex % 8)) & 1;
      cells.push(`<span class="safety-pattern-cell${bit ? " is-on" : ""}"></span>`);
      bitIndex += 1;
    }
  }
  return cells.join("");
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
  elements.pinPeerButton.textContent = prefs.pinned ? "\u53d6\u6d88\u7f6e\u9876" : "\u7f6e\u9876";
  elements.mutePeerButton.textContent = prefs.muted ? "\u53d6\u6d88\u514d\u6253\u6270" : "\u514d\u6253\u6270";
}

async function togglePeerPref(peer, key) {
  if (!peer) {
    return;
  }
  const prefs = peerPrefs(peer);
  await persistPeerPrefs(peer, { [key]: !prefs[key] });
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
  if (state.detailsPanelOpen) {
    state.detailsPanelCollapsed = false;
  }
  syncLayoutState();
}

function openActionDialog(options = {}) {
  return new Promise((resolve) => {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop action-dialog-backdrop";
    const card = document.createElement("section");
    card.className = "dialog-card action-dialog-card";
    card.setAttribute("role", "dialog");
    card.setAttribute("aria-modal", "true");

    const head = document.createElement("div");
    head.className = "dialog-head";
    const titleWrap = document.createElement("div");
    const eyebrow = document.createElement("span");
    eyebrow.textContent = options.eyebrow || "确认操作";
    const title = document.createElement("h2");
    title.textContent = options.title || "确认操作";
    titleWrap.append(eyebrow, title);
    head.append(titleWrap);

    const body = document.createElement("div");
    body.className = "dialog-body";
    const note = document.createElement("div");
    note.className = "dialog-note";
    note.textContent = options.message || "";
    body.append(note);

    let input = null;
    if (options.field) {
      const form = document.createElement("div");
      form.className = "dialog-form";
      const label = document.createElement("label");
      const labelText = document.createElement("span");
      labelText.textContent = options.field.label || "输入内容";
      input = document.createElement(options.field.multiline ? "textarea" : "input");
      input.value = options.field.value || "";
      input.placeholder = options.field.placeholder || "";
      label.append(labelText, input);
      form.append(label);
      body.append(form);
    }

    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "ghost-button";
    cancel.textContent = options.cancelLabel || "取消";
    const confirm = document.createElement("button");
    confirm.type = "button";
    confirm.className = "primary-button";
    confirm.textContent = options.confirmLabel || "确认";
    actions.append(cancel, confirm);
    card.append(head, body, actions);
    backdrop.append(card);

    const cleanup = (result) => {
      backdrop.remove();
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    };
    const onKeydown = (event) => {
      if (event.key === "Escape") {
        cleanup({ confirmed: false, value: "" });
      }
    };
    cancel.addEventListener("click", () => cleanup({ confirmed: false, value: "" }));
    confirm.addEventListener("click", () => cleanup({ confirmed: true, value: String(input?.value || "").trim() }));
    backdrop.addEventListener("click", (event) => {
      if (event.target === backdrop) {
        cleanup({ confirmed: false, value: "" });
      }
    });
    document.addEventListener("keydown", onKeydown);
    document.body.append(backdrop);
    window.requestAnimationFrame(() => (input || confirm).focus());
  });
}

async function confirmActionDialog(options) {
  const result = await openActionDialog(options);
  return Boolean(result.confirmed);
}

async function promptActionDialog(options) {
  const result = await openActionDialog({ ...options, field: options.field || {} });
  return result.confirmed ? result.value : null;
}

async function openSafetyCodeDialog(peerUsername = state.activePeer) {
  if (!peerUsername) {
    return;
  }
  const material = await safetyMaterialForPeer(peerUsername);
  if (!material) {
    showToast("当前安全码不可用", "error");
    return;
  }
  const meta = peerSecurityMetaFor(peerUsername);
  const hasMismatch = state.peerKeyMismatches.has(peerUsername);
  const needsFirstTrust = state.peerKeyUnverified.has(peerUsername);
  const backdrop = document.createElement("div");
  backdrop.className = "dialog-backdrop safety-dialog-backdrop";
  const card = document.createElement("section");
  card.className = "dialog-card safety-dialog-card";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-modal", "true");
  card.innerHTML = `
    <div class="dialog-head">
      <div>
        <p class="eyebrow">安全核验</p>
        <h2>@${escapeHtml(peerUsername)} 的安全码</h2>
      </div>
      <button class="icon-button" type="button" data-safety-close aria-label="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </button>
    </div>
    <div class="dialog-body">
      <div class="dialog-note${hasMismatch || needsFirstTrust ? " is-warning" : ""}">
        <strong>${hasMismatch ? "检测到联系人密钥变化" : needsFirstTrust ? "请先完成首次信任" : "请与对方在线下逐项比对"}</strong>
        <span>${hasMismatch ? "核对无误后再信任新密钥，避免误把中间人密钥当成联系人密钥。" : needsFirstTrust ? "这是首次看到该联系人的密钥，核对一致后再手动固定，避免错误信任。" : "双方短码、完整安全码和核验图样一致时，可确认当前会话密钥未被替换。"}</span>
      </div>
      <div class="safety-code-grid">
        <div class="safety-code-panel">
          <span class="safety-code-label">短码</span>
          <strong class="safety-code-short">${escapeHtml(material.shortCode)}</strong>
          <span class="safety-code-label">完整安全码</span>
          <strong class="safety-code-full">${escapeHtml(material.fullCode)}</strong>
          <span class="safety-code-label">核验串</span>
          <code class="safety-code-share">${escapeHtml(material.shareText)}</code>
        </div>
        <div class="safety-code-panel">
          <span class="safety-code-label">核验图样</span>
          <div class="safety-pattern" aria-hidden="true">${safetyPatternMarkup(material.digest)}</div>
          <div class="safety-code-history">
            <span>首次信任：${escapeHtml(meta.firstTrustedAt ? formatDateTime(meta.firstTrustedAt) : "未记录")}</span>
            <span>最近核验：${escapeHtml(meta.lastVerifiedAt ? formatDateTime(meta.lastVerifiedAt) : "未记录")}</span>
            <span>最近变更：${escapeHtml(meta.lastKeyChangeAt ? formatDateTime(meta.lastKeyChangeAt) : "未记录")}</span>
          </div>
        </div>
      </div>
    </div>
    <div class="dialog-actions">
      <button class="ghost-button" type="button" data-safety-copy="share">复制核验串</button>
      <div class="security-status-actions">
        ${hasMismatch || needsFirstTrust ? `<button class="primary-button" type="button" data-safety-trust>${hasMismatch ? "信任新密钥" : "验证并信任"}</button>` : ""}
        <button class="ghost-button" type="button" data-safety-verified>已核对一致</button>
        <button class="primary-button" type="button" data-safety-copy="code">复制安全码</button>
      </div>
    </div>
  `;
  backdrop.append(card);

  const cleanup = () => {
    document.removeEventListener("keydown", onKeydown);
    backdrop.remove();
  };
  const onKeydown = (event) => {
    if (event.key === "Escape") {
      cleanup();
    }
  };
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-safety-close]")) {
      cleanup();
    }
  });
  card.addEventListener("click", async (event) => {
    if (!isElementNode(event.target)) {
      return;
    }
    const copyTarget = event.target.closest("[data-safety-copy]");
    if (copyTarget) {
      const type = copyTarget.dataset.safetyCopy || "code";
      try {
        await navigator.clipboard.writeText(type === "share" ? material.shareText : material.fullCode);
        showToast(type === "share" ? "核验串已复制" : "安全码已复制");
      } catch (error) {
        showToast("复制失败", "error");
      }
      return;
    }
    if (event.target.closest("[data-safety-verified]")) {
      state.peerSecurityMeta[peerUsername] = normalizePeerSecurityMeta({
        ...meta,
        lastVerifiedAt: Date.now(),
        pinnedKey: state.peerKeys.get(peerUsername) || meta.pinnedKey,
        observedKey: state.peerObservedKeys.get(peerUsername) || meta.observedKey
      });
      savePeerSecurityMeta();
      renderThread({ scrollBehavior: "preserve" });
      showToast("已记录本次核验");
      cleanup();
      return;
    }
    const trustButton = event.target.closest("[data-safety-trust]");
    if (trustButton) {
      cleanup();
      await trustObservedPeerKey(peerUsername);
    }
  });
  document.addEventListener("keydown", onKeydown);
  document.body.append(backdrop);
  window.requestAnimationFrame(() => {
    card.querySelector("[data-safety-copy='code']")?.focus();
  });
}

function openContactDetailsPanel() {
  if (isDetailsDrawerLayout()) {
    setDetailsPanelOpen(true);
    return;
  }
  state.detailsPanelCollapsed = false;
  syncLayoutState();
  renderThread({ scrollBehavior: "preserve" });
}

function syncViewportHeight() {
  const visualHeight = window.visualViewport?.height || 0;
  const viewportHeight = isMobile() && visualHeight ? visualHeight : window.innerHeight || visualHeight || 0;
  if (!viewportHeight) {
    return false;
  }
  const roundedHeight = Math.round(viewportHeight);
  if (Math.abs((state.appViewportHeight || 0) - roundedHeight) < 2) {
    return false;
  }
  state.appViewportHeight = roundedHeight;
  document.documentElement.style.setProperty("--app-vh", `${roundedHeight}px`);
  return true;
}

function renderSimpleDetailRow(title, meta, actionLabel = "", action = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "detail-file-row detail-file-row-simple";
  const copy = document.createElement("div");
  copy.className = "detail-file-copy";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const span = document.createElement("span");
  span.className = "detail-file-meta";
  span.textContent = meta;
  copy.append(strong, span);
  wrapper.append(copy);
  if (actionLabel) {
    const button = document.createElement("button");
    button.className = "detail-file-download";
    button.type = "button";
    button.dataset.securityAction = action;
    button.textContent = actionLabel;
    wrapper.append(button);
  }
  return wrapper;
}

function sessionActivityLabel(sessionItem) {
  if (sessionItem.current) {
    return "当前设备";
  }
  const age = Date.now() - Number(sessionItem.lastSeenAt || 0);
  if (age <= 10 * 60 * 1000) {
    return "最近活跃";
  }
  if (age >= 14 * 24 * 60 * 60 * 1000) {
    return "长期未活动";
  }
  return "其他设备";
}

function renderSecurityLists(deviceSessions = state.deviceSessions) {
  if (elements.presenceVisibleToggle) {
    elements.presenceVisibleToggle.checked = state.securitySettings.showOnlineStatus !== false;
  }
  if (elements.allowSearchToggle) {
    elements.allowSearchToggle.checked = state.securitySettings.allowUserSearch !== false;
  }
  if (elements.deviceSessionsList) {
    elements.deviceSessionsList.textContent = "";
    if (!deviceSessions.length) {
      const empty = document.createElement("div");
      empty.className = "detail-file-row detail-file-empty";
      const span = document.createElement("span");
      span.textContent = "暂无可展示的登录设备。";
      empty.append(span);
      elements.deviceSessionsList.append(empty);
    } else {
      for (const sessionItem of deviceSessions) {
        const title = [sessionItem.device || "设备", sessionItem.browser || "浏览器"].filter(Boolean).join(" · ");
        const meta = [
          sessionActivityLabel(sessionItem),
          sessionItem.os || "系统",
          `登录 ${formatDateTime(sessionItem.createdAt)}`,
          `最近活动 ${formatDateTime(sessionItem.lastSeenAt)}`
        ].filter(Boolean).join(" · ");
        elements.deviceSessionsList.append(
          renderSimpleDetailRow(
            title,
            meta,
            sessionItem.current ? "" : "撤销",
            sessionItem.current ? "" : `revoke-session:${sessionItem.id || ""}`
          )
        );
      }
    }
  }
  if (elements.blockedUsersList) {
    elements.blockedUsersList.textContent = "";
    if (!state.securitySettings.blockedUsers.length) {
      const empty = document.createElement("div");
      empty.className = "detail-file-row detail-file-empty";
      const span = document.createElement("span");
      span.textContent = "黑名单为空。";
      empty.append(span);
      elements.blockedUsersList.append(empty);
    } else {
      for (const username of state.securitySettings.blockedUsers) {
        elements.blockedUsersList.append(
          renderSimpleDetailRow(`@${username}`, "已阻止对方继续发送消息", "解除拉黑", `unblock:${username}`)
        );
      }
    }
  }
}

async function revokeDeviceSession(sessionId) {
  const payload = await api("/api/me/sessions/revoke", {
    method: "POST",
    body: { sessionId }
  });
  state.deviceSessions = Array.isArray(payload?.sessions) ? payload.sessions : [];
  renderSecurityLists();
}

async function refreshSecuritySettingsPanel() {
  const deviceSessions = await loadSecuritySettings();
  renderSecurityLists(deviceSessions);
}

async function updateSecuritySettings(patch) {
  const payload = await api("/api/me/settings", {
    method: "PATCH",
    body: patch
  });
  state.securitySettings = {
    showOnlineStatus: payload?.settings?.showOnlineStatus !== false,
    allowUserSearch: payload?.settings?.allowUserSearch !== false,
    blockedUsers: Array.isArray(payload?.blockedUsers) ? payload.blockedUsers : []
  };
  renderSecurityLists();
  renderSidebar();
  renderThread({ scrollBehavior: "preserve" });
}

async function saveContactNote(username, note) {
  if (!username) {
    return;
  }
  await api(`/api/contacts/${encodeURIComponent(username)}`, {
    method: "PATCH",
    body: { note }
  });
  await loadContacts();
  renderSidebar();
  renderThread({ scrollBehavior: "preserve" });
}

async function addContactRecord(username) {
  const payload = await api("/api/contacts", {
    method: "POST",
    body: { username }
  });
  await Promise.all([loadContacts(), loadConversations()]);
  renderSidebar();
  if (payload.contact?.username) {
    await openConversation(payload.contact.username);
  }
}

async function deleteContactRecord(username) {
  if (!username) {
    return;
  }
  await api(`/api/contacts/${encodeURIComponent(username)}`, {
    method: "DELETE"
  });
  await loadContacts();
  renderSidebar();
  renderThread({ scrollBehavior: "preserve" });
}

async function setBlockedContact(username, blocked) {
  if (!username) {
    return;
  }
  const payload = await api(`/api/contacts/${encodeURIComponent(username)}/block`, {
    method: "POST",
    body: { blocked }
  });
  await loadContacts();
  state.securitySettings.blockedUsers = Array.isArray(payload?.blockedUsers) ? payload.blockedUsers : [];
  renderSidebar();
  renderThread({ scrollBehavior: "preserve" });
  if (state.settingsDialogOpen && (state.settingsDialogSection === "security" || state.settingsDialogSection === "other")) {
    renderSecurityLists();
  }
}

async function trustObservedPeerKey(peer = state.activePeer) {
  const observedKey = state.peerObservedKeys.get(peer);
  const mismatch = state.peerKeyMismatches.has(peer);
  const unverified = state.peerKeyUnverified.has(peer);
  if (!peer || !observedKey || (!mismatch && !unverified)) {
    return false;
  }
  if (!await confirmActionDialog({
    title: mismatch ? "信任新密钥" : "验证并信任密钥",
    message: mismatch
      ? "仅在你已通过其他渠道确认对方身份后继续。确认后会用这把新密钥继续加密会话。"
      : "请先通过其他渠道核对安全码。确认后会把这把首次见到的密钥固定为联系人身份。",
    confirmLabel: "信任"
  })) {
    return false;
  }
  const previousMeta = peerSecurityMetaFor(peer);
  state.peerKeyPins[peer] = observedKey;
  state.peerKeys.set(peer, observedKey);
  state.peerKeyMismatches.delete(peer);
  state.peerKeyUnverified.delete(peer);
  state.conversationKeys.clear();
  state.importedPeerKeys.clear();
  savePeerKeyPins();
  state.peerSecurityMeta[peer] = normalizePeerSecurityMeta({
    ...previousMeta,
    pinnedKey: observedKey,
    observedKey,
    lastVerifiedAt: Date.now(),
    lastKeyChangeAt: mismatch ? (previousMeta.lastKeyChangeAt || Date.now()) : previousMeta.lastKeyChangeAt,
    firstTrustedAt: previousMeta.firstTrustedAt || Date.now()
  });
  savePeerSecurityMeta();
  render();
  showToast(mismatch ? "已信任新密钥" : "已验证并信任联系人密钥");
  await openConversation(peer);
  return true;
}

function renderContactDetails(peer) {
  if (!elements.contactDetailsEmpty || !elements.contactDetailsContent) {
    return;
  }
  if (!peer) {
    elements.contactDetailsEmpty.hidden = false;
    elements.contactDetailsContent.hidden = true;
    if (elements.editContactButton) {
      elements.editContactButton.disabled = true;
    }
    if (elements.detailsVerifyCodeButton) {
      elements.detailsVerifyCodeButton.disabled = true;
    }
    if (isDetailsDrawerLayout()) {
      setDetailsPanelOpen(false);
    }
    return;
  }

  const contact = contactRecord(peer.username);
  const prefs = peerPrefs(peer.username);
  elements.contactDetailsEmpty.hidden = true;
  elements.contactDetailsContent.hidden = false;
  setAvatar(elements.detailsAvatar, peer.username);
  elements.detailsName.textContent = contactDisplayName(peer.username);
  elements.detailsStatus.textContent = peer.online ? "在线" : contact?.lastSeenAt ? `离线 · ${formatLastSeen(contact.lastSeenAt)}` : "离线";
  elements.detailsRole.textContent = contactRoleLabel(peer.username);
  if (elements.detailsNote) {
    elements.detailsNote.textContent = contact?.note || "未设置";
  }
  if (elements.detailsAccountId) {
    elements.detailsAccountId.textContent = `@${peer.username}`;
  }
  if (elements.detailsLastSeen) {
    elements.detailsLastSeen.textContent = peer.online ? "当前在线" : formatLastSeen(contact?.lastSeenAt || 0);
  }
  if (elements.detailsSafetyCode) {
    const requestedPeer = peer.username;
    elements.detailsSafetyCode.textContent = "计算中";
    void safetyCodeForPeer(requestedPeer).then((code) => {
      if (state.activePeer === requestedPeer) {
        elements.detailsSafetyCode.textContent = code;
      }
    });
  }
  if (elements.detailsVerifyCodeButton) {
    elements.detailsVerifyCodeButton.disabled = !state.peerKeys.has(peer.username);
  }
  if (elements.detailsTrustKeyButton) {
    const mismatch = state.peerKeyMismatches.has(peer.username);
    const unverified = state.peerKeyUnverified.has(peer.username);
    elements.detailsTrustKeyButton.hidden = !mismatch && !unverified;
    elements.detailsTrustKeyButton.textContent = mismatch ? "信任新密钥" : "验证并信任密钥";
  }
  elements.detailsAbout.textContent = contactAboutText(peer.username);
  elements.notificationsToggle.checked = !prefs.muted;
  if (elements.blockContactButtonLabel) {
    elements.blockContactButtonLabel.textContent = contact?.blocked ? "取消拉黑" : "拉黑";
  }
  if (elements.detailsCollapseButton) {
    elements.detailsCollapseButton.textContent = isDetailsDrawerLayout() ? "关闭" : "隐藏";
  }
  if (elements.editContactButton) {
    elements.editContactButton.disabled = false;
  }
}

function renderSidebar() {
  const query = state.searchQuery.trim().toLowerCase();
  const contactsMode = state.activeNavSection === "contacts";
  if (elements.globalSearchInput && elements.globalSearchInput.value !== state.searchQuery) {
    elements.globalSearchInput.value = state.searchQuery;
  }
  if (elements.sidebarSearchInput && elements.sidebarSearchInput.value !== state.searchQuery) {
    elements.sidebarSearchInput.value = state.searchQuery;
  }
  if (elements.sidebarTitle) {
    elements.sidebarTitle.textContent = contactsMode ? "联系人" : "最近消息";
  }
  if (elements.sidebarEyebrow) {
    elements.sidebarEyebrow.textContent = contactsMode ? "联系人列表" : "会话列表";
  }
  if (elements.addContactButton) {
    elements.addContactButton.hidden = !contactsMode;
  }
  if (state.workspaceLoading) {
    if (elements.sidebarMeta) {
      elements.sidebarMeta.textContent = "同步中";
    }
    elements.searchGroup.hidden = true;
    elements.pinnedGroup.hidden = true;
    elements.recentGroup.hidden = false;
    elements.conversationEmpty.hidden = true;
    elements.conversationList.textContent = "";
    for (let index = 0; index < 5; index += 1) {
      const skeleton = document.createElement("div");
      skeleton.className = "list-item is-skeleton";
      skeleton.innerHTML = `<div class="list-item-avatar"><div class="avatar"></div></div><div class="list-item-meta"><div class="skeleton-line"></div><div class="skeleton-line is-short"></div></div>`;
      elements.conversationList.append(skeleton);
    }
    return;
  }
  const localResults = query ? buildLocalSearchResults(query) : [];
  const contacts = state.contacts
    .filter((item) => {
      if (!query || !contactsMode) {
        return true;
      }
      return (
        String(item.username || "").toLowerCase().includes(query) ||
        String(item.usernameKey || "").toLowerCase().includes(query) ||
        String(item.note || "").toLowerCase().includes(query)
      );
    })
    .map((item) => ({
      username: item.username,
      usernameKey: item.usernameKey || "",
      online: Boolean(item.online),
      lastAt: Number(item.lastSeenAt || 0),
      previewText: item.blocked
        ? "已拉黑，双方消息已阻断"
        : item.online
          ? "当前在线"
          : item.lastSeenAt
            ? `最后在线 ${formatLastSeen(item.lastSeenAt)}`
            : "暂未公开在线状态",
      unread: 0
    }));
  const conversations = state.conversations.filter((item) => {
    if (!query) {
      return !contactsMode;
    }
    return (
      item.username.toLowerCase().includes(query) ||
      String(item.previewText || "").toLowerCase().includes(query)
      );
  });

  const pinnedConversations = contactsMode ? [] : conversations.filter((item) => peerPrefs(item.username).pinned);
  const recentConversations = contactsMode ? contacts : conversations.filter((item) => !peerPrefs(item.username).pinned);
  const visibleCount = contactsMode ? contacts.length : conversations.length;
  const mergedSearchRows = query
    ? (() => {
        const remoteResults = state.searchResults.map((user) => ({
          ...user,
          sourceLabel: "用户",
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
    : `${visibleCount} ${contactsMode ? "位联系人" : "个会话"}`;
  elements.searchGroup.hidden = !query;
  if (elements.pinnedGroup) {
    elements.pinnedGroup.hidden = contactsMode || query || pinnedConversations.length === 0;
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
  elements.conversationEmpty.hidden = query || recentConversations.length > 0;
  if (elements.conversationEmpty && !elements.conversationEmpty.hidden) {
    const emptyTitle = elements.conversationEmpty.querySelector("strong");
    const emptyText = elements.conversationEmpty.querySelector("span");
    if (emptyTitle) {
      emptyTitle.textContent = contactsMode ? "暂无联系人" : "暂无会话";
    }
    if (emptyText) {
      emptyText.textContent = contactsMode
        ? "搜索用户或开始聊天后，联系人会出现在这里。"
        : "在左上角搜索联系人，即可开始新的加密聊天。";
    }
  }
  for (const conversation of recentConversations) {
    elements.conversationList.append(renderListItem(conversation, false));
  }
}

function renderListItem(item, isSearchResult) {
  const prefs = peerPrefs(item.username);
  const draft = isSearchResult ? "" : draftTextForPeer(item.username).trim();

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
  const presence = document.createElement("i");
  presence.className = `online-dot${item.online ? " is-online" : ""}`;
  presence.setAttribute("aria-hidden", "true");
  avatarWrap.append(presence);

  const meta = document.createElement("div");
  meta.className = "list-item-meta";
  const primaryRow = document.createElement("div");
  primaryRow.className = "list-row";
  const primaryName = document.createElement("strong");
  primaryName.textContent = contactDisplayName(item.username);
  const primaryMeta = document.createElement("span");
  primaryMeta.textContent = isSearchResult ? (item.sourceLabel || (item.online ? "在线" : "离线")) : formatRelative(item.lastAt);
  primaryRow.append(primaryName, primaryMeta);
  const secondaryRow = document.createElement("div");
  secondaryRow.className = "list-row is-subtle";
  const preview = document.createElement("span");
  preview.className = "list-preview";
  preview.textContent = isSearchResult ? (item.searchHint || "发起新的加密会话") : messagePreview(item.previewText || "加密消息");
  const indicatorWrap = document.createElement("span");
  indicatorWrap.className = "list-indicators";
  if (!isSearchResult && draft) {
    const draftBadge = document.createElement("span");
    draftBadge.className = "draft-badge";
    draftBadge.textContent = "草稿";
    indicatorWrap.append(draftBadge);
  }
  if (item.unread) {
    const unread = document.createElement("b");
    unread.className = `unread-badge${prefs.muted ? " is-muted" : ""}`;
    unread.textContent = item.unread > 99 ? "99+" : String(item.unread);
    indicatorWrap.append(unread);
  }
  secondaryRow.append(preview, indicatorWrap);
  meta.append(primaryRow, secondaryRow);

  const flags = [];
  if (prefs.pinned) {
    flags.push("已置顶");
  }
  if (prefs.muted) {
    flags.push("免打扰");
  }
  if (isSearchResult && item.sourceLabel) {
    flags.push(item.sourceLabel);
  }
  if (flags.length > 0) {
    const flagRow = document.createElement("div");
    flagRow.className = "list-flags";
    for (const flag of flags) {
      const em = document.createElement("em");
      em.className = "list-flag";
      em.textContent = flag;
      flagRow.append(em);
    }
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
  const span = document.createElement("span");
  span.textContent = formatDaySeparator(timestamp);
  sep.append(span);
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

const RECEIPT_ICON_CLOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.4"></circle><path d="M8 5V8l2 1.3"></path></svg>`;
const RECEIPT_ICON_SINGLE = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 8.6l3.2 3.2L13 4"></path></svg>`;
const RECEIPT_ICON_DOUBLE = `<svg viewBox="0 0 20 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 8.6l3.2 3.2L12 4"></path><path d="M7.6 11.4l.4.4L18.5 4"></path></svg>`;
const RECEIPT_ICONS = {
  pending: RECEIPT_ICON_CLOCK,
  sent: RECEIPT_ICON_SINGLE,
  delivered: RECEIPT_ICON_DOUBLE,
  read: RECEIPT_ICON_DOUBLE
};

function messageReceiptMarkup(message) {
  if (!message.mine || message.recalled || message.failed) {
    return "";
  }
  let stateKey;
  let label;
  if (message.pending) {
    stateKey = "pending";
    label = message.sendStatus === "queued" ? "待发送" : "发送中";
  } else if (message.readAt) {
    stateKey = "read";
    label = "已读";
  } else if (message.deliveredAt) {
    stateKey = "delivered";
    label = "已送达";
  } else {
    stateKey = "sent";
    label = "已发送";
  }
  return `<span class="message-receipt is-${stateKey}" title="${label}" aria-label="${label}">${RECEIPT_ICONS[stateKey]}</span>`;
}

function attachmentMarkup(attachment, messageId) {
  const safeId = escapeHtml(messageId || "");
  const title = escapeHtml(attachment.name);
  const meta = escapeHtml(`${attachment.isImage ? "图片" : "文件"} · ${formatBytes(attachment.size)}`);
  const preview = attachment.isImage
    ? `<button class="attachment-preview" type="button" data-attachment-preview="${safeId}" aria-label="预览 ${title}"><img src="data:${escapeHtml(attachment.type)};base64,${attachment.data}" alt="${title}" loading="lazy" /></button>`
    : `<div class="attachment-file-icon" aria-hidden="true">FILE</div>`;
  return `<div class="bubble-file inline-file-card">${preview}<div class="attachment-copy"><strong>${title}</strong><span>${meta}</span></div><button class="ghost-button compact attachment-download" type="button" data-attachment-download="${safeId}">下载</button></div>`;
}

function renderMessage(message, options = {}) {
  const article = document.createElement("article");
  const isConsecutive = options.consecutive ? " is-consecutive" : "";
  const isSearchMatch = options.searchMatch ? " is-search-match" : "";
  article.className = `message ${message.mine ? "is-own" : "is-peer"}${message.pending ? " is-pending" : ""}${message.failed ? " is-failed" : ""}${message.replyTo ? " is-reply" : ""}${message.recalled ? " is-recalled" : ""}${isConsecutive}${isSearchMatch}`;
  article.dataset.messageId = message.id || message.tempId || "";
  const attachment = message.recalled ? null : parseAttachmentMessage(messagePlaintext(message));
  article.dataset.messageText = attachment ? `[附件] ${attachment.name}` : messagePlaintext(message);
  article.dataset.mine = message.mine ? "1" : "0";
  const replyAction = `<button class="message-reply-button" type="button" data-reply-id="${escapeHtml(message.id || message.tempId || "")}">\u56de\u590d</button>`;
  const recallAction = `<button class="message-recall-button" type="button" data-recall-id="${escapeHtml(message.id || message.tempId || "")}">\u64a4\u56de</button>`;
  const deleteAction = `<button class="message-delete-button" type="button" data-delete-id="${escapeHtml(message.id || message.tempId || "")}">\u5220\u9664</button>`;
  let statusAction = "";
  if (message.failed) {
    statusAction = `<span class="message-state is-error"><i class="dot"></i>\u53d1\u9001\u5931\u8d25</span><span class="message-meta-sep">·</span><button class="message-retry-button" type="button" data-temp-id="${escapeHtml(message.tempId || "")}">\u91cd\u8bd5</button>`;
  }
  const receiptMarkup = messageReceiptMarkup(message);
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
    ? `<div class="bubble bubble-recalled">${escapeHtml(recalledMessageLabel(message))}</div>`
    : attachment
      ? attachmentMarkup(attachment, message.id || message.tempId || "")
      : `<div class="bubble">${escapeHtml(messagePlaintext(message)).replaceAll("\n", "<br />")}</div>`;
  const metaParts = [escapeHtml(formatTime(message.createdAt))];
  if (statusAction && !message.recalled) metaParts.push(statusAction);
  const actionParts = [];
  if (!message.recalled) {
    if (message.id) {
      actionParts.push(replyAction);
    }
    actionParts.push(copyAction);
    if (message.mine && !message.pending && !message.failed && message.id) {
      actionParts.push(recallAction);
    }
  }
  if (message.id || message.tempId) {
    actionParts.push(deleteAction);
  }
  const avatarMarkup = isConsecutive
    ? ""
    : `<div class="message-avatar avatar avatar-tone-${avatarTone(message.from)}">${escapeHtml(avatarInitial(message.from))}</div>`;
  article.innerHTML = `
    ${message.mine ? "" : avatarMarkup}
    <div class="message-body">
      ${replyMarkup}
      ${bubbleMarkup}
      <div class="message-meta">
        <div class="message-meta-main">${metaParts.join('<span class="message-meta-sep">·</span>')}${receiptMarkup}</div>
        ${actionParts.length > 0 ? `<div class="message-actions">${actionParts.join("")}</div>` : ""}
      </div>
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
  elements.peerName.textContent = contactDisplayName(peer.username);
  let connectionLabel = "";
  if (state.connectionState === "reconnecting") {
    connectionLabel = " · 重连中";
  } else if (state.connectionState === "offline") {
    connectionLabel = " · 离线队列";
  }
  const prefs = peerPrefs(peer.username);
  const contact = contactRecord(peer.username);
  const statusTags = [];
  if (prefs.pinned) {
    statusTags.push("已置顶");
  }
  if (prefs.muted) {
    statusTags.push("免打扰");
  }
  if (contact?.blocked) {
    statusTags.push("已拉黑");
  } else if (contact?.blockedByPeer) {
    statusTags.push("被对方拉黑");
  }
  const threadQuery = state.threadSearchQuery.trim().toLowerCase();
  const basePresence = peer.online ? "在线" : contact?.lastSeenAt ? `最后在线 ${formatLastSeen(contact.lastSeenAt)}` : "离线";
  const peerStatusParts = [
    basePresence,
    { secureLabel: true }
  ];
  if (connectionLabel) {
    peerStatusParts.push(connectionLabel.replace(/^\s*·\s*/, ""));
  }
  peerStatusParts.push(...statusTags);
  elements.peerStatus.textContent = "";
  peerStatusParts.forEach((part, index) => {
    if (index > 0) {
      const sep = document.createElement("span");
      sep.className = "message-meta-sep";
      sep.textContent = "·";
      elements.peerStatus.append(sep);
    }
    if (part && typeof part === "object" && part.secureLabel) {
      const secureLabel = document.createElement("span");
      secureLabel.className = "secure-status-label";
      secureLabel.textContent = "端到端加密";
      const lockWrap = document.createElement("span");
      lockWrap.innerHTML = LOCK_ICON_MARKUP;
      secureLabel.append(lockWrap.firstElementChild || document.createTextNode(""));
      elements.peerStatus.append(secureLabel);
      return;
    }
    const textNode = document.createTextNode(String(part || ""));
    elements.peerStatus.append(textNode);
  });
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
    const strong = document.createElement("strong");
    strong.textContent = peer.username;
    const span = document.createElement("span");
    span.textContent = "暂无消息，发送第一条加密消息开始会话。";
    empty.append(strong, span);
    elements.messageList.append(empty);
  } else if (visibleMessages.length === 0) {
    const empty = document.createElement("div");
    empty.className = "message-empty";
    const strong = document.createElement("strong");
    strong.textContent = "没有匹配的消息";
    const span = document.createElement("span");
    span.textContent = "请尝试缩短关键词，或清空当前会话搜索。";
    empty.append(strong, span);
    elements.messageList.append(empty);
  } else {
    if (virtualWindow && virtualWindow.start > 0) {
      elements.messageList.append(createSpacer(virtualWindow.topSpacer));
    }
    const slice = virtualWindow ? visibleMessages.slice(virtualWindow.start, virtualWindow.end) : visibleMessages;
    const sliceStart = virtualWindow ? virtualWindow.start : 0;
    let prevMessage = sliceStart > 0 ? visibleMessages[sliceStart - 1] : null;
    let lastDayKey = prevMessage ? new Date(prevMessage.createdAt || 0).toDateString() : "";
    for (let index = 0; index < slice.length; index += 1) {
      const message = slice[index];
      const dayKey = new Date(message.createdAt || 0).toDateString();
      if (dayKey && dayKey !== lastDayKey) {
        elements.messageList.append(createDaySeparator(message.createdAt || Date.now()));
        lastDayKey = dayKey;
        prevMessage = null;
      }
      const consecutive = isMessageConsecutive(prevMessage, message);
      elements.messageList.append(renderMessage(message, { consecutive, searchMatch: Boolean(threadQuery) }));
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
  syncReplyState();
  if (scrollBehavior === "bottom") {
    scrollMessagesToBottom(true);
    return;
  }
  const preservePrependedMessages = scrollBehavior === "preserve-prepend";
  if (virtualWindow) {
    elements.messageList.scrollTop = preservePrependedMessages && previousScrollHeight > 0
      ? previousScrollTop + (elements.messageList.scrollHeight - previousScrollHeight)
      : previousScrollTop;
    updateScrollBottomButton();
    return;
  }
  if (previousScrollHeight > 0) {
    elements.messageList.scrollTop = previousScrollTop + (elements.messageList.scrollHeight - previousScrollHeight);
  }
  updateScrollBottomButton();
}

function render() {
  syncLayoutState();
  elements.workspace?.classList.toggle("is-loading", state.workspaceLoading);
  setActiveNavSection(state.activeNavSection);
  renderThread();
  renderAttachmentTransfers();
  if (state.settingsDialogOpen) {
    populateSettingsDialog();
  }
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

async function importPrivateKey(privateKeyPkcs8Base64, extractable = false) {
  return crypto.subtle.importKey(
    "pkcs8",
    base64ToBytes(privateKeyPkcs8Base64),
    { name: "ECDH", namedCurve: "P-256" },
    Boolean(extractable),
    ["deriveBits"]
  );
}

async function createIdentity() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateKeyPkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", keyPair.privateKey));
  const publicKeyBase64 = bytesToBase64(publicKeyRaw);
  const privateKey = await importPrivateKey(bytesToBase64(privateKeyPkcs8), false);
  const storageKey = await createDeviceStorageKey();

  return {
    publicKey: keyPair.publicKey,
    privateKey,
    publicKeyBase64,
    privateKeyPkcs8Base64: bytesToBase64(privateKeyPkcs8),
    storageKey
  };
}

async function restoreIdentity(username, expectedPublicKeyBase64 = "") {
  const stored = await readStoredIdentity(username);
  if (!stored) {
    return null;
  }
  if (expectedPublicKeyBase64 && stored.publicKeyBase64 !== expectedPublicKeyBase64) {
    throw new Error("当前设备密钥与账号加密身份不一致，请重新登录后恢复或重建设备身份");
  }
  try {
    const publicKey = await importPublicKey(stored.publicKeyBase64);
    state.importedPeerKeys.delete(stored.publicKeyBase64);
    return {
      username,
      publicKey,
      privateKey: stored.privateKey,
      publicKeyBase64: stored.publicKeyBase64,
      privateKeyPkcs8Base64: stored.privateKeyPkcs8Base64,
      storageKey: stored.storageKey
    };
  } catch (error) {
    throw new Error("当前设备本地私钥不可用，请重新登录后恢复加密身份");
  }
}

async function loadPeerPrekeyBundle(peerUsername) {
  const bundle = await api(`/prekey-bundle/${encodeURIComponent(peerUsername)}`);
  const publicKey = String(bundle.identityKey || bundle.publicKey || "");
  if (!publicKey) {
    throw new Error("对端没有可用公钥");
  }
  if (bundle.capabilities && bundle.capabilities.zeroKnowledgeMessages !== true) {
    throw new Error("对端密钥包不支持端到端加密消息");
  }
  cachePeerInfo({ username: bundle.username || peerUsername, publicKey });
  return state.peerKeys.get(peerUsername) || publicKey;
}

async function getConversationKey(peerUsername, peerPublicKeyBase64) {
  if (!state.identity || !state.me) {
    throw new Error("本地密钥未就绪");
  }
  const observedKey = peerPublicKeyBase64 || state.peerObservedKeys.get(peerUsername) || state.peerKeys.get(peerUsername);
  if (observedKey) {
    cachePeerInfo({ username: peerUsername, publicKey: observedKey });
  }
  if (state.peerKeyMismatches.has(peerUsername)) {
    throw new Error("联系人安全密钥已改变，请确认后再继续聊天");
  }
  let rawPeerKey = state.peerKeys.get(peerUsername);
  if (!rawPeerKey) {
    rawPeerKey = await loadPeerPrekeyBundle(peerUsername);
  }
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
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: aadBytes(message.from, message.to)
    },
    conversationKey,
    payload
  );
  return textDecoder.decode(plaintext);
}

async function decryptMessageView(message, peerPublicKeyBase64, fallbackPeer = "") {
  let text = "";
  const recalled = Boolean(message?.recalled);
  if (recalled) {
    text = message.from === state.me?.username ? "你撤回了一条消息" : "对方撤回了一条消息";
  } else if (!message?.ciphertext || !message?.nonce) {
    text = "[无法解密]";
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
    clientId: String(message.clientId || ""),
    recalled,
    replyTo: message.replyTo || null,
    text,
    createdAt: message.createdAt,
    deliveredAt: Number(message.deliveredAt) || 0,
    readAt: Number(message.readAt) || 0
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
      unread: Math.max(Number(conversation.unread || 0), Number(getConversation(conversation.username)?.unread || 0)),
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

async function loadContacts() {
  const payload = await api("/api/contacts");
  state.contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
  for (const contact of state.contacts) {
    const saved = peerPrefs(contact.username);
    updatePeerPrefs(contact.username, {
      pinned: contact.prefsVersion ? Boolean(contact.pinned) : saved.pinned,
      muted: contact.prefsVersion ? Boolean(contact.muted) : saved.muted
    });
  }
  sortConversations();
}

async function loadSecuritySettings() {
  const [settingsPayload, sessionsPayload] = await Promise.all([
    api("/api/me/settings"),
    api("/api/me/sessions")
  ]);
  state.securitySettings = {
    showOnlineStatus: settingsPayload?.settings?.showOnlineStatus !== false,
    allowUserSearch: settingsPayload?.settings?.allowUserSearch !== false,
    blockedUsers: Array.isArray(settingsPayload?.blockedUsers) ? settingsPayload.blockedUsers : []
  };
  state.deviceSessions = Array.isArray(sessionsPayload?.sessions) ? sessionsPayload.sessions : [];
  return state.deviceSessions;
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
      if (entry && !entry.transient) {
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

function messageIdentitySet(message) {
  const values = [message?.id, message?.clientId, message?.tempId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  return new Set(values);
}

function messagesShareIdentity(left, right) {
  const leftIds = messageIdentitySet(left);
  if (leftIds.size === 0) {
    return false;
  }
  for (const value of messageIdentitySet(right)) {
    if (leftIds.has(value)) {
      return true;
    }
  }
  return false;
}

function mergeCachedMessage(current, incoming) {
  const currentDeliveredAt = Number(current?.deliveredAt || 0);
  const incomingDeliveredAt = Number(incoming?.deliveredAt || 0);
  const currentReadAt = Number(current?.readAt || 0);
  const incomingReadAt = Number(incoming?.readAt || 0);
  const recalled = Boolean(current?.recalled || incoming?.recalled);
  return {
    ...incoming,
    recalled,
    text: recalled && current?.recalled && !incoming?.recalled ? current.text : incoming.text,
    pending: Boolean(incoming?.pending),
    failed: Boolean(incoming?.failed),
    deliveredAt: Math.max(currentDeliveredAt, incomingDeliveredAt),
    readAt: Math.max(currentReadAt, incomingReadAt)
  };
}

function upsertMessageInCache(peer, incoming) {
  if (!peer || !incoming) {
    return { inserted: false, replaced: false };
  }
  const current = state.messageCache.get(peer) || [];
  const next = [];
  let replaced = false;
  for (const message of current) {
    if (!messagesShareIdentity(message, incoming)) {
      next.push(message);
      continue;
    }
    if (!replaced) {
      next.push(mergeCachedMessage(message, incoming));
      replaced = true;
    }
  }
  if (!replaced) {
    next.push(incoming);
  }
  next.sort((left, right) => left.createdAt - right.createdAt);
  state.messageCache.set(peer, next);
  rebuildConversationSearchIndex(peer);
  return { inserted: !replaced, replaced };
}

function addPendingMessage(peer, text, replyTo = null) {
  const pending = buildTempMessage(peer, text, replyTo);
  upsertMessageInCache(peer, pending);
  const transient = Boolean(parseAttachmentMessage(text));
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
    lastError: "",
    transient
  });
  if (!transient) {
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
  }
  upsertConversation({
    username: peer,
    online: getConversation(peer)?.online || false,
    avatarSeed: peer,
    publicKey: state.peerKeys.get(peer) || "",
    previewText: conversationMessageLabel(pending),
    lastAt: pending.createdAt
  });
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
      return tempId;
    }
    if (!clientId) {
      const sameText = String(pending.text || "") === String(incomingMessage?.text || "");
      const withinWindow = Math.abs((pending.createdAt || 0) - Number(incomingMessage?.createdAt || 0)) <= 60000;
      if (sameText && withinWindow) {
        state.pendingMessages.delete(tempId);
        removePendingMessageFromCache(tempId);
        removePendingOutboxEntry(tempId);
        return tempId;
      }
    }
  }
  return "";
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

  const switchingPeer = Boolean(state.activePeer && state.activePeer !== username);
  if (switchingPeer) {
    stopTypingSignal();
  }
  clearIncomingTyping();
  closeEmojiPanel();
  hideMessageContextMenu();
  ensureConversationEntry(username);
  state.activePeer = username;
  state.detailsPanelOpen = false;
  saveActivePeer(username);
  clearReplyTarget();
  state.threadSearchQuery = "";
  elements.threadSearchInput.value = "";
  elements.messageInput.value = draftTextForPeer(username);
  autoResizeComposer();
  if (switchingPeer && elements.chatThread) {
    elements.chatThread.classList.remove("is-switching");
    void elements.chatThread.offsetWidth;
    elements.chatThread.classList.add("is-switching");
  }
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
    const decryptedMessages = hydrateReplyTargets(await Promise.all(
      payload.messages.map(async (message) => {
        const peerPublicKey = message.publicKey || payload.peer.publicKey;
        return decryptMessageView(message, peerPublicKey, payload.peer.username);
      })
    ), username);

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
    updateNotificationBadge();
    renderThread({ scrollBehavior: "bottom" });
    void markConversationRead(username);
  } catch (error) {
    if (state.peerKeyMismatches.has(username)) {
      render();
    }
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
    const olderMessages = hydrateReplyTargets(await Promise.all(
      payload.messages.map(async (message) => {
        const peerPublicKey = message.publicKey || payload.peer.publicKey;
        return decryptMessageView(message, peerPublicKey, payload.peer.username);
      })
    ), peer);
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
    renderThread({ scrollBehavior: "preserve-prepend" });
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
  stopTypingSignal();
  clearIncomingTyping();
  closeEmojiPanel();
  hideMessageContextMenu();
  clearReplyTarget();
  state.activePeer = "";
  state.detailsPanelOpen = false;
  saveActivePeer("");
  render();
}

function focusGlobalSearch() {
  if (isMobile() && state.activePeer) {
    state.activePeer = "";
    state.detailsPanelOpen = false;
    saveActivePeer("");
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
    saveActivePeer("");
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
  state.contacts = state.contacts.map((item) =>
    item.username === username ? { ...item, online } : item
  );
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
    for (const key of [
      STORAGE.accountProfile,
      STORAGE.contactProfiles,
      STORAGE.conversationPrefs,
      STORAGE.drafts,
      STORAGE.pendingOutbox,
      STORAGE.activePeer,
      STORAGE.peerSecurityMeta,
      STORAGE.peerKeyPins
    ]) {
      renameScopedStorageOwner(key, previousUsername, nextUsername);
    }
    await renameDeviceVaultRecord(previousUsername, nextUsername);
    state.me = {
      ...state.me,
      username: nextUsername
    };
    if (elements.meUsername) {
      elements.meUsername.textContent = accountDisplayName();
    }
    setAvatar(elements.meAvatar, nextUsername);
  }

  if (state.activePeer === previousUsername) {
    state.activePeer = nextUsername;
    saveActivePeer(nextUsername);
  }

  if (Object.prototype.hasOwnProperty.call(state.drafts, previousUsername)) {
    state.drafts[nextUsername] = state.drafts[previousUsername];
    delete state.drafts[previousUsername];
    saveDrafts();
  }
  if (Object.prototype.hasOwnProperty.call(state.peerKeyPins, previousUsername)) {
    state.peerKeyPins[nextUsername] = state.peerKeyPins[previousUsername];
    delete state.peerKeyPins[previousUsername];
    savePeerKeyPins();
  }
  if (Object.prototype.hasOwnProperty.call(state.peerSecurityMeta, previousUsername)) {
    state.peerSecurityMeta[nextUsername] = state.peerSecurityMeta[previousUsername];
    delete state.peerSecurityMeta[previousUsername];
    savePeerSecurityMeta();
  }
  if (state.peerObservedKeys.has(previousUsername)) {
    state.peerObservedKeys.set(nextUsername, state.peerObservedKeys.get(previousUsername));
    state.peerObservedKeys.delete(previousUsername);
  }
  if (state.peerKeyMismatches.delete(previousUsername)) {
    state.peerKeyMismatches.add(nextUsername);
  }
  if (state.peerKeyUnverified.delete(previousUsername)) {
    state.peerKeyUnverified.add(nextUsername);
  }
  if (Object.prototype.hasOwnProperty.call(state.contactProfiles, previousUsername)) {
    state.contactProfiles[nextUsername] = state.contactProfiles[previousUsername];
    delete state.contactProfiles[previousUsername];
    saveContactProfiles();
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
  state.outboundInFlight.clear();
  state.contacts = [];
  syncPendingMessagesFromOutbox();
  hydratePendingMessagesIntoCache();

  await loadConversations();
  await loadContacts();
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
      text: "[无法解密]",
      createdAt: message.createdAt
    };
  }
  decrypted.replyTo = resolveReplyTargetText(decrypted.replyTo, peer);

  if (decrypted.mine) {
    decrypted.sendStatus = "sent";
    const reconciledTempId = reconcilePendingMessage(peer, message);
    if (reconciledTempId && messageExists(peer, message.id, message.clientId)) {
      return;
    }
  }

  upsertMessageInCache(peer, decrypted);

  const previous = getConversation(peer);
  const muted = peerPrefs(peer).muted;
  const unread = !decrypted.mine && state.activePeer !== peer ? (previous?.unread || 0) + 1 : 0;

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
    previewText: conversationMessageLabel(decrypted),
    lastAt: message.createdAt,
    unread
  });
  rebuildConversationSearchIndex(peer);

  if (!decrypted.mine && peer === state.activePeer) {
    clearIncomingTyping();
  }
  if (state.activePeer === peer) {
    const stickToBottom = message.mine || isNearBottom(elements.messageList);
    renderThread({ scrollBehavior: stickToBottom ? "bottom" : "preserve" });
    if (!stickToBottom) {
      state.scrollBottomNewCount += 1;
    }
    updateScrollBottomButton();
    if (!decrypted.mine && document.visibilityState !== "hidden") {
      void markConversationRead(peer);
    }
  } else {
    renderSidebar();
  }
  if (!decrypted.mine) {
    addNotification(peer, conversationMessageLabel(decrypted), decrypted.createdAt);
    if (muted) {
      showToast(`收到 ${contactDisplayName(peer)} 的新消息（免打扰）`);
    }
  }
  updateNotificationBadge();
}

function applyReceiptUpdate(peer, messageIds, kind, timestamp) {
  const cache = state.messageCache.get(peer);
  if (!cache) {
    return;
  }
  const idSet = new Set(Array.isArray(messageIds) ? messageIds : []);
  const stamp = Number(timestamp) || Date.now();
  let changed = false;
  for (const message of cache) {
    if (!message.mine) {
      continue;
    }
    if (idSet.size > 0 && !idSet.has(message.id)) {
      continue;
    }
    if (kind === "read" && !message.readAt) {
      message.readAt = stamp;
      changed = true;
    }
    if (!message.deliveredAt) {
      message.deliveredAt = stamp;
      changed = true;
    }
  }
  if (changed && state.activePeer === peer) {
    renderThread({ scrollBehavior: "preserve" });
  }
}

function applyConversationReadUpdate(peer, messageIds, timestamp) {
  const cache = state.messageCache.get(peer);
  const idSet = new Set(Array.isArray(messageIds) ? messageIds : []);
  const stamp = Number(timestamp) || Date.now();
  let changed = false;
  if (cache) {
    for (const message of cache) {
      if (message.mine) {
        continue;
      }
      if (idSet.size > 0 && !idSet.has(message.id)) {
        continue;
      }
      if (!message.readAt) {
        message.readAt = stamp;
        changed = true;
      }
      if (!message.deliveredAt) {
        message.deliveredAt = stamp;
        changed = true;
      }
    }
  }
  const conversation = getConversation(peer);
  if (conversation && conversation.unread !== 0) {
    conversation.unread = 0;
    changed = true;
  }
  if (!changed) {
    return;
  }
  renderSidebar();
  updateNotificationBadge();
  if (state.activePeer === peer) {
    renderThread({ scrollBehavior: "preserve" });
  }
}

async function markConversationRead(peer) {
  if (!peer || !state.authenticated) {
    return;
  }
  try {
    await api("/api/messages/read", { method: "POST", body: { peer } });
  } catch (error) {
    // Ignore read-receipt failures; they are best-effort.
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
  if (silent && state.realtimeTakeoverPaused) {
    return;
  }
  if (!silent) {
    state.realtimeTakeoverPaused = false;
  }
  void openEventStream().catch((error) => {
    state.connectionState = "offline";
    renderThread();
    if (!silent) {
      showToast(error.message || "实时连接失败");
    }
  });
}

function parseSsePayload(event, fallback = {}) {
  try {
    return JSON.parse(event?.data || "{}");
  } catch (error) {
    return fallback;
  }
}

async function openEventStream() {
  closeEventStream();
  state.connectionState = "connecting";
  renderThread();

  const ticket = await createEventTicket();
  if (!state.authenticated) {
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
    const payload = parseSsePayload(event, { onlineUsers: [] });
    for (const username of payload.onlineUsers || []) {
      mergePresence(username, true);
    }
  });

  source.addEventListener("presence", (event) => {
    const payload = parseSsePayload(event);
    mergePresence(payload.username, payload.online);
  });

  source.addEventListener("user-renamed", (event) => {
    const payload = parseSsePayload(event);
    void handleUserRenamed(payload);
  });

  source.addEventListener("message", (event) => {
    const payload = parseSsePayload(event);
    void ingestEncryptedMessage(payload);
  });

  source.addEventListener("typing", (event) => {
    const payload = parseSsePayload(event);
    handleIncomingTyping(payload);
  });

  source.addEventListener("message-recalled", (event) => {
    const payload = parseSsePayload(event);
    handleRemoteRecall(payload);
  });

  source.addEventListener("message-deleted", (event) => {
    const payload = parseSsePayload(event);
    handleRemoteDelete(payload);
  });

  source.addEventListener("message-delivered", (event) => {
    const payload = parseSsePayload(event);
    applyReceiptUpdate(payload.peer, payload.messageIds, "delivered", payload.deliveredAt);
  });

  source.addEventListener("message-read", (event) => {
    const payload = parseSsePayload(event);
    applyReceiptUpdate(payload.peer, payload.messageIds, "read", payload.readAt);
  });

  source.addEventListener("conversation-read", (event) => {
    const payload = parseSsePayload(event);
    applyConversationReadUpdate(payload.peer, payload.messageIds, payload.readAt);
  });

  source.addEventListener("contact-blocked", () => {
    void loadContacts()
      .then(() => render())
      .catch(() => {});
  });

  source.addEventListener("system", (event) => {
    const payload = parseSsePayload(event);
    if (payload.reason !== "signed in on another device") {
      return;
    }
    state.realtimeTakeoverPaused = true;
    state.manualEventSourceClose = true;
    if (state.reconnectTimer) {
      window.clearTimeout(state.reconnectTimer);
      state.reconnectTimer = 0;
    }
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }
    state.connectionState = "offline";
    renderThread();
    showToast("账号已在其他设备上线，本设备已停止实时同步", "error");
  });

  source.addEventListener("error", () => {
    if (state.manualEventSourceClose || state.realtimeTakeoverPaused || !state.authenticated) {
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
      if (!state.authenticated) {
        return;
      }
      try {
        await api("/api/me");
      } catch (error) {
        if (!state.authenticated) {
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
  state.workspaceLoading = true;
  render();
  try {
    await Promise.all([loadConversations(), loadContacts()]);
    startEventStream();
    void flushPendingOutbox();

    const savedPeer = readActivePeer();
    render();
    if (savedPeer && state.peerKeys.has(savedPeer)) {
      await openConversation(savedPeer);
    }
  } finally {
    state.workspaceLoading = false;
    render();
  }
  elements.workspace?.classList.remove("is-entering");
  void elements.workspace?.offsetWidth;
  elements.workspace?.classList.add("is-entering");
  elements.workspace?.addEventListener("animationend", () => {
    elements.workspace?.classList.remove("is-entering");
  }, { once: true });
}

async function syncServerKeyBundle(password, identity, options = {}) {
  if (!identity?.privateKeyPkcs8Base64) {
    return null;
  }
  const payload = {
    keyBundle: await buildPortableKeyBundle(identity.privateKeyPkcs8Base64, password)
  };
  if (options.publicKey) {
    payload.publicKey = options.publicKey;
  }
  if (options.rotateIdentity) {
    payload.rotateIdentity = true;
    payload.currentPassword = password;
  }
  return api("/api/me/key-bundle", {
    method: "POST",
    body: payload
  });
}

async function recoverAccountIdentity(user, password) {
  const identity = await createIdentity();
  const response = await syncServerKeyBundle(password, identity, {
    publicKey: identity.publicKeyBase64,
    rotateIdentity: true
  });
  return {
    user: response?.user || {
      ...user,
      publicKey: identity.publicKeyBase64
    },
    identity
  };
}

async function submitAuth(event) {
  event.preventDefault();
  if (state.authBusy) {
    return;
  }

  const username = elements.authUsernameInput.value.trim();
  const password = String(elements.authPasswordInput.value || "");
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
  setAuthFeedback(state.authMode === "login" ? "正在验证账号并恢复加密身份..." : "正在创建账号和加密身份...");
  try {
    let payload;
    let identity;
    let user;

    if (state.authMode === "register") {
      identity = await createIdentity();
      payload = await api("/api/register", {
        method: "POST",
        body: {
          username,
          password,
          publicKey: identity.publicKeyBase64,
          keyBundle: await buildPortableKeyBundle(identity.privateKeyPkcs8Base64, password)
        }
      });
      user = payload.user;
    } else {
      payload = await api("/api/login", {
        method: "POST",
        body: { username, password }
      });
      user = payload.user;
      identity = await restoreIdentity(payload.user.username, payload.user.publicKey);
      if (!identity) {
        identity = await restoreIdentityFromPortableBundle(
          payload.user.username,
          payload.user.publicKey,
          payload.keyBundle,
          password
        );
      }
      if (!identity) {
        const recovered = await recoverAccountIdentity(payload.user, password);
        identity = recovered.identity;
        user = recovered.user;
        showToast("已在当前设备重新建立加密身份，旧消息可能需要重新验证或无法解密");
      }
    }

    setSession(user, identity);
    await persistSessionIdentity(identity, user.username);
    if (state.authMode === "login" && !normalizeKeyBundlePayload(payload?.keyBundle) && identity.privateKeyPkcs8Base64) {
      try {
        await syncServerKeyBundle(password, identity);
      } catch (error) {
        showToast("当前设备已登录，但尚未完成多设备密钥同步");
      }
    }
    elements.authPasswordInput.value = "";
    await afterLogin();
    showToast(state.authMode === "login" ? "登录成功，已恢复加密会话" : "注册成功，已创建加密会话");
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
  if (state.outboundInFlight.has(tempId)) {
    return false;
  }
  state.outboundInFlight.add(tempId);
  try {
    if (state.connectionState !== "online") {
      setPendingMessageState(tempId, "queued");
      setAttachmentTransferForTempId(tempId, "failed", "离线状态下不支持附件发送");
      renderThread({ scrollBehavior: "bottom" });
      if (!silent) {
        showToast("当前离线，消息会在本页联网后自动发送，刷新页面会丢失");
      }
      return false;
    }
    setPendingMessageState(tempId, "sending");
    setAttachmentTransferForTempId(tempId, "sending", "正在上传密文附件");
    const encrypted = await encryptOutboundMessage(peer, text);
    const payload = await api(parseAttachmentMessage(text) ? "/api/messages/attachment" : "/api/messages", {
      method: "POST",
      body: {
        to: peer,
        clientId,
        replyToId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    state.pendingMessages.delete(tempId);
    removePendingMessageFromCache(tempId);
    removePendingOutboxEntry(tempId);
    const existing = (state.messageCache.get(peer) || []).find((message) => messagesShareIdentity(message, payload.message));
    if (!existing) {
      await ingestEncryptedMessage(payload.message);
    }
    syncConversationFromCache(peer);
    renderSidebar();
    if (state.replyTarget?.id === replyToId) {
      clearReplyTarget();
    }
    setAttachmentTransferForTempId(tempId, "done", "密文附件已送达服务器");
    if (!silent) {
      showToast("\u5df2\u53d1\u9001");
    }
    return true;
  } catch (error) {
    setPendingMessageState(tempId, "failed", error.message);
    setAttachmentTransferForTempId(tempId, "failed", error.message || "发送失败");
    renderThread();
    if (!silent) {
      showToast(error.message);
    }
    return false;
  } finally {
    state.outboundInFlight.delete(tempId);
  }
}

async function submitMessage(event) {
  event.preventDefault();
  if (!state.activePeer) {
    return;
  }
  if (state.peerKeyMismatches.has(state.activePeer)) {
    showToast("联系人密钥已变化，请先在联系人详情中确认", "error");
    return;
  }
  if (state.peerKeyUnverified.has(state.activePeer)) {
    showToast("请先在联系人详情中核对安全码并信任该密钥", "error");
    return;
  }
  const contact = contactRecord(state.activePeer);
  if (contact?.blocked || contact?.blockedByPeer) {
    showToast(contact.blocked ? "您已拉黑对方，解除后才能继续互动" : "对方已将您拉黑，暂时无法发送消息", "error");
    return;
  }
  if (state.submitInFlight) {
    return;
  }

  const text = elements.messageInput.value.trim();
  if (!text) {
    return;
  }

  setSubmitInFlight(true);

  const peer = state.activePeer;
  const replyTo = state.replyTarget ? { ...state.replyTarget } : null;
  const tempId = addPendingMessage(peer, text, replyTo);
  setDraftForPeer(peer, "");
  elements.messageInput.value = "";
  stopTypingSignal();
  autoResizeComposer();
  closeEmojiPanel();
  if (elements.sendButton) {
    elements.sendButton.classList.remove("is-sent-feedback");
    void elements.sendButton.offsetWidth;
    elements.sendButton.classList.add("is-sent-feedback");
  }
  renderThread({ scrollBehavior: "bottom" });
  renderSidebar();
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
    setSubmitInFlight(false);
    return;
  }
  void sendMessageWithRetry(tempId, peer, text, tempId, false, replyTo?.id || "")
    .finally(() => setSubmitInFlight(false));
}

async function retryPendingMessage(tempId) {
  const pending = state.pendingMessages.get(tempId);
  if (!pending || pending.sendStatus === "sending" || state.outboundInFlight.has(tempId)) {
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

function removeMessageFromConversationCache(peer, messageId) {
  if (!peer || !messageId) {
    return null;
  }
  const messages = state.messageCache.get(peer) || [];
  const target = messages.find((item) => item.id === messageId || item.tempId === messageId);
  if (!target) {
    return null;
  }
  const next = messages.filter((item) => item !== target);
  state.messageCache.set(peer, next);
  if (target.tempId) {
    removePendingOutboxEntry(target.tempId);
    state.pendingMessages.delete(target.tempId);
  }
  syncConversationFromCache(peer);
  return target;
}

async function recallMessageById(peer, messageId) {
  const target = findMessageById(peer, messageId);
  if (!target || !target.mine || target.recalled) {
    return;
  }
  const messageNode = elements.messageList?.querySelector(`[data-message-id="${messageId}"]`);
  if (messageNode) {
    messageNode.classList.add("is-recalling");
  }
  try {
    if (messageNode) {
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
    const serverId = target.id || messageId;
    if (serverId && !target.tempId) {
      await api("/api/messages/recall", { method: "POST", body: { messageId: serverId } });
    }
    if (target.recalled) {
      return;
    }
    target.recalled = true;
    target.text = "";
    if (target.tempId) {
      removePendingOutboxEntry(target.tempId);
      state.pendingMessages.delete(target.tempId);
    }
    syncConversationFromCache(peer);
    renderSidebar();
    renderThread({ scrollBehavior: "preserve" });
    showToast("\u6d88\u606f\u5df2\u64a4\u56de");
  } catch (error) {
    showToast(error.message || "\u64a4\u56de\u5931\u8d25", "error");
  } finally {
    messageNode?.classList.remove("is-recalling");
  }
}

function handleRemoteRecall(payload) {
  const peer = payload.peer;
  const messageId = payload.messageId;
  if (!peer || !messageId) return;
  const messages = state.messageCache.get(peer) || [];
  const target = messages.find((item) => item.id === messageId);
  if (!target || target.recalled) return;
  target.recalled = true;
  target.text = "";
  syncConversationFromCache(peer);
  renderSidebar();
  if (state.activePeer === peer) {
    renderThread({ scrollBehavior: "preserve" });
  }
}

async function deleteMessageById(peer, messageId) {
  const target = findMessageById(peer, messageId);
  if (!target) {
    return;
  }
  const confirmed = await confirmActionDialog({
    title: "删除消息",
    message: "确认删除这条消息吗？删除后仅会从当前账号的会话视图中移除。",
    confirmLabel: "删除"
  });
  if (!confirmed) {
    return;
  }
  const messageNode = elements.messageList?.querySelector(`[data-message-id="${messageId}"]`);
  if (messageNode) {
    messageNode.classList.add("is-recalling");
  }
  const serverId = target.id || "";
  try {
    if (serverId) {
      await api("/api/messages/delete", {
        method: "POST",
        body: { messageId: serverId }
      });
    }
  } catch (error) {
    messageNode?.classList.remove("is-recalling");
    showToast(error.message || "删除失败", "error");
    return;
  }
  if (!removeMessageFromConversationCache(peer, messageId)) {
    removeMessageFromConversationCache(peer, serverId);
  }
  renderSidebar();
  if (state.activePeer === peer) {
    renderThread({ scrollBehavior: isNearBottom(elements.messageList) ? "bottom" : "preserve" });
  }
  showToast("消息已删除");
}

function handleRemoteDelete(payload) {
  const peer = String(payload?.peer || "").trim();
  const messageId = String(payload?.messageId || "").trim();
  if (!peer || !messageId) {
    return;
  }
  if (!removeMessageFromConversationCache(peer, messageId)) {
    return;
  }
  renderSidebar();
  if (state.activePeer === peer) {
    renderThread({ scrollBehavior: "preserve" });
  }
}

function handleListClick(event) {
  if (!isElementNode(event.target)) {
    return;
  }
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
    if (elements.messageInput.value.trim()) {
      notifyTypingActivity();
    } else {
      stopTypingSignal();
    }
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

function attachmentForMessageId(messageId) {
  const message = findMessageById(state.activePeer, messageId);
  return message ? parseAttachmentMessage(messagePlaintext(message)) : null;
}

function attachmentBlob(attachment) {
  return new Blob([base64ToBytes(attachment.data)], { type: attachment.type || "application/octet-stream" });
}

function downloadAttachment(messageId) {
  const attachment = attachmentForMessageId(messageId);
  if (!attachment) {
    showToast("附件已失效或无权访问", "error");
    return;
  }
  try {
    const url = URL.createObjectURL(attachmentBlob(attachment));
    const link = document.createElement("a");
    link.href = url;
    link.download = attachment.name;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showToast("附件下载失败", "error");
  }
}

function previewAttachment(messageId) {
  const attachment = attachmentForMessageId(messageId);
  if (!attachment?.isImage) {
    showToast("图片已失效或无法预览", "error");
    return;
  }
  const overlay = document.createElement("div");
  overlay.className = "attachment-lightbox";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const closeButton = document.createElement("button");
  closeButton.className = "attachment-lightbox-close";
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "关闭预览");
  closeButton.textContent = "×";
  const image = document.createElement("img");
  image.src = `data:${attachment.type};base64,${attachment.data}`;
  image.alt = attachment.name;
  const meta = document.createElement("span");
  meta.textContent = `${attachment.name} · ${formatBytes(attachment.size)}`;
  overlay.append(closeButton, image, meta);
  const close = () => {
    document.body.classList.remove("is-lightbox-open");
    document.removeEventListener("keydown", handleKeydown);
    overlay.remove();
  };
  const handleKeydown = (event) => {
    if (event.key === "Escape") {
      close();
    }
  };
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay || event.target.closest(".attachment-lightbox-close")) {
      close();
    }
  });
  document.body.classList.add("is-lightbox-open");
  document.addEventListener("keydown", handleKeydown);
  document.body.append(overlay);
  closeButton.focus();
}

function handleMessageListClick(event) {
  if (!isElementNode(event.target)) {
    return;
  }
  hideMessageContextMenu();
  const loadOlderButton = event.target.closest(".message-load-older-button");
  if (loadOlderButton) {
    const peer = loadOlderButton.dataset.loadOlderPeer || "";
    void loadOlderMessages(peer);
    return;
  }
  const attachmentPreviewButton = event.target.closest("[data-attachment-preview]");
  if (attachmentPreviewButton) {
    previewAttachment(attachmentPreviewButton.dataset.attachmentPreview || "");
    return;
  }
  const attachmentDownloadButton = event.target.closest("[data-attachment-download]");
  if (attachmentDownloadButton) {
    downloadAttachment(attachmentDownloadButton.dataset.attachmentDownload || "");
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
  const recallButton = event.target.closest(".message-recall-button");
  if (recallButton && state.activePeer) {
    void recallMessageById(state.activePeer, recallButton.dataset.recallId || "");
    return;
  }
  const deleteButton = event.target.closest(".message-delete-button");
  if (deleteButton && state.activePeer) {
    void deleteMessageById(state.activePeer, deleteButton.dataset.deleteId || "");
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
    void togglePeerPref(peer, "pinned").catch((error) => showToast(error.message, "error"));
    return;
  }
  if (action === "mute") {
    void togglePeerPref(peer, "muted").catch((error) => showToast(error.message, "error"));
  }
}

async function setPeerMutedState(peer, muted) {
  if (!peer) {
    return;
  }
  await persistPeerPrefs(peer, { muted: Boolean(muted) });
}

function saveSettingsDialog() {
  if (state.settingsDialogSection === "security" || state.settingsDialogSection === "other") {
    showToast("此页面无需保存，请使用对应按钮操作");
    return;
  }

  const selectedTone = document.querySelector("#avatarPicker .avatar-pick.is-selected");
  const avatarTone = selectedTone ? Number(selectedTone.dataset.avatarTone || 0) : (state.accountProfile?.avatarTone ?? 0);

  state.accountProfile = normalizeAccountProfile({
    displayName: elements.accountDisplayNameInput?.value || "",
    statusText: elements.accountStatusInput?.value || "",
    about: elements.accountAboutInput?.value || "",
    avatarTone
  });
  saveAccountProfile();
  updateWorkspaceStatus();
  renderThread({ scrollBehavior: "preserve" });
  renderSidebar();
  populateSettingsDialog();
  showToast("账号信息已保存");
}

function resetSettingsDialogSection() {
  if (state.settingsDialogSection === "other") {
    showToast("此页面无可重置内容");
    return;
  }
  if (state.settingsDialogSection === "security") {
    const currentPw = document.querySelector("#currentPasswordInput");
    const newPw = document.querySelector("#newPasswordInput");
    const confirmPw = document.querySelector("#confirmPasswordInput");
    if (currentPw) currentPw.value = "";
    if (newPw) newPw.value = "";
    if (confirmPw) confirmPw.value = "";
    showToast("安全设置已重置");
    return;
  }

  state.accountProfile = normalizeAccountProfile({});
  saveAccountProfile();
  updateWorkspaceStatus();
  renderThread({ scrollBehavior: "preserve" });
  populateSettingsDialog();
  showToast("账号信息已重置");
}

function setActiveNavSection(section) {
  state.activeNavSection = section === "contacts" ? "contacts" : "messages";
  elements.navMessagesButton?.classList.toggle("is-active", state.activeNavSection === "messages");
  elements.navContactsButton?.classList.toggle("is-active", state.activeNavSection === "contacts");
  elements.navMessagesButton?.setAttribute("aria-selected", state.activeNavSection === "messages" ? "true" : "false");
  elements.navContactsButton?.setAttribute("aria-selected", state.activeNavSection === "contacts" ? "true" : "false");
  renderSidebar();
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
  if (!isElementNode(event.target)) {
    return;
  }
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
  if (action === "attach") {
    elements.attachmentInput?.click();
    return;
  }
  if (action === "emoji") {
    toggleEmojiPanel(undefined, actionButton);
    return;
  }
}

function handleDetailActionClick(event) {
  if (!isElementNode(event.target)) {
    return;
  }
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
  if (action === "call" || action === "video" || action === "more") {
    handlePresenceAction(action);
  }
}

function handleGlobalKeydown(event) {
  if (state.settingsDialogOpen) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeSettingsDialog();
      return;
    }
    trapSettingsDialogFocus(event);
    return;
  }
  const isMeta = event.ctrlKey || event.metaKey;
  if (isMeta && event.key.toLowerCase() === "k") {
    event.preventDefault();
    elements.globalSearchInput.focus();
    elements.globalSearchInput.select();
    return;
  }
  if (event.key === "Escape" && document.activeElement === elements.globalSearchInput) {
    elements.globalSearchInput.value = "";
    elements.globalSearchInput.blur();
    handleSearchInput({ target: elements.globalSearchInput });
    return;
  }
  if (event.key === "Escape" && elements.threadSearchInput && document.activeElement === elements.threadSearchInput) {
    elements.threadSearchInput.value = "";
    state.threadSearchQuery = "";
    renderThread({ scrollBehavior: "preserve" });
    return;
  }
  if (event.key === "Escape" && document.activeElement === elements.messageInput) {
    elements.messageInput.blur();
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
  if (event.key === "Escape" && state.notificationPanelOpen) {
    closeNotificationPanel();
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
  elements.loginTab.addEventListener("keydown", handleAuthTabKeydown);
  elements.registerTab.addEventListener("keydown", handleAuthTabKeydown);
  elements.passwordVisibilityButton?.addEventListener("click", () => {
    setPasswordVisibility(elements.authPasswordInput.type === "password");
    elements.authPasswordInput.focus();
  });
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
    openSettingsDialog("account");
  });
  elements.accountMenuButton?.addEventListener("click", () => {
    toggleAccountMenu(undefined, elements.accountMenuButton);
  });
  elements.editAccountButton?.addEventListener("click", () => {
    closeAccountMenu();
    openSettingsDialog("account");
  });
  elements.logoutMenuButton?.addEventListener("click", () => {
    closeAccountMenu();
    void logout();
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
    if (!shouldVirtualizeMessages(messages)) {
      updateScrollBottomButton();
      return;
    }
    scheduleMessageListRender();
    updateScrollBottomButton();
  }, { passive: true });
  elements.messageList.addEventListener("contextmenu", (event) => {
    if (!isElementNode(event.target)) {
      hideMessageContextMenu();
      return;
    }
    const message = event.target.closest(".message");
    if (!message) {
      hideMessageContextMenu();
      return;
    }
    event.preventDefault();
    showMessageContextMenu(message.dataset.messageId || "", event.clientX, event.clientY);
  });
  elements.messageList.addEventListener("touchstart", (event) => {
    if (!isElementNode(event.target) || event.touches.length !== 1) {
      return;
    }
    const message = event.target.closest(".message");
    if (!message) {
      return;
    }
    const touch = event.touches[0];
    state.longPressTouchX = touch.clientX;
    state.longPressTouchY = touch.clientY;
    window.clearTimeout(state.longPressTimer);
    state.longPressTimer = window.setTimeout(() => {
      showMessageContextMenu(message.dataset.messageId || "", touch.clientX, touch.clientY);
    }, 420);
  }, { passive: true });
  elements.messageList.addEventListener("touchend", () => {
    window.clearTimeout(state.longPressTimer);
    state.longPressTimer = 0;
  }, { passive: true });
  elements.messageList.addEventListener("touchmove", (event) => {
    if (!state.longPressTimer || event.touches.length !== 1) {
      return;
    }
    const touch = event.touches[0];
    const moved = Math.hypot(touch.clientX - state.longPressTouchX, touch.clientY - state.longPressTouchY);
    if (moved > 10) {
      window.clearTimeout(state.longPressTimer);
      state.longPressTimer = 0;
    }
  }, { passive: true });
  elements.pinPeerButton.addEventListener("click", () => handleThreadActionsClick("pin"));
  elements.mutePeerButton.addEventListener("click", () => handleThreadActionsClick("mute"));
  elements.addContactButton?.addEventListener("click", async () => {
    const username = await promptActionDialog({
      title: "添加联系人",
      message: "输入对方的用户 ID 后会建立端到端加密会话。",
      field: {
        label: "用户 ID",
        placeholder: "例如 alice_01"
      },
      confirmLabel: "添加"
    });
    if (username === null || !username.trim()) {
      return;
    }
    try {
      await addContactRecord(username.trim());
      showToast("好友已添加");
    } catch (error) {
      showToast(error.message || "添加好友失败", "error");
    }
  });
  elements.headerDetailsButton?.addEventListener("click", openContactDetailsPanel);
  elements.detailsCloseButton?.addEventListener("click", () => setDetailsPanelOpen(false));
  elements.detailsCollapseButton?.addEventListener("click", () => {
    if (isDetailsDrawerLayout()) {
      setDetailsPanelOpen(false);
      return;
    }
    state.detailsPanelCollapsed = true;
    syncLayoutState();
    renderThread({ scrollBehavior: "preserve" });
  });
  elements.editContactButton?.addEventListener("click", async () => {
    if (!state.activePeer) {
      showToast("请先选择联系人", "error");
      return;
    }
    const currentNote = contactRecord(state.activePeer)?.note || "";
    const nextNote = await promptActionDialog({
      title: "设置备注",
      message: `为 ${state.activePeer} 设置一个本地备注。`,
      field: {
        label: "备注",
        value: currentNote,
        placeholder: "输入备注"
      },
      confirmLabel: "保存"
    });
    if (nextNote === null) {
      return;
    }
    try {
      await saveContactNote(state.activePeer, nextNote);
      showToast("备注已更新");
    } catch (error) {
      showToast(error.message || "备注保存失败", "error");
    }
  });
  elements.copyContactIdButton?.addEventListener("click", async () => {
    if (!state.activePeer) {
      return;
    }
    try {
      await navigator.clipboard.writeText(state.activePeer);
      showToast("账号 ID 已复制");
    } catch (error) {
      showToast("复制失败", "error");
    }
  });
  elements.detailsVerifyCodeButton?.addEventListener("click", () => {
    void openSafetyCodeDialog();
  });
  elements.detailsTrustKeyButton?.addEventListener("click", () => {
    void trustObservedPeerKey();
  });
  elements.deleteContactButton?.addEventListener("click", async () => {
    if (!state.activePeer) {
      return;
    }
    if (!await confirmActionDialog({
      title: "删除联系人",
      message: `确认删除联系人 ${state.activePeer} 吗？本地会话列表会移除该联系人。`,
      confirmLabel: "删除"
    })) {
      return;
    }
    try {
      await deleteContactRecord(state.activePeer);
      showToast("联系人已删除");
    } catch (error) {
      showToast(error.message || "删除联系人失败", "error");
    }
  });
  elements.blockContactButton?.addEventListener("click", async () => {
    if (!state.activePeer) {
      return;
    }
    const blocked = Boolean(contactRecord(state.activePeer)?.blocked);
    const confirmed = await confirmActionDialog({
      title: blocked ? "解除拉黑" : "拉黑联系人",
      message: blocked ? `确认取消拉黑 ${state.activePeer} 吗？` : `确认拉黑 ${state.activePeer} 吗？拉黑后双方将无法继续发送消息。`,
      confirmLabel: blocked ? "解除拉黑" : "拉黑"
    });
    if (!confirmed) {
      return;
    }
    try {
      await setBlockedContact(state.activePeer, !blocked);
      showToast(blocked ? "已解除拉黑" : "已加入黑名单");
    } catch (error) {
      showToast(error.message || "操作失败", "error");
    }
  });
  elements.contactPanel?.addEventListener("click", handleDetailActionClick);
  elements.notificationsToggle?.addEventListener("change", () => {
    if (!state.activePeer) {
      return;
    }
    const peer = state.activePeer;
    const nextMuted = !elements.notificationsToggle.checked;
    void setPeerMutedState(peer, nextMuted).catch((error) => {
      elements.notificationsToggle.checked = !peerPrefs(peer).muted;
      showToast(error.message || "通知设置失败", "error");
    });
  });
  elements.presenceVisibleToggle?.addEventListener("change", () => {
    void updateSecuritySettings({
      showOnlineStatus: Boolean(elements.presenceVisibleToggle.checked)
    }).catch((error) => {
      showToast(error.message || "设置保存失败", "error");
      void refreshSecuritySettingsPanel().catch(() => {});
    });
  });
  elements.allowSearchToggle?.addEventListener("change", () => {
    void updateSecuritySettings({
      allowUserSearch: Boolean(elements.allowSearchToggle.checked)
    }).catch((error) => {
      showToast(error.message || "设置保存失败", "error");
      void refreshSecuritySettingsPanel().catch(() => {});
    });
  });
  elements.blockedUsersList?.addEventListener("click", (event) => {
    if (!isElementNode(event.target)) {
      return;
    }
    const button = event.target.closest("[data-security-action]");
    if (!button) {
      return;
    }
    const raw = button.dataset.securityAction || "";
    if (!raw.startsWith("unblock:")) {
      return;
    }
    const username = raw.slice("unblock:".length);
    void setBlockedContact(username, false)
      .then(() => showToast("已解除拉黑"))
      .catch((error) => showToast(error.message || "解除失败", "error"));
  });
  elements.deviceSessionsList?.addEventListener("click", (event) => {
    if (!isElementNode(event.target)) {
      return;
    }
    const button = event.target.closest("[data-security-action]");
    if (!button) {
      return;
    }
    const raw = button.dataset.securityAction || "";
    if (!raw.startsWith("revoke-session:")) {
      return;
    }
    const sessionId = raw.slice("revoke-session:".length);
    void confirmActionDialog({
      title: "撤销设备登录",
      message: "撤销后，该设备会立即退出，需重新登录后才能继续同步消息。",
      confirmLabel: "撤销"
    }).then((confirmed) => {
      if (!confirmed) {
        return;
      }
      return revokeDeviceSession(sessionId)
        .then(() => showToast("已撤销该设备"))
        .catch((error) => showToast(error.message || "撤销失败", "error"));
    });
  });
  elements.securityStatus?.addEventListener("click", (event) => {
    if (!isElementNode(event.target)) {
      return;
    }
    const button = event.target.closest("[data-security-card-action]");
    if (!button) {
      return;
    }
    const action = button.dataset.securityCardAction || "";
    if (action === "verify") {
      void openSafetyCodeDialog();
      return;
    }
    if (action === "trust") {
      void trustObservedPeerKey();
    }
  });
  elements.settingsDialogCloseButton?.addEventListener("click", closeSettingsDialog);
  elements.settingsDialogTabs?.addEventListener("click", (event) => {
    if (!isElementNode(event.target)) {
      return;
    }
    const button = event.target.closest("[data-settings-tab]");
    if (!button || button.hasAttribute("disabled")) {
      return;
    }
    setSettingsDialogSection(button.dataset.settingsTab || "account");
  });
  elements.settingsSaveButton?.addEventListener("click", saveSettingsDialog);
  elements.settingsResetButton?.addEventListener("click", resetSettingsDialogSection);
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
  elements.attachmentInput?.addEventListener("change", (event) => {
    const input = event.currentTarget;
    void sendAttachmentFiles(input?.files)
      .catch((error) => {
        showToast(error.message || "附件发送失败");
      })
      .finally(() => {
        if (input) {
          input.value = "";
        }
      });
  });
  elements.contextCopyButton?.addEventListener("click", () => {
    const target = state.contextMenuMessageId ? elements.messageList.querySelector(`[data-message-id="${state.contextMenuMessageId}"] .message-copy-button`) : null;
    if (target) {
      void copyMessageFromButton(target);
    }
    hideMessageContextMenu();
  });
  elements.contextReplyButton?.addEventListener("click", () => {
    if (state.activePeer && state.contextMenuMessageId) {
      const message = findMessageById(state.activePeer, state.contextMenuMessageId);
      if (message && !message.recalled) {
        setReplyTarget(message);
      }
    }
    hideMessageContextMenu();
  });
  elements.contextRecallButton?.addEventListener("click", () => {
    if (state.activePeer && state.contextMenuMessageId) {
      recallMessageById(state.activePeer, state.contextMenuMessageId);
    }
    hideMessageContextMenu();
  });
  elements.contextDeleteButton?.addEventListener("click", () => {
    if (state.activePeer && state.contextMenuMessageId) {
      void deleteMessageById(state.activePeer, state.contextMenuMessageId);
    }
    hideMessageContextMenu();
  });
  elements.mobileBackButton.addEventListener("click", closeConversationOnMobile);
  elements.cancelReplyButton.addEventListener("click", () => {
    clearReplyTarget();
  });
  elements.messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  elements.messageInput.addEventListener("blur", () => {
    stopTypingSignal();
  });
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", scheduleResponsiveRender);
  window.visualViewport?.addEventListener("resize", scheduleViewportOnlySync);
  window.addEventListener("scroll", scheduleViewportOnlySync, { passive: true });
  window.visualViewport?.addEventListener("scroll", scheduleViewportOnlySync);
  document.addEventListener("click", (event) => {
    if (!isAccountMenuEventTarget(event.target)) {
      closeAccountMenu();
    }
    if (!isNotificationPanelEventTarget(event.target)) {
      closeNotificationPanel();
    }
    if (!isEmojiPanelEventTarget(event.target) && (!isElementNode(event.target) || !event.target.closest(".composer"))) {
      closeEmojiPanel();
    }
    if (!isElementNode(event.target) || !event.target.closest(".message-context-menu")) {
      hideMessageContextMenu();
    }
  });
  elements.settingsDialog?.addEventListener("click", (event) => {
    if (event.target === elements.settingsDialog) {
      closeSettingsDialog();
    }
  });
  window.addEventListener("online", () => {
    if (!state.authenticated) {
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
    if (!state.authenticated || document.visibilityState !== "visible") {
      return;
    }
    void flushPendingOutbox();
    if (state.connectionState !== "online" && !state.reconnectTimer) {
      startEventStream(true);
    }
    if (state.activePeer) {
      void markConversationRead(state.activePeer);
    }
  });

  elements.notificationBellButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleNotificationPanel(undefined, elements.notificationBellButton);
  });

  const avatarPicker = document.querySelector("#avatarPicker");
  avatarPicker?.addEventListener("click", (event) => {
    const pick = event.target.closest(".avatar-pick");
    if (!pick) return;
    for (const btn of avatarPicker.querySelectorAll(".avatar-pick")) {
      btn.classList.remove("is-selected");
    }
    pick.classList.add("is-selected");
  });

  const changePasswordButton = document.querySelector("#changePasswordButton");
  changePasswordButton?.addEventListener("click", async () => {
    const currentPw = document.querySelector("#currentPasswordInput")?.value || "";
    const newPw = document.querySelector("#newPasswordInput")?.value || "";
    const confirmPw = document.querySelector("#confirmPasswordInput")?.value || "";
    if (!currentPw || !newPw || !confirmPw) {
      showToast("请填写所有密码字段", "error");
      return;
    }
    if (newPw !== confirmPw) {
      showToast("两次输入的新密码不一致", "error");
      return;
    }
    try {
      if (!state.identity?.privateKeyPkcs8Base64) {
        throw new Error("当前设备无法导出该账号密钥，请重新登录后再修改密码");
      }
      await api("/api/me/password", {
        method: "POST",
        body: {
          currentPassword: currentPw,
          newPassword: newPw,
          keyBundle: await buildPortableKeyBundle(state.identity.privateKeyPkcs8Base64, newPw)
        }
      });
      closeEventStream();
      startEventStream(true);
      const currentPwInput = document.querySelector("#currentPasswordInput");
      const newPwInput = document.querySelector("#newPasswordInput");
      const confirmPwInput = document.querySelector("#confirmPasswordInput");
      if (currentPwInput) currentPwInput.value = "";
      if (newPwInput) newPwInput.value = "";
      if (confirmPwInput) confirmPwInput.value = "";
      showToast("密码已更新，其余设备已退出");
    } catch (error) {
      showToast(error.message || "密码修改失败", "error");
    }
  });

  const settingsLogoutButton = document.querySelector("#settingsLogoutButton");
  settingsLogoutButton?.addEventListener("click", () => {
    closeSettingsDialog();
    void logout();
  });
  const settingsLogoutAllButton = document.querySelector("#settingsLogoutAllButton");
  settingsLogoutAllButton?.addEventListener("click", () => {
    closeSettingsDialog();
    void logoutAllDevices();
  });
}

async function restoreAuthenticatedWorkspace() {
  const payload = await api("/api/me", { skipAuthReset: true });
  const user = payload?.user || null;
  if (!user?.username) {
    throw new Error("请先登录");
  }

  let identity;
  try {
    identity = await restoreIdentityFromSessionCache(user);
  } catch (error) {
    clearSession(false, false);
    elements.authUsernameInput.value = user.username;
    elements.authPasswordInput.value = "";
    setAuthMode("login");
    setAuthFeedback(error.message || "当前设备本地私钥不可用，请重新输入密码恢复加密身份。", true);
    elements.workspace.hidden = true;
    elements.authScreen.hidden = false;
    return false;
  }
  if (!identity) {
    clearSession(false, false);
    elements.authUsernameInput.value = user.username;
    elements.authPasswordInput.value = "";
    setAuthMode("login");
    setAuthFeedback("当前设备尚未保存该账号密钥，请重新输入密码恢复或重建加密身份。", true);
    elements.workspace.hidden = true;
    elements.authScreen.hidden = false;
    return false;
  }

  setSession(user, identity);
  await persistSessionIdentity(identity, user.username);
  await afterLogin();
  return true;
}

async function boot() {
  clearLegacySessionToken();
  syncViewportHeight();
  setAuthMode(state.authMode);
  bindEvents();
  scheduleClientMetaReport();
  render();
  elements.workspace.hidden = true;
  elements.authScreen.hidden = false;

  if (!window.crypto?.subtle) {
    elements.authSubmitButton.disabled = true;
    elements.authTip.textContent = "当前环境缺少 Web Crypto，请使用 HTTPS 或 localhost 打开本站。";
    return;
  }
  if (!window.indexedDB) {
    elements.authSubmitButton.disabled = true;
    elements.authTip.textContent = "当前浏览器不支持安全本地密钥存储，请使用新版浏览器。";
    return;
  }

  try {
    const restored = await restoreAuthenticatedWorkspace();
    if (!restored) {
      return;
    }
  } catch (error) {
    clearSession(true, true);
    setAuthFeedback("请登录后继续使用加密会话。", false);
  }
}

void boot();
