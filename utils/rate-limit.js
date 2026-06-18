"use strict";

function isRateLimited(bucketMap, key, limit, windowMs) {
  const now = Date.now();
  const bucket = bucketMap.get(key);
  if (!bucket || now - bucket.startedAt > windowMs) {
    bucketMap.set(key, { count: 1, startedAt: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

function cleanRateBucketMap(bucketMap, windowMs) {
  const now = Date.now();
  for (const [key, bucket] of bucketMap) {
    if (now - bucket.startedAt > windowMs * 3) {
      bucketMap.delete(key);
    }
  }
}

function loginFailureState(failureMap, key) {
  if (!key) {
    return null;
  }
  return failureMap.get(String(key).toLowerCase()) || null;
}

function loginFailureActive(state) {
  if (!state || !state.lockedUntil) {
    return false;
  }
  return state.lockedUntil > Date.now();
}

function recordLoginFailure(failureMap, key, maxFailures, failureWindowMs, lockoutMs) {
  const normalizedKey = String(key || "").toLowerCase();
  if (!normalizedKey) {
    return null;
  }
  const now = Date.now();
  const previous = failureMap.get(normalizedKey);
  const recentFailures = previous && now - (previous.lastFailedAt || 0) <= failureWindowMs
    ? previous.count
    : 0;
  const count = recentFailures + 1;
  const lockedUntil = count > maxFailures ? now + lockoutMs : 0;
  const next = { count, lockedUntil, lastFailedAt: now };
  failureMap.set(normalizedKey, next);
  return next;
}

function clearLoginFailures(failureMap, key) {
  if (!key) {
    return;
  }
  failureMap.delete(String(key).toLowerCase());
}

function cleanLoginFailuresMap(failureMap, failureWindowMs) {
  const now = Date.now();
  for (const [key, state] of failureMap) {
    if (!state) {
      failureMap.delete(key);
      continue;
    }
    const lastFailedAt = Number(state.lastFailedAt || 0);
    if (now - lastFailedAt > failureWindowMs && now > Number(state.lockedUntil || 0)) {
      failureMap.delete(key);
    }
  }
}

module.exports = {
  isRateLimited,
  cleanRateBucketMap,
  loginFailureState,
  loginFailureActive,
  recordLoginFailure,
  clearLoginFailures,
  cleanLoginFailuresMap
};
