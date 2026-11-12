(() => {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const apiBase = new URL(
    document.querySelector('meta[name="cookie-api"]').content.trim() ||
      location.origin,
  ).origin;

  const output = $("cookie-id");
  const status = $("status");
  const eat = $("eat");
  const share = $("share");
  const certificate = $("certificate");
  const exportOwner = $("export-owner");
  const importOwner = $("import-owner");
  const ownerFile = $("owner-file");
  const ownerTools = $("owner-tools");
  const verifyOwner = $("verify-owner");
  const ownership = window.CookieOwnership;
  const retry = $("retry");

  let cookie = null;
  let ownerToken = null;
  let pendingToken = null;
  let busy = false;
  let refreshing = false;
  let generation = 0;
  let deliveryPending = true;

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const activeTransitions = new WeakMap();
  let lastRenderedCookie = null;

  const crumbLayer = document.createElement("div");
  crumbLayer.className = "crumb-layer";
  crumbLayer.setAttribute("aria-hidden", "true");
  const crumbField = document.createElement("div");
  crumbField.className = "crumb-field";
  crumbLayer.append(crumbField);
  document.body.append(crumbLayer);

  function positionCrumbs() {
    const bounds = $("cookie").getBoundingClientRect();
    const center = {
      x: bounds.left + bounds.width / 2,
      y: bounds.top + bounds.height / 2,
    };
    crumbField.style.left = `${center.x}px`;
    crumbField.style.top = `${center.y}px`;
    return center;
  }

  window.addEventListener("resize", positionCrumbs);
  window.addEventListener("scroll", positionCrumbs, { passive: true });

  function scatterCrumbs(bites) {
    const center = positionCrumbs();
    const face = $("cookie-face");
    const count = bites === 3 ? 32 : 20;
    const palette = ["#dca25c", "#be7d38", "#edbc79", "#a56a32", "#593422"];
    // Start at the bitten edge, including the cookie's current rotation.
    const transform = new DOMMatrix(getComputedStyle($("cookie")).transform)
      .multiply(new DOMMatrix(getComputedStyle(face.parentElement).transform));
    const bitePoint = bites === 1 ? [0.18, -0.22] : bites === 2 ? [-0.08, 0.18] : [-0.25, 0];
    const localX = bitePoint[0] * face.offsetWidth;
    const localY = bitePoint[1] * face.offsetHeight;
    const startX = transform.a * localX + transform.c * localY;
    const startY = transform.b * localX + transform.d * localY;

    for (let i = 0; i < count; i++) {
      const crumb = document.createElement("span");
      crumb.className = "cookie-crumb";
      const size = 2 + Math.random() * 5;
      const angle = Math.random() * Math.PI * 2;
      const distance = 66 + Math.random() * 75;
      const x = Math.max(6 - center.x, Math.min(innerWidth - center.x - 10, Math.cos(angle) * distance));
      const y = Math.max(6 - center.y, Math.min(innerHeight - center.y - 10, Math.sin(angle) * distance * 0.8));
      const rotation = Math.random() * 360;
      const finalTransform = `translate(${x}px, ${y}px) rotate(${rotation}deg)`;

      crumb.style.width = `${size}px`;
      crumb.style.height = `${size * (0.65 + Math.random() * 0.5)}px`;
      crumb.style.background = palette[Math.floor(Math.random() * palette.length)];
      crumb.style.transform = finalTransform;
      crumbField.append(crumb);

      if (!reducedMotion.matches) {
        const flight = crumb.animate(
          [
            { opacity: 0, transform: `translate(${startX}px, ${startY}px) rotate(0deg)`, offset: 0 },
            { opacity: 1, offset: 0.08 },
            { transform: `translate(${startX + (x - startX) * 0.65}px, ${startY + (y - startY) * 0.65 - 18}px) rotate(${rotation * 0.65}deg)`, offset: 0.5 },
            { transform: `translate(${x * 1.04}px, ${y * 1.04}px) rotate(${rotation + 8}deg)`, offset: 0.85 },
            { opacity: 1, transform: finalTransform, offset: 1 },
          ],
          { duration: 450 + Math.random() * 300, easing: "cubic-bezier(0.2, 0.65, 0.3, 1)" },
        );
        // The resting position is regular CSS; no running animation is needed.
        flight.onfinish = () => flight.cancel();
      }
    }

    // Keep decoration bounded even when several cookies are eaten in one tab.
    while (crumbField.childElementCount > 160) {
      const oldest = crumbField.firstElementChild;
      oldest.getAnimations().forEach((animation) => animation.cancel());
      oldest.remove();
    }
  }

  function animateIn(element, delay = 0, icon = false) {
    activeTransitions.get(element)?.cancel();
    if (reducedMotion.matches || element.hidden) return;

    const animation = element.animate(
      [
        {
          opacity: 0,
          transform: icon ? "translateY(12px) scale(0.78)" : "translateY(7px)",
        },
        { opacity: getComputedStyle(element).opacity, transform: "none" },
      ],
      {
        duration: icon ? 520 : 360,
        delay,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "backwards",
      },
    );
    activeTransitions.set(element, animation);
  }

  // Only animate actual text changes, so background refreshes stay quiet.
  const textElements = [output, $("rarity"), $("message"), status, eat];
  const previousText = new WeakMap(
    textElements.map((element) => [element, element.textContent]),
  );
  const textObserver = new MutationObserver(() => {
    for (const element of textElements) {
      const text = element.textContent;
      if (text === previousText.get(element)) continue;
      previousText.set(element, text);
      if (text.trim()) animateIn(element);
    }
  });
  for (const element of textElements) {
    textObserver.observe(element, { childList: true, characterData: true, subtree: true });
  }

  function readToken(id) {
    try {
      return localStorage.getItem("cookie-owner:" + id);
    } catch {
      return null;
    }
  }

  function rememberToken(id, token) {
    try {
      localStorage.setItem("cookie-owner:" + id, token);
      return true;
    } catch {
      // Ownership still works in this tab.
      return false;
    }
  }

  function rarityFor(streak) {
    if (streak >= 7) return "mythic";
    if (streak === 6) return "legendary";
    if (streak === 5) return "epic";
    if (streak === 4) return "rare";
    if (streak === 3) return "uncommon";
    return "common";
  }

  async function request(path, options = {}, requestGeneration = generation) {
    let response;

    try {
      response = await fetch(apiBase + path, {
        ...options,
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
        headers: {
          ...options.headers,
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
      });

      if (response.status >= 500) {
        throw new Error("Cookie service unavailable");
      }

      const data = await response.json();

      if (requestGeneration === generation) {
        if (deliveryPending || !cookie) {
          status.textContent = "";
        }

        deliveryPending = false;
      }

      if (!response.ok) {
        const error = new Error(data.error || "Please try again.");
        error.status = response.status;
        throw error;
      }

      if (!data.cookie) {
        throw new SyntaxError("Invalid cookie response");
      }

      return data.cookie;
    } catch (error) {
      const unavailable =
        !response || response.status >= 500 || error instanceof SyntaxError;

      if (unavailable && requestGeneration === generation) {
        deliveryPending = true;
        render();
      }

      throw error;
    }
  }

  function render() {
    const cookieElement = $("cookie");
    const face = $("cookie-face");
    const wasDelivering = cookieElement.classList.contains("delivering");
    const changed = wasDelivering !== deliveryPending;
    const sameCookie = cookie && lastRenderedCookie?.id === cookie.id;
    const bitten = !deliveryPending && sameCookie && cookie.bites > lastRenderedCookie.bites;
    let departingIcon;

    if (bitten) scatterCrumbs(cookie.bites);

    if (changed || bitten || (!deliveryPending && cookie?.bites === 3)) {
      activeTransitions.get(face)?.cancel();
    }

    if (changed && face.dataset.bites !== "3" && !reducedMotion.matches) {
      departingIcon = document.createElement("span");
      departingIcon.className = "cookie-face delivery-ghost";
      departingIcon.textContent = face.textContent;
      departingIcon.dataset.bites = face.dataset.bites;
      departingIcon.setAttribute("aria-hidden", "true");
      cookieElement.append(departingIcon);
    }

    renderContent();

    if (!deliveryPending && cookie) {
      lastRenderedCookie = { id: cookie.id, bites: cookie.bites };
    }

    if (!changed) return;
    if (departingIcon) {
      const exit = departingIcon.animate(
        [
          { opacity: 1, transform: "translateX(0)" },
          { opacity: 0, transform: "translateX(-70px)" },
        ],
        { duration: 260, easing: "ease-in", fill: "forwards" },
      );
      exit.onfinish = exit.oncancel = () => departingIcon.remove();
    }
    if ($("cookie-face").dataset.bites !== "3") {
      animateIn($("cookie-face"), 140, true);
    }
    document.querySelectorAll(".actions > *:not([hidden])").forEach((element, index) => {
      animateIn(element, 120 + index * 65);
    });
  }

  function renderContent() {
    const face = $("cookie-face");
    const cookieElement = $("cookie");
    const isOwner = Boolean(cookie && ownerToken && !deliveryPending);
    exportOwner.hidden = !isOwner;
    exportOwner.disabled = busy;
    importOwner.disabled = busy;
    ownerTools.hidden = !isOwner;
    $("confirm-owner").disabled = busy;
    verifyOwner.hidden = !cookie || deliveryPending;
    if (cookie) verifyOwner.href = cookie.verificationUrl;

    if (deliveryPending) {
      face.textContent = "🚚";
      face.dataset.bites = "0";

      cookieElement.classList.remove("eaten");
      cookieElement.classList.add("delivering");
      cookieElement.setAttribute("aria-label", "Cookie delivery in progress");

      output.textContent = "";

      $("rarity").textContent = "";
      $("rarity").dataset.level = "";
      $("rarity").title = "";

      $("message").textContent = "Cookie is getting delivered.";
      status.textContent = "";

      eat.disabled = true;
      share.disabled = true;
      certificate.hidden = true;

      return;
    }

    cookieElement.classList.remove("delivering");
    face.textContent = "🍪";

    eat.disabled = busy || !cookie || !ownerToken || cookie.bites === 3;

    share.disabled = busy || !cookie || cookie.bites === 3;

    certificate.hidden = !cookie || !ownerToken;
    certificate.disabled = busy;

    if (!cookie) {
      output.textContent = "";
      $("rarity").textContent = "";

      $("message").textContent = "This cookie is only supposed to be for you.";

      return;
    }

    const fragment = document.createDocumentFragment();
    const runs = cookie.remainingHash.match(/(.)\1*/g) || [];

    for (const run of runs) {
      if (run.length >= 2) {
        const mark = document.createElement("mark");

        mark.textContent = run;
        mark.dataset.level = rarityFor(run.length);
        mark.title = `${run.length} identical characters in a row`;

        fragment.append(mark);
      } else {
        fragment.append(document.createTextNode(run));
      }
    }

    output.replaceChildren(fragment);

    const gone = cookie.bites === 3;

    face.dataset.bites = String(cookie.bites);
    cookieElement.classList.toggle("eaten", gone);

    cookieElement.setAttribute(
      "aria-label",
      gone
        ? "Cookie eaten"
        : `Cookie, ${cookie.bitesRemaining} bites remaining`,
    );

    $("rarity").textContent = gone ? "" : cookie.rarity;
    $("rarity").dataset.level = gone ? "" : cookie.rarity;

    $("rarity").title = gone
      ? ""
      : `${cookie.rarityProbabilityPercent}% · longest original run: ${cookie.maxStreak}`;

    $("message").textContent = gone
      ? "This cookie is gone. You ate it."
      : "This cookie is only supposed to be for you.";

    eat.textContent = gone
      ? "Gone"
      : cookie.bites
        ? "Take another bite"
        : "Eat cookie";

    eat.title = ownerToken
      ? ""
      : "Only the original owner can eat this cookie.";

    try {
      document.cookie =
        `your_cookie=${gone ? "" : cookie.remainingHash}; ` +
        `Path=/; Max-Age=${gone ? 0 : 31536000}; SameSite=Lax` +
        (location.protocol === "https:" ? "; Secure" : "");
    } catch {
      // The official state is stored by the server.
    }
  }

  async function initialize() {
    const current = ++generation;

    cookie = null;
    ownerToken = null;
    busy = true;
    deliveryPending = true;

    retry.hidden = true;

    render();

    try {
      const sharedId = new URL(location.href).searchParams.get("cookie");
      let result;

      if (sharedId !== null) {
        if (!/^[0-9a-f]{64}$/i.test(sharedId)) {
          deliveryPending = false;
          throw new Error("This cookie link is invalid.");
        }

        result = await request(
          "/api/cookies/" + sharedId.toLowerCase(),
          {},
          current,
        );

        if (current !== generation) return;

        const savedToken = readToken(result.id);
        if (savedToken) {
          try {
            result = await ownership.loadOwner(apiBase, result.id, savedToken);
            if (current !== generation) return;
            ownerToken = savedToken;
          } catch {
            if (current !== generation) return;
            ownerToken = null;
          }
        }
        if (current !== generation) return;
      } else {
        // Reuse the same token after a timeout so that a retry
        // retrieves the same issued cookie.
        if (!pendingToken) {
          pendingToken = Array.from(
            crypto.getRandomValues(new Uint8Array(32)),
            (byte) => byte.toString(16).padStart(2, "0"),
          ).join("");
        }

        const token = pendingToken;

        result = await request(
          "/api/cookies",
          {
            method: "POST",
            body: JSON.stringify({ ownerToken: token }),
          },
          current,
        );

        if (current !== generation) return;

        ownerToken = token;
        rememberToken(result.id, token);
        pendingToken = null;
      }

      cookie = result;

      status.textContent =
        cookie.bites === 3
          ? "Only crumbs remain."
          : ownerToken
            ? ""
            : "A shared cookie. Only its owner can take a bite or create a certificate.";
    } catch (error) {
      if (current !== generation) return;

      if (!deliveryPending) {
        status.textContent = error.message;
      }

      retry.hidden = false;
    } finally {
      if (current === generation) {
        busy = false;
        render();
      }
    }
  }

  async function refresh() {
    if (!cookie || busy || refreshing || document.hidden) return;

    const id = cookie.id;
    const current = generation;

    refreshing = true;

    try {
      const latest = await request("/api/cookies/" + id, {}, current);

      if (cookie?.id === id && generation === current && !busy) {
        // An older read must never restore a previous bite state.
        if (latest.bites >= cookie.bites) {
          cookie = latest;
        }

        render();

        if (cookie.bites === 3) {
          status.textContent = "Only crumbs remain.";
        }
      }
    } catch (error) {
      if (current !== generation) return;

      if (!deliveryPending && !busy) {
        status.textContent = error.message;
        render();
      }
    } finally {
      refreshing = false;
    }
  }

  eat.addEventListener("click", async () => {
    if (
      !cookie ||
      !ownerToken ||
      busy ||
      deliveryPending ||
      cookie.bites === 3
    ) {
      return;
    }

    const current = generation;
    const id = cookie.id;

    busy = true;
    status.textContent = "";

    render();

    try {
      const result = await request(
        `/api/cookies/${id}/bite`,
        {
          method: "POST",
          headers: {
            Authorization: "Bearer " + ownerToken,
          },
          body: JSON.stringify({
            expectedBites: cookie.bites,
          }),
        },
        current,
      );

      if (current !== generation) return;

      cookie = result;

      status.textContent =
        cookie.bites === 3
          ? "Only crumbs remain."
          : `${cookie.bitesRemaining} ${
              cookie.bitesRemaining === 1 ? "bite" : "bites"
            } left.`;
    } catch (error) {
      if (current !== generation) return;

      // Read the current state after an uncertain result.
      // Never automatically submit another bite.
      try {
        const latest = await request("/api/cookies/" + id, {}, current);

        if (current !== generation) return;

        if (latest.bites >= cookie.bites) {
          cookie = latest;
        }
      } catch {
        // Preserve the last known cookie and delivery state.
      }

      if (current !== generation) return;

      if (!deliveryPending) {
        status.textContent =
          cookie.bites === 3
            ? "Only crumbs remain."
            : error.status === 409
              ? "Cookie refreshed. A bite was already applied, or this browser is not the owner."
              : "Cookie refreshed. Check the remaining bites before trying again.";
      }
    } finally {
      if (current === generation) {
        busy = false;
        render();
      }
    }
  });

  certificate.addEventListener("click", async () => {
    if (!cookie || !ownerToken || busy || deliveryPending) return;

    // Open during the click so browsers allow the new tab. The secret is sent
    // only in the Authorization header, never in a link or the certificate.
    const certificateWindow = window.open("about:blank", "_blank");
    if (!certificateWindow) {
      status.textContent = "Allow pop-ups to open your certificate, then try again.";
      return;
    }
    certificateWindow.opener = null;
    certificateWindow.document.title = "Cookie certificate";
    certificateWindow.document.body.textContent = "Preparing your certificate…";

    const current = generation;
    const id = cookie.id;
    busy = true;
    status.textContent = "";
    render();

    try {
      const response = await fetch(`${apiBase}/api/cookies/${id}/certificate`, {
        cache: "no-store",
        signal: AbortSignal.timeout(60_000),
        headers: { Authorization: "Bearer " + ownerToken },
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Could not create your certificate. Please try again.");
      }
      const html = await response.text();
      if (current !== generation) {
        certificateWindow.close();
        return;
      }
      if (certificateWindow.closed) return;

      certificateWindow.document.open();
      certificateWindow.document.write(html);
      certificateWindow.document.close();
    } catch (error) {
      certificateWindow.close();
      if (current === generation) {
        status.textContent = error.message || "Could not create your certificate. Please try again.";
      }
    } finally {
      if (current === generation) {
        busy = false;
        render();
      }
    }
  });

  exportOwner.addEventListener("click", async () => {
    if (!cookie || !ownerToken || busy || deliveryPending) return;
    const current = generation, id = cookie.id, token = ownerToken;
    busy = true;
    render();
    try {
      await ownership.loadOwner(apiBase, id, token);
      if (current !== generation) return;
      const blob = new Blob([ownership.makePass(apiBase, id, token)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `cookie-${id}-PRIVATE-owner-pass.json`;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      status.textContent = "Owner Pass saved. Keep this file private; anyone with it can control your cookie.";
    } catch (error) {
      if (current === generation) status.textContent = error.message;
    } finally {
      if (current === generation) { busy = false; render(); }
    }
  });

  importOwner.addEventListener("click", () => {
    if (!busy) ownerFile.click();
  });

  ownerFile.addEventListener("change", async () => {
    const file = ownerFile.files?.[0];
    ownerFile.value = "";
    if (!file || busy) return;
    const current = generation;
    busy = true;
    render();
    try {
      if (file.size > 8192) throw new Error("This file is too large to be an Owner Pass.");
      const pass = ownership.parsePass(await file.text(), apiBase);
      const restored = await ownership.loadOwner(apiBase, pass.cookieId, pass.ownerToken);
      if (current !== generation) return;
      const stored = rememberToken(pass.cookieId, pass.ownerToken);
      // Invalidate any read that was already in flight for the previous cookie.
      generation++;
      cookie = restored;
      ownerToken = pass.ownerToken;
      pendingToken = null;
      deliveryPending = false;
      busy = false;
      retry.hidden = true;
      $("owner-code").value = "";
      $("owner-result").textContent = "";
      const url = new URL(location.href);
      url.searchParams.set("cookie", pass.cookieId);
      history.replaceState(null, "", url);
      render();
      status.textContent = stored
        ? "Owner Pass restored. You can control this cookie on this browser."
        : "Owner Pass restored for this tab. Browser storage is unavailable; keep your backup file.";
    } catch (error) {
      if (current === generation) status.textContent = error.message;
    } finally {
      if (current === generation) { busy = false; render(); }
    }
  });

  $("confirm-owner-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!cookie || !ownerToken || busy || deliveryPending) return;
    const current = generation;
    busy = true;
    $("owner-result").textContent = "Confirming…";
    render();
    try {
      await ownership.confirm(apiBase, cookie.id, ownerToken, $("owner-code").value);
      if (current !== generation) return;
      $("owner-code").value = "";
      $("owner-result").textContent = "Confirmed. Ask the verifier to check the result on their own verification page.";
    } catch (error) {
      if (current === generation) $("owner-result").textContent = error.message;
    } finally {
      if (current === generation) { busy = false; render(); }
    }
  });

  share.addEventListener("click", async () => {
    if (!cookie || busy || deliveryPending || cookie.bites === 3) {
      return;
    }

    const current = generation;
    const url = cookie.shareUrl;

    busy = true;
    status.textContent = "";

    render();

    const copy = async () => {
      if (current !== generation) return;

      try {
        await navigator.clipboard.writeText(url);

        if (current === generation) {
          status.textContent = "Link copied.";
        }
      } catch {
        if (current === generation) {
          window.prompt("Copy your cookie link:", url);
        }
      }
    };

    try {
      if (navigator.share) {
        try {
          await navigator.share({
            title: "A cookie for you 🍪",
            text: "This cookie is only supposed to be for you.",
            url,
          });
        } catch (error) {
          if (error.name !== "AbortError") {
            await copy();
          }
        }
      } else {
        await copy();
      }
    } finally {
      if (current === generation) {
        busy = false;
        render();
      }
    }
  });

  function checkDelivery() {
    if (document.hidden || busy || refreshing) return;

    if (!cookie && deliveryPending) {
      initialize();
    } else {
      refresh();
    }
  }

  retry.addEventListener("click", () => {
    if (busy || refreshing) return;

    if (cookie) {
      refresh();
    } else {
      initialize();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      pendingToken = null;
      initialize();
    }
  });

  document.addEventListener("visibilitychange", checkDelivery);

  setInterval(checkDelivery, 5_000);

  initialize();
})();
