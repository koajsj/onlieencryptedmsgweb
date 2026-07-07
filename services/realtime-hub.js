"use strict";

function createRealtimeHub({
  heartbeatMs,
  messages,
  schedulePersistMessages,
  isPresenceVisibleTo,
  isMessageDeletedFor,
  isBlockedBetween,
  maxConcurrentConnectionsPerUser = 1
}) {
  const onlineConnections = new Map();
  const maxConnections = Math.max(1, Number(maxConcurrentConnectionsPerUser) || 1);

  function writeSse(res, event, payload) {
    if (!res || res.writableEnded || res.destroyed) {
      return false;
    }
    try {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch (error) {
      return false;
    }
  }

  function pushEventToUser(username, event, payload) {
    const connections = onlineConnections.get(username);
    if (!connections || connections.size === 0) {
      return;
    }
    for (const connection of connections) {
      writeSse(connection.res, event, payload);
    }
  }

  function isUserOnline(username) {
    const connections = onlineConnections.get(username);
    return Boolean(connections && connections.size > 0);
  }

  function listOnlineUsers() {
    return [...onlineConnections.entries()]
      .filter(([, connections]) => connections.size > 0)
      .map(([username]) => username)
      .sort((left, right) => left.localeCompare(right));
  }

  function activeConnectionCount(username) {
    return (onlineConnections.get(username) || new Set()).size;
  }

  function pushPresence(username, online) {
    const payload = { username, online };
    for (const connections of onlineConnections.values()) {
      if (connections.size === 0) {
        continue;
      }
      for (const connection of connections) {
        if (!isPresenceVisibleTo(connection.username, username)) {
          writeSse(connection.res, "presence", { username, online: false });
          continue;
        }
        writeSse(connection.res, "presence", payload);
      }
    }
  }

  function markPendingDeliveries(recipient) {
    const now = Date.now();
    const bySender = new Map();
    for (const message of messages) {
      if (message.to !== recipient || message.deliveredAt || message.recalled) {
        continue;
      }
      if (isMessageDeletedFor(message, recipient)) {
        continue;
      }
      if (isBlockedBetween(message.from, recipient)) {
        continue;
      }
      message.deliveredAt = now;
      const ids = bySender.get(message.from) || [];
      ids.push(message.id);
      bySender.set(message.from, ids);
    }
    if (bySender.size === 0) {
      return;
    }
    schedulePersistMessages();
    for (const [sender, messageIds] of bySender) {
      pushEventToUser(sender, "message-delivered", { peer: recipient, messageIds, deliveredAt: now });
    }
  }

  function broadcastUserRename(previousUsername, nextUsername) {
    const payload = {
      previousUsername,
      username: nextUsername,
      at: Date.now()
    };
    for (const connections of onlineConnections.values()) {
      if (connections.size === 0) {
        continue;
      }
      for (const connection of connections) {
        writeSse(connection.res, "user-renamed", payload);
      }
    }
  }

  function attachConnection(username, res, token = "") {
    const heartbeat = setInterval(() => {
      writeSse(res, "heartbeat", { at: Date.now() });
    }, heartbeatMs);

    const connection = { res, heartbeat, username, token: String(token || "") };
    const bucket = onlineConnections.get(username) || new Set();
    while (bucket.size >= maxConnections) {
      const previous = bucket.values().next().value;
      if (!previous) {
        break;
      }
      try {
        writeSse(previous.res, "system", { reason: "signed in on another device", at: Date.now() });
        previous.res.end();
      } catch (error) {
        // Ignore sockets that are already closing.
      }
      clearInterval(previous.heartbeat);
      bucket.delete(previous);
    }
    const wasOnline = bucket.size > 0;
    bucket.add(connection);
    onlineConnections.set(username, bucket);
    if (!wasOnline) {
      pushPresence(username, true);
    }
    return connection;
  }

  function detachConnection(username, connection) {
    const connectionUsername = String(connection?.username || "");
    const bucketUsername = onlineConnections.has(username) ? username : connectionUsername;
    const bucket = onlineConnections.get(bucketUsername);
    if (!bucket) {
      return;
    }
    clearInterval(connection.heartbeat);
    bucket.delete(connection);
    if (bucket.size === 0) {
      onlineConnections.delete(bucketUsername);
      pushPresence(bucketUsername, false);
    }
  }

  function renameUserConnections(previousUsername, nextUsername) {
    const connections = onlineConnections.get(previousUsername);
    if (!connections) {
      return;
    }
    onlineConnections.delete(previousUsername);
    for (const connection of connections) {
      connection.username = nextUsername;
    }
    onlineConnections.set(nextUsername, connections);
  }

  function disconnectUserRealtime(username, reason = "admin action") {
    const bucket = onlineConnections.get(username);
    if (!bucket || bucket.size === 0) {
      return;
    }
    for (const connection of bucket) {
      try {
        writeSse(connection.res, "system", { reason, at: Date.now() });
        connection.res.end();
      } catch (error) {
        // ignore close errors
      }
      clearInterval(connection.heartbeat);
    }
    onlineConnections.delete(username);
    pushPresence(username, false);
  }

  function disconnectAllRealtime(reason = "server shutting down") {
    for (const connections of onlineConnections.values()) {
      for (const connection of connections) {
        clearInterval(connection.heartbeat);
        try {
          writeSse(connection.res, "system", { reason, at: Date.now() });
          connection.res.end();
        } catch (error) {
          // Ignore sockets that have already closed.
        }
      }
    }
    onlineConnections.clear();
  }

  function disconnectSessionRealtime(token, reason = "session ended") {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) {
      return;
    }
    for (const [username, bucket] of onlineConnections) {
      if (!bucket || bucket.size === 0) {
        continue;
      }
      let removed = false;
      for (const connection of [...bucket]) {
        if (connection?.token !== normalizedToken) {
          continue;
        }
        removed = true;
        try {
          writeSse(connection.res, "system", { reason, at: Date.now() });
          connection.res.end();
        } catch (error) {
          // ignore close errors
        }
        clearInterval(connection.heartbeat);
        bucket.delete(connection);
      }
      if (!removed) {
        continue;
      }
      if (bucket.size === 0) {
        onlineConnections.delete(username);
        pushPresence(username, false);
        continue;
      }
      onlineConnections.set(username, bucket);
    }
  }

  return {
    writeSse,
    pushEventToUser,
    isUserOnline,
    listOnlineUsers,
    activeConnectionCount,
    pushPresence,
    markPendingDeliveries,
    broadcastUserRename,
    attachConnection,
    detachConnection,
    renameUserConnections,
    disconnectUserRealtime,
    disconnectAllRealtime,
    disconnectSessionRealtime
  };
}

module.exports = {
  createRealtimeHub
};
