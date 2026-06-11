"use strict";

const elements = {
  loginCard: document.querySelector("#loginCard"),
  loginForm: document.querySelector("#loginForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  dashboard: document.querySelector("#dashboard"),
  adminMeta: document.querySelector("#adminMeta"),
  refreshMeta: document.querySelector("#refreshMeta"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  statsGrid: document.querySelector("#statsGrid"),
  healthGrid: document.querySelector("#healthGrid"),
  userSearchInput: document.querySelector("#userSearchInput"),
  userStatusSelect: document.querySelector("#userStatusSelect"),
  userSortSelect: document.querySelector("#userSortSelect"),
  applyUserFilterButton: document.querySelector("#applyUserFilterButton"),
  selectAllUsers: document.querySelector("#selectAllUsers"),
  batchBanButton: document.querySelector("#batchBanButton"),
  batchUnbanButton: document.querySelector("#batchUnbanButton"),
  usersPager: document.querySelector("#usersPager"),
  prevUsersPageButton: document.querySelector("#prevUsersPageButton"),
  nextUsersPageButton: document.querySelector("#nextUsersPageButton"),
  usersTbody: document.querySelector("#usersTbody"),
  msgFromInput: document.querySelector("#msgFromInput"),
  msgToInput: document.querySelector("#msgToInput"),
  msgKeywordInput: document.querySelector("#msgKeywordInput"),
  msgSinceInput: document.querySelector("#msgSinceInput"),
  msgUntilInput: document.querySelector("#msgUntilInput"),
  msgMaskCheckbox: document.querySelector("#msgMaskCheckbox"),
  applyMsgFilterButton: document.querySelector("#applyMsgFilterButton"),
  resetMsgFilterButton: document.querySelector("#resetMsgFilterButton"),
  loadMoreMessagesButton: document.querySelector("#loadMoreMessagesButton"),
  exportReasonInput: document.querySelector("#exportReasonInput"),
  exportMessagesButton: document.querySelector("#exportMessagesButton"),
  messagesList: document.querySelector("#messagesList"),
  refreshAuditButton: document.querySelector("#refreshAuditButton"),
  auditList: document.querySelector("#auditList"),
  toast: document.querySelector("#toast"),
  dialogBackdrop: document.querySelector("#dialogBackdrop"),
  dialogTitle: document.querySelector("#dialogTitle"),
  dialogMessage: document.querySelector("#dialogMessage"),
  dialogFieldWrap: document.querySelector("#dialogFieldWrap"),
  dialogFieldLabel: document.querySelector("#dialogFieldLabel"),
  dialogInput: document.querySelector("#dialogInput"),
  dialogCancelButton: document.querySelector("#dialogCancelButton"),
  dialogConfirmButton: document.querySelector("#dialogConfirmButton")
};

const state = {
  token: "cookie",
  admin: { username: "", role: "admin" },
  stats: {},
  health: null,
  users: [],
  usersPage: 1,
  usersLimit: 30,
  usersTotal: 0,
  selectedUsers: new Set(),
  messages: [],
  hasMoreMessages: false,
  nextBefore: "",
  loadingMessages: false,
  logs: [],
  lastRefreshAt: 0,
  dialogResolver: null,
  dialogOptions: null
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function hasPermission(permission) {
  return Boolean(state.token && permission);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function updateAdminHeader() {
  elements.adminMeta.textContent = `${state.admin.username || "管理员"} | ${state.admin.role || "admin"}`;
  if (elements.refreshMeta) {
    elements.refreshMeta.textContent = state.lastRefreshAt
      ? `最后刷新 ${formatDateTime(state.lastRefreshAt)}`
      : "尚未刷新";
  }
}

function markAdminRefreshed() {
  state.lastRefreshAt = Date.now();
  updateAdminHeader();
}

function closeDialog(result) {
  if (!state.dialogResolver) {
    return;
  }
  const resolve = state.dialogResolver;
  state.dialogResolver = null;
  state.dialogOptions = null;
  elements.dialogBackdrop.hidden = true;
  elements.dialogInput.value = "";
  elements.dialogFieldWrap.hidden = true;
  resolve(result);
}

function openDialog(options) {
  if (state.dialogResolver) {
    closeDialog({ confirmed: false, value: "" });
  }
  return new Promise((resolve) => {
    state.dialogResolver = resolve;
    state.dialogOptions = options;
    elements.dialogTitle.textContent = options.title || "确认操作";
    elements.dialogMessage.textContent = options.message || "";
    elements.dialogConfirmButton.textContent = options.confirmLabel || "确认";
    elements.dialogCancelButton.textContent = options.cancelLabel || "取消";
    if (options.field) {
      elements.dialogFieldWrap.hidden = false;
      elements.dialogFieldLabel.textContent = options.field.label || "输入内容";
      elements.dialogInput.type = options.field.type || "text";
      elements.dialogInput.placeholder = options.field.placeholder || "";
      elements.dialogInput.value = options.field.value || "";
      elements.dialogInput.required = Boolean(options.field.required);
    } else {
      elements.dialogFieldWrap.hidden = true;
      elements.dialogInput.type = "text";
      elements.dialogInput.placeholder = "";
      elements.dialogInput.value = "";
      elements.dialogInput.required = false;
    }
    elements.dialogBackdrop.hidden = false;
    window.requestAnimationFrame(() => {
      if (options.field) {
        elements.dialogInput.focus();
        elements.dialogInput.select();
      } else {
        elements.dialogConfirmButton.focus();
      }
    });
  });
}

async function confirmDialog(options) {
  const result = await openDialog(options);
  return result.confirmed;
}

async function promptDialog(options) {
  const result = await openDialog(options);
  if (!result.confirmed) {
    return null;
  }
  return String(result.value || "");
}

async function api(pathname, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers || {}) };
  let body = options.body;
  if (body && !(body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(body);
  }
  let response;
  try {
    response = await fetch(pathname, { method: options.method || "GET", headers, credentials: "same-origin", body });
  } catch (error) {
    throw new Error("网络连接失败，请稍后重试");
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch (error) {
    payload = null;
  }
  if (!response.ok) {
    throw new Error(payload?.error || `request failed: ${response.status}`);
  }
  return payload;
}

function setLoggedIn(loggedIn) {
  elements.loginCard.hidden = loggedIn;
  elements.dashboard.hidden = !loggedIn;
}

function formatDateTime(value) {
  if (!value) {
    return "-";
  }
  return new Date(value).toLocaleString();
}

function parseSortValue() {
  const raw = String(elements.userSortSelect.value || "username:asc");
  const [sort, order] = raw.split(":");
  return {
    sort: sort || "username",
    order: order === "desc" ? "desc" : "asc"
  };
}

function dateInputToStartMs(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }
  const parsed = new Date(`${raw}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function dateInputToEndMs(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return 0;
  }
  const parsed = new Date(`${raw}T23:59:59.999`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function renderStats() {
  const stats = state.stats;
  const items = [
    ["总用户", stats.users || 0],
    ["封禁用户", stats.bannedUsers || 0],
    ["在线用户", stats.onlineUsers || 0],
    ["会话数", stats.sessions || 0],
    ["消息总量", stats.messages || 0],
    ["24h消息", stats.messages24h || 0]
  ];
  elements.statsGrid.textContent = "";
  for (const [label, value] of items) {
    const card = document.createElement("article");
    card.className = "stat-card";
    card.innerHTML = `<h4>${label}</h4><strong>${value}</strong>`;
    elements.statsGrid.append(card);
  }
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) {
    return `${days}天 ${hours}小时`;
  }
  if (hours > 0) {
    return `${hours}小时 ${minutes}分钟`;
  }
  return `${minutes}分钟`;
}

function renderHealth() {
  if (!elements.healthGrid) {
    return;
  }
  const health = state.health;
  elements.healthGrid.textContent = "";
  if (!health) {
    const empty = document.createElement("article");
    empty.className = "health-card";
    empty.textContent = "暂无运行健康数据";
    elements.healthGrid.append(empty);
    return;
  }
  const items = [
    ["服务运行", formatDuration(health.uptimeSeconds)],
    ["启动时间", formatDateTime(health.startedAt)],
    ["用户数据", formatBytes(health.files?.usersBytes)],
    ["消息快照", formatBytes(health.files?.messagesBytes)],
    ["消息日志", formatBytes(health.files?.messagesLogBytes)],
    ["审计日志", formatBytes(health.files?.adminAuditBytes)],
    ["在线用户", health.runtime?.onlineUsers || 0],
    ["待写入", health.runtime?.messagesDirty ? `${health.runtime?.pendingMessageAppends || 0} 条` : "无"]
  ];
  for (const [label, value] of items) {
    const card = document.createElement("article");
    card.className = "health-card";
    card.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    elements.healthGrid.append(card);
  }
}

function renderUsers() {
  elements.usersTbody.textContent = "";
  for (const user of state.users) {
    const tr = document.createElement("tr");
    const checked = state.selectedUsers.has(user.username) ? "checked" : "";
    const status = user.banned ? `封禁 (${user.bannedReason || "无原因"})` : "正常";
    const safeUsername = escapeHtml(user.username);
    const safeStatus = escapeHtml(status);
    tr.innerHTML = `
      <td><input type="checkbox" data-select-user="${safeUsername}" ${checked} /></td>
      <td>${safeUsername}</td>
      <td>${safeStatus}</td>
      <td>${formatDateTime(user.createdAt)}</td>
      <td class="actions">
        <button class="tiny ${user.banned ? "ok" : "danger"}" data-action="ban" data-username="${safeUsername}" ${hasPermission("admin:user:update") ? "" : "disabled"}>${user.banned ? "解封" : "封禁"}</button>
        <button class="tiny" data-action="rename" data-username="${safeUsername}" ${hasPermission("admin:user:update") ? "" : "disabled"}>改名</button>
        <button class="tiny" data-action="password" data-username="${safeUsername}" ${hasPermission("admin:user:update") ? "" : "disabled"}>改密</button>
      </td>
    `;
    elements.usersTbody.append(tr);
  }
  const totalPages = Math.max(1, Math.ceil(state.usersTotal / state.usersLimit));
  elements.usersPager.textContent = `第 ${state.usersPage}/${totalPages} 页，共 ${state.usersTotal} 条`;
  elements.prevUsersPageButton.disabled = state.usersPage <= 1;
  elements.nextUsersPageButton.disabled = state.usersPage >= totalPages;
  const hasSelection = state.selectedUsers.size > 0;
  elements.batchBanButton.disabled = !hasPermission("admin:user:batch") || !hasSelection;
  elements.batchUnbanButton.disabled = !hasPermission("admin:user:batch") || !hasSelection;
}

function renderMessages() {
  elements.messagesList.textContent = "";
  if (state.messages.length === 0) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "当前筛选条件下没有消息";
    elements.messagesList.append(empty);
    elements.loadMoreMessagesButton.disabled = true;
    return;
  }
  for (const message of state.messages) {
    const article = document.createElement("article");
    article.className = "msg-item";
    const text = message.auditText || "(无可见审计文本)";
    article.innerHTML = `
      <div class="msg-meta">
        <span>${message.from} -> ${message.to}</span>
        <span>${formatDateTime(message.createdAt)}</span>
      </div>
      <div class="msg-text"></div>
    `;
    article.querySelector(".msg-text").textContent = text;
    elements.messagesList.append(article);
  }
  elements.loadMoreMessagesButton.disabled = !state.hasMoreMessages || state.loadingMessages;
}

function renderAuditLogs() {
  if (!hasPermission("admin:audit:read")) {
    elements.auditList.parentElement.hidden = true;
    return;
  }
  elements.auditList.parentElement.hidden = false;
  elements.auditList.textContent = "";
  if (state.logs.length === 0) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "暂无审计日志";
    elements.auditList.append(empty);
    return;
  }
  for (const item of state.logs) {
    const article = document.createElement("article");
    article.className = "msg-item";
    article.innerHTML = `
      <div class="msg-meta">
        <span>${escapeHtml(item.action)} | ${escapeHtml(item.actor)} (${escapeHtml(item.role)})</span>
        <span>${formatDateTime(item.at)}</span>
      </div>
      <div class="msg-text"></div>
    `;
    article.querySelector(".msg-text").textContent = JSON.stringify(item.details || {}, null, 2);
    elements.auditList.append(article);
  }
}

async function loadStats() {
  if (!hasPermission("admin:read")) {
    return;
  }
  const payload = await api("/api/admin/stats");
  state.stats = payload.stats || {};
  renderStats();
  markAdminRefreshed();
}

async function loadHealth() {
  if (!hasPermission("admin:read")) {
    return;
  }
  const payload = await api("/api/admin/health");
  state.health = payload.health || null;
  renderHealth();
  markAdminRefreshed();
}

async function loadUsers() {
  if (!hasPermission("admin:read")) {
    return;
  }
  const { sort, order } = parseSortValue();
  const q = encodeURIComponent(String(elements.userSearchInput.value || "").trim());
  const status = encodeURIComponent(String(elements.userStatusSelect.value || "all"));
  const payload = await api(`/api/admin/users?q=${q}&status=${status}&sort=${sort}&order=${order}&page=${state.usersPage}&limit=${state.usersLimit}`);
  state.users = payload.users || [];
  state.usersTotal = Number(payload.total || 0);
  state.usersPage = Number(payload.page || state.usersPage);
  state.usersLimit = Number(payload.limit || state.usersLimit);
  const available = new Set(state.users.map((user) => user.username));
  state.selectedUsers = new Set([...state.selectedUsers].filter((name) => available.has(name)));
  renderUsers();
  markAdminRefreshed();
}

function messageFilterQuery(reset) {
  const from = encodeURIComponent(String(elements.msgFromInput.value || "").trim());
  const to = encodeURIComponent(String(elements.msgToInput.value || "").trim());
  const q = encodeURIComponent(String(elements.msgKeywordInput.value || "").trim());
  const since = dateInputToStartMs(elements.msgSinceInput.value);
  const until = dateInputToEndMs(elements.msgUntilInput.value);
  const mask = elements.msgMaskCheckbox.checked ? "1" : "0";
  const before = !reset && state.nextBefore ? `&before=${encodeURIComponent(state.nextBefore)}` : "";
  const sinceParam = since ? `&since=${since}` : "";
  const untilParam = until ? `&until=${until}` : "";
  return `/api/admin/messages?limit=120&from=${from}&to=${to}&q=${q}&mask=${mask}${sinceParam}${untilParam}${before}`;
}

function buildMessageExportQuery(reasonValue) {
  const from = encodeURIComponent(String(elements.msgFromInput.value || "").trim());
  const to = encodeURIComponent(String(elements.msgToInput.value || "").trim());
  const q = encodeURIComponent(String(elements.msgKeywordInput.value || "").trim());
  const since = dateInputToStartMs(elements.msgSinceInput.value);
  const until = dateInputToEndMs(elements.msgUntilInput.value);
  const reason = encodeURIComponent(String(reasonValue || "").trim());
  const sinceParam = since ? `&since=${since}` : "";
  const untilParam = until ? `&until=${until}` : "";
  return `/api/admin/messages/export?reason=${reason}&from=${from}&to=${to}&q=${q}${sinceParam}${untilParam}`;
}

function resetMessageFilters() {
  elements.msgFromInput.value = "";
  elements.msgToInput.value = "";
  elements.msgKeywordInput.value = "";
  elements.msgSinceInput.value = "";
  elements.msgUntilInput.value = "";
  elements.msgMaskCheckbox.checked = true;
}

async function loadMessages(reset = false) {
  if (!hasPermission("admin:messages:read") || state.loadingMessages) {
    return;
  }
  state.loadingMessages = true;
  if (reset) {
    state.messages = [];
    state.hasMoreMessages = false;
    state.nextBefore = "";
  }
  try {
    const payload = await api(messageFilterQuery(reset));
    const rows = payload.messages || [];
    state.messages = reset ? rows : [...rows, ...state.messages];
    state.hasMoreMessages = Boolean(payload.hasMore);
    state.nextBefore = String(payload.nextBefore || "");
    markAdminRefreshed();
  } finally {
    state.loadingMessages = false;
    renderMessages();
  }
}

async function loadAuditLogs() {
  if (!hasPermission("admin:audit:read")) {
    state.logs = [];
    renderAuditLogs();
    return;
  }
  const payload = await api("/api/admin/audit?limit=160");
  state.logs = payload.logs || [];
  renderAuditLogs();
  markAdminRefreshed();
}

async function refreshAll(resetMessages = true) {
  await Promise.all([loadStats(), loadHealth(), loadUsers(), loadAuditLogs()]);
  await loadMessages(resetMessages);
  markAdminRefreshed();
}

async function login(username, password) {
  const payload = await api("/api/admin/login", {
    method: "POST",
    body: { username, password }
  });
  state.token = payload.token ? "cookie" : "";
  state.admin = {
    username: payload.admin?.username || "管理员",
    role: payload.admin?.role || "admin"
  };
  updateAdminHeader();
  setLoggedIn(true);
  await refreshAll(true);
}

async function logout() {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } catch (error) {
    // ignore
  }
  state.token = "";
  state.admin = { username: "", role: "admin" };
  state.lastRefreshAt = 0;
  updateAdminHeader();
  setLoggedIn(false);
}

async function patchUser(username, body) {
  await api(`/api/admin/users/${encodeURIComponent(username)}`, {
    method: "PATCH",
    body
  });
  await Promise.all([loadUsers(), loadStats(), loadAuditLogs()]);
  markAdminRefreshed();
  showToast("用户修改成功");
}

async function batchUsers(banned) {
  const usernames = [...state.selectedUsers];
  if (usernames.length === 0) {
    showToast("请先勾选用户");
    return;
  }
  const result = await openDialog({
    title: banned ? "批量封禁" : "批量解封",
    message: `${banned ? "即将封禁" : "即将解封"} ${usernames.length} 个用户。`,
    field: banned
      ? {
          label: "封禁原因",
          value: "admin batch action",
          placeholder: "输入封禁原因",
          required: false
        }
      : null,
    confirmLabel: banned ? "确认封禁" : "确认解封"
  });
  if (!result.confirmed) {
    return;
  }
  const reason = banned ? String(result.value || "").trim() || "admin batch action" : "";
  await api("/api/admin/users/batch", {
    method: "POST",
    body: { usernames, banned, bannedReason: reason }
  });
  await Promise.all([loadUsers(), loadStats(), loadAuditLogs()]);
  markAdminRefreshed();
  showToast(`已更新 ${usernames.length} 个用户`);
}

async function exportMessages() {
  if (!hasPermission("admin:messages:export")) {
    return;
  }
  const reason = String(elements.exportReasonInput.value || "").trim();
  if (!reason) {
    showToast("请填写导出原因");
    return;
  }
  const confirmed = await confirmDialog({
    title: "导出审计内容",
    message: "确认导出当前筛选条件下的聊天审计内容？",
    confirmLabel: "确认导出"
  });
  if (!confirmed) {
    return;
  }
  const payload = await api(buildMessageExportQuery(reason));
  const blob = new Blob([String(payload.content || "")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = String(payload.filename || `admin-export-${Date.now()}.txt`);
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("导出完成");
  await loadAuditLogs();
  markAdminRefreshed();
}

async function handleUserAction(event) {
  const selectCheckbox = event.target.closest("input[data-select-user]");
  if (selectCheckbox) {
    const username = String(selectCheckbox.dataset.selectUser || "");
    if (selectCheckbox.checked) {
      state.selectedUsers.add(username);
    } else {
      state.selectedUsers.delete(username);
    }
    return;
  }

  const button = event.target.closest("button[data-action]");
  if (!button) {
    return;
  }
  const username = String(button.dataset.username || "");
  const action = String(button.dataset.action || "");
  const user = state.users.find((item) => item.username === username);
  if (!user) {
    return;
  }
  try {
    if (action === "ban") {
      if (user.banned) {
        const confirmed = await confirmDialog({
          title: "解封用户",
          message: `确认解封 ${username}？`,
          confirmLabel: "确认解封"
        });
        if (!confirmed) {
          return;
        }
        await patchUser(username, { banned: false });
      } else {
        const reason = await promptDialog({
          title: "封禁用户",
          message: `为 ${username} 设置封禁原因。`,
          field: {
            label: "封禁原因",
            value: "admin action",
            placeholder: "输入封禁原因",
            required: false
          },
          confirmLabel: "确认封禁"
        });
        if (reason === null) {
          return;
        }
        await patchUser(username, { banned: true, bannedReason: reason || "admin action" });
      }
      return;
    }
    if (action === "rename") {
      const nextName = await promptDialog({
        title: "修改用户名",
        message: `当前用户名：${user.username}`,
        field: {
          label: "新用户名",
          value: user.username,
          placeholder: "3-24 字母数字下划线",
          required: true
        },
        confirmLabel: "确认修改"
      });
      const normalizedName = String(nextName || "").trim();
      if (nextName === null || !normalizedName || normalizedName === user.username) {
        return;
      }
      await patchUser(username, { username: normalizedName });
      return;
    }
    if (action === "password") {
      const nextPassword = await promptDialog({
        title: "修改密码",
        message: `为 ${username} 设置新密码。`,
        field: {
          label: "新密码",
          type: "password",
          placeholder: "4-72位",
          required: true
        },
        confirmLabel: "确认修改"
      });
      if (!String(nextPassword || "").trim()) {
        return;
      }
      await patchUser(username, { password: String(nextPassword || "") });
    }
  } catch (error) {
    showToast(error.message);
  }
}

function bindEvents() {
  const close = () => closeDialog({ confirmed: false, value: "" });
  elements.dialogCancelButton.addEventListener("click", close);
  elements.dialogBackdrop.addEventListener("click", (event) => {
    if (event.target === elements.dialogBackdrop) {
      close();
    }
  });
  elements.dialogConfirmButton.addEventListener("click", () => {
    if (!state.dialogResolver) {
      return;
    }
    if (state.dialogOptions?.field?.required && !String(elements.dialogInput.value || "").trim()) {
      showToast("请输入内容");
      elements.dialogInput.focus();
      return;
    }
    const value = String(elements.dialogInput.value || "").trim();
    closeDialog({ confirmed: true, value });
  });
  elements.dialogInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey && elements.dialogInput.type !== "textarea") {
      event.preventDefault();
      elements.dialogConfirmButton.click();
    }
    if (event.key === "Escape") {
      close();
    }
  });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.dialogBackdrop.hidden) {
      close();
    }
  });
  elements.loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await login(String(elements.usernameInput.value || "").trim(), String(elements.passwordInput.value || ""));
      showToast("登录成功");
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.logoutButton.addEventListener("click", async () => {
    await logout();
    showToast("已退出");
  });

  elements.refreshButton.addEventListener("click", async () => {
    try {
      await refreshAll(true);
      showToast("已刷新");
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.applyUserFilterButton.addEventListener("click", async () => {
    state.usersPage = 1;
    try {
      await loadUsers();
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.prevUsersPageButton.addEventListener("click", async () => {
    if (state.usersPage <= 1) {
      return;
    }
    state.usersPage -= 1;
    try {
      await loadUsers();
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.nextUsersPageButton.addEventListener("click", async () => {
    const totalPages = Math.max(1, Math.ceil(state.usersTotal / state.usersLimit));
    if (state.usersPage >= totalPages) {
      return;
    }
    state.usersPage += 1;
    try {
      await loadUsers();
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.selectAllUsers.addEventListener("change", () => {
    if (elements.selectAllUsers.checked) {
      for (const user of state.users) {
        state.selectedUsers.add(user.username);
      }
    } else {
      for (const user of state.users) {
        state.selectedUsers.delete(user.username);
      }
    }
    renderUsers();
  });

  elements.batchBanButton.addEventListener("click", async () => {
    try {
      await batchUsers(true);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.batchUnbanButton.addEventListener("click", async () => {
    try {
      await batchUsers(false);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.usersTbody.addEventListener("click", (event) => {
    void handleUserAction(event);
  });

  elements.applyMsgFilterButton.addEventListener("click", async () => {
    try {
      await loadMessages(true);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.resetMsgFilterButton.addEventListener("click", async () => {
    resetMessageFilters();
    try {
      await loadMessages(true);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.loadMoreMessagesButton.addEventListener("click", async () => {
    try {
      await loadMessages(false);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.exportMessagesButton.addEventListener("click", async () => {
    try {
      await exportMessages();
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.refreshAuditButton.addEventListener("click", async () => {
    try {
      await loadAuditLogs();
      showToast("审计日志已刷新");
    } catch (error) {
      showToast(error.message);
    }
  });

  for (const input of [
    elements.msgFromInput,
    elements.msgToInput,
    elements.msgKeywordInput,
    elements.msgSinceInput,
    elements.msgUntilInput
  ]) {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      elements.applyMsgFilterButton.click();
    });
  }
}

function syncPermissionUi() {
  if (!hasPermission("admin:user:update")) {
    elements.batchBanButton.disabled = true;
    elements.batchUnbanButton.disabled = true;
  }
  if (!hasPermission("admin:messages:export")) {
    elements.exportMessagesButton.disabled = true;
    elements.exportReasonInput.disabled = true;
  }
}

async function boot() {
  bindEvents();
  try {
    const payload = await api("/api/admin/me");
    state.admin = {
      username: payload.admin?.username || "管理员",
      role: payload.admin?.role || "admin"
    };
    updateAdminHeader();
    setLoggedIn(true);
    syncPermissionUi();
    await refreshAll(true);
  } catch (error) {
    state.token = "";
    state.lastRefreshAt = 0;
    updateAdminHeader();
    setLoggedIn(false);
  }
}

void boot();
