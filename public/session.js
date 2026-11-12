(() => {
  "use strict";
  const pending = new Map();
  const memory = new Map();

  function getToken(apiOrigin) {
    if (pending.has(apiOrigin)) return pending.get(apiOrigin);
    const key = "cookie-session:" + apiOrigin;
    const load = async () => {
      let saved = memory.get(key);
      try { saved = localStorage.getItem(key) || saved; } catch { /* Keep this tab usable without browser storage. */ }
      if (/^[0-9a-f]{64}$/.test(saved || "")) return saved;
      const response = await fetch(apiOrigin + "/api/session", {
        method: "POST", body: "{}", headers: { "Content-Type": "application/json" },
        cache: "no-store", signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok) throw new Error("Could not start your cookie session. Please try again.");
      const { sessionToken } = await response.json();
      if (!/^[0-9a-f]{64}$/.test(sessionToken || "")) throw new Error("Invalid cookie session response.");
      memory.set(key, sessionToken);
      try { localStorage.setItem(key, sessionToken); } catch { /* In-memory fallback. */ }
      return sessionToken;
    };
    // First-time tabs share one session instead of racing to create separate ones.
    const result = (navigator.locks ? navigator.locks.request(key, load) : load())
      .finally(() => pending.delete(apiOrigin));
    pending.set(apiOrigin, result);
    return result;
  }

  function forget(apiOrigin) {
    const key = "cookie-session:" + apiOrigin;
    memory.delete(key);
    try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
  }

  window.CookieSession = Object.freeze({ getToken, forget });
})();
