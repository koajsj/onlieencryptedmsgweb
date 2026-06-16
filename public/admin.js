"use strict";

const elements = {
  loginCard: document.querySelector("#loginCard"),
  loginForm: document.querySelector("#loginForm"),
  usernameInput: document.querySelector("#usernameInput"),
  passwordInput: document.querySelector("#passwordInput"),
  adminResetForm: document.querySelector("#adminResetForm"),
  resetPassphraseInput: document.querySelector("#resetPassphraseInput"),
  resetUsernameInput: document.querySelector("#resetUsernameInput"),
  resetPasswordInput: document.querySelector("#resetPasswordInput"),
  resetPasswordConfirmInput: document.querySelector("#resetPasswordConfirmInput"),
  dashboard: document.querySelector("#dashboard"),
  adminMeta: document.querySelector("#adminMeta"),
  refreshMeta: document.querySelector("#refreshMeta"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  overviewGrid: document.querySelector("#overviewGrid"),
  recentLoginsList: document.querySelector("#recentLoginsList"),
  recentUsersList: document.querySelector("#recentUsersList"),
  systemStatusText: document.querySelector("#systemStatusText"),
  currentIpText: document.querySelector("#currentIpText"),
  statsGrid: document.querySelector("#statsGrid"),
  healthGrid: document.querySelector("#healthGrid"),
  accessOverviewGrid: document.querySelector("#accessOverviewGrid"),
  accessTrend: document.querySelector("#accessTrend"),
  accessTopPages: document.querySelector("#accessTopPages"),
  accessTopIps: document.querySelector("#accessTopIps"),
  accessIpInput: document.querySelector("#accessIpInput"),
  accessUserIdInput: document.querySelector("#accessUserIdInput"),
  accessSessionInput: document.querySelector("#accessSessionInput"),
  accessSinceInput: document.querySelector("#accessSinceInput"),
  accessUntilInput: document.querySelector("#accessUntilInput"),
  applyAccessFilterButton: document.querySelector("#applyAccessFilterButton"),
  resetAccessFilterButton: document.querySelector("#resetAccessFilterButton"),
  accessProfileList: document.querySelector("#accessProfileList"),
  accessLogsPager: document.querySelector("#accessLogsPager"),
  prevAccessLogsPageButton: document.querySelector("#prevAccessLogsPageButton"),
  nextAccessLogsPageButton: document.querySelector("#nextAccessLogsPageButton"),
  accessLogsTbody: document.querySelector("#accessLogsTbody"),
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

const ADMIN_TOKEN_STORAGE_KEY = "secure_chat_admin_token";
const CLIENT_META_SENT_STORAGE_KEY = "secure_chat_client_meta_sent_v1";

const state = {
  token: "",
  admin: { username: "", role: "admin" },
  dashboard: null,
  stats: {},
  health: null,
  accessSummary: null,
  accessLogs: [],
  accessLogsPage: 1,
  accessLogsLimit: 25,
  accessLogsTotal: 0,
  accessProfile: null,
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

function isElementNode(value) {
  return value instanceof Element;
}

function hasPermission(permission) {
  return Boolean(state.token && permission);
}

function resetAdminState(showLogin = false) {
  state.token = "";
  state.dashboard = null;
  state.stats = {};
  state.health = null;
  state.accessSummary = null;
  state.accessLogs = [];
  state.accessLogsPage = 1;
  state.accessLogsTotal = 0;
  state.accessProfile = null;
  state.users = [];
  state.usersTotal = 0;
  state.selectedUsers.clear();
  state.messages = [];
  state.hasMoreMessages = false;
  state.nextBefore = "";
  state.logs = [];
  state.admin = { username: "", role: "admin" };
  state.lastRefreshAt = 0;
  persistAdminToken("");
  updateAdminHeader();
  if (showLogin) {
    setLoggedIn(false);
    elements.usernameInput.focus();
  }
}

function readStoredAdminToken() {
  try {
    return String(window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "");
  } catch (error) {
    return "";
  }
}

function persistAdminToken(token) {
  try {
    if (token) {
      window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    } else {
      window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage failures and continue with the in-memory token.
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

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function translateAdminError(pathname, status, payload) {
  const raw = String(payload?.error || "").trim();
  const route = String(pathname || "").split("?")[0];
  const mapped = {
    "管理员账号或密码错误": "管理员账号或密码错误",
    "invalid admin credentials": "管理员账号或密码错误",
    "身份验证口令错误": "身份验证口令错误",
    "管理员身份验证口令未配置": "管理员身份验证口令未配置",
    "管理员配置写入失败": "管理员配置写入失败",
    unauthorized: "请先登录管理员账号",
    "session expired": "管理员登录已过期，请重新登录",
    "too many auth requests": "请求过于频繁，请稍后再试",
    "too many failed attempts, try again later": "失败次数过多，请稍后再试"
  };
  if (mapped[raw]) {
    return mapped[raw];
  }
  if (route === "/api/admin/login" && status === 401) {
    return "登录失败，请检查账号和密码";
  }
  return raw || `请求失败：${status}`;
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
  const bearerToken =
    options.auth === false
      ? ""
      : String(options.token !== undefined ? options.token : state.token || "");
  if (bearerToken && !headers.Authorization) {
    headers.Authorization = `Bearer ${bearerToken}`;
  }
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
    if (response.status === 401 && String(pathname || "").split("?")[0] !== "/api/admin/login") {
      resetAdminState(true);
    }
    throw new Error(translateAdminError(pathname, response.status, payload));
  }
  return payload;
}

function setLoggedIn(loggedIn) {
  elements.loginCard.hidden = loggedIn;
  elements.dashboard.hidden = !loggedIn;
  if (loggedIn) {
    syncMessageAuditControls();
  }
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

function userDetailHref(username) {
  return `./admin-user.html?username=${encodeURIComponent(String(username || ""))}`;
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

function renderDetailList(container, rows, emptyText) {
  container.textContent = "";
  if (!rows || rows.length === 0) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = emptyText;
    container.append(empty);
    return;
  }
  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "detail-item";
    item.innerHTML = `
      <strong>${escapeHtml(row.title)}</strong>
      <div class="detail-item-meta">${escapeHtml(row.meta)}</div>
    `;
    container.append(item);
  }
}

function renderDashboardPanel() {
  const dashboard = state.dashboard;
  elements.overviewGrid.textContent = "";
  if (!dashboard) {
    renderDetailList(elements.recentLoginsList, [], "暂无登录记录");
    renderDetailList(elements.recentUsersList, [], "暂无注册记录");
    elements.systemStatusText.textContent = "系统状态 -";
    elements.currentIpText.textContent = "IP -";
    return;
  }

  const overviewCards = [
    ["用户总数", dashboard.userTotal || 0],
    ["在线/活跃用户", dashboard.activeUsers || 0],
    ["当前管理员", dashboard.currentAdmin?.username || "管理员"],
    ["当前访问 IP", dashboard.currentIp || "-"]
  ];
  for (const [label, value] of overviewCards) {
    const card = document.createElement("article");
    card.className = "overview-card";
    card.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    elements.overviewGrid.append(card);
  }

  elements.systemStatusText.textContent = `系统状态 ${dashboard.systemStatus?.label || "-"}`;
  elements.currentIpText.textContent = `IP ${dashboard.currentIp || "-"}`;

  renderDetailList(
    elements.recentLoginsList,
    (dashboard.recentLogins || []).map((item) => ({
      title: `${item.username || "管理员"} · ${item.ip || "-"}`,
      meta: formatDateTime(item.at)
    })),
    "暂无登录记录"
  );
  renderDetailList(
    elements.recentUsersList,
    (dashboard.recentUsers || []).map((item) => ({
      title: `${item.username || "-"}`,
      meta: `${formatDateTime(item.createdAt)}${item.banned ? " · 已封禁" : ""}`
    })),
    "暂无注册记录"
  );
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

function renderRankList(container, rows, valueKey, labelKey, suffix = "") {
  container.textContent = "";
  if (!rows || rows.length === 0) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "暂无访问数据";
    container.append(empty);
    return;
  }
  const maxValue = Math.max(1, ...rows.map((row) => Number(row[valueKey] || 0)));
  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "rank-item";
    const value = Number(row[valueKey] || 0);
    const label = escapeHtml(row[labelKey] || "-");
    const meta = row.meta ? `<div class="rank-meta">${escapeHtml(row.meta)}</div>` : "";
    item.innerHTML = `
      <div class="rank-head">
        <strong title="${label}">${label}</strong>
        <span>${value}${suffix}</span>
      </div>
      <div class="bar-track"><span class="bar-fill" style="width:${Math.max(8, Math.round((value / maxValue) * 100))}%"></span></div>
      ${meta}
    `;
    container.append(item);
  }
}

function renderTrendList(container, rows) {
  container.textContent = "";
  if (!rows || rows.length === 0) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "最近 7 天暂无页面访问";
    container.append(empty);
    return;
  }
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.pv || 0)));
  for (const row of rows) {
    const item = document.createElement("article");
    item.className = "trend-item";
    const pv = Number(row.pv || 0);
    const uv = Number(row.uv || 0);
    item.innerHTML = `
      <div class="trend-head">
        <strong>${escapeHtml(row.label || "-")}</strong>
        <span>${pv} PV / ${uv} UV</span>
      </div>
      <div class="bar-track"><span class="bar-fill" style="width:${Math.max(8, Math.round((pv / maxValue) * 100))}%"></span></div>
      <div class="trend-meta">会话数 ${uv}</div>
    `;
    container.append(item);
  }
}

