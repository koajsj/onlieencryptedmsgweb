"use strict";

const { formatDateTime } = window.EchoUi;

const elements = {
  title: document.querySelector("#detailTitle"),
  subtitle: document.querySelector("#detailSubtitle"),
  username: document.querySelector("#detailUsername"),
  usernameKey: document.querySelector("#detailUsernameKey"),
  avatar: document.querySelector("#detailAvatar"),
  refreshMeta: document.querySelector("#detailRefreshMeta"),
  refreshButton: document.querySelector("#detailRefreshButton"),
  backToUsersLink: document.querySelector("#backToUsersLink"),
  logoutButton: document.querySelector("#detailLogoutButton"),
  overviewGrid: document.querySelector("#detailOverviewGrid"),
  identityList: document.querySelector("#identityList"),
  cryptoList: document.querySelector("#cryptoList"),
  sessionList: document.querySelector("#sessionList"),
  accessProfileList: document.querySelector("#accessProfileList"),
  accessLogsList: document.querySelector("#accessLogsList"),
  conversationList: document.querySelector("#conversationList"),
  messageList: document.querySelector("#messageList"),
  auditList: document.querySelector("#auditList"),
  renameForm: document.querySelector("#renameForm"),
  renameInput: document.querySelector("#renameInput"),
  banForm: document.querySelector("#banForm"),
  banReasonInput: document.querySelector("#banReasonInput"),
  banToggleButton: document.querySelector("#banToggleButton"),
  actionStatusBadge: document.querySelector("#actionStatusBadge"),
  accessBadge: document.querySelector("#accessBadge"),
  toast: document.querySelector("#detailToast")
};

const state = {
  username: "",
  detail: null,
  csrfToken: "",
  loading: false,
  lastRefreshAt: 0,
  toastTimer: 0
};

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = String(message || "");
  elements.toast.classList.add("show");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2400);
}

function userDetailHref(username) {
  return `./admin-user.html?username=${encodeURIComponent(String(username || ""))}`;
}

function adminUsersHref() {
  return "./admin.html#usersPanel";
}

function parseUsernameFromQuery() {
  const url = new URL(window.location.href);
  return String(url.searchParams.get("username") || "").trim();
}

function formatCiphertextMeta(message) {
  const bytes = Number(message?.ciphertextBytes || 0);
  const sha256 = String(message?.ciphertextSha256 || "");
  const nonce = String(message?.nonce || "-");
  return `长度 ${bytes} bytes | ${sha256 ? `sha256 ${sha256}` : "sha256 -"} | nonce ${nonce}`;
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
    response = await fetch(pathname, {
      method: options.method || "GET",
      headers,
      credentials: "same-origin",
      body
    });
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
    if (response.status === 401) {
      window.location.href = adminUsersHref();
      throw new Error("管理员登录已过期，请重新登录");
    }
    throw new Error(String(payload?.error || `请求失败：${response.status}`));
  }
  return payload;
}

function setRefreshMeta() {
  elements.refreshMeta.textContent = state.lastRefreshAt
    ? `最后刷新：${formatDateTime(state.lastRefreshAt)}`
    : "尚未刷新";
}

function formatIpLocation(row) {
  const ip = String(row?.ip || "-");
  const location = String(row?.ipAttribution || row?.ipLocation || "").trim();
  return location ? `${ip} · ${location}` : ip;
}

function createEmptyState(text) {
  const article = document.createElement("article");
  article.className = "empty-state";
  article.textContent = text;
  return article;
}

function createDetailItem(title, meta) {
  const article = document.createElement("article");
  article.className = "detail-item";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const metaEl = createDetailMeta(meta);
  article.append(strong, metaEl);
  return article;
}

function createDetailMeta(text) {
  const metaEl = document.createElement("div");
  metaEl.className = "detail-item-meta";
  metaEl.textContent = text;
  return metaEl;
}

