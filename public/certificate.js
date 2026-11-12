(() => {
  "use strict";
  const print = document.getElementById("print");
  if (print) {
    let downloadedForPrint = false;
    const downloadOwnerPass = () => {
      if (!downloadedForPrint && window.downloadCookieOwnerPass) {
        window.downloadCookieOwnerPass();
        downloadedForPrint = true;
      }
    };
    print.addEventListener("click", () => {
      downloadOwnerPass();
      try { window.print(); }
      finally { downloadedForPrint = false; }
    });
    window.addEventListener("beforeprint", downloadOwnerPass);
    window.addEventListener("afterprint", () => { downloadedForPrint = false; });
  }
  const panel = document.getElementById("owner-check");
  if (!panel) return;
  const { apiJson, formatCode } = window.CookieOwnership;
  const apiOrigin = panel.dataset.apiOrigin;
  const cookieId = panel.dataset.cookieId;
  const start = document.getElementById("start-owner-check");
  const details = document.getElementById("check-details");
  const code = document.getElementById("check-code");
  const time = document.getElementById("check-time");
  const result = document.getElementById("check-result");
  let active = null;
  let generation = 0;
  let pollTimer, expiryTimer;

  function show(state, text) {
    result.dataset.state = state;
    result.textContent = text;
  }

  function stop() {
    generation++;
    active = null;
    clearTimeout(pollTimer);
    clearInterval(expiryTimer);
  }

  function expire() {
    stop();
    time.textContent = "Check expired.";
    show("expired", "This check has expired. Start a new check to verify the owner again.");
  }

  function tick() {
    if (!active) return;
    const remaining = Math.ceil((active.deadline - performance.now()) / 1000);
    if (remaining <= 0) { expire(); return; }
    time.textContent = `Expires in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}.`;
  }

  async function poll(current) {
    const session = active;
    if (!session || session.polling || current !== generation) return;
    session.polling = true;
    const sentAt = performance.now();
    try {
      const { check } = await apiJson(apiOrigin, `/api/cookies/${cookieId}/owner-checks/${session.code}`, {
        headers: { Authorization: "Bearer " + session.verifierToken },
      });
      if (current !== generation || active !== session) return;
      if (check.cookieId !== cookieId || check.code !== session.code || !Number.isFinite(check.remainingMs)) {
        throw new Error("Invalid verification response.");
      }
      session.deadline = Math.min(session.deadline, sentAt + check.remainingMs);
      if (check.status === "expired" || session.deadline <= performance.now()) { expire(); return; }
      if (check.status === "confirmed" && check.confirmedAt) {
        show("confirmed", `Owner confirmed this check at ${new Date(check.confirmedAt).toLocaleTimeString()}. Control of this cookie’s key has been demonstrated for the code above.`);
      } else {
        show("pending", "Waiting for the owner to confirm this code. Ownership has not been verified yet.");
      }
    } catch {
      if (current === generation && active === session) {
        show("unavailable", "The check could not be refreshed. Ownership is not currently verified. Retrying…");
      }
    } finally {
      session.polling = false;
      if (current === generation && active === session) pollTimer = setTimeout(() => poll(current), 2000);
    }
  }

  start.addEventListener("click", async () => {
    stop();
    const current = generation;
    const sentAt = performance.now();
    start.disabled = true;
    details.hidden = true;
    code.textContent = "";
    show("pending", "Starting a new owner check…");
    try {
      const data = await apiJson(apiOrigin, `/api/cookies/${cookieId}/owner-checks`, { method: "POST", body: "{}" });
      if (current !== generation) return;
      active = { code: data.check.code, verifierToken: data.verifierToken, deadline: sentAt + data.check.remainingMs };
      code.textContent = formatCode(active.code);
      details.hidden = false;
      start.textContent = "Start a new check";
      show("pending", "Waiting for the owner to confirm this code. Ownership has not been verified yet.");
      expiryTimer = setInterval(tick, 1000);
      tick();
      if (active) pollTimer = setTimeout(() => poll(current), 2000);
    } catch (error) {
      if (current === generation) show("unavailable", error.message || "Could not start the owner check. Please try again.");
    } finally {
      start.disabled = false;
    }
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !active) return;
    tick();
    if (active) {
      show("pending", "Refreshing this owner check…");
      clearTimeout(pollTimer);
      poll(generation);
    }
  });
  window.addEventListener("pagehide", () => {
    stop();
    details.hidden = true;
    show("idle", "Start a fresh check to verify ownership.");
  });
})();
