(() => {
  "use strict";

  // This preview stays entirely in memory: no payments or real cookie issuance.
  const packages = [
    { quantity: 10, cents: 499, description: "Für den kleinen Hunger" },
    { quantity: 25, cents: 999, description: "Ein Vorrat zum Teilen" },
    { quantity: 60, cents: 1999, description: "Die große Keksdose" },
  ];
  const currency = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });
  const numbers = new Intl.NumberFormat("de-DE");
  const trigger = document.getElementById("open-shop");
  const dialog = document.getElementById("cookie-shop");
  const list = document.getElementById("shop-packages");
  const balance = document.getElementById("shop-balance");
  const status = document.getElementById("shop-status");
  let demoCookies = 0;

  for (const pack of packages) {
    const price = currency.format(pack.cents / 100);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shop-package";
    button.setAttribute("aria-label", `${pack.quantity} Kekse für ${price}, Kauf simulieren`);

    const icon = document.createElement("span");
    icon.className = "shop-package-icon";
    icon.textContent = "🍪";
    icon.setAttribute("aria-hidden", "true");
    const details = document.createElement("span");
    details.className = "shop-package-details";
    const quantity = document.createElement("strong");
    quantity.textContent = `${pack.quantity} Kekse`;
    const description = document.createElement("small");
    description.textContent = pack.description;
    details.append(quantity, description);
    const amount = document.createElement("span");
    amount.className = "shop-package-price";
    amount.textContent = price;
    button.append(icon, details, amount);

    button.addEventListener("click", () => {
      demoCookies += pack.quantity;
      balance.textContent = `${numbers.format(demoCookies)} Kekse`;
      status.textContent = `Demo-Kauf bestätigt: ${pack.quantity} Kekse für ${price}. Keine Zahlung.`;
    });
    list.append(button);
  }

  trigger.addEventListener("click", () => {
    if (dialog.open) return;
    dialog.showModal();
    trigger.setAttribute("aria-expanded", "true");
  });
  document.getElementById("close-shop").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => trigger.setAttribute("aria-expanded", "false"));
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right ||
        event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
  });
})();
