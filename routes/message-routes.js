"use strict";

const crypto = require("node:crypto");

function createMessageRoutes(context) {
  const {
    requireSession,
    getClientAddress,
    rejectIfForbiddenOrLimited,
    sendJson,
    sendJsonBodyError,
    readJsonBody,
    normalizeClientId,
    parsePositiveInteger,
    parseMessageCursor,
    findUserByUsername,
    userShowsPresence,
    isUserBlocked,
    isBlockedBetween,
    isPresenceVisibleTo,
    isUserOnline,
    isBase64Blob,
    isRateLimited,
    messageNonceReplayKey,
    makeAvatarSeed,
    contactEntryFor,
    upsertUserContact,
    persistUsers,
    appendMessageBucket,
    schedulePersistMessages,
    messagesBetween,
    pagedMessagesBetween,
    isMessageDeletedFor,
    createMessageView,
    buildConversationSummary,
    resolveReplyTarget,
    listConversationsFor,
    pushEventToUser,
    recordAdminAction,
    nextMessageSequence,
    messages,
    messageClientIndex,
    messageNonceIndex,
    messageIdIndex,
    conversationRateBuckets,
    limits
  } = context;

  function rejectUnknownBodyKeys(body, allowedKeys, res) {
    const allowed = new Set(allowedKeys);
    const unknown = Object.keys(body || {}).filter((key) => !allowed.has(key));
    if (unknown.length === 0) {
      return false;
    }
    sendJson(res, 400, { error: "unknown request fields" });
    return true;
  }

  function redactRecalledMessagePayload(message) {
    if (!message) {
      return false;
    }
    let changed = false;
    if (message.nonce) {
      message.recalledNonce = message.recalledNonce || message.nonce;
      message.nonce = "";
      changed = true;
    }
    if (message.ciphertext) {
      message.ciphertext = "";
      changed = true;
    }
    return changed;
  }

  function handleConversations(req, res, url) {
    const session = requireSession(req, res, url);
    if (!session) {
      return;
    }
    const address = getClientAddress(req);
    if (
      rejectIfForbiddenOrLimited(
        req,
        res,
        `api:conversations:${address}`,
        limits.MAX_API_REQUESTS_PER_WINDOW,
        "too many requests"
      )
    ) {
      return;
    }
    sendJson(res, 200, {
      conversations: listConversationsFor(session.username)
    });
  }

  function handleMessages(req, res, url) {
    const session = requireSession(req, res, url);
    if (!session) {
      return;
    }
    const address = getClientAddress(req);
    if (
      rejectIfForbiddenOrLimited(
        req,
        res,
        `api:messages:get:${address}`,
        limits.MAX_API_REQUESTS_PER_WINDOW,
        "too many requests"
      )
    ) {
      return;
    }

    const peer = findUserByUsername(url.searchParams.get("with"));
    if (!peer || peer.username === session.username) {
      sendJson(res, 404, { error: "user not found" });
      return;
    }
    const limit = parsePositiveInteger(url.searchParams.get("limit"), 50, 1, 100);
    const beforeCursor = parseMessageCursor(url.searchParams.get("before"));
    const page = pagedMessagesBetween(session.username, peer.username, limit, beforeCursor);

    sendJson(res, 200, {
      peer: {
        username: peer.username,
        usernameKey: peer.usernameKey,
        online: isPresenceVisibleTo(session.username, peer.username),
        lastSeenAt: userShowsPresence(peer) && !isUserBlocked(peer, session.username)
          ? Number.parseInt(String(peer.lastSeenAt || "0"), 10) || 0
          : 0,
        avatarSeed: makeAvatarSeed(peer.username),
        publicKey: peer.publicKey
      },
      messages: page.items.map((message) => createMessageView(message, session.username)),
      hasMore: page.hasMore,
      nextBefore: page.nextBefore
    });
  }

  async function handleSendMessage(req, res, url) {
    const session = requireSession(req, res, url);
    if (!session) {
      return;
    }
    const address = getClientAddress(req);
    if (
      rejectIfForbiddenOrLimited(
        req,
        res,
        `api:messages:post:${session.username}:${address}`,
        limits.MAX_API_REQUESTS_PER_WINDOW,
        "too many requests"
      )
    ) {
      return;
    }

    let body;
    try {
      body = await readJsonBody(req, url.pathname === "/api/messages/attachment" ? limits.MAX_MESSAGE_BODY_BYTES : limits.MAX_BODY_BYTES);
    } catch (error) {
      sendJsonBodyError(res, error);
      return;
    }
    if (rejectUnknownBodyKeys(body, ["to", "nonce", "ciphertext", "clientId", "replyToId"], res)) {
      return;
    }

    const peer = findUserByUsername(body.to);
    const nonce = String(body.nonce || "").trim();
    const ciphertext = String(body.ciphertext || "").trim();
    const clientId = normalizeClientId(body.clientId);
    const replyToId = String(body.replyToId || "").trim();
    if (!peer || peer.username === session.username) {
      sendJson(res, 404, { error: "user not found" });
      return;
    }
    if (peer.banned) {
      sendJson(res, 403, { error: "peer is banned" });
      return;
    }
    const senderUser = findUserByUsername(session.username);
    if (isUserBlocked(senderUser, peer.username)) {
      sendJson(res, 403, { error: "you blocked peer" });
      return;
    }
    if (isUserBlocked(peer, session.username)) {
      sendJson(res, 403, { error: "blocked by peer" });
      return;
    }
    if (!clientId) {
      sendJson(res, 400, { error: "clientId required" });
      return;
    }
    if (clientId) {
      const existing = messageClientIndex.get(`${session.username}\u0000${clientId}`);
      if (existing) {
        if (existing.to !== peer.username) {
          sendJson(res, 409, { error: "clientId already used" });
          return;
        }
        sendJson(res, 200, {
          message: createMessageView(existing, session.username),
          conversation: buildConversationSummary(session.username, peer.username)
        });
        return;
      }
    }
    if (
      isRateLimited(
        conversationRateBuckets,
        `msg:${session.username}\u0000${peer.username}`,
        limits.MAX_MESSAGES_PER_CONVERSATION_WINDOW,
        limits.RATE_WINDOW_MS
      )
    ) {
      sendJson(res, 429, { error: "too many messages sent" });
      return;
    }
    if (!isBase64Blob(nonce, limits.MESSAGE_NONCE_BYTES.min, limits.MESSAGE_NONCE_BYTES.max)) {
      sendJson(res, 400, { error: "invalid message payload" });
      return;
    }
    if (!isBase64Blob(ciphertext, limits.MESSAGE_CIPHERTEXT_BYTES.min, limits.MESSAGE_CIPHERTEXT_BYTES.max)) {
      sendJson(res, 400, { error: "invalid message payload" });
      return;
    }
    if (messageNonceIndex.has(messageNonceReplayKey(session.username, nonce))) {
      sendJson(res, 409, { error: "duplicate message nonce" });
      return;
    }
    const replyTo = resolveReplyTarget(session.username, peer.username, replyToId);
    if (replyToId && !replyTo) {
      sendJson(res, 400, { error: "reply target not found" });
      return;
    }

    const createdAt = Date.now();
    const message = {
      id: crypto.randomUUID(),
      clientId,
      sequence: nextMessageSequence(),
      from: session.username,
      to: peer.username,
      publicKey: String(senderUser?.publicKey || ""),
      nonce,
      ciphertext,
      createdAt,
      timestamp: createdAt,
      replyToId: replyTo?.id || "",
      replyTo: replyTo
        ? {
            id: String(replyTo.id),
            from: String(replyTo.from || ""),
            createdAt: Number(replyTo.createdAt) || 0
          }
        : null,
      deletedFor: []
    };
    let contactsChanged = false;
    if (senderUser && !contactEntryFor(senderUser, peer.username)) {
      upsertUserContact(senderUser, peer.username, {});
      contactsChanged = true;
    }
    if (!contactEntryFor(peer, session.username)) {
      upsertUserContact(peer, session.username, {});
      contactsChanged = true;
    }
    if (contactsChanged) {
      persistUsers();
    }
    messages.push(message);
    appendMessageBucket(message);
    const recipientOnline = isUserOnline(peer.username);
    if (recipientOnline) {
      message.deliveredAt = Date.now();
    }
    schedulePersistMessages(message);

    const senderView = createMessageView(message, session.username);
    const recipientView = createMessageView(message, peer.username);
    pushEventToUser(session.username, "message", senderView);
    pushEventToUser(peer.username, "message", recipientView);
    if (recipientOnline) {
      pushEventToUser(session.username, "message-delivered", {
        peer: peer.username,
        messageIds: [message.id],
        deliveredAt: message.deliveredAt
      });
    }

    sendJson(res, 201, {
      message: senderView,
      conversation: buildConversationSummary(session.username, peer.username)
    });
  }

  async function handleRecallMessage(req, res, url) {
    const session = requireSession(req, res, url);
    if (!session) {
      return;
    }
    const address = getClientAddress(req);
    if (
      rejectIfForbiddenOrLimited(
        req,
        res,
        `api:messages:recall:${session.username}:${address}`,
        limits.MAX_API_REQUESTS_PER_WINDOW,
        "too many requests"
      )
    ) {
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJsonBodyError(res, error);
      return;
    }
    if (rejectUnknownBodyKeys(body, ["messageId"], res)) {
      return;
    }
    const messageId = String(body.messageId || "").trim();
    if (!messageId) {
      sendJson(res, 400, { error: "messageId required" });
      return;
    }
    const target = messageIdIndex.get(messageId);
    if (!target || target.from !== session.username) {
      sendJson(res, 404, { error: "message not found or not yours" });
      return;
    }
    const recallAgeMs = Date.now() - Number(target.createdAt || 0);
    if (recallAgeMs > limits.MESSAGE_RECALL_WINDOW_MS) {
      sendJson(res, 403, { error: "recall window expired" });
      return;
    }
    if (target.recalled) {
      if (redactRecalledMessagePayload(target)) {
        schedulePersistMessages();
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    target.recalled = true;
    target.recalledAt = Date.now();
    target.recalledBy = session.username;
    redactRecalledMessagePayload(target);
    schedulePersistMessages();
    const peer = target.to === session.username ? target.from : target.to;
    recordAdminAction("message_recall", session, req, {
      messageId,
      peer,
      recallAgeMs
    });
    pushEventToUser(session.username, "message-recalled", { messageId, by: session.username, peer });
    pushEventToUser(peer, "message-recalled", { messageId, by: session.username, peer: session.username });
    sendJson(res, 200, { ok: true });
  }

  async function handleDeleteMessage(req, res, url) {
    const session = requireSession(req, res, url);
    if (!session) {
      return;
    }
    const address = getClientAddress(req);
    if (
      rejectIfForbiddenOrLimited(
        req,
        res,
        `api:messages:delete:${session.username}:${address}`,
        limits.MAX_API_REQUESTS_PER_WINDOW,
        "too many requests"
      )
    ) {
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJsonBodyError(res, error);
      return;
    }
    if (rejectUnknownBodyKeys(body, ["messageId"], res)) {
      return;
    }

    const messageId = String(body.messageId || "").trim();
    if (!messageId) {
      sendJson(res, 400, { error: "messageId required" });
      return;
    }

    const target = messageIdIndex.get(messageId);
    if (!target || (target.from !== session.username && target.to !== session.username)) {
      sendJson(res, 404, { error: "message not found" });
      return;
    }

    const deletedFor = Array.isArray(target.deletedFor) ? target.deletedFor : [];
    if (!deletedFor.includes(session.username)) {
      deletedFor.push(session.username);
      target.deletedFor = deletedFor;
      schedulePersistMessages();
    }

    const peer = target.from === session.username ? target.to : target.from;
    pushEventToUser(session.username, "message-deleted", { messageId, peer });
    sendJson(res, 200, { ok: true });
  }

  async function handleMarkRead(req, res, url) {
    const session = requireSession(req, res, url);
    if (!session) {
      return;
    }
    const address = getClientAddress(req);
    if (
      rejectIfForbiddenOrLimited(
        req,
        res,
        `api:messages:read:${session.username}:${address}`,
        limits.MAX_API_REQUESTS_PER_WINDOW,
        "too many requests"
      )
    ) {
      return;
    }

    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJsonBodyError(res, error);
      return;
    }
    if (rejectUnknownBodyKeys(body, ["peer"], res)) {
      return;
    }

    const peer = findUserByUsername(body.peer);
    if (!peer || peer.username === session.username) {
      sendJson(res, 404, { error: "user not found" });
      return;
    }
    if (isBlockedBetween(session.username, peer.username)) {
      sendJson(res, 200, { ok: true, count: 0 });
      return;
    }

    const now = Date.now();
    const messageIds = [];
    for (const message of messagesBetween(session.username, peer.username)) {
      if (message.from !== peer.username || message.recalled || message.readAt) {
        continue;
      }
      if (isMessageDeletedFor(message, session.username)) {
        continue;
      }
      if (!message.deliveredAt) {
        message.deliveredAt = now;
      }
      message.readAt = now;
      messageIds.push(message.id);
    }

    if (messageIds.length > 0) {
      schedulePersistMessages();
      pushEventToUser(peer.username, "message-read", { peer: session.username, messageIds, readAt: now });
      pushEventToUser(session.username, "conversation-read", { peer: peer.username, messageIds, readAt: now });
    }

    sendJson(res, 200, { ok: true, count: messageIds.length });
  }

  async function handleTypingSignal(req, res, url) {
    const session = requireSession(req, res, url);
    if (!session) {
      return;
    }
    const address = getClientAddress(req);
    if (
      rejectIfForbiddenOrLimited(
        req,
        res,
        `api:typing:${session.username}:${address}`,
        limits.MAX_API_REQUESTS_PER_WINDOW,
        "too many requests"
      )
    ) {
      return;
    }
    let body;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      sendJsonBodyError(res, error);
      return;
    }
    if (rejectUnknownBodyKeys(body, ["to", "typing"], res)) {
      return;
    }
    if (typeof body.typing !== "boolean") {
      sendJson(res, 400, { error: "typing must be a boolean" });
      return;
    }
    const peer = findUserByUsername(body.to);
    // Typing is best-effort and ephemeral; always answer 200 so a caller can't probe
    // block/online state, but only forward the signal when neither side is blocked.
    if (peer && peer.username !== session.username && !peer.banned) {
      const senderUser = findUserByUsername(session.username);
      if (!isUserBlocked(senderUser, peer.username) && !isUserBlocked(peer, session.username)) {
        pushEventToUser(peer.username, "typing", {
          peer: session.username,
          typing: body.typing
        });
      }
    }
    sendJson(res, 200, { ok: true });
  }

  return {
    handleConversations,
    handleMessages,
    handleSendMessage,
    handleRecallMessage,
    handleDeleteMessage,
    handleMarkRead,
    handleTypingSignal
  };
}

module.exports = {
  createMessageRoutes
};