function createMessageAuditItem(left, right, text) {
  const article = document.createElement("article");
  article.className = "msg-item";
  const meta = document.createElement("div");
  meta.className = "msg-meta";
  const leftSpan = document.createElement("span");
  leftSpan.textContent = left;
  const rightSpan = document.createElement("span");
  rightSpan.textContent = right;
  meta.append(leftSpan, rightSpan);
  const body = document.createElement("div");
  body.className = "msg-text";
  body.textContent = text;
  article.append(meta, body);
  return article;
}

function renderOverview(detail) {
  const messageStats = detail.messageStats || {};
  const access = detail.access || {};
  const cards = [
    { label: "账号状态", value: detail.user?.banned ? "已封禁" : detail.user?.online ? "在线" : "离线" },
    { label: "活跃会话", value: `${(detail.sessions || []).length}` },
    { label: "实时连接", value: `${detail.realtime?.eventConnections || 0}` },
    { label: "消息总数", value: `${messageStats.total || 0}` },
    { label: "会话对象", value: `${messageStats.peers || 0}` },
    { label: "访问日志", value: `${access.totalLogs || 0}` }
  ];
  elements.overviewGrid.textContent = "";
  for (const card of cards) {
    const article = document.createElement("article");
    article.className = "overview-card";
    const span = document.createElement("span");
    span.textContent = card.label;
    const strong = document.createElement("strong");
    strong.textContent = card.value;
    article.append(span, strong);
    elements.overviewGrid.append(article);
  }
}

function renderIdentity(detail) {
  const rows = [
    { title: "用户名", meta: detail.user?.username || "-" },
    { title: "用户名索引", meta: detail.user?.usernameKey || "-" },
    { title: "注册时间", meta: formatDateTime(detail.user?.createdAt) },
    {
      title: "封禁信息",
      meta: detail.user?.banned
        ? `${detail.user?.bannedReason || "无原因"} · ${formatDateTime(detail.user?.bannedAt)}`
        : "正常"
    },
    { title: "首条消息时间", meta: formatDateTime(detail.messageStats?.firstMessageAt) },
    { title: "最后消息时间", meta: formatDateTime(detail.messageStats?.lastMessageAt) }
  ];
  elements.identityList.textContent = "";
  for (const row of rows) {
    elements.identityList.append(createDetailItem(row.title, row.meta));
  }
}

function renderCrypto(detail) {
  const publicKey = detail.crypto?.publicKey || {};
  const publicKeySummary = publicKey.present
    ? `${publicKey.bytes || 0} bytes | SHA-256 ${String(publicKey.sha256 || "").slice(0, 16) || "-"}`
    : "缺少公钥";
  const rows = [
    {
      title: "公钥",
      summary: publicKeySummary
    },
    {
      title: "私钥保存位置",
      summary: detail.crypto?.privateKeyStoredOnServer === false
        ? "仅保存在用户浏览器设备，服务端不可读取"
        : "未知，建议检查历史数据"
    },
    {
      title: "后台可见内容",
      summary: "仅密文元数据与公钥摘要，不展示私钥材料"
    }
  ];
  elements.cryptoList.textContent = "";
  for (const row of rows) {
    elements.cryptoList.append(createDetailItem(row.title, row.summary));
  }
}

function renderSessions(detail) {
  const sessions = detail.sessions || [];
  elements.sessionList.textContent = "";
  if (sessions.length === 0) {
    elements.sessionList.append(createEmptyState("当前没有活跃会话"));
    return;
  }
  for (const sessionItem of sessions) {
    const article = document.createElement("article");
    article.className = "detail-item";
    const strong = document.createElement("strong");
    strong.textContent = "活跃会话";
    article.append(
      strong,
      createDetailMeta(`${sessionItem.browser || "-"} · ${sessionItem.os || "-"} · ${sessionItem.device || "-"}`),
      createDetailMeta(`IP ${formatIpLocation(sessionItem)}`),
      createDetailMeta(`创建时间 ${formatDateTime(sessionItem.createdAt)}`),
      createDetailMeta(`最近活动 ${formatDateTime(sessionItem.lastSeenAt)}`),
      createDetailMeta(`过期时间 ${formatDateTime(sessionItem.expiresAt)}`)
    );
    elements.sessionList.append(article);
  }
}

