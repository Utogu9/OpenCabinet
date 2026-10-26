// A title belongs to at most one shared ordering group. Never sort via a
// pairwise exception comparator: its cycles would make Array.sort unstable.
(() => {
  const key = title => String(title || '').trim().normalize('NFC').toLowerCase();
  const titlesFrom = value => String(value || '').split(/\r?\n/).map(title => title.trim()).filter(Boolean);
  function apply(games, library = games) {
    const groups = new Map();
    for (const game of library) for (const entry of [game, ...(game.regions || []).map(region => region.game)]) {
      if (entry.order_group) groups.set(entry.order_group.id, entry.order_group);
    }
    if (!groups.size) return games;
    const membership = new Map();
    for (const group of groups.values()) group.titles.forEach((title, position) => {
      if (!membership.has(key(title))) membership.set(key(title), { id:group.id, position });
    });
    const blocks = new Map();
    games.forEach((game, original) => {
      const member = membership.get(key(game.title));
      if (!member) return;
      if (!blocks.has(member.id)) blocks.set(member.id, []);
      blocks.get(member.id).push({ game, original, position:member.position });
    });
    blocks.forEach(block => block.sort((a,b) => a.position-b.position || a.original-b.original));
    const emitted = new Set(), result = [];
    for (const game of games) {
      const member = membership.get(key(game.title));
      if (!member) result.push(game);
      else if (!emitted.has(member.id)) {
        emitted.add(member.id);result.push(...blocks.get(member.id).map(item => item.game));
      }
    }
    return result;
  }
  function createEditor({ getGames }) {
    const t = globalThis.OpenCabinetI18n.t;
    const input = document.getElementById('game-order-titles'), select = document.getElementById('game-order-add');
    const preview = document.getElementById('game-order-preview'), status = document.getElementById('game-order-status');
    let group = null, original = [];
    function render() {
      const titles = titlesFrom(input.value), library = getGames();
      const counts=new Map();library.forEach(game=>counts.set(key(game.title),(counts.get(key(game.title))||0)+1));
      preview.replaceChildren();
      for (const title of titles.slice(0,200)) {
        const row = document.createElement('li'), name = document.createElement('span'), info = document.createElement('small');
        name.textContent = title;
        const matches = counts.get(key(title)) || 0;
        info.textContent = matches ? t('order.matches',matches) : t('order.missing');
        row.classList.toggle('game-order-missing',matches===0);row.append(name,info);preview.appendChild(row);
      }
      status.textContent = !titles.length ? t('order.empty') : titles.length>200 ? t('order.invalid_count') : '';
    }
    input.addEventListener('input',render);
    select.addEventListener('change',() => {
      if (!select.value) return;
      const titles = titlesFrom(input.value);
      if (!titles.some(title => key(title) === key(select.value))) titles.push(select.value);
      input.value = titles.join('\n');select.value='';render();
    });
    document.getElementById('btn-clear-game-order').addEventListener('click',() => { input.value='';render(); });
    return {
      setGame(game) {
        group = game.order_group || null;original = group?.titles?.slice() || [];
        input.value = original.join('\n');select.replaceChildren();
        const option = document.createElement('option');option.value='';option.textContent=t('order.add');select.appendChild(option);
        const names = new Map();getGames().forEach(game => { if (!names.has(key(game.title))) names.set(key(game.title),game.title); });
        [...names.values()].sort((a,b)=>a.localeCompare(b,globalThis.OpenCabinetI18n.locale)).forEach(title=>{
          const option=document.createElement('option');option.value=title;option.textContent=title;select.appendChild(option);
        });select.value='';render();
      },
      value() {
        const titles=titlesFrom(input.value);
        if (JSON.stringify(titles)===JSON.stringify(original)) return undefined;
        if (titles.length && (titles.length<2||titles.length>200)) throw Error(t('order.invalid_count'));
        if (titles.some(title=>[...title].length>500)) throw Error(t('order.invalid_title'));
        if (new Set(titles.map(key)).size!==titles.length) throw Error(t('order.duplicates'));
        return { id:group?.id ?? null, titles };
      },
    };
  }
  globalThis.OpenCabinetOrder = { apply, createEditor, key };
})();
