"use strict";

const { escapeHtml, formatDateTime, isElementNode, scheduleClientMetaReport } = window.EchoUi;

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
  dashboardRangeSelect: document.querySelector("#dashboardRangeSelect"),
  refreshButton: document.querySelector("#refreshButton"),
  logoutButton: document.querySelector("#logoutButton"),
  overviewGrid: document.querySelector("#overviewGrid"),
  chartRangeText: document.querySelector("#chartRangeText"),
  growthBarChart: document.querySelector("#growthBarChart"),
  activityLineChart: document.querySelector("#activityLineChart"),
  userMixChart: document.querySelector("#userMixChart"),
  deviceMixChart: document.querySelector("#deviceMixChart"),
  securityAlertsList: document.querySelector("#securityAlertsList"),
  recentLoginsList: document.querySelector("#recentLoginsList"),
  recentUsersList: document.querySelector("#recentUsersList"),
  abnormalLoginsList: document.querySelector("#abnormalLoginsList"),
  systemStatusText: document.querySelector("#systemStatusText"),
  currentIpText: document.querySelector("#currentIpText"),
  statsGrid: document.querySelector("#statsGrid"),
  healthGrid: document.querySelector("#healthGrid"),
  accessOverviewGrid: document.querySelector("#accessOverviewGrid"),
  accessTrend: document.querySelector("#accessTrend"),
  accessTopPages: document.querySelector("#accessTopPages"),
  accessTopIps: document.querySelector("#accessTopIps"),
  accessRangeText: document.querySelector("#accessRangeText"),
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

const ADMIN_PANEL_IDS = [
  "overviewPanel",
  "healthPanel",
  "accessPanel",
  "accessLogsPanel",
  "usersPanel",
  "messagesPanel",
  "auditPanel"
];

const adminNavigation = document.querySelector(".sidebar-nav");
const adminProfileButton = document.querySelector("#adminProfileButton");
const adminProfileMenu = document.querySelector("#adminProfileMenu");
const adminMenuRefreshButton = document.querySelector("#adminMenuRefreshButton");
const adminMenuLogoutButton = document.querySelector("#adminMenuLogoutButton");

