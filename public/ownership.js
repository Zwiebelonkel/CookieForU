(() => {
  "use strict";
  const hexId = /^[0-9a-f]{64}$/;
  const normalizeCode = (code) => code.replace(/[\s-]/g, "").toLowerCase();
  const formatCode = (code) => code.toUpperCase().match(/.{1,4}/g)?.join("-") || "";

  async function apiJson(apiOrigin, path, options = {}) {
    const response = await fetch(apiOrigin + path, {
      ...options,
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
      headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
    let data;
    try { data = await response.json(); }
    catch { throw new Error("The cookie service returned an invalid response. Please try again."); }
    if (!response.ok) throw new Error(data.error || "The cookie service is unavailable. Please try again.");
    return data;
  }

  function parsePass(text, apiOrigin) {
    let pass;
    try { pass = JSON.parse(text); }
    catch { throw new Error("Choose a valid Cookie Owner Pass JSON file."); }
    if (!pass || pass.type !== "cookie-owner-pass" || pass.version !== 1 ||
        typeof pass.cookieId !== "string" || !hexId.test(pass.cookieId) ||
        typeof pass.ownerToken !== "string" || !hexId.test(pass.ownerToken)) {
      throw new Error("This is not a valid Cookie Owner Pass.");
    }
    // Never send the secret to a server specified by an imported file.
    if (pass.serviceOrigin !== apiOrigin) {
      throw new Error("This Owner Pass belongs to a different cookie service. Open the original website to restore it.");
    }
    return pass;
  }

  function makePass(apiOrigin, cookieId, ownerToken) {
    return JSON.stringify({
      type: "cookie-owner-pass", version: 1, serviceOrigin: apiOrigin,
      cookieId, ownerToken, exportedAt: new Date().toISOString(),
      keepPrivate: "Anyone with this file can control this cookie. Store it privately; do not share it with a verifier.",
    }, null, 2);
  }

  async function loadOwner(apiOrigin, cookieId, ownerToken) {
    const data = await apiJson(apiOrigin, `/api/cookies/${cookieId}/owner`, {
      headers: { Authorization: "Bearer " + ownerToken },
    });
    if (data.cookie?.id !== cookieId) throw new Error("The Owner Pass could not be verified.");
    return data.cookie;
  }

  async function confirm(apiOrigin, cookieId, ownerToken, value) {
    const code = normalizeCode(value);
    if (!/^[0-9a-f]{16}$/.test(code)) throw new Error("Enter the full 16-character code shown on the verifier’s device.");
    return apiJson(apiOrigin, `/api/cookies/${cookieId}/owner-checks/${code}/confirm`, {
      method: "POST", headers: { Authorization: "Bearer " + ownerToken }, body: "{}",
    });
  }

  window.CookieOwnership = Object.freeze({ apiJson, parsePass, makePass, loadOwner, confirm, formatCode });
})();
