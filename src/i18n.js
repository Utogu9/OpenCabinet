// Interface strings only. Game metadata and other user content never pass here.
(() => {
  const catalogs = globalThis.OpenCabinetLocaleCatalogs || {};
  const fallback = 'es-AR';
  const userLanguage = globalThis.navigator?.language || globalThis.navigator?.languages?.[0] || '';
  const defaultLocale = /^es(?:[-_]|$)/i.test(userLanguage) ? 'es-AR' : 'en-US';
  let selected = defaultLocale;
  const hasLocale = code => Object.prototype.hasOwnProperty.call(catalogs, code);
  try {
    const storage = globalThis.localStorage || globalThis.window?.localStorage;
    const saved = JSON.parse(storage?.getItem('opencabinet.preferences') || 'null');
    if (hasLocale(saved?.language)) selected = saved.language;
  } catch { /* Missing or unreadable preferences use the system language. */ }
  function t(key, ...values) {
    const message = catalogs[selected]?.messages?.[key] ?? catalogs[fallback]?.messages?.[key] ?? key;
    return message.replace(/\{(\d+)\}/g, (token, index) => index < values.length ? String(values[index] ?? '') : token);
  }
  function translateDOM(root = globalThis.document) {
    if (!root?.querySelectorAll) return;
    root.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.getAttribute('data-i18n')); });
    for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach(node => node.setAttribute(attr, t(node.getAttribute(`data-i18n-${attr}`))));
    }
    root.documentElement?.setAttribute?.('lang', selected);
    root.documentElement?.removeAttribute?.('data-i18n-pending');
  }
  globalThis.OpenCabinetI18n = {
    t, translateDOM, hasLocale, get locale() { return selected; },
    defaultLocale,
    gameMode(value) {
      // Recognize the built-in metadata catalog value without translating custom metadata.
      const known = ['es-AR', 'en-US'].map(code => catalogs[code]?.messages?.['game.mode.cooperative']);
      return typeof value === 'string' && known.includes(value.trim()) ? t('game.mode.cooperative') : value;
    },
    languages: Object.values(catalogs).map(catalog => ({ code: catalog._meta.locale, name: catalog._meta.name })),
    setLocale(code) { selected = hasLocale(code) ? code : fallback; },
  };
  if (globalThis.document?.documentElement?.hasAttribute?.('data-i18n-pending')) translateDOM();
})();