const state = {
  admin: { username: "", role: "admin" },
  csrfToken: "",
  dashboard: null,
  dashboardRangeDays: 7,
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

function formatCiphertextMeta(message) {
  const bytes = Number(message?.ciphertextBytes || 0);
  const sha256 = String(message?.ciphertextSha256 || "");
  const nonce = String(message?.nonce || "-");
  return `长度 ${bytes} bytes | ${sha256 ? `sha256 ${sha256}` : "sha256 -"} | nonce ${nonce}`;
}

function hasPermission(permission) {
  return Boolean(permission && state.admin?.role === "admin");
}

function resetAdminState(showLogin = false) {
  state.csrfToken = "";
  state.dashboard = null;
  state.dashboardRangeDays = 7;
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
  updateAdminHeader();
  if (showLogin) {
    setLoggedIn(false);
    elements.usernameInput.focus();
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
    "invalid csrf token": "当前后台安全令牌已失效，请重新登录",
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
  const username = state.admin.username || "管理员";
  const role = state.admin.role || "admin";
  for (const element of document.querySelectorAll("#adminProfileName, #adminMenuName")) {
    element.textContent = username;
  }
  for (const element of document.querySelectorAll("#adminProfileRole, #adminMenuRole")) {
    element.textContent = role;
  }
  const avatar = document.querySelector("#adminAvatarText");
  if (avatar) {
    avatar.textContent = Array.from(username)[0] || "管";
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
  if (!["GET", "HEAD"].includes((options.method || "GET").toUpperCase()) && state.csrfToken) {
    headers["X-CSRF-Token"] = state.csrfToken;
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
  if (payload?.csrfToken) {
    state.csrfToken = String(payload.csrfToken);
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
    syncActiveAdminPanel();
  }
}

function activeAdminPanelId() {
  const requested = String(window.location.hash || "").slice(1);
  return ADMIN_PANEL_IDS.includes(requested) ? requested : "overviewPanel";
}

function syncActiveAdminPanel(panelId = activeAdminPanelId()) {
  const activeId = ADMIN_PANEL_IDS.includes(panelId) ? panelId : "overviewPanel";
  for (const id of ADMIN_PANEL_IDS) {
    const panel = document.getElementById(id);
    if (panel) {
      panel.hidden = id !== activeId;
    }
  }
  if (elements.statsGrid) {
    elements.statsGrid.hidden = activeId !== "overviewPanel";
  }
  for (const link of adminNavigation?.querySelectorAll("a[href^='#']") || []) {
    const selected = link.getAttribute("href") === `#${activeId}`;
    link.classList.toggle("is-active", selected);
    if (selected) {
      link.setAttribute("aria-current", "page");
    } else {
      link.removeAttribute("aria-current");
    }
  }
  window.scrollTo({ top: 0, behavior: "auto" });
}

function closeAdminProfileMenu() {
  if (!adminProfileMenu || !adminProfileButton) {
    return;
  }
  adminProfileMenu.hidden = true;
  adminProfileButton.setAttribute("aria-expanded", "false");
}

function parseSortValue() {
  const raw = String(elements.userSortSelect.value || "username:asc");
  const [sort, order] = raw.split(":");
  return {
    sort: sort || "username",
    order: order === "desc" ? "desc" : "asc"
  };
}

function selectedDashboardDays() {
  const days = Number(elements.dashboardRangeSelect?.value || state.dashboardRangeDays || 7);
  if (days <= 7) {
    return 7;
  }
  if (days <= 14) {
    return 14;
  }
  return 30;
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
    ["今日注册", stats.usersToday || 0],
    ["封禁用户", stats.bannedUsers || 0],
    ["在线用户", stats.onlineUsers || 0],
    ["24h 活跃", stats.activeUsers || 0],
    ["会话数", stats.sessions || 0],
    ["消息总量", stats.messages || 0],
    ["24h 消息", stats.messages24h || 0],
    ["今日消息", stats.messagesToday || 0]
  ];
  elements.statsGrid.textContent = "";
  for (const [label, value] of items) {
    const card = document.createElement("article");
    card.className = "stat-card";
    card.innerHTML = `<h4>${escapeHtml(label)}</h4><strong>${escapeHtml(value)}</strong>`;
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

const chartColors = ["#2f8f5b", "#5979d7", "#b55044", "#a26a23", "#7a6cc9", "#5d7568"];

function renderChartLegend(items) {
  const legend = document.createElement("div");
  legend.className = "chart-legend";
  for (const item of items) {
    const row = document.createElement("span");
    row.innerHTML = `<i class="legend-dot ${escapeHtml(item.className || "")}"></i>${escapeHtml(item.label || "")}`;
    legend.append(row);
  }
  return legend;
}

function renderEmptyBlock(container, text) {
  container.textContent = "";
  const empty = document.createElement("article");
  empty.className = "empty-state compact";
  empty.textContent = text;
  container.append(empty);
}

function formatPercent(value) {
  return `${(Math.max(0, Number(value) || 0) * 100).toFixed(2)}%`;
}

function rangeLabel(days) {
  return `近 ${Number(days) || 7} 天`;
}

function setRangeLabels(days) {
  const label = rangeLabel(days);
  if (elements.chartRangeText) {
    elements.chartRangeText.textContent = label;
  }
  if (elements.accessRangeText) {
    elements.accessRangeText.textContent = label;
  }
}

function renderGrowthBarChart(rows) {
  const container = elements.growthBarChart;
  if (!container) {
    return;
  }
  container.textContent = "";
  const source = Array.isArray(rows) ? rows : [];
  if (source.length === 0) {
    renderEmptyBlock(container, "当前范围暂无趋势数据");
    return;
  }
  const maxValue = Math.max(1, ...source.map((row) => Math.max(Number(row.users || 0), Number(row.messages || 0))));
  for (const row of source) {
    const users = Number(row.users || 0);
    const messages = Number(row.messages || 0);
    const group = document.createElement("article");
    group.className = "bar-group";
    group.style.setProperty("--users-height", `${Math.max(3, Math.round((users / maxValue) * 100))}%`);
    group.style.setProperty("--messages-height", `${Math.max(3, Math.round((messages / maxValue) * 100))}%`);
    group.innerHTML = `
      <div class="bar-pair" aria-label="${escapeHtml(`${row.label}: ${users} 个新用户，${messages} 条消息`)}">
        <span class="bar-column users"></span>
        <span class="bar-column messages"></span>
      </div>
      <strong>${escapeHtml(String(row.label || "").slice(5))}</strong>
    `;
    container.append(group);
  }
}

function svgLinePoints(rows, key, width, height, maxValue) {
  if (rows.length === 1) {
    const value = Number(rows[0]?.[key] || 0);
    const y = height - (value / maxValue) * (height - 16) - 8;
    return `8,${y.toFixed(1)} ${width - 8},${y.toFixed(1)}`;
  }
  return rows.map((row, index) => {
    const x = 8 + (index / Math.max(1, rows.length - 1)) * (width - 16);
    const value = Number(row?.[key] || 0);
    const y = height - (value / maxValue) * (height - 16) - 8;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

function renderActivityLineChart(rows) {
  const container = elements.activityLineChart;
  if (!container) {
    return;
  }
  container.textContent = "";
  const source = Array.isArray(rows) ? rows : [];
  if (source.length === 0) {
    renderEmptyBlock(container, "当前范围暂无活跃趋势");
    return;
  }
  const width = 360;
  const height = 150;
  const maxValue = Math.max(1, ...source.map((row) => Math.max(Number(row.activeUsers || 0), Number(row.errors || 0))));
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "活跃用户与错误请求趋势");
  const grid = document.createElementNS("http://www.w3.org/2000/svg", "path");
  grid.setAttribute("d", `M8 ${height - 8}H${width - 8}M8 ${Math.round(height / 2)}H${width - 8}M8 8H${width - 8}`);
  grid.setAttribute("class", "line-grid");
  svg.append(grid);
  for (const [key, className] of [["activeUsers", "line-active"], ["errors", "line-error"]]) {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    line.setAttribute("points", svgLinePoints(source, key, width, height, maxValue));
    line.setAttribute("class", className);
    svg.append(line);
  }
  container.append(svg);
  container.append(renderChartLegend([
    { className: "active", label: "活跃用户" },
    { className: "error", label: "错误请求" }
  ]));
}

function renderDonutChart(container, rows, emptyText) {
  if (!container) {
    return;
  }
  container.textContent = "";
  const source = (Array.isArray(rows) ? rows : [])
    .map((row) => ({
      label: String(row.label || "-"),
      value: Math.max(0, Number(row.value ?? row.hits ?? row.sessions ?? 0))
    }))
    .filter((row) => row.value > 0);
  const total = source.reduce((sum, row) => sum + row.value, 0);
  if (!total) {
    renderEmptyBlock(container, emptyText);
    return;
  }
  let cursor = 0;
  const stops = source.map((row, index) => {
    const start = cursor;
    cursor += (row.value / total) * 100;
    const color = chartColors[index % chartColors.length];
    return `${color} ${start.toFixed(2)}% ${cursor.toFixed(2)}%`;
  });
  const visual = document.createElement("div");
  visual.className = "donut-visual";
  visual.style.background = `conic-gradient(${stops.join(", ")})`;
  visual.innerHTML = `<span>${escapeHtml(String(total))}</span>`;
  const legend = document.createElement("div");
  legend.className = "donut-legend";
  source.forEach((row, index) => {
    const item = document.createElement("div");
    item.className = "donut-legend-item";
    item.innerHTML = `
      <i style="background:${chartColors[index % chartColors.length]}"></i>
      <span>${escapeHtml(row.label)}</span>
      <strong>${escapeHtml(row.value)} · ${((row.value / total) * 100).toFixed(1)}%</strong>
    `;
    legend.append(item);
  });
  container.append(visual, legend);
}

function renderSecurityAlerts(alerts) {
  const container = elements.securityAlertsList;
  if (!container) {
    return;
  }
  container.textContent = "";
  const rows = Array.isArray(alerts) ? alerts : [];
  if (rows.length === 0) {
    renderEmptyBlock(container, "当前范围暂无告警");
    return;
  }
  for (const alert of rows) {
    const item = document.createElement("article");
    const level = String(alert.level || "low");
    item.className = `alert-item level-${level}`;
    item.innerHTML = `
      <span>${escapeHtml(level === "high" ? "高" : level === "medium" ? "中" : level === "ok" ? "正常" : "低")}</span>
      <div>
        <strong>${escapeHtml(alert.title || "告警")}</strong>
        <p>${escapeHtml(alert.detail || "")}</p>
      </div>
    `;
    container.append(item);
  }
}

function renderDashboardPanel() {
  const dashboard = state.dashboard;
  elements.overviewGrid.textContent = "";
  if (!dashboard) {
    setRangeLabels(state.dashboardRangeDays);
    renderGrowthBarChart([]);
    renderActivityLineChart([]);
    renderDonutChart(elements.userMixChart, [], "暂无用户结构数据");
    renderDonutChart(elements.deviceMixChart, [], "暂无设备来源数据");
    renderSecurityAlerts([]);
    renderDetailList(elements.recentLoginsList, [], "暂无登录记录");
    renderDetailList(elements.recentUsersList, [], "暂无注册记录");
    renderDetailList(elements.abnormalLoginsList, [], "暂无异常登录");
    elements.systemStatusText.textContent = "系统状态 -";
    elements.currentIpText.textContent = "IP -";
    return;
  }

  state.dashboardRangeDays = Number(dashboard.rangeDays || selectedDashboardDays());
  if (elements.dashboardRangeSelect) {
    elements.dashboardRangeSelect.value = String(state.dashboardRangeDays);
  }
  setRangeLabels(state.dashboardRangeDays);
  const alertCount = (dashboard.securityAlerts || []).filter((alert) => alert.level !== "ok").length;
  const deliveryStats = dashboard.deliveryStats || {};
  const overviewCards = [
    ["在线人数", dashboard.onlineUsers || 0, `${dashboard.sessions || 0} 个会话`],
    ["24h 活跃用户", dashboard.activeUsers || 0, `${dashboard.userTotal || 0} 个总用户`],
    ["今日消息", dashboard.messagesToday || 0, `${dashboard.messages || 0} 条总消息`],
    ["待投递消息", deliveryStats.pending || 0, `${deliveryStats.delivered || 0} 条已投递`],
    ["已读消息", deliveryStats.read || 0, `${deliveryStats.recalled || 0} 条已撤回`],
    ["错误率", formatPercent(dashboard.errorRate || 0), "当前时间范围"],
    ["安全告警", alertCount, alertCount ? "需要处理" : "暂无高优先级"]
  ];
  for (const [label, value, meta] of overviewCards) {
    const card = document.createElement("article");
    card.className = "overview-card";
    card.innerHTML = `
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(meta)}</small>
    `;
    elements.overviewGrid.append(card);
  }
  renderGrowthBarChart(dashboard.charts?.trends || []);
  renderActivityLineChart(dashboard.charts?.trends || []);
  renderDonutChart(elements.userMixChart, dashboard.charts?.userDistribution || [], "暂无用户结构数据");
  renderDonutChart(elements.deviceMixChart, dashboard.charts?.deviceBreakdown || [], "暂无设备来源数据");
  renderSecurityAlerts(dashboard.securityAlerts || []);

  elements.systemStatusText.textContent = `系统状态 ${dashboard.systemStatus?.ok === undefined ? "-" : (dashboard.systemStatus.ok ? "正常" : "异常")}`;
  elements.currentIpText.textContent = `IP ${dashboard.currentIp || "-"}`;

  renderDetailList(
    elements.recentLoginsList,
    (dashboard.recentLogins || []).map((item) => ({
      title: `${item.username || "管理员"} · ${item.role === "admin" ? "管理员" : "用户"} · ${item.ip || "-"}`,
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
  renderDetailList(
    elements.abnormalLoginsList,
    (dashboard.abnormalLogins || []).map((item) => ({
      title: `${item.username || "未知账号"} · ${item.ip || "-"}`,
      meta: formatDateTime(item.at)
    })),
    "暂无异常登录"
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
    ["待写入", health.runtime?.messagesDirty ? `${health.runtime?.pendingMessageAppends || 0} 条` : "无"],
    ["IP 归属", health.accessLogs?.ipGeoEnabled ? `已启用 · ${health.accessLogs?.ipGeoCacheSize || 0} 缓存` : "已关闭"]
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
    setRangeLabels(state.dashboardRangeDays);
    renderTrendList(elements.accessTrend, []);
    renderRankList(elements.accessTopPages, [], "pv", "path");
    renderRankList(elements.accessTopIps, [], "hits", "ip");
    return;
  }
  setRangeLabels(summary.days || state.dashboardRangeDays);
  const cards = [
    ["总页面 PV", summary.totals?.pageViews || 0],
    ["总页面 UV", summary.totals?.uniqueVisitors || 0],
    ["近 24 小时 PV", summary.totals?.pageViews24h || 0],
    ["近 24 小时 UV", summary.totals?.uniqueVisitors24h || 0],
    ["范围内请求", summary.totals?.requestsInRange || 0],
    ["范围内错误率", formatPercent(summary.totals?.errorRate || 0)],
    ["平均耗时", `${summary.totals?.avgRequestTimeMs || 0} ms`]
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
      <td>${user.online ? "在线" : "离线"}</td>
      <td>${formatDateTime(user.lastLoginAt)}</td>
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
        <span>${escapeHtml(`${message.from} -> ${message.to}`)}</span>
        <span>${escapeHtml(formatDateTime(message.createdAt))}</span>
      </div>
      <div class="msg-text"></div>
    `;
    const status = message.deliveryLabel || "未知状态";
    const auditLabel = message.auditLabel || (message.encrypted ? "端到端加密密文，后台不可读取明文" : "消息结构异常");
    article.querySelector(".msg-text").textContent = `${auditLabel} | ${status} | ${formatCiphertextMeta(message)}`;
    elements.messagesList.append(article);
  }
  elements.loadMoreMessagesButton.disabled = !state.hasMoreMessages || state.loadingMessages;
}

function renderAuditLogs() {
  if (!hasPermission("admin:audit:read")) {
    elements.auditList.textContent = "";
    return;
  }
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
  state.dashboardRangeDays = selectedDashboardDays();
  const payload = await api(`/api/admin/dashboard/stats?days=${state.dashboardRangeDays}`);
  state.dashboard = payload.dashboard || null;
  state.stats = payload.dashboard?.stats || state.stats || {};
  state.health = payload.dashboard?.health || state.health || null;
  state.accessSummary = payload.dashboard?.accessSummary || state.accessSummary || null;
  if (payload.dashboard?.currentAdmin?.username) {
    state.admin = {
      username: payload.dashboard.currentAdmin.username,
      role: payload.dashboard.currentAdmin.role || "admin"
    };
    updateAdminHeader();
  }
  renderDashboardPanel();
  renderStats();
  renderHealth();
  renderAccessSummary();
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
  state.dashboardRangeDays = selectedDashboardDays();
  const payload = await api(`/api/admin/access/summary?days=${state.dashboardRangeDays}`);
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
    loadAccessLogs(),
    loadAccessProfile(),
    loadUsers(),
    loadAuditLogs()
  ]);
  await loadMessages(resetMessages);
  markAdminRefreshed();
  syncActiveAdminPanel();
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
  await Promise.all([loadUsers(), loadDashboardStats(), loadAuditLogs()]);
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
  await Promise.all([loadUsers(), loadDashboardStats(), loadAuditLogs()]);
  markAdminRefreshed();
  showToast(`已更新 ${usernames.length} 个用户`);
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
  adminNavigation?.addEventListener("click", (event) => {
    if (!isElementNode(event.target)) {
      return;
    }
    const link = event.target.closest("a[href^='#']");
    if (!link) {
      return;
    }
    const panelId = String(link.getAttribute("href") || "").slice(1);
    if (!ADMIN_PANEL_IDS.includes(panelId)) {
      return;
    }
    event.preventDefault();
    window.history.pushState(null, "", `#${panelId}`);
    syncActiveAdminPanel(panelId);
    closeAdminProfileMenu();
  });
  window.addEventListener("popstate", () => syncActiveAdminPanel());
  adminProfileButton?.addEventListener("click", (event) => {
    event.stopPropagation();
    const open = adminProfileMenu?.hidden !== false;
    if (adminProfileMenu) {
      adminProfileMenu.hidden = !open;
    }
    adminProfileButton.setAttribute("aria-expanded", open ? "true" : "false");
  });
  adminProfileMenu?.addEventListener("click", (event) => event.stopPropagation());
  document.addEventListener("click", closeAdminProfileMenu);
  adminMenuRefreshButton?.addEventListener("click", async () => {
    closeAdminProfileMenu();
    try {
      await refreshAll(true);
      showToast("已刷新");
    } catch (error) {
      showToast(error.message);
    }
  });
  adminMenuLogoutButton?.addEventListener("click", async () => {
    closeAdminProfileMenu();
    await logout();
    showToast("已退出");
  });
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

  elements.dashboardRangeSelect?.addEventListener("change", async () => {
    state.dashboardRangeDays = selectedDashboardDays();
    try {
      await loadDashboardStats();
      showToast(`已切换到${rangeLabel(state.dashboardRangeDays)}`);
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
}

async function boot() {
  bindEvents();
  scheduleClientMetaReport();
  elements.resetUsernameInput.value = "admin";
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
