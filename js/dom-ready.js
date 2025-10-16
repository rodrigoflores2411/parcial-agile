<script src="js/dom-ready.js?v=1"></script>
// js/dom-ready.js
// Utilidades para evitar "null.addEventListener"
window.onReady = (fn) => {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", fn, { once: true });
  } else {
    fn();
  }
};
// Engancha evento si el elemento existe
window.on = (id, ev, fn) => {
  const el = document.getElementById(id);
  if (el) el.addEventListener(ev, fn);
  return el; // devuelve null si no existe (por si quieres chequear)
};
