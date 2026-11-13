(() => {
  "use strict";
  const menu = document.getElementById("leaderboard-menu");
  const summary = menu.querySelector("summary");
  const panel = document.getElementById("leaderboard-panel");
  const list = document.getElementById("leaderboard-list");
  const status = document.getElementById("leaderboard-status");
  const retry = document.getElementById("retry-leaderboard");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const apiOrigin = new URL(document.querySelector('meta[name="cookie-api"]').content.trim() || location.origin).origin;
  let expiresAt = 0, loading = false, animation = null;

  function renderCookies(cookies) {
    const rows = document.createDocumentFragment();
    for (const cookie of cookies) {
      const row = document.createElement("li");
      const link = document.createElement("a");
      link.className = "leaderboard-entry rarity-stars";
      link.dataset.level = cookie.rarity;
      // Use only a known public path on the configured API, never an owner link.
      link.href = `${apiOrigin}/?cookie=${encodeURIComponent(cookie.id)}`;
      link.setAttribute("aria-label", `Rank ${cookie.rank}: ${cookie.rarity}, ${cookie.maxStreak} matching characters. View cookie ${cookie.id}`);
      const rank = document.createElement("span");
      rank.className = "leaderboard-rank";
      rank.textContent = String(cookie.rank).padStart(2, "0");
      rank.setAttribute("aria-hidden", "true");
      const details = document.createElement("div");
      details.className = "leaderboard-details";
      const heading = document.createElement("div");
      heading.className = "leaderboard-heading";
      const name = document.createElement("strong");
      name.textContent = cookie.rarity;
      const stars = document.createElement("span");
      stars.className = "chance-stars";
      stars.textContent = "★".repeat(cookie.stars);
      stars.setAttribute("aria-hidden", "true");
      heading.append(name, stars);
      const id = document.createElement("span");
      id.className = "leaderboard-id";
      id.textContent = `${cookie.id.slice(0, 12)}…${cookie.id.slice(-8)}`;
      id.title = cookie.id;
      const meta = document.createElement("span");
      meta.className = "leaderboard-meta";
      meta.textContent = `${cookie.maxStreak} in a row · ${new Date(cookie.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
      details.append(heading, id, meta);
      const arrow = document.createElement("span");
      arrow.className = "leaderboard-arrow";
      arrow.textContent = "↗";
      arrow.setAttribute("aria-hidden", "true");
      link.append(rank, details, arrow);
      row.append(link);
      rows.append(row);
    }
    list.replaceChildren(rows);
  }

  async function loadLeaderboard() {
    if (loading || performance.now() < expiresAt) return;
    loading = true;
    retry.hidden = true;
    status.textContent = "Loading the rarest cookies…";
    panel.setAttribute("aria-busy", "true");
    try {
      const { cookies, refreshAfterMs } = await window.CookieOwnership.apiJson(apiOrigin, "/api/leaderboard");
      renderCookies(cookies);
      expiresAt = performance.now() + Math.max(0, Math.min(30_000, Number(refreshAfterMs) || 0));
      status.textContent = cookies.length ? "" : "No cookies drawn yet. Yours could be the first.";
    } catch {
      status.textContent = "The leaderboard is unavailable right now. Please try again.";
      // Do not leave old results looking current after a failed refresh.
      list.replaceChildren();
      retry.hidden = false;
    } finally {
      loading = false;
      panel.setAttribute("aria-busy", "false");
    }
  }

  function setOpen(open) {
    animation?.cancel();
    animation = null;
    summary.setAttribute("aria-expanded", String(open));
    menu.toggleAttribute("data-closing", !open);
    if (open) { menu.open = true; loadLeaderboard(); }
    if (reducedMotion.matches) {
      menu.open = open;
      menu.removeAttribute("data-closing");
      return;
    }
    const hidden = { opacity: 0, transform: "translateY(-8px) scale(.97)" };
    const visible = { opacity: 1, transform: "translateY(0) scale(1)" };
    animation = panel.animate(open ? [hidden, visible] : [visible, hidden], {
      duration: open ? 240 : 170, easing: "cubic-bezier(.2,.8,.2,1)",
    });
    animation.onfinish = () => {
      menu.open = open;
      menu.removeAttribute("data-closing");
      animation = null;
    };
  }
  summary.setAttribute("aria-expanded", "false");
  summary.addEventListener("click", (event) => {
    event.preventDefault();
    setOpen(!menu.open || menu.hasAttribute("data-closing"));
  });
  retry.addEventListener("click", loadLeaderboard);
  document.addEventListener("pointerdown", (event) => {
    if (menu.open && !menu.hasAttribute("data-closing") && !menu.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) { setOpen(false); summary.focus(); }
  });
})();
