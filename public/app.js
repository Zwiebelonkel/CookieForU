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
  const retry = $("retry");

  let cookie = null;
  let ownerToken = null;
  let pendingToken = null;
  let busy = false;
  let refreshing = false;
  let generation = 0;
  let deliveryPending = true;

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
    } catch {
      // Ownership still works in this tab.
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
    const face = $("cookie-face");
    const cookieElement = $("cookie");

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

    certificate.hidden = !cookie;

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

    certificate.href = cookie.certificateUrl;

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

        ownerToken = readToken(result.id);
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
            : "A shared cookie. Only its owner can take a bite.";
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