function renderAccessSummary() {
  elements.accessOverviewGrid.textContent = "";
  const summary = state.accessSummary;
  if (!summary) {
    renderTrendList(elements.accessTrend, []);
    renderRankList(elements.accessTopPages, [], "pv", "path");
    renderRankList(elements.accessTopIps, [], "hits", "ip");
    return;
  }
  const cards = [
    ["总页面 PV", summary.totals?.pageViews || 0],
    ["总页面 UV", summary.totals?.uniqueVisitors || 0],
    ["近 24 小时 PV", summary.totals?.pageViews24h || 0],
    ["近 24 小时 UV", summary.totals?.uniqueVisitors24h || 0]
  ];
  for (const [label, value] of cards) {
    const card = document.createElement("article");
    card.className = "overview-card";
    card.innerHTML = `<span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>`;
    elements.accessOverviewGrid.append(card);
  }
  renderTrendList(elements.accessTrend, summary.trend || []);
  renderRankList(
    elements.accessTopPages,
    (summary.topPages || []).map((row) => ({
      ...row,
      meta: `页面访问 ${row.pv || 0} 次`
    })),
    "pv",
    "path"
  );
  renderRankList(
    elements.accessTopIps,
    (summary.topIps || []).map((row) => ({
      ...row,
      meta: `${row.attribution || "未知"} · ${row.uv || 0} 个会话`
    })),
    "hits",
    "ip"
  );
}

