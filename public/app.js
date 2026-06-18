"use strict";

const STORAGE = {
  activePeer: "private-chat-active-peer",
  accountProfile: "private-chat-account-profile",
  authMode: "private-chat-auth-mode",
  contactProfiles: "private-chat-contact-profiles",
  conversationPrefs: "private-chat-conversation-prefs",
  drafts: "private-chat-drafts",
  pendingOutbox: "private-chat-pending-outbox",
  sessionToken: "private-chat-session-token",
  sessionIdentity: "private-chat-session-identity"
};

const AVATAR_TONES = 6;
const PRIVATE_KEY_ITERATIONS = 150000;
const MESSAGE_KEY_INFO = "private-chat-message-key-v1";
const MESSAGE_VIRTUAL_THRESHOLD = 140;
const MESSAGE_VIRTUAL_OVERSCAN = 480;
const CLIENT_META_SENT_STORAGE_KEY = "secure_chat_client_meta_sent_v1";
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
  sidebarTitle: document.querySelector(".sidebar-head h2"),
  sidebarEyebrow: document.querySelector(".sidebar-head .eyebrow"),
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
  attachmentInput: document.querySelector("#attachmentInput"),
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
  contactSettingsTab: document.querySelector("#contactSettingsTab"),
  accountSettingsForm: document.querySelector("#accountSettingsForm"),
  contactSettingsForm: document.querySelector("#contactSettingsForm"),
  accountUsernameInput: document.querySelector("#accountUsernameInput"),
  accountDisplayNameInput: document.querySelector("#accountDisplayNameInput"),
  accountStatusInput: document.querySelector("#accountStatusInput"),
  accountAboutInput: document.querySelector("#accountAboutInput"),
  presenceVisibleToggle: document.querySelector("#presenceVisibleToggle"),
  allowSearchToggle: document.querySelector("#allowSearchToggle"),
  deviceSessionsList: document.querySelector("#deviceSessionsList"),
  blockedUsersList: document.querySelector("#blockedUsersList"),
  contactSettingsHeading: document.querySelector("#contactSettingsHeading"),
  contactUsernameInput: document.querySelector("#contactUsernameInput"),
  contactDisplayNameInput: document.querySelector("#contactDisplayNameInput"),
  contactRoleInput: document.querySelector("#contactRoleInput"),
  contactAboutInput: document.querySelector("#contactAboutInput"),
  contactMediaInput: document.querySelector("#contactMediaInput"),
  contactFilesInput: document.querySelector("#contactFilesInput"),
  settingsResetButton: document.querySelector("#settingsResetButton"),
  settingsSaveButton: document.querySelector("#settingsSaveButton")
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
  accountProfile: {},
  contactProfiles: {},
  contacts: [],
  deviceSessions: [],
  securitySettings: {
    showOnlineStatus: true,
    allowUserSearch: true,
    blockedUsers: []
  },
  outboxFlushing: false,
  searchTimer: 0,
  searchRequestId: 0,
  messageListRenderRaf: 0,
  resizeRenderRaf: 0,
  toastTimer: 0,
  longPressTimer: 0,
  openConversationRequest: 0,
  conversationPrefs: {},
  drafts: {},
  submitInFlight: false,
  scrollBottomNewCount: 0,
  scrollBottomHideTimer: 0,
  detailsPanelOpen: false,
  detailsPanelCollapsed: false,
  activeNavSection: "messages",
  emojiPanelOpen: false,
  accountMenuOpen: false,
  accountMenuAnchor: null,
  settingsDialogOpen: false,
  settingsDialogSection: "account",
  contextMenuMessageId: "",
  previewMode: false,
  workspaceLoading: false
};

if (elements.accountMenu && elements.accountMenu.parentElement !== document.body) {
  document.body.append(elements.accountMenu);
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

function readSessionAuthToken() {
  try {
    return String(sessionStorage.getItem(STORAGE.sessionToken) || "");
  } catch (error) {
    return "";
  }
}

function persistSessionAuthToken(token) {
  try {
    if (token) {
      sessionStorage.setItem(STORAGE.sessionToken, String(token));
    } else {
      sessionStorage.removeItem(STORAGE.sessionToken);
    }
  } catch (error) {
    // Ignore sessionStorage failures and continue with cookie auth.
  }
}

function scheduleClientMetaReport() {
  const run = () => {
    void reportClientMetaOnce();
  };
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(run, { timeout: 1200 });
    return;
  }
  window.setTimeout(run, 60);
}

