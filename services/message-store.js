"use strict";

const fs = require("node:fs");

function createMessageStore({
  messagesFile,
  messagesLogFile,
  messagePersistDebounceMs,
  readJsonFile,
  readJsonLinesFile,
  writeJsonFile,
  rewriteJsonLinesFile,
  appendJsonLinesFile,
  findUserByUsername,
  userShowsPresence,
  isUserBlocked,
  isBlockedBetween,
  isPresenceVisibleTo,
  makeAvatarSeed
}) {
  const messages = [];
  const messageBuckets = new Map();
  const messageIdIndex = new Map();
  const messageClientIndex = new Map();
  const messageNonceIndex = new Set();
  const userPeersIndex = new Map();

  let nextMessageSequence = 1;
  let pendingMessagesPersistTimer = null;
  let messagesDirty = false;
  let messagesRequireFullPersist = false;
  const pendingMessageAppends = [];

  function messageNonceReplayKey(from, nonce) {
    return `${String(from || "")}\u0000${String(nonce || "")}`;
  }

  function conversationBucketKey(leftUser, rightUser) {
    return leftUser.localeCompare(rightUser) <= 0
      ? `${leftUser}\u0000${rightUser}`
      : `${rightUser}\u0000${leftUser}`;
  }

  function recordUserPeer(username, peer) {
    if (!username || !peer || username === peer) {
      return;
    }
    const peers = userPeersIndex.get(username) || new Set();
    peers.add(peer);
    userPeersIndex.set(username, peers);
  }

  function rebuildMessageBuckets() {
    messageBuckets.clear();
    messageIdIndex.clear();
    messageClientIndex.clear();
    messageNonceIndex.clear();
    userPeersIndex.clear();
    for (const message of messages) {
      recordUserPeer(message.from, message.to);
      recordUserPeer(message.to, message.from);
      const key = conversationBucketKey(message.from, message.to);
      const bucket = messageBuckets.get(key) || [];
      bucket.push(message);
      messageBuckets.set(key, bucket);
      if (message.id) {
        messageIdIndex.set(message.id, message);
      }
      if (message.clientId) {
        messageClientIndex.set(`${message.from}\u0000${message.clientId}`, message);
      }
      const replayNonce = message.nonce || message.recalledNonce;
      if (replayNonce) {
        messageNonceIndex.add(messageNonceReplayKey(message.from, replayNonce));
      }
    }
    for (const bucket of messageBuckets.values()) {
      bucket.sort((left, right) => {
        if (Number(left.createdAt) !== Number(right.createdAt)) {
          return Number(left.createdAt) - Number(right.createdAt);
        }
        if (Number(left.sequence) !== Number(right.sequence)) {
          return Number(left.sequence) - Number(right.sequence);
        }
        return String(left.id || "").localeCompare(String(right.id || ""));
      });
    }
  }

  function appendMessageBucket(message) {
    recordUserPeer(message.from, message.to);
    recordUserPeer(message.to, message.from);
    const key = conversationBucketKey(message.from, message.to);
    const bucket = messageBuckets.get(key) || [];
    bucket.push(message);
    messageBuckets.set(key, bucket);
    if (message.id) {
      messageIdIndex.set(message.id, message);
    }
    if (message.clientId) {
      messageClientIndex.set(`${message.from}\u0000${message.clientId}`, message);
    }
    const replayNonce = message.nonce || message.recalledNonce;
    if (replayNonce) {
      messageNonceIndex.add(messageNonceReplayKey(message.from, replayNonce));
    }
  }

  function loadMessages() {
    const logStat = fs.statSync(messagesLogFile);
    const loadedMessages = logStat.size > 0 ? readJsonLinesFile(messagesLogFile) : readJsonFile(messagesFile);
    if (!Array.isArray(loadedMessages)) {
      throw new Error(`expected ${messagesFile} to contain a JSON array`);
    }
    const normalizedMessages = loadedMessages.map((message) => ({
      ...message,
      createdAt: Number.parseInt(String(message?.createdAt || message?.timestamp || "0"), 10) || Date.now(),
      timestamp: Number.parseInt(String(message?.timestamp || message?.createdAt || "0"), 10) || Date.now(),
      sequence: Number.parseInt(String(message?.sequence || "0"), 10) || 0,
      clientId: typeof message?.clientId === "string" ? message.clientId : "",
      publicKey: typeof message?.publicKey === "string" ? message.publicKey : "",
      recalledNonce: typeof message?.recalledNonce === "string" ? message.recalledNonce : "",
      deletedFor: Array.isArray(message?.deletedFor)
        ? message.deletedFor
          .map((entry) => String(entry || "").trim())
          .filter(Boolean)
        : []
    }));
    let sequenceCursor = normalizedMessages.reduce(
      (maxValue, message) => Math.max(maxValue, Number(message.sequence || 0)),
      0
    ) + 1;
    const sequencedMessages = normalizedMessages.map((message) => ({
      ...message,
      sequence: Number(message.sequence || 0) > 0 ? Number(message.sequence) : sequenceCursor++
    }));
    nextMessageSequence = sequenceCursor;
    sequencedMessages.sort((left, right) => {
      if (Number(left.createdAt) !== Number(right.createdAt)) {
        return Number(left.createdAt) - Number(right.createdAt);
      }
      if (Number(left.sequence) !== Number(right.sequence)) {
        return Number(left.sequence) - Number(right.sequence);
      }
      return String(left.id || "").localeCompare(String(right.id || ""));
    });
    messages.splice(0, messages.length, ...sequencedMessages);
    rebuildMessageBuckets();
  }

  function persistMessagesNow() {
    writeJsonFile(messagesFile, messages);
    rewriteJsonLinesFile(messagesLogFile, messages);
  }

  function persistMessageAppendsNow(rows) {
    if (rows.length === 0) {
      return;
    }
    appendJsonLinesFile(messagesLogFile, rows);
  }

  function flushPendingMessagePersist() {
    if (pendingMessagesPersistTimer) {
      clearTimeout(pendingMessagesPersistTimer);
      pendingMessagesPersistTimer = null;
    }
    if (!messagesDirty) {
      return;
    }
    const appends = pendingMessageAppends.splice(0);
    const shouldFullPersist = messagesRequireFullPersist;
    messagesDirty = false;
    messagesRequireFullPersist = false;
    if (shouldFullPersist) {
      persistMessagesNow();
      return;
    }
    persistMessageAppendsNow(appends);
  }

  function schedulePersistMessages(message = null) {
    messagesDirty = true;
    if (message) {
      pendingMessageAppends.push(message);
    } else {
      messagesRequireFullPersist = true;
      pendingMessageAppends.length = 0;
    }
    if (pendingMessagesPersistTimer) {
      return;
    }
    pendingMessagesPersistTimer = setTimeout(() => {
      pendingMessagesPersistTimer = null;
      flushPendingMessagePersist();
    }, messagePersistDebounceMs);
  }

  function purgeStoredMessagePlaintext() {
    let changed = false;
    for (const message of messages) {
      if ("text" in message) {
        delete message.text;
        changed = true;
      }
      if ("auditText" in message) {
        delete message.auditText;
        changed = true;
      }
      if (message.replyTo && typeof message.replyTo === "object" && "text" in message.replyTo) {
        delete message.replyTo.text;
        changed = true;
      }
    }
    if (changed) {
      schedulePersistMessages();
    }
  }

  function normalizeReplyTargetView(replyTo) {
    if (!replyTo || !replyTo.id) {
      return null;
    }
    return {
      id: String(replyTo.id),
      from: String(replyTo.from || ""),
      text: typeof replyTo.text === "string" ? replyTo.text : "",
      createdAt: Number(replyTo.createdAt) || 0
    };
  }

  function resolveReplyTarget(leftUser, rightUser, replyToId) {
    const id = String(replyToId || "").trim();
    if (!id) {
      return null;
    }
    const message = messageIdIndex.get(id);
    if (
      !message ||
      !(
        (message.from === leftUser && message.to === rightUser) ||
        (message.from === rightUser && message.to === leftUser)
      )
    ) {
      return null;
    }
    return normalizeReplyTargetView(message);
  }

  function isMessageDeletedFor(message, viewer) {
    if (!message || !viewer) {
      return false;
    }
    return Array.isArray(message.deletedFor) && message.deletedFor.includes(viewer);
  }

  function messagesBetween(leftUser, rightUser) {
    const key = conversationBucketKey(leftUser, rightUser);
    return messageBuckets.get(key) || [];
  }

  function visibleMessagesBetween(viewer, peer) {
    return messagesBetween(viewer, peer).filter((message) => !isMessageDeletedFor(message, viewer));
  }

  function createMessageView(message, viewer) {
    const peer = message.from === viewer ? message.to : message.from;
    const peerUser = findUserByUsername(peer);
    const redacted = Boolean(message.recalled);
    const peerPublicKey = message.from === viewer
      ? peerUser?.publicKey
      : message.publicKey || peerUser?.publicKey;
    return {
      id: message.id,
      clientId: String(message.clientId || ""),
      from: message.from,
      to: message.to,
      peer,
      mine: message.from === viewer,
      publicKey: String(peerPublicKey || ""),
      text: null,
      recalled: Boolean(message.recalled),
      replyToId: String(message.replyToId || ""),
      replyTo: normalizeReplyTargetView(message.replyTo) || resolveReplyTarget(message.from, message.to, message.replyToId),
      nonce: redacted ? "" : message.nonce,
      ciphertext: redacted ? "" : message.ciphertext,
      createdAt: message.createdAt,
      timestamp: Number(message.timestamp || message.createdAt || 0),
      deliveredAt: Number.parseInt(String(message.deliveredAt || "0"), 10) || 0,
      readAt: Number.parseInt(String(message.readAt || "0"), 10) || 0
    };
  }

  function buildConversationSummary(viewer, peer) {
    const peerUser = findUserByUsername(peer);
    if (!peerUser) {
      return null;
    }

    const conversationMessages = visibleMessagesBetween(viewer, peer);
    const latest = conversationMessages.at(-1) || null;
    const blocked = isBlockedBetween(viewer, peer);

    return {
      username: peer,
      online: isPresenceVisibleTo(viewer, peer),
      avatarSeed: makeAvatarSeed(peer),
      publicKey: peerUser.publicKey,
      usernameKey: peerUser.usernameKey,
      lastSeenAt: userShowsPresence(peerUser) && !isUserBlocked(peerUser, viewer)
        ? Number.parseInt(String(peerUser.lastSeenAt || "0"), 10) || 0
        : 0,
      unread: blocked
        ? 0
        : conversationMessages.filter((message) => message.to === viewer && !message.readAt && !message.recalled).length,
      latestMessage: latest
        ? {
            id: latest.id,
            from: latest.from,
            to: latest.to,
            text: null,
            recalled: Boolean(latest.recalled),
            replyToId: String(latest.replyToId || ""),
            replyTo: normalizeReplyTargetView(latest.replyTo) || resolveReplyTarget(latest.from, latest.to, latest.replyToId),
            nonce: latest.recalled ? "" : latest.nonce,
            ciphertext: latest.recalled ? "" : latest.ciphertext,
            createdAt: latest.createdAt,
            timestamp: Number(latest.timestamp || latest.createdAt || 0)
          }
        : null,
      lastAt: latest ? latest.createdAt : 0
    };
  }

  function listConversationsFor(username) {
    const peers = userPeersIndex.get(username);
    if (!peers || peers.size === 0) {
      return [];
    }
    return [...peers]
      .map((peer) => buildConversationSummary(username, peer))
      .filter((conversation) => conversation && conversation.lastAt > 0)
      .sort((left, right) => {
        if (right.lastAt !== left.lastAt) {
          return right.lastAt - left.lastAt;
        }
        return left.username.localeCompare(right.username);
      });
  }

  function encodeMessageCursor(message) {
    return String(message.id || "");
  }

  function parseMessageCursor(rawValue) {
    const value = String(rawValue || "").trim();
    if (!value) {
      return null;
    }
    return { id: value };
  }

  function collectPagedMessages(sourceMessages, limit, beforeCursor, predicate = null) {
    let beforeIndex = sourceMessages.length;
    if (beforeCursor?.id) {
      const matchedIndex = sourceMessages.findIndex((message) => message.id === beforeCursor.id);
      if (matchedIndex >= 0) {
        beforeIndex = matchedIndex;
      }
    }

    const items = [];
    for (let index = beforeIndex - 1; index >= 0 && items.length <= limit; index -= 1) {
      const message = sourceMessages[index];
      if (predicate && !predicate(message)) {
        continue;
      }
      items.push(message);
    }

    const hasMore = items.length > limit;
    const pageItems = (hasMore ? items.slice(0, limit) : items).reverse();
    return {
      items: pageItems,
      hasMore,
      nextBefore: hasMore && pageItems.length > 0 ? encodeMessageCursor(pageItems[0]) : ""
    };
  }

  function pagedMessagesBetween(leftUser, rightUser, limit, beforeCursor) {
    return collectPagedMessages(
      messagesBetween(leftUser, rightUser),
      limit,
      beforeCursor,
      (message) => !isMessageDeletedFor(message, leftUser)
    );
  }

  function getNextMessageSequence() {
    const sequence = nextMessageSequence;
    nextMessageSequence += 1;
    return sequence;
  }

  function healthSnapshot() {
    return {
      pendingMessageAppends: pendingMessageAppends.length,
      messagesDirty
    };
  }

  return {
    messages,
    messageBuckets,
    messageIdIndex,
    messageClientIndex,
    messageNonceIndex,
    userPeersIndex,
    loadMessages,
    schedulePersistMessages,
    flushPendingMessagePersist,
    purgeStoredMessagePlaintext,
    rebuildMessageBuckets,
    appendMessageBucket,
    messageNonceReplayKey,
    normalizeReplyTargetView,
    resolveReplyTarget,
    isMessageDeletedFor,
    messagesBetween,
    visibleMessagesBetween,
    createMessageView,
    buildConversationSummary,
    listConversationsFor,
    parseMessageCursor,
    collectPagedMessages,
    pagedMessagesBetween,
    getNextMessageSequence,
    healthSnapshot
  };
}

module.exports = {
  createMessageStore
};