function renderAccessProfile() {
  elements.accessProfileList.textContent = "";
  const profile = state.accessProfile;
  if (!profile) {
    const empty = document.createElement("article");
    empty.className = "empty-state";
    empty.textContent = "输入 IP、用户ID 或会话ID 后可查看访问画像";
    elements.accessProfileList.append(empty);
    return;
  }
  const items = [
    { title: "首次访问", meta: formatDateTime(profile.firstVisitAt) },
    { title: "最近访问", meta: formatDateTime(profile.lastVisitAt) },
    { title: "访问次数", meta: `${profile.visits || 0} 次` },
    {
      title: "访问主体",
      meta: `用户ID ${profile.userId || "-"} · 会话 ${profile.sessionId || "-"}`
    },
    {
      title: "访问设备",
      meta: `${profile.clientMeta?.browser || "-"} · ${profile.clientMeta?.os || "-"} · ${profile.clientMeta?.deviceType || "-"}`
    },
    {
      title: "环境信息",
      meta: `${profile.clientMeta?.language || "-"} · ${profile.clientMeta?.screenResolution || "-"} · ${profile.clientMeta?.timezone || "-"}`
    },
    {
      title: "IP 属性",
      meta: `${profile.ip || "-"} · ${profile.ipAttribution || "未知"}`
    }
  ];
  for (const item of items) {
    const article = document.createElement("article");
    article.className = "detail-item";
    article.innerHTML = `<strong>${escapeHtml(item.title)}</strong><div class="detail-item-meta">${escapeHtml(item.meta)}</div>`;
    elements.accessProfileList.append(article);
  }
  if (Array.isArray(profile.topPages) && profile.topPages.length > 0) {
    const wrapper = document.createElement("article");
    wrapper.className = "detail-item";
    const rows = profile.topPages.map((row) => `${row.path} (${row.hits})`).join(" | ");
    wrapper.innerHTML = `<strong>常访问页面</strong><div class="detail-item-meta">${escapeHtml(rows)}</div>`;
    elements.accessProfileList.append(wrapper);
  }
}

