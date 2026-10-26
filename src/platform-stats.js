(function (root) {
  function seconds(game) {
    return Math.max(0, Number(game.play_time_seconds ?? (game.play_time || 0) * 60) || 0);
  }
  function summarize(games, emulators, platform) {
    const matches = (name) => name?.toLowerCase() === platform?.toLowerCase();
    const members = games.filter((game) => matches(game.platform));
    const recent = members.filter((game) => game.last_played && Number.isFinite(Date.parse(game.last_played)))
      .sort((a, b) => Date.parse(b.last_played) - Date.parse(a.last_played) || a.id - b.id);
    const played = members.filter((game) => seconds(game) > 0 || game.session_count > 0)
      .sort((a, b) => seconds(b) - seconds(a) || (b.session_count || 0) - (a.session_count || 0) || a.id - b.id);
    return {
      games: members, last: recent[0] || null, most: played[0] || null,
      play_time_seconds: members.reduce((sum, game) => sum + seconds(game), 0),
      session_count: members.reduce((sum, game) => sum + Math.max(0, Number(game.session_count) || 0), 0),
      emulator: emulators.filter((emu) => matches(emu.platform)).sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)) || a.id - b.id)[0] || null,
    };
  }
  const api = { summarize };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OpenCabinetPlatforms = api;
})(typeof window !== "undefined" ? window : globalThis);
