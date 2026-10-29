// Keyboard behavior stays separate from launching, selection and persistence.
(() => {
  const focusSelector = 'button, a[href], input:not([type="hidden"]), select, textarea, [tabindex]';
  function visible(element) {
    return !!element && !element.closest('[hidden], .hidden, [inert]') && !!element.getClientRects().length;
  }
  function focusable(element) { return visible(element) && !element.matches(':disabled') && element.tabIndex >= 0; }
  function focusables(root) { return [...root.querySelectorAll(focusSelector)].filter(focusable); }
  function stop(event) { event.preventDefault(); event.stopPropagation(); }
  function contextMenu(element, win) {
    element.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 0, clientY: 0 }));
  }
  function gridTarget(cards, index, key) {
    if (key === 'Home') return 0;
    if (key === 'End') return cards.length - 1;
    if (key === 'ArrowLeft') return Math.max(0, index - 1);
    if (key === 'ArrowRight') return Math.min(cards.length - 1, index + 1);
    const current = cards[index].getBoundingClientRect();
    const direction = key === 'ArrowDown' ? 1 : -1;
    const candidates = [];
    let rowTop = null;
    for (let i = index + direction; i >= 0 && i < cards.length; i += direction) {
      const rect = cards[i].getBoundingClientRect();
      if ((rect.top - current.top) * direction <= 1) continue;
      if (rowTop !== null && Math.abs(rect.top - rowTop) > 1) break;
      rowTop = rect.top; candidates.push({ i, rect });
    }
    if (!candidates.length) return index;
    const row = candidates.reduce((nearest, { rect }) => Math.min(nearest, Math.abs(rect.top - current.top)), Infinity);
    return candidates.filter(({ rect }) => Math.abs(Math.abs(rect.top - current.top) - row) < 1)
      .sort((a, b) => Math.abs(a.rect.left - current.left) - Math.abs(b.rect.left - current.left))[0].i;
  }
  function handleGameKey(event, { card, cards, select, launch, edit, remove, selectAll, window }) {
    if (event.isComposing || event.altKey) return false;
    const list = [...cards], index = list.indexOf(card);
    if (index < 0) return false;
    const id = element => Number(element.dataset.gameId);
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
      stop(event);
      const target = list[gridTarget(list, index, event.key)];
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey) select(id(target), event);
      target.focus({ preventScroll: true }); target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    } else if (event.key === ' ') { stop(event); select(id(card), event); }
    else if (event.key === 'Enter') { stop(event); if (!event.repeat) { select(id(card), {}); launch(id(card)); } }
    else if (event.key === 'F2') { stop(event); if (!event.repeat) { select(id(card), {}); edit(id(card)); } }
    else if (event.key === 'Delete') { stop(event); if (!event.repeat) remove(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') { stop(event); selectAll(); }
    else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) { stop(event); contextMenu(card, window); }
    else return false;
    return true;
  }
  function setup({ document, window }) {
    let lastActionTarget = document.activeElement, overlays = [], menuState = null;
    const get = id => document.getElementById(id);
    const nativeDialog = () => [...document.querySelectorAll('dialog[open]')].at(-1);
    const topOverlay = () => [...document.querySelectorAll('.modal-overlay:not(.hidden)')].filter(visible).at(-1);
    function firstFocus(root) {
      const controls = focusables(root);
      const preferred = controls.find(el => el.hasAttribute('autofocus')) || controls.find(el => el.matches('input, select, textarea')) || controls[0];
      if (preferred) preferred.focus({ preventScroll: true });
      else { root.tabIndex = -1; root.focus({ preventScroll: true }); }
    }
    function closeMenu(restore = false) {
      if (!menuState) return;
      const { button, menu, holder } = menuState;
      menu.classList.remove('show'); holder.classList.remove('active'); button.setAttribute('aria-expanded', 'false');
      menuState = null; if (restore && visible(button)) button.focus();
    }
    const menus = ['options', 'tools'].map(name => ({
      button: get(`btn-menu-${name}`), menu: get(`dropdown-${name}-menu`), holder: get(`menu-${name}-dropdown`),
    })).filter(item => item.button && item.menu);
    for (const [id, shortcut] of [['search-input','Control+f'],['btn-scan-roms','Control+i'],['btn-open-preferences','Control+,'],['btn-keyboard-shortcuts','F1']]) get(id)?.setAttribute('aria-keyshortcuts', shortcut);
    for (const entry of menus) {
      entry.button.setAttribute('aria-haspopup', 'menu'); entry.button.setAttribute('aria-controls', entry.menu.id);
      entry.menu.setAttribute('role', 'menu');
      entry.menu.querySelectorAll('button').forEach(button => { button.setAttribute('role', 'menuitem'); button.tabIndex = -1; });
    }
    function syncMenus() {
      menuState = menus.find(({ menu }) => menu.classList.contains('show')) || null;
      menus.forEach(({ button, menu }) => button.setAttribute('aria-expanded', String(menu.classList.contains('show'))));
    }
    function openMenu(entry, last = false) {
      closeMenu(); if (!entry.menu.classList.contains('show')) entry.button.click(); syncMenus();
      const items = focusables(entry.menu).length ? focusables(entry.menu) : [...entry.menu.querySelectorAll('button')].filter(el => visible(el) && !el.disabled);
      (last ? items.at(-1) : items[0])?.focus();
    }
    const sidebar = get('platform-list');
    function sidebarButtons() { return sidebar ? [...sidebar.querySelectorAll('button')].filter(el => visible(el) && !el.disabled) : []; }
    let sidebarKey = null;
    function syncSidebar() {
      const buttons = sidebarButtons(); if (!buttons.length) return;
      const current = buttons.includes(document.activeElement) ? document.activeElement
        : buttons.find(el => el.dataset.libraryGroup === sidebarKey && sidebarKey !== null)
          || buttons.find(el => el.getAttribute('aria-pressed') === 'true') || buttons[0];
      buttons.forEach(el => { el.tabIndex = el === current ? 0 : -1; });
    }
    function synchronizeOverlays() {
      if (nativeDialog()) return;
      const active = [...document.querySelectorAll('.modal-overlay:not(.hidden)')].filter(visible);
      const previous = overlays.at(-1);
      const removed = overlays.filter(entry => !active.includes(entry.element));
      overlays = active.map(element => {
        const known = overlays.find(entry => entry.element === element); if (known) return known;
        let opener = element.contains(document.activeElement) ? lastActionTarget : document.activeElement;
        opener = menus.find(entry => entry.menu.contains(opener))?.button || opener;
        return { element, opener };
      });
      const top = overlays.at(-1);
      if (top && !top.element.contains(document.activeElement)) firstFocus(top.element);
      else if (!top && removed.length && previous && (previous.element.contains(document.activeElement) || document.activeElement === document.body)) {
        const opener = previous.opener;
        if (opener?.isConnected && visible(opener)) opener.focus();
        else (document.querySelector('.game-card[tabindex="0"]') || sidebarButtons()[0])?.focus();
      }
    }
    function help() {
      const dialog = get('keyboard-shortcuts-dialog'); if (dialog && !dialog.open) dialog.showModal();
    }
    get('btn-keyboard-shortcuts')?.addEventListener('click', help);
    document.addEventListener('pointerdown', event => { lastActionTarget = event.target.closest(focusSelector) || document.activeElement; }, true);
    document.addEventListener('focusin', event => {
      if (sidebar?.contains(event.target)) { sidebarKey = event.target.dataset.libraryGroup ?? null; syncSidebar(); }
      if (nativeDialog()) return;
      const modal = topOverlay(); if (modal && !modal.contains(event.target)) firstFocus(modal);
    });
    document.addEventListener('keydown', event => {
      if (event.defaultPrevented || event.isComposing) return;
      lastActionTarget = document.activeElement;
      if (event.key === 'F1') { stop(event); if (!event.repeat) help(); return; }
      const dialog = nativeDialog(), modal = topOverlay();
      if (dialog) return;
      if (modal) {
        if (event.key === 'Tab') {
          const controls = focusables(modal), first = controls[0], last = controls.at(-1);
          if (!controls.length) { stop(event); firstFocus(modal); }
          else if (!modal.contains(document.activeElement) || (event.shiftKey ? document.activeElement === first : document.activeElement === last)) {
            stop(event); (event.shiftKey ? last : first).focus();
          }
        }
        return;
      }
      syncMenus();
      const menuTitle = menus.find(({ button }) => button === event.target);
      if (event.key === 'F10' && !event.shiftKey && !event.ctrlKey && !event.metaKey) { stop(event);closeMenu();menus[0]?.button.focus();return; }
      if (menuTitle && ['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        stop(event);
        if (menuState === menuTitle && ['Enter', ' '].includes(event.key)) closeMenu(true);
        else openMenu(menuTitle, event.key === 'ArrowUp');
        return;
      }
      if (menuState) {
        const items = [...menuState.menu.querySelectorAll('button')].filter(el => visible(el) && !el.disabled);
        const index = items.indexOf(document.activeElement);
        if (event.key === 'Escape') { stop(event); closeMenu(true); return; }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) && menuState.menu.contains(event.target)) {
          stop(event); const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next]?.focus(); return;
        }
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          stop(event); const index = menus.indexOf(menuState);openMenu(menus[(index + (event.key === 'ArrowLeft' ? -1 : 1) + menus.length) % menus.length]);return;
        }
        if (event.key === 'Tab') {
          stop(event); const owner = menuState.button; closeMenu(); const controls = focusables(document);
          const index = controls.indexOf(owner); controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus(); return;
        }
      }
      const typing = event.target.closest('input, textarea, select, [contenteditable="true"]');
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === 'f') { stop(event); get('search-input')?.focus();get('search-input')?.select();return; }
      if (!typing && command && event.key.toLowerCase() === 'i') { stop(event); if (!event.repeat) get('btn-scan-roms')?.click();return; }
      if (!typing && command && event.key === ',') { stop(event); if (!event.repeat) get('btn-open-preferences')?.click();return; }
      if (event.key === 'F6') {
        stop(event);
        const regions = [get('search-input'), sidebarButtons().find(el => el.tabIndex === 0), document.querySelector('.game-card[tabindex="0"]'), get('btn-play-game')]
          .filter(el => el && visible(el) && !el.disabled);
        const current = sidebar?.contains(event.target) ? regions.indexOf(regions.find(el => sidebar.contains(el)))
          : event.target.closest('.game-card') ? regions.indexOf(document.querySelector('.game-card[tabindex="0"]')) : regions.indexOf(document.activeElement);
        regions[(current + (event.shiftKey ? -1 : 1) + regions.length) % regions.length]?.focus();return;
      }
      if (typing) return;
      if (sidebar?.contains(event.target)) {
        const buttons = sidebarButtons(), index = buttons.indexOf(event.target);
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
          stop(event);const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : Math.max(0, Math.min(buttons.length - 1, index + (event.key === 'ArrowUp' ? -1 : 1)));
          buttons[next]?.focus();buttons[next]?.scrollIntoView({block:'nearest'});
        } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          const platform = event.target.closest('.platform-filter[data-platform]');if (platform) { stop(event);contextMenu(platform, window); }
        }
      }
    }, true);
    // Observe window boundaries, not the 3D faces or library images on every frame.
    const observer = new window.MutationObserver(() => { synchronizeOverlays();syncMenus();syncSidebar(); });
    document.querySelectorAll('.modal-overlay, dialog, .dropdown-menu').forEach(element => {
      observer.observe(element, { attributes:true, attributeFilter:['class','open','hidden'] });
    });
    if (sidebar) observer.observe(sidebar, { childList:true, subtree:true, attributes:true, attributeFilter:['class'] });
    synchronizeOverlays();syncMenus();syncSidebar();
    return { dispose: () => observer.disconnect() };
  }
  globalThis.OpenCabinetKeyboard = { setup, handleGameKey, gridTarget };
})();