function renderAccessLogs() {
  elements.accessLogsTbody.textContent = "";
  if (state.accessLogs.length === 0) {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td colspan="7"><div class="empty-state">当前筛选条件下没有访问日志</div></td>`;
    elements.accessLogsTbody.append(tr);
  } else {
    for (const row of state.accessLogs) {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${formatDateTime(row.createdAt)}</td>
        <td>${escapeHtml(row.userId || "-")}</td>
        <td title="${escapeHtml(row.sessionId || "-")}">${escapeHtml(row.sessionId || "-")}</td>
        <td><div class="access-log-path"><strong>${escapeHtml(row.ip || "-")}</strong><span class="access-log-subtle">${escapeHtml(row.ipAttribution || "未知")}</span></div></td>
        <td><div class="access-log-path"><strong>${escapeHtml(`${row.method || "GET"} ${row.path || "/"}`)}</strong><span class="access-log-subtle">${escapeHtml(row.requestKind || "other")} · ${escapeHtml(String(row.statusCode || 0))}</span></div></td>
        <td><div class="access-log-path"><strong>${escapeHtml(row.browser || "-")}</strong><span class="access-log-subtle">${escapeHtml(row.os || "-")} · ${escapeHtml(row.deviceType || "-")}</span></div></td>
        <td>${escapeHtml(`${row.requestTimeMs || 0} ms`)}</td>
      `;
      elements.accessLogsTbody.append(tr);
    }
  }
  const totalPages = Math.max(1, Math.ceil(state.accessLogsTotal / state.accessLogsLimit));
  elements.accessLogsPager.textContent = `第 ${state.accessLogsPage}/${totalPages} 页，共 ${state.accessLogsTotal} 条`;
  elements.prevAccessLogsPageButton.disabled = state.accessLogsPage <= 1;
  elements.nextAccessLogsPageButton.disabled = state.accessLogsPage >= totalPages;
}

