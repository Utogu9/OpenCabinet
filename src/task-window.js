(function (root) {
  const windows = new WeakMap();
  function attach(card, { window = root, document = root.document } = {}) {
    if (windows.has(card)) return windows.get(card);
    const handle = card.querySelector('.import-task-header');
    let position = null, drag = null;
    const bounds = () => {
      const titlebar = document.querySelector('.top-menu-bar');
      return { left: 8, top: Math.max(8, titlebar?.getBoundingClientRect().bottom || 32) + 8,
        right: window.innerWidth - 8, bottom: window.innerHeight - 8 };
    };
    function move(x, y) {
      const area = bounds(), size = card.getBoundingClientRect();
      position = { x: Math.min(Math.max(area.left, x), Math.max(area.left, area.right - size.width)),
        y: Math.min(Math.max(area.top, y), Math.max(area.top, area.bottom - size.height)) };
      Object.assign(card.style, { left: `${position.x}px`, top: `${position.y}px`, right: 'auto', bottom: 'auto' });
    }
    function fit() { if (position && !card.classList.contains('hidden')) move(position.x, position.y); }
    handle.tabIndex = 0;
    handle.setAttribute('aria-label', globalThis.OpenCabinetI18n.t("msg.c4f4d6be93"));
    handle.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target.closest('button') || drag) return;
      const rect = card.getBoundingClientRect();
      drag = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      event.preventDefault(); handle.focus(); handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
    });
    handle.addEventListener('pointermove', event => {
      if (drag?.id === event.pointerId) move(event.clientX - drag.dx, event.clientY - drag.dy);
    });
    function stop(event) {
      if (drag?.id !== event.pointerId) return;
      drag = null; handle.classList.remove('dragging');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(name => handle.addEventListener(name, stop));
    handle.addEventListener('keydown', event => {
      if (event.target !== handle) return;
      const delta = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] }[event.key];
      if (!delta) return;
      event.preventDefault(); const rect = card.getBoundingClientRect(); move(rect.left + delta[0], rect.top + delta[1]);
    });
    window.addEventListener('resize', fit);
    if (window.ResizeObserver) new window.ResizeObserver(fit).observe(card);
    const api = {
      show() {
        card.classList.remove('hidden');
        if (!position) {
          const area = bounds(), size = card.getBoundingClientRect();
          let x = area.right - size.width - 10, y = area.bottom - size.height - 10;
          const others = [...document.querySelectorAll('.import-task:not(.hidden)')].filter(other => other !== card);
          for (const other of others) {
            const rect = other.getBoundingClientRect();
            if (x < rect.right && x + size.width > rect.left && y < rect.bottom && y + size.height > rect.top) {
              if (rect.top - size.height - 12 >= area.top) y = rect.top - size.height - 12;
              else x = rect.left - size.width - 12;
            }
          }
          move(x, y);
        } else fit();
      },
      hide() { card.classList.add('hidden'); },
    };
    windows.set(card, api);
    return api;
  }
  const api = { attach };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OpenCabinetTaskWindows = api;
})(typeof window === 'object' ? window : globalThis);
