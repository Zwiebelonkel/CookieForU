(() => {
  "use strict";

  const preventZoom = (event) => event.preventDefault();
  const nonPassive = { passive: false };

  // Safari exposes pinch zoom through gesture events.
  for (const type of ["gesturestart", "gesturechange", "gestureend"]) {
    document.addEventListener(type, preventZoom, nonPassive);
  }

  for (const type of ["touchstart", "touchmove"]) {
    document.addEventListener(type, (event) => {
      if (event.touches.length > 1) event.preventDefault();
    }, nonPassive);
  }

  // Trackpad pinch and Ctrl/Cmd + wheel use the same zoom event.
  document.addEventListener("wheel", (event) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  }, nonPassive);

  document.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    if (["+", "=", "-", "_", "0"].includes(event.key) ||
        ["NumpadAdd", "NumpadSubtract", "Numpad0"].includes(event.code)) {
      event.preventDefault();
    }
  });
})();