function renderAccess(detail) {
  const profile = detail.access?.profile;
  const logs = detail.access?.recentLogs || [];
  elements.accessBadge.textContent = `最近 ${logs.length} 条日志`;

  if (!profile) {
    elements.accessProfileList.textContent = "";
    elements.accessProfileList.append(createEmptyState("没有该用户的访问画像"));
  } else {
    const rows = [
      { title: "首次访问", meta: formatDateTime(profile.firstVisitAt) },
      { title: "最近访问", meta: formatDateTime(profile.lastVisitAt) },
      { title: "累计访问", meta: `${profile.visits || 0} 次` },
      { title: "主会话 / IP", meta: `${profile.sessionId || "-"} · ${formatIpLocation(profile)}` },
      {
        title: "客户端环境",
        meta: `${profile.clientMeta?.browser || "-"} · ${profile.clientMeta?.os || "-"} · ${profile.clientMeta?.deviceType || "-"}`
      },
      {
        title: "语言 / 时区",
        meta: `${profile.clientMeta?.language || "-"} · ${profile.clientMeta?.timezone || "-"} · ${profile.clientMeta?.screenResolution || "-"}`
      }
    ];
    elements.accessProfileList.textContent = "";
    for (const row of rows) {
      elements.accessProfileList.append(createDetailItem(row.title, row.meta));
    }
  }

  if (logs.length === 0) {
    elements.accessLogsList.textContent = "";
    elements.accessLogsList.append(createEmptyState("暂无可展示的访问明细"));
    return;
  }
  elements.accessLogsList.textContent = "";
  for (const row of logs) {
    const article = document.createElement("article");
    article.className = "detail-item";
    const strong = document.createElement("strong");
    strong.textContent = `${row.method || "GET"} ${row.path || "/"}`;
    article.append(
      strong,
      createDetailMeta(formatDateTime(row.createdAt)),
      createDetailMeta(`${formatIpLocation(row)} · ${row.browser || "-"} · ${row.os || "-"}`)
    );
    elements.accessLogsList.append(article);
  }
}

function renderConversations(detail) {
  const rows = detail.conversations || [];
  elements.conversationList.textContent = "";
  if (rows.length === 0) {
    elements.conversationList.append(createEmptyState("该用户还没有会话关系"));
    return;
  }
  for (const row of rows) {
    const article = document.createElement("article");
    article.className = "detail-item";
    const strong = document.createElement("strong");
    strong.textContent = row.username;
    article.append(
      strong,
      createDetailMeta(`${row.online ? "在线" : "离线"} · 总消息 ${row.totalMessages || 0}`),
      createDetailMeta(`发送 ${row.sentMessages || 0} / 接收 ${row.receivedMessages || 0}`),
      createDetailMeta(`最后互动 ${formatDateTime(row.lastAt)}`)
    );
    elements.conversationList.append(article);
  }
}

function renderMessages(detail) {
  const rows = detail.recentMessages || [];
  elements.messageList.textContent = "";
  if (rows.length === 0) {
    elements.messageList.append(createEmptyState("暂无消息记录"));
    return;
  }
  for (const message of rows) {
    const text = `${message.auditLabel || "端到端加密密文，后台不可读取明文"} | ${message.deliveryLabel || "未知状态"} | ${formatCiphertextMeta(message)}`;
    elements.messageList.append(
      createMessageAuditItem(
        `${message.direction === "sent" ? "发送给" : "收到自"} ${message.peer}`,
        formatDateTime(message.createdAt),
        text
      )
    );
  }
}

function renderAudit(detail) {
  const rows = detail.audit || [];
  elements.auditList.textContent = "";
  if (rows.length === 0) {
    elements.auditList.append(createEmptyState("暂无与该用户相关的管理员审计记录"));
    return;
  }
  for (const item of rows) {
    elements.auditList.append(
      createMessageAuditItem(
        item.action || "-",
        formatDateTime(item.at),
        JSON.stringify(item.details || {}, null, 2)
      )
    );
  }
}

