"use strict";

(function initializeEchoUiUtils() {
  const CLIENT_META_SENT_STORAGE_KEY = "secure_chat_client_meta_sent_v1";

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

  function formatDateTime(value) {
    if (!value) {
      return "-";
    }
    return new Date(value).toLocaleString();
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
        headers: { "Content-Type": "application/json" },
        keepalive: true,
        body: JSON.stringify(payload)
      });
      window.localStorage.setItem(CLIENT_META_SENT_STORAGE_KEY, "1");
    } catch (error) {
      // Client metadata is optional and must not interrupt the application.
    }
  }

  window.EchoUi = Object.freeze({
    escapeHtml,
    formatDateTime,
    isElementNode,
    scheduleClientMetaReport
  });
})();
