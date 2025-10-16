// js/debug.js
(function () {
  function banner(msg) {
    const el = document.createElement('pre');
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;padding:12px;margin:0;background:#111827;color:#fca5a5;font:12px/1.4 monospace;white-space:pre-wrap;border-bottom:1px solid #ef4444';
    el.textContent = 'JS ERROR → ' + msg;
    document.body.prepend(el);
  }
  window.addEventListener('error', (e) => {
    banner(`${e.message}\n@ ${e.filename}:${e.lineno}:${e.colno}`);
    console.error(e.error || e.message, e);
  });
  window.addEventListener('unhandledrejection', (e) => {
    banner('Unhandled promise rejection: ' + (e.reason && (e.reason.stack || e.reason.message) || e.reason));
    console.error(e.reason || e);
  });
  document.addEventListener('DOMContentLoaded', () => console.log('[debug] DOM ready'));
})();