function renderDetail(detail) {
  state.detail = detail;
  const subtitle = detail.user?.banned
    ? `该账号已封禁，原因：${detail.user?.bannedReason || "无原因"}`
    : detail.user?.online
      ? "账号当前在线，可在这里查看状态、设备和历史。"
      : "账号当前离线，可在这里查看状态、设备和历史。";
  document.title = `${detail.user?.username || "用户"} · 用户详情`;
  elements.title.textContent = `${detail.user?.username || "用户"} 的详情`;
  elements.subtitle.textContent = subtitle;
  elements.username.textContent = detail.user?.username || "-";
  elements.usernameKey.textContent = detail.user?.usernameKey || "-";
  elements.avatar.textContent = String(detail.user?.username || "?").slice(0, 1).toUpperCase();
  elements.actionStatusBadge.textContent = detail.user?.banned ? "已封禁" : detail.user?.online ? "在线" : "离线";
  elements.banToggleButton.textContent = detail.user?.banned ? "解除封禁" : "执行封禁";
  elements.backToUsersLink.href = adminUsersHref();
  elements.renameInput.value = detail.user?.username || "";
  elements.banReasonInput.value = detail.user?.bannedReason || "";
  renderOverview(detail);
  renderIdentity(detail);
  renderCrypto(detail);
  renderSessions(detail);
  renderAccess(detail);
  renderConversations(detail);
  renderMessages(detail);
  renderAudit(detail);
}

async function loadDetail() {
  if (!state.username) {
    throw new Error("缺少用户名参数");
  }
  state.loading = true;
  elements.refreshButton.disabled = true;
  try {
    const payload = await api(`/api/admin/users/${encodeURIComponent(state.username)}`);
    renderDetail(payload.detail || {});
    state.lastRefreshAt = Date.now();
    setRefreshMeta();
  } finally {
    state.loading = false;
    elements.refreshButton.disabled = false;
  }
}

async function patchUser(body) {
  const payload = await api(`/api/admin/users/${encodeURIComponent(state.username)}`, {
    method: "PATCH",
    body
  });
  const nextUsername = String(payload.user?.username || state.username);
  if (nextUsername && nextUsername !== state.username) {
    state.username = nextUsername;
    window.history.replaceState({}, "", userDetailHref(nextUsername));
  }
  await loadDetail();
}

async function logout() {
  try {
    await api("/api/admin/logout", { method: "POST" });
  } catch (error) {
    // Ignore logout errors and return to the admin list.
  }
  window.location.href = adminUsersHref();
}

function bindEvents() {
  elements.refreshButton.addEventListener("click", async () => {
    try {
      await loadDetail();
      showToast("详情已刷新");
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.logoutButton.addEventListener("click", async () => {
    await logout();
  });

  elements.renameForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const nextUsername = String(elements.renameInput.value || "").trim();
    if (!nextUsername) {
      showToast("请输入用户名");
      return;
    }
    if (nextUsername === state.username) {
      showToast("用户名未变化");
      return;
    }
    try {
      await patchUser({ username: nextUsername });
      showToast("用户名已更新");
    } catch (error) {
      showToast(error.message);
    }
  });

  elements.banForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const currentlyBanned = Boolean(state.detail?.user?.banned);
    const bannedReason = String(elements.banReasonInput.value || "").trim();
    try {
      await patchUser({
        banned: !currentlyBanned,
        bannedReason: bannedReason || "admin action"
      });
      showToast(currentlyBanned ? "已解除封禁" : "已执行封禁");
    } catch (error) {
      showToast(error.message);
    }
  });
}

async function boot() {
  bindEvents();
  state.username = parseUsernameFromQuery();
  if (!state.username) {
    elements.subtitle.textContent = "URL 中缺少 username 参数";
    showToast("缺少用户名参数");
    return;
  }
  try {
    await api("/api/admin/me");
    await loadDetail();
  } catch (error) {
    showToast(error.message);
  }
}

void boot();
