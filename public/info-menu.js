(() => {
  "use strict";
  const menu = document.getElementById("info-menu");
  const summary = menu.querySelector("summary");
  const panel = document.getElementById("rarity-info-panel");
  const list = document.getElementById("rarity-chances");
  const status = document.getElementById("rarity-info-status");
  const retry = document.getElementById("retry-rarity-info");
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const apiOrigin = new URL(document.querySelector('meta[name="cookie-api"]').content.trim() || location.origin).origin;
  let loaded = false, loading = false, animation = null;

  async function loadChances() {
    if (loaded || loading) return;
    loading = true;
    retry.hidden = true;
    status.textContent = "Loading chances…";
    try {
      const { rarities } = await window.CookieOwnership.apiJson(apiOrigin, "/api/rarities");
      const rows = document.createDocumentFragment();
      rarities.forEach((rarity, index) => {
        const row = document.createElement("div");
        row.className = "chance-row rarity-stars";
        row.dataset.level = rarity.name;
        const heading = document.createElement("div");
        heading.className = "chance-heading";
        const name = document.createElement("strong");
        name.textContent = rarity.name;
        const percent = document.createElement("span");
        percent.textContent = Number(rarity.percent).toLocaleString("en-US", { maximumFractionDigits: 6 }) + "%";
        heading.append(name, percent);
        const stars = document.createElement("div");
        stars.className = "chance-stars";
        stars.textContent = "★".repeat(index + 1);
        stars.setAttribute("aria-label", `${index + 1} of 6 stars`);
        const track = document.createElement("div");
        track.className = "chance-track";
        track.setAttribute("aria-hidden", "true");
        const fill = document.createElement("span");
        fill.style.width = `${Number(rarity.percent)}%`;
        track.append(fill);
        const odds = document.createElement("small");
        odds.textContent = "About 1 in " + Number(rarity.oneIn).toLocaleString("en-US", { maximumFractionDigits: rarity.oneIn < 10 ? 2 : 0 });
        row.append(heading, stars, track, odds);
        rows.append(row);
      });
      list.replaceChildren(rows);
      status.textContent = "";
      loaded = true;
    } catch {
      status.textContent = "Chances are unavailable right now. Please try again.";
      retry.hidden = false;
    } finally { loading = false; }
  }

  function setOpen(open) {
    animation?.cancel();
    animation = null;
    summary.setAttribute("aria-expanded", String(open));
    menu.toggleAttribute("data-closing", !open);
    if (open) { menu.open = true; loadChances(); }
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
  retry.addEventListener("click", loadChances);
  document.addEventListener("pointerdown", (event) => {
    if (menu.open && !menu.hasAttribute("data-closing") && !menu.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) { setOpen(false); summary.focus(); }
  });
})();