function renderUsers() {
  elements.usersTbody.textContent = "";
  for (const user of state.users) {
    const tr = document.createElement("tr");
    const checked = state.selectedUsers.has(user.username) ? "checked" : "";
    const status = user.banned ? `封禁 (${user.bannedReason || "无原因"})` : "正常";
    const safeUsername = escapeHtml(user.username);
    const safeStatus = escapeHtml(status);
    const safeUsernameKey = escapeHtml(user.usernameKey || "");
    const detailHref = escapeHtml(userDetailHref(user.username));
    tr.innerHTML = `
      <td><input type="checkbox" data-select-user="${safeUsername}" ${checked} /></td>
      <td><div class="user-cell"><a class="user-link" href="${detailHref}">${safeUsername}</a><span class="user-subtle">${safeUsernameKey || "-"}</span></div></td>
      <td>${safeStatus}</td>
      <td>${formatDateTime(user.createdAt)}</td>
      <td class="actions">
        <button class="tiny" data-action="detail" data-username="${safeUsername}">详情</button>
        <button class="tiny ${user.banned ? "ok" : "danger"}" data-action="ban" data-username="${safeUsername}" ${hasPermission("admin:user:update") ? "" : "disabled"}>${user.banned ? "解封" : "封禁"}</button>
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
    article.innerHTML = `
      <div class="msg-meta">
        <span>${message.from} -> ${message.to}</span>
        <span>${formatDateTime(message.createdAt)}</span>
      </div>
      <div class="msg-text"></div>
    `;
    article.querySelector(".msg-text").textContent = `密文 ${message.ciphertext || "-"} | nonce ${message.nonce || "-"}`;
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

async function loadDashboardStats() {
  if (!hasPermission("admin:read")) {
    return;
  }
  const payload = await api("/api/admin/dashboard/stats");
  state.dashboard = payload.dashboard || null;
  if (payload.dashboard?.currentAdmin?.username) {
    state.admin = {
      username: payload.dashboard.currentAdmin.username,
      role: payload.dashboard.currentAdmin.role || "admin"
    };
    updateAdminHeader();
  }
  renderDashboardPanel();
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

function accessFilterQuery(page = state.accessLogsPage) {
  const ip = encodeURIComponent(String(elements.accessIpInput.value || "").trim());
  const userId = encodeURIComponent(String(elements.accessUserIdInput.value || "").trim());
  const sessionId = encodeURIComponent(String(elements.accessSessionInput.value || "").trim());
  const since = dateInputToStartMs(elements.accessSinceInput.value);
  const until = dateInputToEndMs(elements.accessUntilInput.value);
  const sinceParam = since ? `&since=${since}` : "";
  const untilParam = until ? `&until=${until}` : "";
  return `/api/admin/access/logs?page=${page}&limit=${state.accessLogsLimit}&ip=${ip}&userId=${userId}&sessionId=${sessionId}${sinceParam}${untilParam}`;
}

function accessProfileQuery() {
  const ip = encodeURIComponent(String(elements.accessIpInput.value || "").trim());
  const userId = encodeURIComponent(String(elements.accessUserIdInput.value || "").trim());
  const sessionId = encodeURIComponent(String(elements.accessSessionInput.value || "").trim());
  const since = dateInputToStartMs(elements.accessSinceInput.value);
  const until = dateInputToEndMs(elements.accessUntilInput.value);
  const sinceParam = since ? `&since=${since}` : "";
  const untilParam = until ? `&until=${until}` : "";
  return `/api/admin/access/profile?ip=${ip}&userId=${userId}&sessionId=${sessionId}${sinceParam}${untilParam}`;
}

async function loadAccessSummary() {
  if (!hasPermission("admin:read")) {
    return;
  }
  const payload = await api("/api/admin/access/summary");
  state.accessSummary = payload.summary || null;
  renderAccessSummary();
  markAdminRefreshed();
}

async function loadAccessLogs() {
  if (!hasPermission("admin:read")) {
    return;
  }
  const payload = await api(accessFilterQuery(state.accessLogsPage));
  state.accessLogs = payload.rows || [];
  state.accessLogsTotal = Number(payload.total || 0);
  state.accessLogsPage = Number(payload.page || state.accessLogsPage);
  state.accessLogsLimit = Number(payload.limit || state.accessLogsLimit);
  renderAccessLogs();
  markAdminRefreshed();
}

async function loadAccessProfile() {
  if (!hasPermission("admin:read")) {
    return;
  }
  const payload = await api(accessProfileQuery());
  state.accessProfile = payload.profile || null;
  renderAccessProfile();
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
  const since = dateInputToStartMs(elements.msgSinceInput.value);
  const until = dateInputToEndMs(elements.msgUntilInput.value);
  const before = !reset && state.nextBefore ? `&before=${encodeURIComponent(state.nextBefore)}` : "";
  const sinceParam = since ? `&since=${since}` : "";
  const untilParam = until ? `&until=${until}` : "";
  return `/api/admin/messages?limit=120&from=${from}&to=${to}${sinceParam}${untilParam}${before}`;
}

function buildMessageExportQuery(reasonValue) {
  const from = encodeURIComponent(String(elements.msgFromInput.value || "").trim());
  const to = encodeURIComponent(String(elements.msgToInput.value || "").trim());
  const since = dateInputToStartMs(elements.msgSinceInput.value);
  const until = dateInputToEndMs(elements.msgUntilInput.value);
  const reason = encodeURIComponent(String(reasonValue || "").trim());
  const sinceParam = since ? `&since=${since}` : "";
  const untilParam = until ? `&until=${until}` : "";
  return `/api/admin/messages/export?reason=${reason}&from=${from}&to=${to}${sinceParam}${untilParam}`;
}

function resetMessageFilters() {
  elements.msgFromInput.value = "";
  elements.msgToInput.value = "";
  elements.msgKeywordInput.value = "";
  elements.msgSinceInput.value = "";
  elements.msgUntilInput.value = "";
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
  await Promise.all([
    loadDashboardStats(),
    loadStats(),
    loadHealth(),
    loadAccessSummary(),
    loadAccessLogs(),
    loadAccessProfile(),
    loadUsers(),
    loadAuditLogs()
  ]);
  await loadMessages(resetMessages);
  markAdminRefreshed();
}

function syncMessageAuditControls() {
  if (elements.msgKeywordInput) {
    elements.msgKeywordInput.value = "";
    elements.msgKeywordInput.disabled = true;
    elements.msgKeywordInput.placeholder = "明文关键词检索已禁用";
  }
  if (elements.msgMaskCheckbox) {
    elements.msgMaskCheckbox.checked = false;
    elements.msgMaskCheckbox.disabled = true;
  }
}

async function login(username, password) {
  const payload = await api("/api/admin/login", {
    method: "POST",
    body: { username, password },
    auth: false
  });
  state.token = String(payload.token || "");
  persistAdminToken(state.token);
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
  resetAdminState(true);
}

async function resetAdminAccount(username, password, passphrase) {
  const payload = await api("/api/admin/account/reset", {
    method: "POST",
    auth: false,
    body: {
      username,
      password,
      passphrase
    }
  });
  const nextUsername = String(payload.admin?.username || username || "");
  elements.usernameInput.value = nextUsername;
  elements.passwordInput.value = "";
  elements.resetUsernameInput.value = nextUsername;
  elements.resetPasswordInput.value = "";
  elements.resetPasswordConfirmInput.value = "";
  elements.resetPassphraseInput.value = "";
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
    title: "导出消息密文",
    message: "确认导出当前筛选条件下的消息密文记录？",
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
  if (!isElementNode(event.target)) {
    return;
  }
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
    if (action === "detail") {
      window.location.href = userDetailHref(username);
      return;
    }
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

  elements.adminResetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = String(elements.resetUsernameInput.value || "").trim();
    const password = String(elements.resetPasswordInput.value || "");
    const passwordConfirm = String(elements.resetPasswordConfirmInput.value || "");
    const passphrase = String(elements.resetPassphraseInput.value || "");
    if (!username || !password || !passphrase) {
      showToast("请填写完整信息");
      return;
    }
    if (password !== passwordConfirm) {
      showToast("两次输入的密码不一致");
      elements.resetPasswordConfirmInput.focus();
      return;
    }
    try {
      await resetAdminAccount(username, password, passphrase);
      showToast("管理员账号密码已更新，请重新登录");
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

  elements.applyAccessFilterButton.addEventListener("click", async () => {
    state.accessLogsPage = 1;
    try {
      await Promise.all([loadAccessLogs(), loadAccessProfile()]);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.resetAccessFilterButton.addEventListener("click", async () => {
    elements.accessIpInput.value = "";
    elements.accessUserIdInput.value = "";
    elements.accessSessionInput.value = "";
    elements.accessSinceInput.value = "";
    elements.accessUntilInput.value = "";
    state.accessLogsPage = 1;
    try {
      await Promise.all([loadAccessLogs(), loadAccessProfile()]);
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.prevAccessLogsPageButton.addEventListener("click", async () => {
    if (state.accessLogsPage <= 1) {
      return;
    }
    state.accessLogsPage -= 1;
    try {
      await loadAccessLogs();
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.nextAccessLogsPageButton.addEventListener("click", async () => {
    const totalPages = Math.max(1, Math.ceil(state.accessLogsTotal / state.accessLogsLimit));
    if (state.accessLogsPage >= totalPages) {
      return;
    }
    state.accessLogsPage += 1;
    try {
      await loadAccessLogs();
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

  for (const input of [
    elements.accessIpInput,
    elements.accessUserIdInput,
    elements.accessSessionInput,
    elements.accessSinceInput,
    elements.accessUntilInput
  ]) {
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") {
        return;
      }
      event.preventDefault();
      elements.applyAccessFilterButton.click();
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
  scheduleClientMetaReport();
  elements.resetUsernameInput.value = "admin";
  state.token = readStoredAdminToken();
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
    resetAdminState(true);
  }
}

void boot();