async function reportClientMetaOnce() {
  try {
    if (window.localStorage.getItem(CLIENT_META_SENT_STORAGE_KEY) === "1") {
      return;
    }
  } catch (error) {
    return;
  }
  const payload = {
    language: navigator.language || "",
    screenResolution:
      window.screen && Number(window.screen.width) > 0 && Number(window.screen.height) > 0
        ? `${window.screen.width}x${window.screen.height}`
        : "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
    platform: navigator.userAgentData?.platform || navigator.platform || ""
  };
  try {
    await fetch("/api/client-meta", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json"
      },
      keepalive: true,
      body: JSON.stringify(payload)
    });
    window.localStorage.setItem(CLIENT_META_SENT_STORAGE_KEY, "1");
  } catch (error) {
    // Ignore silent telemetry errors.
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
  const store = readJsonStorage(key, {});
  store[owner] = value;
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

function saveAccountProfile() {
  writeScopedStorageRecord(STORAGE.accountProfile, currentStorageOwner(), state.accountProfile);
}

function saveContactProfiles() {
  writeScopedStorageRecord(STORAGE.contactProfiles, currentStorageOwner(), state.contactProfiles);
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
  if (!node) {
    return;
  }
  node.className = `avatar avatar-tone-${avatarTone(username)}`;
  node.textContent = avatarInitial(username);
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

function addNotification(from, text, timestamp) {
  const list = document.querySelector("#notificationList");
  if (!list) return;
  const emptyEl = list.querySelector(".notification-empty");
  if (emptyEl) emptyEl.remove();
  const item = document.createElement("div");
  item.className = "notification-item";
  item.dataset.peer = from;
  const tone = avatarTone(from);
  const initial = escapeHtml(avatarInitial(from));
  const displayName = escapeHtml(contactDisplayName(from));
  const preview = escapeHtml(String(text || "").slice(0, 60));
  const time = escapeHtml(formatTime(timestamp || Date.now()));
  item.innerHTML = `<div class="avatar avatar-tone-${tone}">${initial}</div><div class="notification-item-copy"><strong>${displayName}</strong><span>${preview}</span><small>${time}</small></div>`;
  item.addEventListener("click", () => {
    const panel = document.querySelector("#notificationPanel");
    if (panel) panel.hidden = true;
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

function clearNotificationBadge() {
  const badge = document.querySelector("#notificationBadge");
  if (badge) {
    badge.hidden = true;
  }
}

function setAccountMenuExpanded(expanded) {
  const value = expanded ? "true" : "false";
  elements.accountMenuButton?.setAttribute("aria-expanded", value);
  elements.sidebarProfileButton?.setAttribute("aria-expanded", value);
}

function isElementNode(value) {
  return value instanceof Element;
}

function isAccountMenuEventTarget(target) {
  if (!isElementNode(target)) {
    return false;
  }
  return Boolean(
    target.closest(".account-menu-wrap") ||
    target.closest("#sidebarProfileButton") ||
    target.closest("#accountMenu")
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

  if (anchor === elements.sidebarProfileButton) {
    left = rect.left;
  }

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

function setSettingsDialogSection(section) {
  const nextSection = section === "security" ? "security" : section === "other" ? "other" : "account";
  state.settingsDialogSection = nextSection;
  elements.accountSettingsTab?.classList.toggle("is-active", nextSection === "account");
  document.querySelector("#securitySettingsTab")?.classList.toggle("is-active", nextSection === "security");
  document.querySelector("#otherSettingsTab")?.classList.toggle("is-active", nextSection === "other");
  if (elements.accountSettingsForm) {
    elements.accountSettingsForm.hidden = nextSection !== "account";
  }
  const securityForm = document.querySelector("#securitySettingsForm");
  if (securityForm) securityForm.hidden = nextSection !== "security";
  const otherForm = document.querySelector("#otherSettingsForm");
  if (otherForm) otherForm.hidden = nextSection !== "other";
  if ((nextSection === "security" || nextSection === "other") && state.token) {
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
  if (currentPw) currentPw.value = "";
  if (newPw) newPw.value = "";
  if (confirmPw) confirmPw.value = "";
}

function openSettingsDialog(section = "account") {
  const nextSection = section === "security" ? "security" : "account";
  state.settingsDialogOpen = true;
  if (elements.settingsDialog) {
    elements.settingsDialog.hidden = false;
  }
  setSettingsDialogSection(nextSection);
  populateSettingsDialog();
  syncLayoutState();
}

function closeSettingsDialog() {
  state.settingsDialogOpen = false;
  if (elements.settingsDialog) {
    elements.settingsDialog.hidden = true;
  }
  syncLayoutState();
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
  elements.messageContextMenu.hidden = false;
  const maxX = window.innerWidth - 180;
  const maxY = window.innerHeight - 220;
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

function buildAttachmentMessageText(file) {
  const name = String(file?.name || "未命名文件").trim().slice(0, 80);
  const meta = `${fileKindLabel(file)} · ${formatBytes(file?.size || 0)}`;
  return `[附件] ${name}\n${meta}`;
}

async function sendAttachmentFiles(fileList) {
  if (!state.activePeer) {
    return;
  }
  const files = Array.from(fileList || []).filter(Boolean).slice(0, 5);
  for (const file of files) {
    if (file.size > 10 * 1024 * 1024) {
      showToast(`${file.name} 超过 10MB，暂不支持`);
      continue;
    }
    const text = buildAttachmentMessageText(file);
    const replyTo = state.replyTarget ? { ...state.replyTarget } : null;
    const tempId = addPendingMessage(state.activePeer, text, replyTo);
    renderThread({ scrollBehavior: "bottom" });
    void sendMessageWithRetry(tempId, state.activePeer, text, tempId, false, replyTo?.id || "");
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
  const displayName = accountDisplayName();
  const profileStatus = accountStatusText();
  const pendingCount = state.pendingOutbox.length;
  const pendingSuffix = pendingCount > 0 ? ` \u00b7 \u5f85\u53d1\u9001 ${pendingCount}` : "";
  if (elements.meUsername) {
    elements.meUsername.textContent = displayName;
  }
  elements.meStatus.textContent = `${profileStatus || connectionStatusLabel()} \u00b7 \u5df2\u52a0\u5bc6${pendingSuffix}`;
  if (elements.sidebarProfileAvatar) {
    setAvatar(elements.sidebarProfileAvatar, state.me.username);
  }
  if (elements.sidebarProfileName) {
    elements.sidebarProfileName.textContent = displayName;
  }
  if (elements.sidebarProfileStatus) {
    elements.sidebarProfileStatus.textContent = profileStatus || connectionStatusLabel();
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
  return messagePlaintext(message);
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
  loadEditableProfiles();
  loadPendingOutbox();
}

function saveConversationPrefs() {
  writeJsonStorage(STORAGE.conversationPrefs, state.conversationPrefs);
}

function saveDrafts() {
  writeJsonStorage(STORAGE.drafts, state.drafts);
}

function clearSessionIdentityCache() {
  try {
    sessionStorage.removeItem(STORAGE.sessionIdentity);
  } catch (error) {
    // Ignore sessionStorage cleanup failures.
  }
}

async function persistSessionIdentity(identity, username = state.me?.username || "") {
  if (!identity?.publicKeyBase64 || !identity?.privateKeyPkcs8Base64 || !username) {
    clearSessionIdentityCache();
    return;
  }
  writeJsonSessionStorage(STORAGE.sessionIdentity, {
    username,
    publicKeyBase64: identity.publicKeyBase64,
    privateKeyPkcs8Base64: identity.privateKeyPkcs8Base64
  });
}

async function restoreIdentityFromSessionCache(user) {
  const cached = readJsonSessionStorage(STORAGE.sessionIdentity, null);
  if (!cached || cached.username !== user?.username || cached.publicKeyBase64 !== user?.publicKey) {
    return null;
  }
  try {
    const publicKey = await importPublicKey(cached.publicKeyBase64);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      base64ToBytes(cached.privateKeyPkcs8Base64),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"]
    );
    state.importedPeerKeys.delete(cached.publicKeyBase64);
    return {
      username: user.username,
      publicKey,
      privateKey,
      publicKeyBase64: cached.publicKeyBase64,
      privateKeyPkcs8Base64: cached.privateKeyPkcs8Base64
    };
  } catch (error) {
    clearSessionIdentityCache();
    return null;
  }
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
  if (contactRecord(peer.username)?.blocked) {
    parts.push("已拉黑，对话发送已禁用");
  }
  elements.securityStatus.textContent = parts.join(" \u00b7 ");
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
  const blocked = Boolean(state.activePeer && contactRecord(state.activePeer)?.blocked);
  elements.sendButton.disabled = busy || !state.activePeer || blocked;
  elements.messageInput.disabled = busy || !state.activePeer || blocked;
}

function isMobile() {
  return window.innerWidth <= 767;
}

function syncLayoutState() {
  if (!isDetailsDrawerLayout()) {
    state.detailsPanelOpen = false;
  }
  document.body.classList.toggle("is-mobile", isMobile());
  document.body.classList.toggle("is-chat-open", isMobile() && Boolean(state.activePeer));
  document.body.classList.toggle("is-details-open", isDetailsDrawerLayout() && state.detailsPanelOpen);
  document.body.classList.toggle("is-details-collapsed", !isDetailsDrawerLayout() && state.detailsPanelCollapsed);
  document.body.classList.toggle("is-dialog-open", state.settingsDialogOpen);
  if (state.accountMenuOpen && state.accountMenuAnchor && state.accountMenuAnchor.offsetParent === null) {
    closeAccountMenu();
    return;
  }
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
  if (clearToken) {
    persistSessionAuthToken("");
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
    "password must be 4-72 characters": "密码长度需为 4-72 位。",
    "username already exists": "用户名已存在",
    "username is reserved": "该用户名不可使用",
    "account banned": "账号已被禁用",
    "account key material is missing": "账号密钥异常，请重新登录或重新注册",
    "too many auth requests": "请求过于频繁，请稍后再试",
    "current password invalid": "当前密码不正确",
    "peer unavailable": "对方当前不可接收消息",
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
  const sessionToken = options.auth === false ? "" : readSessionAuthToken();
  if (sessionToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${sessionToken}`;
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
  state.accountProfile = {};
  state.contactProfiles = {};
  state.contacts = [];
  state.deviceSessions = [];
  state.securitySettings = {
    showOnlineStatus: true,
    allowUserSearch: true,
    blockedUsers: []
  };
  state.outboxFlushing = false;
  state.searchRequestId += 1;
  state.openConversationRequest += 1;
  state.detailsPanelOpen = false;
  state.activeNavSection = "messages";
  state.settingsDialogOpen = false;
  state.settingsDialogSection = "account";
  state.previewMode = false;
  state.detailsPanelCollapsed = false;
  state.workspaceLoading = false;

  clearStoredSessionArtifacts(clearToken, true);
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
  }
}

function setSession(token, user, identity) {
  if (token && token !== "cookie") {
    persistSessionAuthToken(token);
  }
  state.token = token ? "cookie" : "";
  state.me = user;
  state.identity = identity;
  state.previewMode = false;
  resetLocalConversationState();
  elements.authScreen.hidden = true;
  elements.workspace.hidden = false;
  elements.workspace.classList.add("is-entering");
  elements.workspace.addEventListener("animationend", () => {
    elements.workspace.classList.remove("is-entering");
  }, { once: true });
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
  if (state.detailsPanelOpen) {
    state.detailsPanelCollapsed = false;
  }
  syncLayoutState();
}

function renderSimpleDetailRow(title, meta, actionLabel = "", action = "") {
  const wrapper = document.createElement("div");
  wrapper.className = "detail-file-row detail-file-row-simple";
  wrapper.innerHTML = `
    <div class="detail-file-copy">
      <strong>${escapeHtml(title)}</strong>
      <span class="detail-file-meta">${escapeHtml(meta)}</span>
    </div>
    ${actionLabel ? `<button class="detail-file-download" type="button" data-security-action="${escapeHtml(action)}">${escapeHtml(actionLabel)}</button>` : ""}
  `;
  return wrapper;
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
      empty.innerHTML = "<span>暂无可展示的登录设备。</span>";
      elements.deviceSessionsList.append(empty);
    } else {
      for (const sessionItem of deviceSessions) {
        const title = [sessionItem.device || "设备", sessionItem.browser || "浏览器"].filter(Boolean).join(" · ");
        const meta = [sessionItem.os || "系统", `最近活动 ${formatDateTime(sessionItem.lastSeenAt)}`].filter(Boolean).join(" · ");
        elements.deviceSessionsList.append(renderSimpleDetailRow(title, meta));
      }
    }
  }
  if (elements.blockedUsersList) {
    elements.blockedUsersList.textContent = "";
    if (!state.securitySettings.blockedUsers.length) {
      const empty = document.createElement("div");
      empty.className = "detail-file-row detail-file-empty";
      empty.innerHTML = "<span>黑名单为空。</span>";
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
  elements.detailsAbout.textContent = contactAboutText(peer.username);
  elements.notificationsToggle.checked = !prefs.muted;
  if (elements.blockContactButtonLabel) {
    elements.blockContactButtonLabel.textContent = contact?.blocked ? "取消拉黑" : "拉黑";
  }
  if (elements.detailsCollapseButton) {
    elements.detailsCollapseButton.textContent = state.detailsPanelCollapsed ? "展开" : "收起";
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
  const indicators = [`<i class="online-dot${item.online ? " is-online" : ""}"></i>`];
  if (item.unread && !prefs.muted) {
    indicators.push(`<b class="unread-badge">${item.unread}</b>`);
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
  const presence = document.createElement("i");
  presence.className = `online-dot${item.online ? " is-online" : ""}`;
  presence.setAttribute("aria-hidden", "true");
  avatarWrap.append(presence);

  const meta = document.createElement("div");
  meta.className = "list-item-meta";
  meta.innerHTML = `
    <div class="list-row">
      <strong>${escapeHtml(contactDisplayName(item.username))}</strong>
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

function renderMessage(message, options = {}) {
  const article = document.createElement("article");
  const isConsecutive = options.consecutive ? " is-consecutive" : "";
  const isSearchMatch = options.searchMatch ? " is-search-match" : "";
  article.className = `message ${message.mine ? "is-own" : "is-peer"}${message.pending ? " is-pending" : ""}${message.failed ? " is-failed" : ""}${message.replyTo ? " is-reply" : ""}${message.recalled ? " is-recalled" : ""}${isConsecutive}${isSearchMatch}`;
  article.dataset.messageId = message.id || message.tempId || "";
  article.dataset.messageText = messagePlaintext(message);
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
  }
  const threadQuery = state.threadSearchQuery.trim().toLowerCase();
  const statusSuffix = statusTags.length ? ` · ${statusTags.join(" · ")}` : "";
  const basePresence = peer.online ? "在线" : contact?.lastSeenAt ? `最后在线 ${formatLastSeen(contact.lastSeenAt)}` : "离线";
  elements.peerStatus.textContent = `${basePresence} · 端到端加密${connectionLabel}${statusSuffix}`;
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
  elements.workspace?.classList.toggle("is-loading", state.workspaceLoading);
  setActiveNavSection(state.activeNavSection);
  renderThread();
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
  const privateKeyPkcs8Base64 = bytesToBase64(privateKeyPkcs8);
  const keyBundle = await encryptPrivateKeyBundle(privateKeyPkcs8, password);

  return {
    publicKey: keyPair.publicKey,
    privateKey: keyPair.privateKey,
    publicKeyBase64,
    privateKeyPkcs8Base64,
    keyBundle: {
      publicKey: publicKeyBase64,
      ...keyBundle
    }
  };
}

async function restoreIdentity(username, password, keyBundle) {
  try {
    const privateKeyBytes = await decryptPrivateKeyBundle(password, keyBundle);
    const privateKeyPkcs8Base64 = bytesToBase64(privateKeyBytes);
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
      publicKeyBase64: keyBundle.publicKey,
      privateKeyPkcs8Base64
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
  const recalled = Boolean(message?.recalled);
  if (recalled) {
    text = message.from === state.me?.username ? "你撤回了一条消息" : "对方撤回了一条消息";
  } else if (!message?.ciphertext || !message?.nonce) {
    text = messagePlaintext(message);
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

async function loadContacts() {
  const payload = await api("/api/contacts");
  state.contacts = Array.isArray(payload.contacts) ? payload.contacts : [];
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
    void markConversationRead(username);
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
    renameScopedStorageOwner(STORAGE.accountProfile, previousUsername, nextUsername);
    renameScopedStorageOwner(STORAGE.contactProfiles, previousUsername, nextUsername);
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
    localStorage.setItem(STORAGE.activePeer, nextUsername);
  }

  if (Object.prototype.hasOwnProperty.call(state.drafts, previousUsername)) {
    state.drafts[nextUsername] = state.drafts[previousUsername];
    delete state.drafts[previousUsername];
    saveDrafts();
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
  state.contacts = [];

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

  if (decrypted.mine) {
    decrypted.sendStatus = "sent";
    const reconciledTempId = reconcilePendingMessage(peer, message);
    if (reconciledTempId && messageExists(peer, message.id, message.clientId)) {
      return;
    }
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
    if (!decrypted.mine && document.visibilityState !== "hidden") {
      void markConversationRead(peer);
    }
  } else {
    renderSidebar();
  }
  if (!decrypted.mine) {
    addNotification(peer, decrypted.text, decrypted.createdAt);
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

async function markConversationRead(peer) {
  if (!peer || !state.token) {
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

  source.addEventListener("message-recalled", (event) => {
    const payload = JSON.parse(event.data);
    handleRemoteRecall(payload);
  });

  source.addEventListener("message-deleted", (event) => {
    const payload = JSON.parse(event.data);
    handleRemoteDelete(payload);
  });

  source.addEventListener("message-delivered", (event) => {
    const payload = JSON.parse(event.data);
    applyReceiptUpdate(payload.peer, payload.messageIds, "delivered", payload.deliveredAt);
  });

  source.addEventListener("message-read", (event) => {
    const payload = JSON.parse(event.data);
    applyReceiptUpdate(payload.peer, payload.messageIds, "read", payload.readAt);
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
  state.workspaceLoading = true;
  render();
  try {
    await Promise.all([loadConversations(), loadContacts()]);
    startEventStream();
    void flushPendingOutbox();

    const savedPeer = localStorage.getItem(STORAGE.activePeer) || "";
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
    await persistSessionIdentity(identity, payload.user.username);
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
        clientId,
        replyToId,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext
      }
    });
    state.pendingMessages.delete(tempId);
    removePendingMessageFromCache(tempId);
    removePendingOutboxEntry(tempId);
    const existing = (state.messageCache.get(peer) || []).find(
      (message) =>
        message.id === payload.message?.id ||
        (payload.message?.clientId &&
          (message.clientId === payload.message.clientId || message.tempId === payload.message.clientId))
    );
    if (!existing) {
      await ingestEncryptedMessage(payload.message);
    }
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
  if (contactRecord(state.activePeer)?.blocked) {
    showToast("已拉黑该联系人，无法继续发送消息", "error");
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
  if (elements.sendButton) {
    elements.sendButton.classList.remove("is-sent-feedback");
    void elements.sendButton.offsetWidth;
    elements.sendButton.classList.add("is-sent-feedback");
  }
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
  syncConversationFromCache(peer);
  renderSidebar();
  renderThread({ scrollBehavior: "preserve" });
  showToast("\u6d88\u606f\u5df2\u64a4\u56de");
  const serverId = target.id || messageId;
  if (serverId && !target.tempId) {
    api("/api/messages/recall", { method: "POST", body: { messageId: serverId } }).catch(() => {});
  }
  }, messageNode ? 180 : 0);
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
  const downloadButton = event.target.closest("[data-detail-action='download']");
  if (downloadButton) {
    showToast("当前仅保存文件说明，可按需接入真实附件下载接口");
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
  renderSidebar();
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
    toggleEmojiPanel();
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
  if (action === "download") {
    showToast("当前仅保存文件说明，可按需接入真实附件下载接口");
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
  if (event.key === "Escape" && state.settingsDialogOpen) {
    closeSettingsDialog();
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
  elements.sidebarProfileButton?.addEventListener("click", () => {
    toggleAccountMenu(undefined, elements.sidebarProfileButton);
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
    window.clearTimeout(state.longPressTimer);
    state.longPressTimer = window.setTimeout(() => {
      showMessageContextMenu(message.dataset.messageId || "", touch.clientX, touch.clientY);
    }, 420);
  }, { passive: true });
  elements.messageList.addEventListener("touchend", () => {
    window.clearTimeout(state.longPressTimer);
    state.longPressTimer = 0;
  }, { passive: true });
  elements.messageList.addEventListener("touchmove", () => {
    window.clearTimeout(state.longPressTimer);
    state.longPressTimer = 0;
  }, { passive: true });
  elements.pinPeerButton.addEventListener("click", () => handleThreadActionsClick("pin"));
  elements.mutePeerButton.addEventListener("click", () => handleThreadActionsClick("mute"));
  elements.exportPeerButton.addEventListener("click", () => handleThreadActionsClick("export"));
  elements.headerSearchButton?.addEventListener("click", focusThreadSearch);
  elements.headerDetailsButton?.addEventListener("click", () => setDetailsPanelOpen());
  elements.detailsCloseButton?.addEventListener("click", () => setDetailsPanelOpen(false));
  elements.detailsCollapseButton?.addEventListener("click", () => {
    if (isDetailsDrawerLayout()) {
      setDetailsPanelOpen(false);
      return;
    }
    state.detailsPanelCollapsed = !state.detailsPanelCollapsed;
    syncLayoutState();
    renderThread({ scrollBehavior: "preserve" });
  });
  elements.editContactButton?.addEventListener("click", async () => {
    if (!state.activePeer) {
      showToast("请先选择联系人", "error");
      return;
    }
    const currentNote = contactRecord(state.activePeer)?.note || "";
    const nextNote = window.prompt("设置联系人备注", currentNote);
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
  elements.deleteContactButton?.addEventListener("click", async () => {
    if (!state.activePeer) {
      return;
    }
    if (!window.confirm(`确认删除联系人 ${state.activePeer} 吗？`)) {
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
    const confirmed = window.confirm(blocked ? `确认取消拉黑 ${state.activePeer} 吗？` : `确认拉黑 ${state.activePeer} 吗？`);
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
    setPeerMutedState(state.activePeer, !elements.notificationsToggle.checked);
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
    void sendAttachmentFiles(event.currentTarget?.files).catch((error) => {
      showToast(error.message || "附件发送失败");
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
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      elements.composerForm.requestSubmit();
    }
  });
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("resize", scheduleResponsiveRender);
  document.addEventListener("click", (event) => {
    if (!isAccountMenuEventTarget(event.target)) {
      closeAccountMenu();
    }
    if (!isElementNode(event.target) || !event.target.closest(".composer")) {
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
    if (state.activePeer) {
      void markConversationRead(state.activePeer);
    }
  });

  const notificationBellButton = document.querySelector("#notificationBellButton");
  const notificationPanel = document.querySelector("#notificationPanel");
  notificationBellButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (notificationPanel) {
      const isOpen = !notificationPanel.hidden;
      notificationPanel.hidden = isOpen;
      if (!isOpen) {
        const rect = notificationBellButton.getBoundingClientRect();
        notificationPanel.style.top = `${rect.bottom + 8}px`;
        notificationPanel.style.right = `${window.innerWidth - rect.right}px`;
        notificationPanel.style.left = "auto";
        clearNotificationBadge();
      }
    }
  });
  document.addEventListener("click", (origEvent) => {
    if (notificationPanel && !notificationPanel.hidden && !origEvent.target.closest("#notificationPanel") && !origEvent.target.closest("#notificationBellButton")) {
      notificationPanel.hidden = true;
    }
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
    if (newPw.length < 4) {
      showToast("新密码至少需要 4 个字符", "error");
      return;
    }
    try {
      await api("/api/me/password", {
        method: "POST",
        body: {
          currentPassword: currentPw,
          newPassword: newPw
        }
      });
      const currentPwInput = document.querySelector("#currentPasswordInput");
      const newPwInput = document.querySelector("#newPasswordInput");
      const confirmPwInput = document.querySelector("#confirmPasswordInput");
      if (currentPwInput) currentPwInput.value = "";
      if (newPwInput) newPwInput.value = "";
      if (confirmPwInput) confirmPwInput.value = "";
      showToast("密码已更新");
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

  const identity = await restoreIdentityFromSessionCache(user);
  if (!identity) {
    clearSession(false, false);
    elements.authUsernameInput.value = user.username;
    elements.authPasswordInput.value = "";
    setAuthMode("login");
    setAuthFeedback("检测到已有登录状态，请重新输入密码以解锁本地密钥。", false);
    elements.workspace.hidden = true;
    elements.authScreen.hidden = false;
    return false;
  }

  setSession("cookie", user, identity);
  await persistSessionIdentity(identity, user.username);
  await afterLogin();
  return true;
}

async function boot() {
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
