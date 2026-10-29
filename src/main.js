const { invoke } = window.__TAURI__.core;

// Estado local
let allGames = [];
let allEmulators = [];
let allPlatforms = [];
let toastTimeout = null;
let selectedGameId = null;
let focusedGameId = null;
let fileAvailabilityRequest = 0;
let selectedFileAvailability = null;
let libraryTools = null, savedFolderImport = null, savedFolderScan = null;
function createSavedFolderScan() {
  return {
    cancelled:false,committing:false,cancelStep:null,
    cancel(){if(this.committing)return;this.cancelled=true;return this.cancelStep?.();},
    async wait(promise){
      let abort;
      const cancelled=new Promise((_,reject)=>{abort=()=>reject(this);});
      this.cancelStep=abort;
      if(this.cancelled)abort();
      try{return await Promise.race([promise,cancelled]);}
      finally{if(this.cancelStep===abort)this.cancelStep=null;}
    },
  };
}
function closeSavedFolderScan() {
  if(!savedFolderScan)return false;
  if(savedFolderScan.committing)return true;
  void savedFolderScan.cancel();
  document.getElementById('scanner-modal').classList.add('hidden');
  if(!scanInProgress){savedFolderScan=null;++singleFileRequest;chooseImportMode(null);}
  return true;
}
function getLibraryTools() {
  return libraryTools ??= window.OpenCabinetLibraryTools?.create({document,invoke,
    onChanged:loadGames,formatDate:formatLastPlayed,
    formatDuration:seconds=>{seconds=Math.max(0,Math.floor(seconds));return [Math.floor(seconds/3600),Math.floor(seconds/60)%60,seconds%60].map(value=>String(value).padStart(2,'0')).join(':');}});
}
function openSessionHistory(id) {
  const game=allGames.find(game=>game.id===id);if(game)getLibraryTools()?.history(game,{combine:preferences.combineRegionStatistics,regionId:regionalGame(game).id});
}
async function relocateGame(game) {
  try {await getLibraryTools()?.relocate(game);}catch(error){showToast(String(error),true);}
}
async function startSavedFolderScan(platform, folder=null) {
  if(scanInProgress||retroarchSetup?.busy||inlineRetroarchSetup?.busy||savingEmulator||savingInlineEmulator)return;
  try {
    folder ||= await getLibraryTools()?.chooseFolder(platform);if(!folder)return;
    savedFolderImport={platform,folder};document.getElementById('btn-scan-roms').click();
  } catch(error){showToast(String(error),true);}
}
let selectedGameIds = new Set();
let selectionAnchorId = null;
let visibleGameIds = [];
let selectedPlatform = null;
let libraryGrouping = "platform", selectedLibraryGroup = null;
let libraryCategories = null, libraryManufacturers = {};
let libraryGameVariables = {}, libraryPlatformVariables = {};
function libraryVariableContext() { return { games: libraryGameVariables, platforms: libraryPlatformVariables }; }
function libraryVariableNames() { return window.OpenCabinetVariables?.knownNames(libraryVariableContext()) || []; }
let libraryGroupNodes = new Map();
const collapsedLibraryGroups = new Set();
let libraryCategoryEditor = null;
const platformDetailsCache = new Map();
let platformDetailsRequest = 0;
let platformDetailsEditor = null;
let retroarchSetup = null;
let inlineRetroarchSetup = null;
let savingInlineEmulator = false;
let savingEmulator = false;
let emulatorArgumentDefaults = null, inlineEmulatorArgumentDefaults = null;
const PLATFORM_IMAGE_TYPES = [["logo", globalThis.OpenCabinetI18n.t("msg.d707dc2f19")], ["screenshot", globalThis.OpenCabinetI18n.t("msg.e0236ea3bc")], ["artwork", globalThis.OpenCabinetI18n.t("msg.3dbb2d3239")], ["other", globalThis.OpenCabinetI18n.t("msg.371008571b")]];
let scanInProgress = false;
let importMode = "folder";
let importConfigPage = "platform";
let metadataCatalogWarmup = null;
let metadataCatalogSummary = null;
let singleFileRequest = 0;
let importProgressTask = null;
let retroarchProgressTask = null;
const GAME_IMAGE_TYPES = [
  ["cover", globalThis.OpenCabinetI18n.t("msg.1ce80078b2")],
  ["logo", globalThis.OpenCabinetI18n.t("msg.d707dc2f19")],
  ["screenshot", globalThis.OpenCabinetI18n.t("msg.4bcfbfa89f")],
  ["title_screen", globalThis.OpenCabinetI18n.t("msg.35923bef63")],
  ["back_cover", globalThis.OpenCabinetI18n.t("msg.2848e11aaf")],
  ["inlay", globalThis.OpenCabinetI18n.t("image.kind.inlay")],
  ["spine", globalThis.OpenCabinetI18n.t("msg.11ac6da5f0")],
  ["box_3d", globalThis.OpenCabinetI18n.t("msg.4c03aa2d90")],
  ["box_full", globalThis.OpenCabinetI18n.t("msg.768eb3ad45")],
  ["cover_reconstructed", globalThis.OpenCabinetI18n.t("msg.310ed124f1")],
  ["back_cover_reconstructed", globalThis.OpenCabinetI18n.t("msg.577185c50b")],
  ["cart_front", globalThis.OpenCabinetI18n.t("msg.36b12eff47")],
  ["cart_back", globalThis.OpenCabinetI18n.t("msg.4362018c24")],
  ["cart_3d", globalThis.OpenCabinetI18n.t("msg.2a8b646d88")],
  ["cart_label", globalThis.OpenCabinetI18n.t("msg.e4fd86844d")],
  ["disc", globalThis.OpenCabinetI18n.t("msg.62571160f3")],
  ["banner", globalThis.OpenCabinetI18n.t("msg.b7f4d98f98")],
  ["icon", globalThis.OpenCabinetI18n.t("msg.051fec278e")],
  ["poster", globalThis.OpenCabinetI18n.t("msg.4044d84f08")],
  ["square", globalThis.OpenCabinetI18n.t("msg.0b2ea54ec6")],
  ["fanart_background", globalThis.OpenCabinetI18n.t("msg.8d1b2e3aa3")],
  ["fanart_cover", globalThis.OpenCabinetI18n.t("msg.64e40930f7")],
  ["fanart_back_cover", globalThis.OpenCabinetI18n.t("msg.61e96ba6e1")],
  ["fanart_cart_front", globalThis.OpenCabinetI18n.t("msg.880538328d")],
  ["fanart_cart_back", globalThis.OpenCabinetI18n.t("msg.41909b158e")],
  ["fanart_disc", globalThis.OpenCabinetI18n.t("msg.979901e3d6")],
  ["game_select", globalThis.OpenCabinetI18n.t("msg.56ae9c1b2d")],
  ["game_over", globalThis.OpenCabinetI18n.t("msg.81fea183cb")],
  ["high_scores", globalThis.OpenCabinetI18n.t("msg.596d8876a5")],
  ["flyer_front", globalThis.OpenCabinetI18n.t("msg.bf1b31a349")],
  ["flyer_back", globalThis.OpenCabinetI18n.t("msg.481819de38")],
  ["arcade_cabinet", globalThis.OpenCabinetI18n.t("msg.4c1badc3eb")],
  ["arcade_circuit_board", globalThis.OpenCabinetI18n.t("msg.48ce50930d")],
  ["arcade_control_panel", globalThis.OpenCabinetI18n.t("msg.b660d271aa")],
  ["arcade_controls", globalThis.OpenCabinetI18n.t("msg.672d204227")],
  ["arcade_marquee", globalThis.OpenCabinetI18n.t("msg.c73d3e7b4e")],
  ["artwork", globalThis.OpenCabinetI18n.t("msg.5f5445a9c5")], ["other", globalThis.OpenCabinetI18n.t("msg.371008571b")],
];
let galleryGameId = null;
let galleryImagePath = null;
let fullscreenGallery = null;
let detailsGameBox = null;
let logoPanelKey = null;
let catalogCoverLoader = null;
let catalogCoverCache = null;
let catalogFullCoverPaths = new Set();
let catalogInlayPaths = new Set();
let manualCoverCache = null;
const isDreamcastGame = game => /^(sega)?dreamcast$/.test(String(game?.platform||'').toLowerCase().replace(/[^a-z0-9]/g,''));
const pauseManualPrefetchForScroll=()=>manualCoverCache?.pauseForScroll();
const PREFERENCES_KEY = "opencabinet.preferences";
const DEFAULT_PREFERENCES = { language: globalThis.OpenCabinetI18n.defaultLocale, maxCachedCovers: 400, cacheMode: "disk", cacheDirectory: "", startMaximized: true, coversOnly: false, timeFormat: "24h", combineRegionStatistics: true, useCatalogTitles: true };
let preferences = readPreferences();
const launchingGames = new Set();
let deletingGames = false;
let bulkImageDownloader = null;
const modalDismissHandlers = new Map();
let escapeDismissalReady = false;
let libraryLoading = false, libraryLoadError = false, initialLibraryLoad = null;

function validCoverLimit(value) {
  return Number.isInteger(value) && value >= 1 && value <= 99999;
}

function readPreferences() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFERENCES_KEY));
    return {
      language: globalThis.OpenCabinetI18n.hasLocale(saved?.language) ? saved.language : DEFAULT_PREFERENCES.language,
      maxCachedCovers: validCoverLimit(saved?.maxCachedCovers) ? saved.maxCachedCovers : DEFAULT_PREFERENCES.maxCachedCovers,
      cacheMode: saved?.cacheMode === "ram" ? "ram" : "disk",
      cacheDirectory: typeof saved?.cacheDirectory === "string" ? saved.cacheDirectory : "",
      startMaximized: typeof saved?.startMaximized === "boolean" ? saved.startMaximized : DEFAULT_PREFERENCES.startMaximized,
      coversOnly: typeof saved?.coversOnly === "boolean" ? saved.coversOnly : DEFAULT_PREFERENCES.coversOnly,
      timeFormat: ["12h", "24h"].includes(saved?.timeFormat) ? saved.timeFormat : DEFAULT_PREFERENCES.timeFormat,
      combineRegionStatistics: typeof saved?.combineRegionStatistics === "boolean" ? saved.combineRegionStatistics : true,
      useCatalogTitles: typeof saved?.useCatalogTitles === "boolean" ? saved.useCatalogTitles : true,
    };
  } catch { /* Use defaults if preferences are missing or unreadable. */ }
  return { ...DEFAULT_PREFERENCES };
}

function setupPreferences() {
  const languageSelect = document.getElementById("preference-language");
  languageSelect.replaceChildren();
  globalThis.OpenCabinetI18n.languages.forEach(language => {
    const option = document.createElement("option"); option.value = language.code; option.textContent = language.name; languageSelect.appendChild(option);
  });
  const dialog = document.getElementById("preferences-dialog");
  const openButton = document.getElementById("btn-open-preferences");
  const input = document.getElementById("preference-cover-limit");
  const cacheMode = document.getElementById("preference-cache-mode");
  const cacheDirectory = document.getElementById("preference-cache-directory");
  const cacheBrowse = document.getElementById("btn-browse-cache-directory");
  const cacheReset = document.getElementById("btn-reset-cache-directory");
  let draftCacheDirectory = "";
  const startMaximized = document.getElementById("preference-start-maximized");
  const coversOnly = document.getElementById("preference-covers-only");
  const combineRegions = document.getElementById("preference-combine-region-statistics");
  const timeFormat = document.getElementById("preference-time-format");
  const directory = document.getElementById("preference-data-directory");
  const browse = document.getElementById("btn-browse-data-directory");
  const reset = document.getElementById("btn-reset-data-directory");
  const undo = document.getElementById("btn-undo-data-directory");
  const restart = document.getElementById("btn-restart-data-move");
  const languageRestart=document.getElementById('language-restart-dialog');
  const restartNow=document.getElementById('btn-language-restart-now');
  document.getElementById('btn-language-restart-later').addEventListener('click',()=>languageRestart.close());
  restartNow.addEventListener('click',async()=>{
    if(scanInProgress||launchingGames.size||allGames.some(game=>game.is_running)){
      showToast(globalThis.OpenCabinetI18n.t('msg.bcfea2fcc9'),true);return;
    }
    restartNow.disabled=true;
    try{await invoke('restart_app');}
    catch(reason){showToast(globalThis.OpenCabinetI18n.t('msg.d08932cc3c',reason),true);}
    finally{restartNow.disabled=false;}
  });
  const save = document.getElementById("btn-save-preferences");
  const error = document.getElementById("preferences-error");
  const status = document.getElementById("preferences-data-status");
  const preview = document.getElementById("preferences-data-preview");
  const metadataCatalog=document.getElementById('preference-metadata-catalog');
  const metadataImport=document.getElementById('btn-import-metadata-catalog');
  const metadataReset=document.getElementById('btn-reset-metadata-catalog');
  const catalogTitles=document.getElementById('preference-catalog-titles');
  let metadataSource=null,draftCatalog=undefined;
  let location = null, draftDirectory = "", request = 0, saving = false, choosing = false;
  let selection = null;
  let reading = null;
  let backupsPanel = null, preferenceCategory = "startup";
  function updateSaveVisibility() { save.classList.toggle("hidden", preferenceCategory === "backups"); }
  const tabs = ["startup", "library", "metadata", "data", "backups"].map(name => ({
    name, button: document.getElementById(`preferences-tab-${name}`),
    panel: document.getElementById(`preferences-panel-${name}`),
  }));
  function showCategory(name, focus = false) {
    if (backupsPanel?.busy) return;
    preferenceCategory = name; updateSaveVisibility();
    document.getElementById("preferences-tab-data").classList.toggle("has-active-subcategory", name === "backups");
    if (name === "backups") void backupsPanel?.open();
    document.getElementById("preferences-panels").scrollTop = 0;
    tabs.forEach(tab => {
      const active = tab.name === name;
      tab.button.setAttribute("aria-selected", String(active));
      tab.button.tabIndex = active ? 0 : -1;
      tab.panel.classList.toggle("hidden", !active);
      if (active && focus) tab.button.focus();
    });
  }
  tabs.forEach((tab, index) => {
    tab.button.addEventListener("click", () => showCategory(tab.name));
    tab.button.addEventListener("keydown", event => {
      let next;
      if (event.key === "ArrowDown") next = tabs[(index + 1) % tabs.length];
      if (event.key === "ArrowUp") next = tabs[(index + tabs.length - 1) % tabs.length];
      if (event.key === "Home") next = tabs[0];
      if (event.key === "End") next = tabs[tabs.length - 1];
      if (next) { event.preventDefault(); showCategory(next.name, true); }
    });
  });

  function readLocation() {
    if (!reading) reading = invoke("get_data_location").finally(() => { reading = null; });
    return reading;
  }
  function showError(message) {
    error.textContent = String(message);
    error.classList.remove("hidden");
  }
  function update() {
    directory.value = draftDirectory;
    document.getElementById("preferences-current-directory").textContent = location
      ? globalThis.OpenCabinetI18n.t("msg.8d1a55bd93", location.active_directory) : globalThis.OpenCabinetI18n.t("msg.cd9c5528d2");
    const busy = saving || choosing || !!backupsPanel?.busy;
    tabs.forEach(tab => { tab.button.disabled = busy; });
    metadataImport.disabled=metadataReset.disabled=busy;
    catalogTitles.disabled=busy;
    metadataCatalog.value=draftCatalog===undefined?(metadataSource?.label||globalThis.OpenCabinetI18n.t('source.default')):draftCatalog===null?globalThis.OpenCabinetI18n.t('source.default'):draftCatalog;
    browse.disabled = reset.disabled = save.disabled = !location || busy;
    undo.disabled = !location || busy || draftDirectory === location.active_directory;
    input.disabled = busy;
    cacheMode.disabled = cacheBrowse.disabled = cacheReset.disabled = busy;
    cacheDirectory.value = draftCacheDirectory || (location ? `${location.active_directory.replace(/[\\/]$/, "")}/cache` : globalThis.OpenCabinetI18n.t("msg.efe5f1e8d3"));
    document.getElementById("preference-cache-disk-options").classList.toggle("hidden", cacheMode.value !== "disk");
    startMaximized.disabled = coversOnly.disabled = busy;
    timeFormat.disabled = busy;
    document.getElementById("btn-close-preferences").disabled = busy;
    document.getElementById("btn-cancel-preferences").disabled = busy;
    restart.classList.toggle("hidden", !location?.pending_directory);
    restart.disabled = busy;
    restart.textContent = location?.pending_action === "use_existing" ? globalThis.OpenCabinetI18n.t("msg.14e83ace90") : globalThis.OpenCabinetI18n.t("msg.2f1d9c765d");
    preview.classList.toggle("hidden", !selection || draftDirectory === location?.active_directory);
    preview.textContent = selection?.action === "use_existing"
      ? globalThis.OpenCabinetI18n.t("msg.26a4dd25a8")
      : globalThis.OpenCabinetI18n.t("msg.65d8ff718d");
    status.classList.toggle("hidden", !location?.pending_directory && !location?.startup_message);
    status.textContent = location?.startup_message || "";
    if (location?.pending_directory) {
      const message = location.pending_action === "use_existing"
        ? globalThis.OpenCabinetI18n.t("msg.d00ebc770b", location.pending_directory)
        : globalThis.OpenCabinetI18n.t("msg.e87d6dfb79", location.pending_directory);
      status.textContent += `${status.textContent ? "\n" : ""}${message}`;
    }
  }
  if (globalThis.OpenCabinetBackups) backupsPanel = globalThis.OpenCabinetBackups.setup({ document, invoke,
    Channel: window.__TAURI__.core.Channel, getPreferences: () => preferences, onBusyChange: update,
    onRestored: async () => { location = await readLocation(); draftDirectory = location.pending_directory || location.active_directory; selection = null; update(); },
    canRestart: () => !scanInProgress && !launchingGames.size && !allGames.some(game => game.is_running) });
  function close() { if (!saving && !choosing && !backupsPanel?.busy) dialog.close(); }
  openButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    document.getElementById("dropdown-options-menu").classList.remove("show");
    document.getElementById("menu-options-dropdown").classList.remove("active");
    input.value = String(preferences.maxCachedCovers);
    cacheMode.value = preferences.cacheMode;
    draftCacheDirectory = preferences.cacheDirectory;
    startMaximized.checked = preferences.startMaximized;
    coversOnly.checked = preferences.coversOnly;
    languageSelect.value = preferences.language;
    combineRegions.checked = preferences.combineRegionStatistics;
    catalogTitles.checked = preferences.useCatalogTitles;
    timeFormat.value = preferences.timeFormat;
    error.classList.add("hidden");
    location = null;
    draftDirectory = "";
    selection = null;
    metadataSource=null;draftCatalog=undefined;
    update();
    showCategory("startup");
    dialog.showModal();
    tabs[0].button.focus();
    const currentRequest = ++request;
    void invoke('get_metadata_source').then(source=>{if(currentRequest===request&&dialog.open){metadataSource=source;update();}}).catch(console.error);
    try {
      const result = await readLocation();
      if (currentRequest !== request || !dialog.open) return;
      location = result;
      draftDirectory = location.pending_directory || location.active_directory;
    } catch (reason) {
      if (currentRequest === request && dialog.open) showError(globalThis.OpenCabinetI18n.t("msg.35949fa556", reason));
    }
    if (currentRequest === request) update();
  });
  dialog.addEventListener("close", () => { request++; });
  dialog.addEventListener("cancel", (event) => { if (saving || choosing || backupsPanel?.busy) event.preventDefault(); });
  document.getElementById("btn-close-preferences").addEventListener("click", close);
  document.getElementById("btn-cancel-preferences").addEventListener("click", close);
  async function inspectSelection(selected, currentRequest) {
    const result = await invoke("inspect_data_directory", { directory: selected });
    if (currentRequest !== request || !dialog.open) return;
    draftDirectory = result.directory;
    selection = result;
    error.classList.add("hidden");
  }
  browse.addEventListener("click", async () => {
    if (!location || saving || choosing) return;
    const currentRequest = request;
    choosing = true; update();
    try {
      const selected = await invoke("choose_data_directory");
      if (selected && currentRequest === request && dialog.open) await inspectSelection(selected, currentRequest);
    } catch (reason) { showError(globalThis.OpenCabinetI18n.t("msg.219183b500", reason)); }
    finally { choosing = false; update(); }
  });
  reset.addEventListener("click", async () => {
    if (!location || saving || choosing) return;
    choosing = true; update();
    try { await inspectSelection(location.default_directory, request); }
    catch (reason) { showError(globalThis.OpenCabinetI18n.t("msg.219183b500", reason)); }
    finally { choosing = false; update(); }
  });
  undo.addEventListener("click", () => { if (location && !saving && !choosing) { draftDirectory = location.active_directory; selection = null; update(); } });
  cacheMode.addEventListener("change", update);
  metadataImport.addEventListener('click',async()=>{
    if(saving||choosing)return;
    const currentRequest=request;choosing=true;update();
    try{const path=await invoke('choose_metadata_catalog');if(path&&currentRequest===request&&dialog.open)draftCatalog=path;}
    catch(reason){showError(reason);}
    finally{choosing=false;update();}
  });
  metadataReset.addEventListener('click',()=>{if(!saving&&!choosing){draftCatalog=null;update();}});
  cacheReset.addEventListener("click", () => { draftCacheDirectory = ""; update(); });
  cacheBrowse.addEventListener("click", async () => {
    if (saving || choosing) return;
    const currentRequest = request;
    choosing = true; update();
    try {
      const selected = await invoke("choose_cache_directory");
      if (selected && currentRequest === request && dialog.open) draftCacheDirectory = selected;
    } catch (reason) { showError(globalThis.OpenCabinetI18n.t("msg.f54a89d7db", reason)); }
    finally { choosing = false; update(); }
  });
  document.getElementById("preferences-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || choosing || backupsPanel?.busy || !location) return;
    if (preferenceCategory === "backups") { await backupsPanel?.saveSettings(); return; }
    const value = Number(input.value);
    if (!validCoverLimit(value)) {
      showCategory("data");
      showError(globalThis.OpenCabinetI18n.t("msg.51fff04dc7"));
      input.focus();
      return;
    }
    if (!["12h", "24h"].includes(timeFormat.value)) {
      showCategory("library");
      showError(globalThis.OpenCabinetI18n.t("msg.ddac9839bd"));
      timeFormat.focus();
      return;
    }
    if (!globalThis.OpenCabinetI18n.hasLocale(languageSelect.value)) {
      showCategory("startup"); showError(globalThis.OpenCabinetI18n.t("language.invalid")); return;
    }
    const next = { ...preferences, language: languageSelect.value, maxCachedCovers: value,
      cacheMode: cacheMode.value === "ram" ? "ram" : "disk", cacheDirectory: draftCacheDirectory,
      startMaximized: startMaximized.checked, coversOnly: coversOnly.checked, timeFormat: timeFormat.value,
      combineRegionStatistics: combineRegions.checked, useCatalogTitles: catalogTitles.checked };
    let previous;
    saving = true; update();
    try {
      if (next.cacheMode === "disk") await invoke("validate_cover_cache_directory", { cacheDirectory: next.cacheDirectory || null });
      previous = window.localStorage.getItem(PREFERENCES_KEY);
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(next));
    } catch (reason) {
      saving = false; update();
      showError(globalThis.OpenCabinetI18n.t("msg.de4d0d614d", reason));
      return;
    }
    saving = true;
    error.classList.add("hidden");
    update();
    try {
      const actionChanged = location.pending_directory && selection && selection.action !== (location.pending_action || "move");
      if (draftDirectory !== (location.pending_directory || location.active_directory) || actionChanged) {
        location = await invoke("schedule_data_directory", { directory: draftDirectory,
          directoryAction: selection?.action || location.pending_action || "move" });
      }
      selection = null;
      const languageChanged = next.language !== preferences.language;
      if(draftCatalog!==undefined){
        const importStatus=document.getElementById('metadata-import-status');
        const importProgress=document.getElementById('metadata-import-progress');
        const currentRequest=request;
        let onProgress;
        if(window.__TAURI__.core.Channel)onProgress=new window.__TAURI__.core.Channel();
        if(draftCatalog!==null){
          showCategory('metadata');
          importStatus.textContent=globalThis.OpenCabinetI18n.t('source.import.processing');
          importStatus.classList.remove('hidden');importProgress.classList.remove('hidden');
          if(onProgress){
            onProgress.onmessage=progress=>{
              if(currentRequest!==request||!dialog.open||!saving)return;
              const key={reading:'source.import.reading',indexing:'source.import.indexing',validating:'source.import.validating',publishing:'source.import.publishing'}[progress.phase]||'source.import.processing';
              importStatus.textContent=globalThis.OpenCabinetI18n.t(key);
              if(progress.phase==='reading'&&progress.processed>0)importStatus.textContent+=' · '+globalThis.OpenCabinetI18n.t('source.import.records',new Intl.NumberFormat(globalThis.OpenCabinetI18n.locale).format(progress.processed));
            };
          }
        }
        try{
          metadataSource=await invoke('set_metadata_catalog',{catalog:draftCatalog,...(onProgress?{onProgress}: {})});
          draftCatalog=undefined;metadataCatalogWarmup=null;metadataCatalogSummary=null;
        }finally{importStatus.classList.add('hidden');importProgress.classList.add('hidden');}
      }
      if (next.language !== preferences.language) await invoke("save_ui_language", { language: next.language });
      const cacheChanged = preferences.cacheMode !== next.cacheMode || preferences.cacheDirectory !== next.cacheDirectory;
      const statisticsChanged = preferences.combineRegionStatistics !== next.combineRegionStatistics;
      preferences = next;
      void invoke("save_backup_preferences", { preferences }).catch(reason => console.error(reason));
      allGames.forEach(projectRegionalStatistics);
      if (statisticsChanged) renderPlatformFilters();
      catalogCoverLoader?.dispose();
      catalogCoverLoader = null;
      if (cacheChanged) {
        manualCoverCache?.dispose();manualCoverCache=null;
        catalogCoverCache?.dispose(); catalogCoverCache = null;
      } else catalogCoverCache?.setLimit(value);
      applyLibraryFilters();
      saving = false;
      update();
      if (!location.pending_directory) close();
      else showCategory("data");
      showToast(!location.pending_directory ? globalThis.OpenCabinetI18n.t(languageChanged ? "language.changed" : "msg.1dacf61b0b") : location.pending_action === "use_existing"
        ? globalThis.OpenCabinetI18n.t("msg.4b41879dc5")
        : globalThis.OpenCabinetI18n.t("msg.76729405df"));
      if (languageChanged) document.getElementById("language-restart-dialog").showModal();
    } catch (reason) {
      try {
        if (previous === null) window.localStorage.removeItem(PREFERENCES_KEY);
        else window.localStorage.setItem(PREFERENCES_KEY, previous);
      } catch { /* Preserve the error from scheduling the move. */ }
      showError(globalThis.OpenCabinetI18n.t("msg.de4d0d614d", reason));
    } finally { saving = false; update(); }
  });
  restart.addEventListener("click", async () => {
    if (saving || choosing || !location?.pending_directory) return;
    if (draftDirectory !== location.pending_directory || Number(input.value) !== preferences.maxCachedCovers
      || cacheMode.value !== preferences.cacheMode || draftCacheDirectory !== preferences.cacheDirectory
      || startMaximized.checked !== preferences.startMaximized || coversOnly.checked !== preferences.coversOnly
      || timeFormat.value !== preferences.timeFormat
      || languageSelect.value !== preferences.language
      || combineRegions.checked !== preferences.combineRegionStatistics
      || catalogTitles.checked !== preferences.useCatalogTitles
      || (selection && selection.action !== (location.pending_action || "move"))) {
      showError(globalThis.OpenCabinetI18n.t("msg.39ef2ccc28"));
      return;
    }
    if (scanInProgress || launchingGames.size || allGames.some((game) => game.is_running)) {
      showError(globalThis.OpenCabinetI18n.t("msg.bcfea2fcc9"));
      return;
    }
    saving = true; update();
    try { await invoke("restart_for_data_move"); }
    catch (reason) { saving = false; update(); showError(globalThis.OpenCabinetI18n.t("msg.d08932cc3c", reason)); }
  });
  // Report a failed startup move without ever silently opening a new library.
  readLocation().then((result) => {
    if (result.startup_message) showToast(result.startup_message, true);
  }).catch(() => {});
  window.addEventListener("beforeunload", () => {
    catalogCoverLoader?.dispose();
    manualCoverCache?.dispose();
    catalogCoverCache?.dispose();
  });
}

let appUpdates = null;
function setupAppUpdates() {
  const t = (...args) => globalThis.OpenCabinetI18n.t(...args);
  const status = document.getElementById('updates-status');
  const progress = document.getElementById('updates-progress');
  const error = document.getElementById('updates-error');
  const check = document.getElementById('btn-check-update');
  const install = document.getElementById('btn-install-update');
  const notes = document.getElementById('updates-notes');
  const updateTask = document.getElementById('update-task');
  const floating = window.OpenCabinetTaskWindows.attach(updateTask);
  let dismissedVersion = null;
  document.getElementById('btn-dismiss-update-task').addEventListener('click', () => {
    dismissedVersion = appUpdates?.state.update?.version;
    floating.hide();
  });
  document.getElementById('btn-view-update').addEventListener('click', () => {
    floating.hide();
    document.getElementById('btn-open-about').click();
  });
  appUpdates = window.OpenCabinetUpdates.create({
    invoke, channel: () => new window.__TAURI__.core.Channel(),
    busy: () => scanInProgress || launchingGames.size || savingEmulator || savingInlineEmulator
      || retroarchSetup?.busy || inlineRetroarchSetup?.busy || allGames.some(game => game.is_running),
    notify: version => {
      document.getElementById('btn-open-about').classList.add('update-available');
      document.getElementById('update-task-label').textContent = t('update.available', version);
      if (version !== dismissedVersion && !document.getElementById('about-dialog').open) floating.show();
    },
    render(state) {
      const active = ['checking', 'downloading', 'installing'].includes(state.phase);
      check.disabled = active;
      check.hidden = ['downloading', 'installing'].includes(state.phase);
      install.hidden = !state.update;
      install.disabled = active || !state.update?.install_allowed;
      document.getElementById('btn-close-about').disabled = appUpdates?.busy || false;
      const keys = { idle: 'update.hint', checking: 'update.checking', current: 'update.current',
        available: 'update.available', downloading: 'update.downloading', installing: 'update.installing', error: 'update.checkFailed' };
      status.textContent = t(keys[state.phase], state.update?.version || '');
      if (state.update && !state.update.install_allowed) status.textContent += ' ' + t('update.releaseOnly');
      progress.hidden = !['downloading', 'installing'].includes(state.phase);
      if (state.total > 0) {
        progress.value = Math.min(100, state.downloaded / state.total * 100);
        if (state.phase === 'downloading') status.textContent += ` ${Math.floor(progress.value)}%`;
      } else progress.removeAttribute('value');
      error.hidden = !state.error;
      error.textContent = state.error.startsWith('update.') ? t(state.error) : state.error;
      notes.hidden = !state.update?.notes;
      notes.querySelector('p').textContent = state.update?.notes || '';
      if (!state.update) document.getElementById('btn-open-about').classList.remove('update-available');
      if (!state.update || ['downloading', 'installing'].includes(state.phase)) floating.hide();
    },
  });
  check.addEventListener('click', () => appUpdates.check());
  install.addEventListener('click', () => appUpdates.install());
  appUpdates.refresh();
}

function setupAbout() {
  const dialog = document.getElementById("about-dialog");
  const button = document.getElementById("btn-open-about");
  button.addEventListener("click", async () => {
    for (const name of ["options", "tools"]) {
      document.getElementById(`dropdown-${name}-menu`).classList.remove("show");
      document.getElementById(`menu-${name}-dropdown`).classList.remove("active");
    }
    dialog.showModal();
    appUpdates?.refresh();
    document.getElementById("btn-close-about").focus();
    const version = document.getElementById("about-version");
    try { version.textContent = globalThis.OpenCabinetI18n.t("msg.584ed1896d", await window.__TAURI__.app.getVersion()); }
    catch { version.textContent = ""; }
  });
  const close = () => { if (!appUpdates?.busy) dialog.close(); };
  dialog.addEventListener('cancel', event => { if (appUpdates?.busy) event.preventDefault(); });
  document.getElementById("btn-close-about").addEventListener("click", close);
  document.getElementById("btn-project-github").addEventListener("click", async () => {
    try { await invoke("plugin:opener|open_url", { url: "https://github.com/Utogu9/OpenCabinet" }); }
    catch (reason) { showToast(String(reason), true); }
  });
  dialog.addEventListener("close", () => button.focus());
  setupModalBackdropClose(dialog, close);
}

function gameImages(game) {
  const images = (game.images || []).map((image) => ({ ...image }));
  if (game.cover_path && !images.some((image) => image.kind === "cover")) {
    images.unshift({ kind: "cover", path: game.cover_path });
  }
  return images;
}

function regionalGame(game) {
  return game.regions?.find(region => region.game.id === game.default_region_id)?.game || game;
}
function findGameSource(id) {
  return allGames.flatMap(game => [game, ...(game.regions || []).map(region => region.game)]).find(game => game.id === id);
}
function displayGameImages(game) {
  const images = gameImages(regionalGame(game));
  return window.OpenCabinetImages ? window.OpenCabinetImages.resolve(images) : images;
}

const IMAGE_TYPE_PREFERENCES_KEY = "opencabinet.imageTypes";
const DEFAULT_IMAGE_TYPES = ["cover", "logo", "screenshot", "title_screen", "back_cover", "spine", "disc"];
function readImageTypePreferences() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(IMAGE_TYPE_PREFERENCES_KEY));
    return new Map(GAME_IMAGE_TYPES.filter(([kind]) => typeof saved?.[kind] === "boolean").map(([kind]) => [kind, saved[kind]]));
  } catch { return new Map(); }
}
function rememberImageTypes(inputs) {
  const saved = readImageTypePreferences();
  inputs.forEach((input, kind) => saved.set(kind, !!input.checked));
  try { window.localStorage.setItem(IMAGE_TYPE_PREFERENCES_KEY, JSON.stringify(Object.fromEntries(saved))); } catch { /* Keep the current selection if storage is unavailable. */ }
}
function renderImageTypeChoices(container, counts, inputs, remembered = new Map(), form = null) {
  inputs.forEach((input, kind) => remembered.set(kind, !!input.checked));
  inputs.clear(); container.replaceChildren(); container.classList.add("image-type-checklist");
  const saved = readImageTypePreferences();
  GAME_IMAGE_TYPES.forEach(([kind, name]) => {
    if (!(counts[kind] > 0)) return;
    const label = document.createElement("label");
    const caption = document.createElement("span"); caption.textContent = name + " (" + counts[kind] + ")";
    const input = document.createElement("input"); input.type = "checkbox"; input.name = kind;
    input.checked = remembered.has(kind) ? remembered.get(kind) : saved.has(kind) ? saved.get(kind) : DEFAULT_IMAGE_TYPES.includes(kind);
    input.onchange = () => { remembered.set(kind, !!input.checked); rememberImageTypes(inputs); };
    if (form) input.setAttribute("form", form);
    label.append(caption, input); container.appendChild(label); inputs.set(kind, input);
  });
  if (!inputs.size) container.textContent = globalThis.OpenCabinetI18n.t("msg.2436866316");
}

function selectedImageTypes(inputs, downloadAll = false) {
  rememberImageTypes(inputs);
  return { selected_types: [...inputs].filter(([, input]) => input.checked).map(([kind]) => kind),
    download_all: downloadAll };
}

function assignImageType(images, path, kind) {
  const next = images.map((image) => ({ ...image }));
  if (["cover", "logo"].includes(kind)) {
    next.forEach((image) => {
      if (image.path !== path && image.kind === kind) image.kind = "artwork";
    });
  }
  const existing = next.find((image) => image.path === path);
  if (existing) existing.kind = kind;
  else next.push({ path, kind });
  return next;
}

function imageSource(path) {
  return /^(https?:|asset:|data:image\/|blob:)/i.test(path)
    ? path : window.__TAURI__.core.convertFileSrc(path);
}

function mediaImage(path, alt, className = "", onError = null) {
  const image = document.createElement("img");
  image.alt = alt;
  image.className = className;
  image.decoding = "async";
  image.loading = "lazy";
  image.addEventListener("error", () => {
    if (onError) {
      onError();
      return;
    }
    const message = document.createElement("span");
    message.className = "image-unavailable";
    message.textContent = globalThis.OpenCabinetI18n.t("msg.cc5537794c");
    image.replaceWith(message);
  }, { once: true });
  image.src = imageSource(path);
  return image;
}

function createCatalogCoverLoader(root) {
  if (!root || !window.IntersectionObserver || !window.OpenCabinetCovers) return null;
  catalogFullCoverPaths = new Set(allGames.flatMap(game => [game, ...(game.regions || []).map(region => region.game)]).flatMap(game => gameImages(game).filter(image => image.kind === "box_full").map(image => image.path)));
  const dreamcastGames=allGames.flatMap(game=>[game,...(game.regions||[]).map(region=>region.game)]).filter(isDreamcastGame);
  catalogInlayPaths=new Set(dreamcastGames.flatMap(game=>gameImages(game).filter(image=>image.kind==='inlay').map(image=>image.path)));
  if (!catalogCoverCache) {
    const decode = window.OpenCabinetCovers.createDecoder();
    const cacheDirectory = preferences.cacheDirectory || null;
    let warned = false;
    const decodePath = preferences.cacheMode === "disk" ? window.OpenCabinetCovers.createPersistentDecoder({
      decode, toUrl: imageSource,
      optionsFor: source => ({ fullCover: catalogFullCoverPaths.has(source)||catalogInlayPaths.has(source) }),
      lookup: source => invoke("cover_cache_entry", { source, cacheDirectory, fullCover: catalogFullCoverPaths.has(source), ...(catalogInlayPaths.has(source)?{previewKind:'inlay'}:{}) }),
      store: (source, key, thumbnailBytes) => invoke("store_cover_thumbnail", { source, key, cacheDirectory, fullCover: catalogFullCoverPaths.has(source), ...(catalogInlayPaths.has(source)?{previewKind:'inlay'}:{}), thumbnailBytes: Array.from(thumbnailBytes) }),
      onError: error => {
        if (!warned) { warned = true; console.warn("Caché de portadas:", error); showToast(globalThis.OpenCabinetI18n.t("msg.44b28132ce"), true); }
      },
    }) : Object.assign((path, signal) => decode(imageSource(path), signal, null, { fullCover: catalogFullCoverPaths.has(path)||catalogInlayPaths.has(path) }), { dispose: () => decode.dispose() });
    catalogCoverCache = window.OpenCabinetCovers.createCache(preferences.maxCachedCovers, decodePath);
    if(window.OpenCabinetManualCovers) {
      manualCoverCache=window.OpenCabinetManualCovers.create({cache:catalogCoverCache,decode,toUrl:imageSource,disk:preferences.cacheMode==='disk',
        render:(path,options)=>window.OpenCabinetManualPDF.render(path,{imageSource,...options}),
        lookup:(source,mode)=>invoke('cover_cache_entry',{source,cacheDirectory,previewKind:`manual_${mode}`}),
        store:(source,mode,key,bytes)=>invoke('store_cover_thumbnail',{source,cacheDirectory,previewKind:`manual_${mode}`,key,thumbnailBytes:Array.from(bytes)}),
        getManuals:id=>invoke('get_game_manuals',{id}),
        getCoverMode:path=>{try{return JSON.parse(window.localStorage.getItem('opencabinet.manualCoverModes')||'{}')[path]||'auto';}catch{return 'auto';}},
        onError:error=>console.warn('Manual preview cache:',error),
      });
    }
  }
  manualCoverCache?.warm(dreamcastGames.map(game=>game.id));
  root.addEventListener?.('scroll',pauseManualPrefetchForScroll,{passive:true});
  const paths = preferences.cacheMode === "disk" ? [...allGames].sort((a, b) => a.title.localeCompare(b.title)).flatMap(game => {
    return [game, ...(game.regions || []).map(region => region.game)].flatMap(source => {
      const images = gameImages(source);
      return [images.find(image => image.kind === "cover")?.path, images.find(image => image.kind === "box_full")?.path,
        ...(isDreamcastGame(source)?images.filter(image=>image.kind==='inlay').map(image=>image.path):[])].filter(Boolean);
    });
  }) : [];
  return window.OpenCabinetCovers.createLoader(root, catalogCoverCache, { prefetchAll: preferences.cacheMode === "disk", paths });
}

function renderGameLogo(game, images) {
  const container = document.getElementById("details-logo-container");
  const logo = images.find((image) => image.kind === "logo");
  const screenshot = images.find((image) => image.kind === "screenshot");
  const key = JSON.stringify([game.id, game.title, game.platform, logo?.path, screenshot?.path]);
  // Actualizar otros datos del panel no debe reiniciar la animación del logo.
  if (key === logoPanelKey) return;
  logoPanelKey = key;
  // Conservar el mismo botón y sus eventos al renovar el logo y el fondo.
  const editButton = document.getElementById("btn-edit-game");
  const deleteButton = document.getElementById("btn-delete-game");
  const platformEditButton = document.getElementById("btn-edit-platform-details");
  container.replaceChildren();
  if (screenshot) {
    const background = document.createElement("img");
    background.src = imageSource(screenshot.path);
    background.alt = "";
    background.className = "details-logo-background";
    background.setAttribute("aria-hidden", "true");
    background.decoding = "async";
    background.addEventListener("error", () => background.classList.add("hidden"), { once: true });
    container.appendChild(background);
  }
  const foreground = document.createElement("div");
  foreground.className = "details-logo-foreground";
  function showTitle() {
    foreground.replaceChildren();
    const title = document.createElement("span");
    title.className = "details-logo-title";
    title.textContent = game.title;
    const platform = document.createElement("span");
    platform.className = "details-logo-platform";
    platform.textContent = game.platform;
    foreground.append(title, platform);
    foreground.classList.add("logo-enter");
  }
  if (logo) {
    const image = mediaImage(logo.path, globalThis.OpenCabinetI18n.t("msg.628d3d3bc8", game.title), "details-logo-image", showTitle);
    image.loading = "eager";
    image.addEventListener("load", () => foreground.classList.add("logo-enter"), { once: true });
    foreground.appendChild(image);
    if (image.complete && image.naturalWidth > 0) foreground.classList.add("logo-enter");
  } else {
    showTitle();
  }
  container.appendChild(foreground);
  container.appendChild(editButton);
  container.appendChild(deleteButton);
  if (platformEditButton) container.appendChild(platformEditButton);
}

function revealGalleryThumbnail(thumbnails, button) {
  if (!button || !thumbnails?.clientWidth || !button.getBoundingClientRect) return;
  const viewport = thumbnails.getBoundingClientRect();
  const image = button.getBoundingClientRect();
  const left = image.left - viewport.left - thumbnails.clientLeft;
  const right = left + image.width;
  const current = thumbnails.scrollLeft;
  let target = current;
  if (left < 2) target += left - 2;
  else if (right > thumbnails.clientWidth - 2) target += right - thumbnails.clientWidth + 2;
  target = Math.max(0, Math.min(target, thumbnails.scrollWidth - thumbnails.clientWidth));
  if (Math.abs(target - current) > 1) thumbnails.scrollTo({ left: target, behavior: "smooth" });
}

function createFullscreenGallery() {
  const dialog = document.getElementById("fullscreen-gallery");
  const viewer = document.getElementById("fullscreen-gallery-viewer");
  const thumbnails = document.getElementById("fullscreen-gallery-thumbnails");
  const previous = document.getElementById("fullscreen-gallery-previous");
  const next = document.getElementById("fullscreen-gallery-next");
  const fullscreenTarget = document.documentElement;
  let session = null;
  let ownsFullscreen = false;
  let requestedFullscreen = false;
  const nativeFullscreen = window.OpenCabinetWindowFullscreen?.forWindow(window.__TAURI__?.window?.getCurrentWindow?.());
  let nativeLease = null;
  let buttons = [];

  function show(position) {
    if (!session) return;
    session.index = (position + session.images.length) % session.images.length;
    const image = session.images[session.index];
    const kind = (session.game.is_platform ? PLATFORM_IMAGE_TYPES : GAME_IMAGE_TYPES).find(([key]) => key === (image.source_kind || image.kind))?.[1] || globalThis.OpenCabinetI18n.t("msg.58d6f29b06");
    const photo = mediaImage(image.path, `${session.game.title} — ${kind}`);
    photo.loading = "eager";
    viewer.replaceChildren(photo);
    document.getElementById("fullscreen-gallery-caption").textContent = `${kind} · ${session.index + 1} / ${session.images.length}`;
    buttons.forEach((button, i) => button.setAttribute("aria-current", String(i === session.index)));
    revealGalleryThumbnail(thumbnails, buttons[session.index]);
    session.onChange(session.index);
  }

  function renderThumbnails() {
    thumbnails.replaceChildren();
    buttons = session.images.map((image, i) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "gallery-thumbnail";
      const kind = (session.game.is_platform ? PLATFORM_IMAGE_TYPES : GAME_IMAGE_TYPES).find(([key]) => key === (image.source_kind || image.kind))?.[1] || globalThis.OpenCabinetI18n.t("msg.58d6f29b06");
      button.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.8da15ee0c1", kind, i + 1));
      button.appendChild(mediaImage(image.path, ""));
      button.addEventListener("click", () => show(i));
      thumbnails.appendChild(button);
      return button;
    });
    previous.disabled = next.disabled = session.images.length < 2;
  }

  function exitFullscreen() {
    if (document.fullscreenElement === fullscreenTarget) document.exitFullscreen().catch(() => {});
  }
  function close() { if (dialog.open) dialog.close(); }
  document.getElementById("fullscreen-gallery-close").addEventListener("click", close);
  previous.addEventListener("click", () => { if (session) show(session.index - 1); });
  next.addEventListener("click", () => { if (session) show(session.index + 1); });
  dialog.addEventListener("keydown", (event) => {
    if (!session || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    show(event.key === "Home" ? 0 : event.key === "End" ? session.images.length - 1
      : session.index + (event.key === "ArrowLeft" ? -1 : 1));
  });
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => {
    const opener = session?.opener;
    session = null;
    ownsFullscreen = false;
    viewer.replaceChildren();
    thumbnails.replaceChildren();
    buttons = [];
    nativeLease?.release(); nativeLease = null;
    if (requestedFullscreen) exitFullscreen();
    requestedFullscreen = false;
    if (opener?.isConnected) opener.focus();
  });
  document.addEventListener("fullscreenchange", () => {
    if (requestedFullscreen && document.fullscreenElement === fullscreenTarget) ownsFullscreen = true;
    else if (ownsFullscreen) { ownsFullscreen = false; close(); }
  });

  return {
    open(game, images, index, onChange, opener) {
      session = { game, images, index, onChange, opener };
      document.getElementById("fullscreen-gallery-title").textContent = game.title;
      renderThumbnails();
      show(index);
      if (!dialog.open) dialog.showModal();
      revealGalleryThumbnail(thumbnails, buttons[session.index]);
      document.getElementById("fullscreen-gallery-close").focus();
      // Keep the full-window viewer available if native fullscreen is unavailable.
      if (nativeFullscreen) {
        nativeLease ||= nativeFullscreen.acquire(close);
      } else if (fullscreenTarget?.requestFullscreen && !document.fullscreenElement) {
        requestedFullscreen = true;
        try {
          fullscreenTarget.requestFullscreen().then(() => {
            if (!dialog.open) exitFullscreen();
          }).catch(() => {});
        } catch { /* The dialog still fills the application window. */ }
      }
    },
    refresh(game, images, onChange) {
      if (!session || !dialog.open) return;
      if (session.game.id !== game.id || !images.length) { close(); return; }
      const path = session.images[session.index].path;
      session = { ...session, game, images, onChange };
      document.getElementById("fullscreen-gallery-title").textContent = game.title;
      renderThumbnails();
      show(Math.max(0, images.findIndex((image) => image.path === path)));
    },
  };
}

function openFullscreenGallery(game, images, index, onChange, opener) {
  if (!images.length) return;
  fullscreenGallery ??= createFullscreenGallery();
  fullscreenGallery.open(game, images, index, onChange, opener);
}

function createBoxFullscreen(panel, stage, onClose = () => {}) {
  const dialog = document.getElementById("fullscreen-box");
  const content = document.getElementById("fullscreen-box-content");
  const slot = document.getElementById("game-box-slot");
  const target = document.documentElement;
  let expanded = false, requestedFullscreen = false, enteredFullscreen = false;
  const nativeFullscreen = window.OpenCabinetWindowFullscreen?.forWindow(window.__TAURI__?.window?.getCurrentWindow?.());
  let nativeLease = null;
  function exitFullscreen() {
    if (document.fullscreenElement === target) document.exitFullscreen().catch(() => {});
  }
  function restore() {
    if (!expanded || dialog.open) return;
    expanded = false;
    // Move the same viewer back: its rotation, zoom and loaded textures survive.
    slot.appendChild(panel);
    nativeLease?.release(); nativeLease = null;
    if (requestedFullscreen) exitFullscreen();
    requestedFullscreen = enteredFullscreen = false;
    stage.focus({ preventScroll: true });
  }
  function close() { if (expanded || dialog.open) onClose(); if (dialog.open) dialog.close(); restore(); }
  document.getElementById("fullscreen-box-close").addEventListener("click", close);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("close", restore);
  document.addEventListener("fullscreenchange", () => {
    if (requestedFullscreen && document.fullscreenElement === target) enteredFullscreen = true;
    else if (enteredFullscreen) { enteredFullscreen = false; close(); }
  });
  return {
    open(title) {
      if (dialog.open) return;
      expanded = true;
      document.getElementById("fullscreen-box-title").textContent = globalThis.OpenCabinetI18n.t("box.viewer.title", title);
      content.appendChild(panel);
      dialog.showModal();
      stage.focus({ preventScroll: true });
      if (nativeFullscreen) {
        nativeLease ||= nativeFullscreen.acquire(close);
      } else if (target?.requestFullscreen && !document.fullscreenElement) {
        requestedFullscreen = true;
        try {
          target.requestFullscreen().then(() => {
            if (!dialog.open) exitFullscreen();
          }).catch(() => {});
        } catch { /* The dialog still fills the application window. */ }
      }
    },
    close,
  };
}

let boxBrandRequest = 0;
async function refreshBoxBrandImages() {
  const request = ++boxBrandRequest;
  try {
    const marks = await invoke("get_box_brand_images");
    if (request !== boxBrandRequest) return;
    const style = document.documentElement?.style;
    if (!style?.setProperty) return;
    for (const key of ["bluray", "gamecube-logo", "gamecube-mark", "three-ds", "ds", "nintendo", "playstation", "sega", "wii"]) {
      style.setProperty(`--box-brand-${key}`, marks?.[key] ? `url(${JSON.stringify(imageSource(marks[key]))})` : "linear-gradient(transparent, transparent)");
    }
  } catch (error) { console.error("Could not load box markings:", error); }
}

function createDetailsGameBox() {
  void refreshBoxBrandImages();
  const panel = document.getElementById("game-box-panel");
  const photos = document.getElementById("gallery-photos");
  const boxButton = document.getElementById("btn-media-box");
  const photosButton = document.getElementById("btn-media-photos");
  const stage = document.getElementById("game-box-stage");
  const openButton = document.getElementById("btn-box-open");
  const manualControls = document.getElementById("game-box-manual-controls");
  const manualSelect = document.getElementById("game-box-manual-select");
  const manualLabel = document.getElementById("game-box-manual-label");
  const coverPreferenceKey = "opencabinet.manualCoverModes";
  let manualCoverModes = {};
  try {
    const saved = JSON.parse(window.localStorage.getItem(coverPreferenceKey));
    if (saved && typeof saved === "object" && !Array.isArray(saved)) manualCoverModes = saved;
  } catch { /* Missing preferences use automatic detection. */ }
  const manualStatus = document.getElementById("game-box-manual-status");
  const readManualButton = document.getElementById("btn-box-read-manual");
  let manualPath = null, manualPaths = [], manualEligible = false, boxOpen = false;
  let manualState = { status: "none" };
  function manualUI() {
    readManualButton.classList.toggle("hidden", !manualEligible || !boxOpen || manualState.status !== "ready");
    const multiple = manualPaths.length > 1;
    const showStatus = manualState.status === "error";
    manualControls.classList.toggle("hidden", !manualEligible || !boxOpen || (!multiple && !showStatus));
    manualSelect.classList.toggle("hidden", !multiple); manualLabel.classList.toggle("hidden", !multiple);
    manualSelect.disabled = manualState.status === "loading";
    manualStatus.classList.toggle("hidden", !showStatus);
    manualStatus.textContent = manualState.status === "error" ? globalThis.OpenCabinetI18n.t("msg.c97cadcce2")
      : "";
  }
  const manualReader = window.OpenCabinetManualReader?.create({ imageSource, onClose: () => viewer.returnManual?.() });
  const fullscreen = createBoxFullscreen(panel, stage, () => manualReader?.close(false, false));
  const viewer = window.OpenCabinet3D.createViewer(stage, {
    imageSource,
    getCoverPreview: path => catalogCoverCache?.get(path),
    loadCoverPreview: (path, signal) => catalogCoverCache?.load(path, signal),
    onManualCoverChange(mode) {
      if (!manualPath || !["auto", "full", "left", "right"].includes(mode)) return;
      if (mode === "auto") delete manualCoverModes[manualPath];
      else manualCoverModes[manualPath] = mode;
      try { window.localStorage.setItem(coverPreferenceKey, JSON.stringify(manualCoverModes)); }
      catch { /* Keep the choice for this session if storage is unavailable. */ }
      viewer.refreshManual();
    },
    async loadManual(game, signal, onPreview) {
      if (signal.aborted || game.id !== gameId) throw new DOMException(globalThis.OpenCabinetI18n.t("msg.92a2872d72"), "AbortError");
      if(isDreamcastGame(game)) {
        const knownPath=manualCoverCache?.showGamePreview(game.id,{path:manualPath,signal,onPreview});
        if(knownPath)manualPath=knownPath;
      }
      const paths = await invoke("get_game_manuals", { id: game.id });
      if (signal.aborted || game.id !== gameId) throw new DOMException(globalThis.OpenCabinetI18n.t("msg.92a2872d72"), "AbortError");
      if(isDreamcastGame(game))manualCoverCache?.trackGame(game.id,paths);
      manualPaths = paths; manualSelect.replaceChildren();
      paths.forEach(path => {
        const option = document.createElement("option"); option.value = path;
        option.textContent = path.split(/[\\/]/).pop(); manualSelect.appendChild(option);
      });
      if (!paths.includes(manualPath)) manualPath = paths[0] || null;
      manualSelect.value = manualPath || ""; manualUI();
      if (!manualPath) return null;
      if(isDreamcastGame(game)&&manualCoverCache)return manualCoverCache.render(manualPath,{imageSource,signal,coverMode:manualCoverModes[manualPath]||'auto',onPreview});
      return window.OpenCabinetManualPDF.render(manualPath, { imageSource, signal, platform:game.platform, coverMode: manualCoverModes[manualPath] || "auto" });
    },
    onManualState(state) { manualState = state; manualUI(); },
    onManualActivate({ manual, game, origin }) {
      return manualReader?.open(manual, { title: game.title, origin, focusTarget: stage }) ?? false;
    },
    onManualDeactivate() { manualReader?.close(false, false); },
    onOpenState(state) {
      boxOpen = state.open; manualUI();
      openButton.classList.toggle("hidden", !state.canOpen);
      openButton.disabled = !state.canOpen;
      openButton.textContent = state.open ? globalThis.OpenCabinetI18n.t("msg.59810c76a7") : globalThis.OpenCabinetI18n.t("msg.2d3b26a1ab");
      openButton.setAttribute("aria-pressed", String(state.open));
    },
  });
  let gameId = null, gameTitle = "", settingsPlatform = null, boxSettings = null, request = 0;
  function mode(box) {
    if (!box) { manualReader?.close(false, false); fullscreen.close(); }
    panel.classList.toggle("hidden", !box);
    photos.classList.toggle("hidden", box);
    boxButton.setAttribute("aria-pressed", String(box));
    photosButton.setAttribute("aria-pressed", String(!box));
    if (!box) {
      const thumbnails = document.getElementById("gallery-thumbnails");
      revealGalleryThumbnail(thumbnails, thumbnails.querySelector?.('[aria-current="true"]'));
    }
  }
  boxButton.addEventListener("click", () => mode(true));
  photosButton.addEventListener("click", () => mode(false));
  const expand = () => { if (gameId !== null) fullscreen.open(gameTitle); };
  stage.addEventListener("dblclick", event => { if (!event.target?.closest?.('[data-manual-booklet="true"]')) expand(); });
  stage.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); expand(); }
  });
  document.getElementById("btn-box-fullscreen").addEventListener("click", expand);
  document.getElementById("btn-box-reset").addEventListener("click", () => viewer.toggleSide());
  openButton.addEventListener("click", () => viewer.toggleOpen());
  readManualButton.addEventListener("click", () => viewer.readManual?.());
  manualSelect.addEventListener("change", () => { manualPath = manualSelect.value; viewer.refreshManual(); });
  document.getElementById("btn-box-zoom-in").addEventListener("click", () => viewer.zoom(0.15));
  document.getElementById("btn-box-zoom-out").addEventListener("click", () => viewer.zoom(-0.15));
  window.addEventListener("beforeunload", () => { manualReader?.dispose(); fullscreen.close(); viewer.dispose(); }, { once: true });
  return {
    update(game, images) {
      const token = ++request;
      if (game.id !== gameId) { fullscreen.close(); mode(true); gameId = game.id; manualPath = null; manualPaths = []; manualState = { status: "none" }; }
      manualEligible = !!window.OpenCabinetManualPDF?.supportsGame(game);
      gameTitle = game.title;
      document.getElementById("fullscreen-box-title").textContent = globalThis.OpenCabinetI18n.t("box.viewer.title", gameTitle);
      if (settingsPlatform !== game.platform) { settingsPlatform = game.platform; boxSettings = null; }
      viewer.update(game, images, boxSettings);
      const platform = allPlatforms.find(item => item.name.toLowerCase() === game.platform.toLowerCase());
      if (platform) getPlatformDetails(platform).then(details => {
        if (token !== request || gameId !== game.id) return;
        boxSettings = details.box_3d || null;
        viewer.update(game, images, boxSettings);
      }).catch(error => console.error("No se pudo cargar la configuración de la caja 3D:", error));
    },
    refreshManuals() { if(gameId!==null)manualCoverCache?.refresh(gameId);viewer.refreshManual?.(); },
    clear() { ++request; fullscreen.close(); gameId = null; manualPath = null; manualPaths = []; manualEligible = false; manualState = { status: "none" }; settingsPlatform = null; boxSettings = null; viewer.clear(); manualUI(); },
  };
}

function renderGameMedia(game) {
  const firstKind = game.is_platform ? "screenshot" : "cover";
  const images = displayGameImages(game).sort((a, b) => Number(b.kind === firstKind) - Number(a.kind === firstKind));
  renderGameLogo(game, images);
  if (game.is_platform) {
    detailsGameBox?.clear();
    document.getElementById("gallery-photos").classList.remove("hidden");
  } else if (window.OpenCabinet3D) {
    detailsGameBox ??= createDetailsGameBox();
    detailsGameBox.update({ ...regionalGame(game), title: game.title }, images);
  }
  const viewer = document.getElementById("gallery-viewer");
  const thumbnails = document.getElementById("gallery-thumbnails");
  const previous = document.getElementById("gallery-previous");
  const next = document.getElementById("gallery-next");
  thumbnails.replaceChildren();
  if (galleryGameId !== game.id) galleryImagePath = null;
  galleryGameId = game.id;
  let index = Math.max(0, images.findIndex((image) => image.path === galleryImagePath));
  const buttons = [];
  function show(position) {
    viewer.replaceChildren();
    if (images.length === 0) {
      viewer.textContent = game.is_platform ? globalThis.OpenCabinetI18n.t("msg.605a47650f") : globalThis.OpenCabinetI18n.t("msg.da6920a1d3");
      galleryImagePath = null;
      return;
    }
    index = (position + images.length) % images.length;
    const image = images[index];
    galleryImagePath = image.path;
    const kind = (game.is_platform ? PLATFORM_IMAGE_TYPES : GAME_IMAGE_TYPES).find(([key]) => key === (image.source_kind || image.kind))?.[1] || globalThis.OpenCabinetI18n.t("msg.58d6f29b06");
    viewer.appendChild(mediaImage(image.path, `${game.title} — ${kind}`));
    buttons.forEach((button, i) => button.setAttribute("aria-current", String(i === index)));
    revealGalleryThumbnail(thumbnails, buttons[index]);
  }
  images.forEach((image, i) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-thumbnail";
    const kind = (game.is_platform ? PLATFORM_IMAGE_TYPES : GAME_IMAGE_TYPES).find(([key]) => key === (image.source_kind || image.kind))?.[1] || globalThis.OpenCabinetI18n.t("msg.58d6f29b06");
    button.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.8da15ee0c1", kind, i + 1));
    button.appendChild(mediaImage(image.path, ""));
    button.addEventListener("click", () => show(i));
    button.addEventListener("dblclick", () => openFullscreenGallery(game, images, i, show, button));
    buttons.push(button);
    thumbnails.appendChild(button);
  });
  previous.disabled = images.length < 2;
  next.disabled = images.length < 2;
  previous.onclick = () => show(index - 1);
  next.onclick = () => show(index + 1);
  viewer.ondblclick = () => openFullscreenGallery(game, images, index, show, viewer);
  viewer.classList.toggle("can-expand", images.length > 0);
  viewer.title = images.length ? globalThis.OpenCabinetI18n.t("msg.259d135688") : "";
  viewer.setAttribute("aria-label", images.length ? globalThis.OpenCabinetI18n.t("msg.5e941425a2", game.is_platform ? globalThis.OpenCabinetI18n.t("msg.c31db3daed") : globalThis.OpenCabinetI18n.t("msg.fcf3d3a9bf")) : globalThis.OpenCabinetI18n.t("msg.d81a2af610"));
  viewer.onkeydown = (event) => {
    if (images.length && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      openFullscreenGallery(game, images, index, show, viewer);
    }
    if (images.length > 1 && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      show(index + (event.key === "ArrowLeft" ? -1 : 1));
    }
  };
  viewer.tabIndex = 0;
  show(index);
  fullscreenGallery?.refresh(game, images, show);
}

// --- Carga y Renderizado de Juegos ---
function loadInitialLibrary() {
  if (initialLibraryLoad) return initialLibraryLoad;
  libraryLoading = true; libraryLoadError = false;
  renderGames([]);
  initialLibraryLoad = (async () => {
    const [games, emulators, platforms, navigation] = await Promise.allSettled([
      invoke("get_games"), invoke("get_emulators"), invoke("get_platforms"),
      window.OpenCabinetLibrary ? invoke("get_library_navigation") : Promise.resolve(null),
    ]);
    libraryLoading = false;
    libraryLoadError = games.status === "rejected";
    if (!libraryLoadError) allGames = games.value.map(projectRegionalStatistics);
    else console.error("Error al cargar juegos:", games.reason);
    if (emulators.status === "fulfilled") allEmulators = emulators.value;
    else showToast(globalThis.OpenCabinetI18n.t("msg.3d3a82c4a3"), true);
    if (platforms.status === "fulfilled") allPlatforms = platforms.value;
    else showToast(globalThis.OpenCabinetI18n.t("msg.de90ee277b"), true);
    if (navigation.status === "fulfilled" && navigation.value) {
      libraryCategories = navigation.value.categories ?? window.OpenCabinetLibrary.defaults();
      libraryManufacturers = navigation.value.manufacturers;
      libraryGameVariables = navigation.value.game_variables || {};
      libraryPlatformVariables = navigation.value.platform_variables || {};
    } else if (navigation.status === "rejected") showToast(globalThis.OpenCabinetI18n.t("msg.ed0e53a110"), true);
    const categoryButton = document.getElementById("btn-library-categories");
    if (categoryButton) categoryButton.disabled = navigation.status === "rejected";
    populateEmulatorPlatformDropdown(); renderPlatformsTable(); renderEmulatorsTable(allEmulators);
    renderPlatformFilters(); applyLibraryFilters();
  })().finally(() => { initialLibraryLoad = null; });
  return initialLibraryLoad;
}

async function loadGames() {
  try {
    const games = await invoke("get_games");
    allGames = games.map(projectRegionalStatistics);
    libraryLoading = false; libraryLoadError = false;
    renderPlatformFilters();
    applyLibraryFilters();
    void refreshBoxBrandImages();
  } catch (error) {
    console.error("Error al cargar juegos:", error);
    showToast(globalThis.OpenCabinetI18n.t("msg.81b6556ed4"), true);
  }
}

function renderGames(gamesToRender) {
  const gridContainer = document.getElementById("games-grid");
  if (!gridContainer) return;
  const restoreGridFocus = gridContainer.contains?.(document.activeElement);
  gridContainer.setAttribute("aria-busy", String(libraryLoading));
  if (!allGames.length && (libraryLoading || libraryLoadError)) {
    const state = libraryLoading ? "loading" : "error";
    // Keep the existing status node (including the initial HTML) while waiting.
    // Search/filter events must not clear and recreate the loading view.
    if (gridContainer.dataset.libraryState === state) return;
    gridContainer.dataset.libraryState = state;
    gridContainer.innerHTML = `<div class="library-load-status" role="status"><p>${libraryLoading ? globalThis.OpenCabinetI18n.t("msg.daf2f4eb7a") : globalThis.OpenCabinetI18n.t("msg.b4c8c4220a")}</p></div>`;
    if (libraryLoadError && !libraryLoading) {
      const retry = document.createElement("button"); retry.type = "button"; retry.className = "secondary-btn";
      retry.textContent = globalThis.OpenCabinetI18n.t("msg.a9254c5f81"); retry.addEventListener("click", loadInitialLibrary);
      gridContainer.appendChild(retry);
    }
    return;
  }
  delete gridContainer.dataset.libraryState;
  gridContainer.classList.toggle("covers-only", preferences.coversOnly);
  catalogCoverLoader?.dispose();
  catalogCoverLoader = createCatalogCoverLoader(document.getElementById("catalog-scroll"));
  gamesToRender = [...(gamesToRender || [])].sort((a, b) => window.OpenCabinetLibrary
    ? window.OpenCabinetLibrary.compareGames(a, b, libraryGrouping) : a.title.localeCompare(b.title, globalThis.OpenCabinetI18n.locale));
  if (globalThis.OpenCabinetOrder) gamesToRender = globalThis.OpenCabinetOrder.apply(gamesToRender,allGames);
  gridContainer.innerHTML = "";
  visibleGameIds = (gamesToRender || []).map((game) => game.id);
  const visibleIds = new Set(visibleGameIds);
  if (!visibleIds.has(focusedGameId)) focusedGameId = visibleIds.has(selectedGameId) ? selectedGameId : visibleGameIds[0] ?? null;
  selectedGameIds = new Set([...selectedGameIds].filter((id) => visibleIds.has(id)));
  if (!visibleIds.has(selectionAnchorId)) selectionAnchorId = null;
  document.getElementById("game-context-menu").classList.add("hidden");

  if (!gamesToRender || gamesToRender.length === 0) {
    gridContainer.innerHTML = globalThis.OpenCabinetI18n.t("msg.2dbbff99ba", allGames.length ? globalThis.OpenCabinetI18n.t("msg.9d63b1f136") : globalThis.OpenCabinetI18n.t("msg.9ad5b5611c"), allGames.length ? globalThis.OpenCabinetI18n.t("msg.b4b45ef0ca") : globalThis.OpenCabinetI18n.t("msg.eaeee2835b"));
    updateGameSelection();
    return;
  }

  gamesToRender.forEach((game) => {
    const card = document.createElement("div");
    card.className = "game-card";
    card.dataset.gameId = String(game.id);
    card.tabIndex = game.id === focusedGameId ? 0 : -1;
    card.setAttribute("role", "button");
    card.setAttribute("aria-label", `${game.title} — ${game.platform}`);
    card.title = `${game.title} — ${game.platform}`;

    card.innerHTML = `
      <div class="game-cover-wrapper"><div class="game-cover-surface"></div></div>
      <div class="game-info">
        <div class="game-title"></div>
        <div class="game-platform"></div>
      </div>
    `;
    renderGameCover(card.querySelector(".game-cover-surface"), game, "game-cover", "cover-placeholder", catalogCoverLoader);
    const title = card.querySelector(".game-title");
    title.textContent = game.title;
    title.title = game.title;
    card.querySelector(".game-platform").textContent = game.platform;

    card.addEventListener("click", (event) => selectGame(game.id, event));
    card.addEventListener("focus", () => {
      focusedGameId = game.id;
      if (selectionAnchorId === null) selectionAnchorId = game.id;
      document.querySelectorAll(".game-card").forEach(item => { item.tabIndex = Number(item.dataset.gameId) === focusedGameId ? 0 : -1; });
    });
    card.addEventListener("dblclick", (event) => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      return launchGame(game.id, game.title);
    });
    card.addEventListener("keydown", (event) => {
      if (window.OpenCabinetKeyboard?.handleGameKey(event, { card, cards: document.querySelectorAll(".game-card"), window,
        select: selectGame, launch: id => { const game = allGames.find(game => game.id === id); if (game) void launchGame(id, game.title); },
        edit: () => document.getElementById("btn-edit-game").click(), remove: () => { void deleteLibraryGames([...selectedGameIds]); },
        selectAll: () => { selectedGameIds = new Set(visibleGameIds); updateGameSelection(); },
      })) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectGame(game.id, event);
      }
    });

    gridContainer.appendChild(card);
  });

  catalogCoverLoader?.start();
  updateGameSelection();
  if (restoreGridFocus) [...gridContainer.children].find(card => Number(card.dataset.gameId) === focusedGameId)?.focus({ preventScroll: true });
}

function selectGame(id, modifiers = {}) {
  const index = visibleGameIds.indexOf(id);
  if (index === -1) return;
  focusedGameId = id;
  const anchorIndex = visibleGameIds.indexOf(selectionAnchorId);
  const additive = modifiers.ctrlKey || modifiers.metaKey;
  if (modifiers.shiftKey && anchorIndex !== -1) {
    if (!additive) selectedGameIds.clear();
    const start = Math.min(index, anchorIndex);
    const end = Math.max(index, anchorIndex);
    visibleGameIds.slice(start, end + 1).forEach((gameId) => selectedGameIds.add(gameId));
  } else {
    if (additive) {
      if (selectedGameIds.has(id)) selectedGameIds.delete(id);
      else selectedGameIds.add(id);
    } else {
      selectedGameIds = new Set([id]);
    }
    selectionAnchorId = id;
  }
  if (selectedGameIds.has(id)) selectedGameId = id;
  updateGameSelection();
}

function updateGameSelection() {
  document.querySelectorAll(".game-card").forEach((card) => {
    const selected = selectedGameIds.has(Number(card.dataset.gameId));
    card.classList.toggle("selected", selected);
    card.setAttribute("aria-pressed", String(selected));
    card.tabIndex = Number(card.dataset.gameId) === focusedGameId ? 0 : -1;
  });
  const status = document.getElementById("game-selection-status");
  status.textContent = globalThis.OpenCabinetI18n.t("msg.e054c492bc", selectedGameIds.size);
  status.classList.toggle("hidden", selectedGameIds.size < 2);
  if (!selectedGameIds.has(selectedGameId)) {
    selectedGameId = [...selectedGameIds].at(-1) ?? null;
  }
  const active = allGames.find((game) => game.id === selectedGameId);
  if (active) showGameDetails(active);
  else resetGameDetails();
}

// Shared by the context menu and the selected game's sidebar button.
async function deleteLibraryGames(ids) {
  if (deletingGames) return;
  const games = allGames.filter((game) => ids.includes(game.id));
  if (!games.length) return;
  const targetIds = games.map((game) => game.id);
  const single = games.length === 1;
  deletingGames = true;
  try {
    const confirmed = await confirmDeletion(single ? globalThis.OpenCabinetI18n.t("msg.e46db29366") : globalThis.OpenCabinetI18n.t("msg.384fd2c8c6"),
      globalThis.OpenCabinetI18n.t("msg.de7978d868", single ? globalThis.OpenCabinetI18n.t("msg.138fa73e5d", games[0].title) : globalThis.OpenCabinetI18n.t("msg.853f54c89b", games.length)));
    if (!confirmed) return;
    const preserveData = await chooseGameDataRetention();
    if (preserveData === null) return;
    const deleted = await invoke("delete_games", { ids: targetIds, preserveData });
    const removed = new Set(targetIds);
    allGames = allGames.filter((game) => !removed.has(game.id));
    selectedGameIds = new Set([...selectedGameIds].filter((id) => !removed.has(id)));
    if (removed.has(selectionAnchorId)) selectionAnchorId = null;
    renderPlatformFilters();
    applyLibraryFilters();
    showToast(deleted === 1 ? globalThis.OpenCabinetI18n.t("msg.8c71e7d341") : globalThis.OpenCabinetI18n.t("msg.31c9b1c990", deleted));
  } catch (error) {
    showToast(globalThis.OpenCabinetI18n.t("msg.96da899484", single ? globalThis.OpenCabinetI18n.t("msg.71d738408a") : globalThis.OpenCabinetI18n.t("msg.a4dea9fadf"), error), true);
  } finally {
    deletingGames = false;
  }
}

// --- Menú contextual de juegos ---
function setupGameContextMenu() {
  const menu = document.getElementById("game-context-menu");
  const play = document.getElementById("context-play-game");
  const edit = document.getElementById("context-edit-game");
  const history = document.getElementById("context-session-history");
  const openEmulator = document.getElementById("context-open-emulator");
  const remove = document.getElementById("context-delete-games");
  const downloadImages = document.getElementById("context-download-images");
  const mergeDiscs = document.getElementById("context-merge-discs");
  const mergeRegions = document.getElementById("context-merge-regions");
  const imageFolder = document.getElementById("context-open-images");
  const manualFolder = document.getElementById("context-open-manuals");
  const gameFiles = document.getElementById("context-open-game-files");
  let items = [play, edit];
  let targetId = null;
  let targetIds = [];
  let targetCard = null;

  function close(restoreFocus = false) {
    const card = targetCard;
    menu.classList.add("hidden");
    targetId = null;
    targetIds = [];
    targetCard = null;
    if (restoreFocus && card?.isConnected) card.focus();
  }

  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    close();
    const card = event.target.closest(".game-card");
    const game = card && allGames.find((item) => item.id === Number(card.dataset.gameId));
    if (!game) return;
    if (!selectedGameIds.has(game.id)) selectGame(game.id);
    else showGameDetails(game);
    targetId = game.id;
    play.dataset.gameId = String(game.id);
    play.disabled = Boolean(game.is_running);
    targetIds = [...selectedGameIds];
    targetCard = card;
    const multiple = targetIds.length > 1;
    const emulator = !game.launch_directly && !game.steam_app_id && !game.epic_app_id && allEmulators.some(emu =>
      emu.platform.toLowerCase() === game.platform.toLowerCase() && (!game.execution?.emulator_id || emu.id === game.execution.emulator_id));
    openEmulator.classList.toggle("hidden", multiple || !emulator);
    play.classList.toggle("hidden", multiple);
    edit.classList.toggle("hidden", multiple);
    history.classList.toggle('hidden',multiple||!window.OpenCabinetLibraryTools);
    remove.classList.remove("hidden");
    downloadImages.classList.toggle("hidden", !multiple);
    imageFolder.classList.toggle("hidden", multiple);
    manualFolder.classList.toggle("hidden", multiple);
    gameFiles.classList.toggle("hidden", multiple);
    const mergeCandidates = targetIds.map(id => allGames.find(g => g.id === id));
    const canMerge = multiple && mergeCandidates.every(g => g && !g.launch_directly && !g.steam_app_id && !g.epic_app_id && !g.is_running && !launchingGames.has(g.id) && g.platform.toLowerCase() === game.platform.toLowerCase());
    const canMergeDiscs = canMerge && mergeCandidates.every(game => !game.regions?.length);
    mergeDiscs.classList.toggle("hidden", !canMergeDiscs);
    mergeRegions.classList.toggle("hidden", !canMerge);
    items = multiple ? [remove, downloadImages, ...(canMergeDiscs ? [mergeDiscs] : []), ...(canMerge ? [mergeRegions] : [])] : [play, edit, ...(window.OpenCabinetLibraryTools?[history]:[]), ...(emulator ? [openEmulator] : []), gameFiles, imageFolder, manualFolder, remove];
    document.querySelectorAll(".dropdown-menu.show").forEach((dropdown) => dropdown.classList.remove("show"));
    document.querySelectorAll(".menu-item-dropdown.active").forEach((dropdown) => dropdown.classList.remove("active"));
    menu.classList.remove("hidden");
    const bounds = card.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const x = keyboard ? bounds.left : event.clientX;
    const y = keyboard ? bounds.top : event.clientY;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    (items.find(item => !item.disabled) || items[0]).focus({ preventScroll: true });
  }, { capture: true });

  play.addEventListener("click", () => {
    const game = allGames.find((item) => item.id === targetId);
    close(true);
    if (game) launchGame(game.id, game.title);
  });
  history.addEventListener('click',()=>{const id=targetId;close(true);openSessionHistory(id);});
  edit.addEventListener("click", () => {
    const game = allGames.find((item) => item.id === targetId);
    close(true);
    if (game) {
      showGameDetails(game);
      document.getElementById("btn-edit-game").click();
    }
  });
  openEmulator.addEventListener("click", async () => {
    const game = allGames.find(game => game.id === targetId);
    const id = game ? regionalGame(game).id : targetId; close(true); if (id === null) return;
    try { await invoke("open_game_emulator", { id }); }
    catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.bf974dd8d4", error), true); }
  });
  remove.addEventListener("click", async () => {
    if (deletingGames || !targetIds.length) return;
    const ids = [...targetIds];
    close(true);
    await deleteLibraryGames(ids);
  });
  gameFiles.addEventListener("click", async () => {
    const id = targetId; close(true); if (id === null) return;
    try { await invoke("open_game_files", { id }); }
    catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.a18cc956cb", error), true); }
  });
  for (const [button, kind] of [[imageFolder, "images"], [manualFolder, "manuals"]]) {
    button.addEventListener("click", async () => {
      const id = targetId;
      const game = allGames.find(game => game.id === id);
      const sourceId = game ? regionalGame(game).id : id;
      close(true);
      if (id === null) return;
      try { await invoke("open_game_folder", { id:sourceId, kind }); }
      catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.079a669890", error), true); }
    });
  }
  mergeDiscs.addEventListener("click", async () => {
    const games = targetIds.map(id => allGames.find(g => g.id === id)); close(true);
    if (games.length < 2 || games.some(g => !g || g.is_running)) return;
    try {
      const primary = await window.OpenCabinetDiscs.mergeGames(games, invoke);
      if (primary === null) return;
      selectedGameId = primary; selectedGameIds = new Set([primary]); selectionAnchorId = primary;
      platformDetailsCache.clear(); await loadGames();
      const game = allGames.find(g => g.id === primary); if (game) showGameDetails(game);
      showToast(globalThis.OpenCabinetI18n.t("msg.5613c4acd7"));
    } catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.0cda860364", error), true); }
  });
  mergeRegions.addEventListener("click", async () => {
    const games = targetIds.map(id => allGames.find(game => game.id === id)); close(true);
    if (games.length < 2 || games.some(game => !game || game.is_running)) return;
    try {
      const primary = await window.OpenCabinetRegions.mergeGames(games, invoke);
      if (primary === null) return;
      selectedGameId = primary; selectedGameIds = new Set([primary]); selectionAnchorId = primary;
      platformDetailsCache.clear(); await loadGames();
      showToast(globalThis.OpenCabinetI18n.t("msg.2d8ee6524f"));
    } catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.952c09398e", error), true); }
  });
  downloadImages.addEventListener("click", () => {
    if (targetIds.length < 2) return;
    const ids = [...targetIds];
    close(true);
    bulkImageDownloader ??= createBulkImageDownloader();
    bulkImageDownloader.open(ids);
  });
  document.getElementById("btn-delete-game").addEventListener("click", () => {
    if (selectedGameId !== null) return deleteLibraryGames([selectedGameId]);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!menu.contains(event.target)) close();
  }, { capture: true });
  document.addEventListener("keydown", (event) => {
    if (menu.classList.contains("hidden")) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close(true);
    } else if (event.key === "Tab") {
      close(true);
    } else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const enabled = items.filter(item => !item.disabled);
      const current = enabled.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? enabled.length - 1
        : (current + (event.key === "ArrowUp" ? -1 : 1) + enabled.length) % enabled.length;
      enabled[next]?.focus();
    }
  });
  document.addEventListener("scroll", (event) => {
    if (!menu.contains(event.target)) close();
  }, { capture: true });
  window.addEventListener("resize", () => close());
  window.addEventListener("blur", () => close());
}

function setupPlatformContextMenu() {
  const menu = document.getElementById("platform-context-menu");
  const edit = document.getElementById("context-edit-platform");
  const findNew=document.getElementById('context-find-new-games');
  findNew.addEventListener('click',()=>{const platform=allPlatforms.find(item=>item.id===target);close(true);if(platform)void startSavedFolderScan(platform);});
  let target = null, opener = null;
  function close(restoreFocus = false) {
    const button = opener;
    menu.classList.add("hidden"); target = null; opener = null;
    if (restoreFocus && button?.isConnected) button.focus();
  }
  document.addEventListener("contextmenu", (event) => {
    close();
    const button = event.target.closest(".platform-filter");
    if (button?.dataset.platform === undefined) return;
    const platform = allPlatforms.find(item => item.name.toLowerCase() === button.dataset.platform.toLowerCase());
    if (!platform || platform.id == null) return;
    event.preventDefault(); target = platform.id; opener = button;
    document.querySelectorAll(".dropdown-menu.show").forEach(item => item.classList.remove("show"));
    document.querySelectorAll(".menu-item-dropdown.active").forEach(item => item.classList.remove("active"));
    menu.classList.remove("hidden");
    const bounds = button.getBoundingClientRect();
    const keyboard = event.clientX === 0 && event.clientY === 0;
    const x = keyboard ? bounds.left : event.clientX, y = keyboard ? bounds.top : event.clientY;
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`;
    edit.focus({ preventScroll: true });
  }, { capture: true });
  edit.addEventListener("click", () => {
    const platform = allPlatforms.find(item => item.id === target);
    close(true);
    if (platform) return openPlatformDetailsEditor(platform);
  });
  document.addEventListener("pointerdown", event => { if (!menu.contains(event.target)) close(); }, { capture: true });
  document.addEventListener("keydown", event => {
    if (menu.classList.contains("hidden")) return;
    if (event.key === "Escape") { event.preventDefault(); close(true); }
    else if (event.key === "Tab") close();
    else if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) {
      event.preventDefault();const items=window.OpenCabinetLibraryTools?[edit,findNew]:[edit],index=items.indexOf(document.activeElement);
      const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length;items[next].focus();
    }
  });
  document.addEventListener("scroll", event => { if (!menu.contains(event.target)) close(); }, { capture: true });
  window.addEventListener("resize", () => close());
  window.addEventListener("blur", () => close());
}

function createBulkImageDownloader() {
  const dialog = document.getElementById("bulk-images-dialog");
  const form = document.getElementById("bulk-images-form");
  const optionsBox = document.getElementById("bulk-images-options");
  const message = document.getElementById("bulk-images-message");
  const results = document.getElementById("bulk-images-results");
  const progress = document.getElementById("bulk-images-progress");
  const label = document.getElementById("bulk-images-progress-label");
  const bar = document.getElementById("bulk-images-progress-bar");
  const submit = document.getElementById("btn-download-bulk-images");
  const cancel = document.getElementById("btn-cancel-bulk-images");
  const downloadAll = document.getElementById("bulk-images-download-all");
  const minimizeButton = document.getElementById("btn-minimize-bulk-images");
  const card = document.getElementById("bulk-images-task");
  const taskTitle = document.getElementById("bulk-images-task-title");
  const taskLabel = document.getElementById("bulk-images-task-label");
  const taskBar = document.getElementById("bulk-images-task-bar");
  const taskCancel = document.getElementById("btn-bulk-images-task-cancel");
  const taskDismiss = document.getElementById("btn-bulk-images-task-dismiss");
  const floating = window.OpenCabinetTaskWindows?.attach(card);
  let detached = false, activity = "analysis", indeterminate = true;
  let taskHeading = globalThis.OpenCabinetI18n.t("msg.488a8c208f"), progressVersion = 0;
  const quantities = new Map();
  const typeChoices = new Map();
  let typesReady = false;
  let ids = [], busy = false, cancelling = false, jobId = null, ending = null;

  function syncTask() {
    taskTitle.textContent = busy ? (activity === "analysis" ? globalThis.OpenCabinetI18n.t("msg.98a8680784") : globalThis.OpenCabinetI18n.t("msg.d371948cb7")) : taskHeading;
    taskLabel.textContent = busy ? label.textContent : message.textContent;
    if (busy && indeterminate) taskBar.removeAttribute("value");
    else taskBar.value = busy ? bar.value : 100;
    taskCancel.classList.toggle("hidden", !busy); taskCancel.disabled = cancelling;
    taskDismiss.classList.toggle("hidden", busy);
    if (detached) { if (floating) floating.show(); else card.classList.remove("hidden"); }
    else { if (floating) floating.hide(); else card.classList.add("hidden"); }
  }
  function minimize() {
    if (!busy || cancelling) return;
    detached = true; dialog.close(); syncTask();
  }
  function restore() {
    if (dialog.open) return;
    dialog.showModal(); detached = false; syncTask();
  }
  function dismiss() { return busy ? minimize() : close(); }
  minimizeButton.addEventListener("click", minimize);
  document.getElementById("btn-bulk-images-task-restore").addEventListener("click", restore);
  taskCancel.addEventListener("click", () => close());
  taskDismiss.addEventListener("click", () => close());
  setupModalBackdropClose(dialog, dismiss);

  function controls() {
    quantities.forEach((input) => { input.disabled = busy; });
    downloadAll.disabled = busy;
    minimizeButton.classList.toggle("hidden", !busy); minimizeButton.disabled = cancelling;
    submit.disabled = busy || (typesReady && !quantities.size);
    submit.textContent = typesReady ? globalThis.OpenCabinetI18n.t("msg.488a8c208f") : globalThis.OpenCabinetI18n.t("msg.c63c878c20");
    cancel.disabled = cancelling;
    cancel.textContent = busy ? (cancelling ? globalThis.OpenCabinetI18n.t("msg.c5b0af9a5e") : globalThis.OpenCabinetI18n.t("msg.bc3ae00362")) : globalThis.OpenCabinetI18n.t("msg.aeccae342e");
    document.getElementById("btn-close-bulk-images").disabled = cancelling;
    syncTask();
  }
  function endSession() {
    if (!jobId) return Promise.resolve();
    ending ??= invoke("end_metadata_import", { jobId });
    return ending;
  }
  function close() {
    if (!busy) {
      busy = true; cancelling = true; controls();
      return endSession().then(() => { jobId = null; ending = null; detached = false; dialog.close(); })
        .catch(reason => { message.textContent = globalThis.OpenCabinetI18n.t("msg.8eaa478b04") + reason; ending = null; })
        .finally(() => { busy = false; cancelling = false; controls(); });
    }
    cancelling = true; controls();
    label.textContent = globalThis.OpenCabinetI18n.t("msg.0e62f4f5d1");
    syncTask();
    endSession().catch((reason) => { message.textContent = globalThis.OpenCabinetI18n.t("msg.0afb96bdd7", reason); });
  }
  cancel.addEventListener("click", close);
  document.getElementById("btn-close-bulk-images").addEventListener("click", dismiss);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); dismiss(); });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (busy) return;
    if (!typesReady) return analyze();
    const options = selectedImageTypes(quantities, document.getElementById("bulk-images-download-all").checked);
    if (!options.selected_types.length) { message.textContent = globalThis.OpenCabinetI18n.t("msg.c2af09131f"); return; }
    busy = true; cancelling = false; ending = null; activity = "download"; indeterminate = true;
    const version = ++progressVersion;
    results.replaceChildren(); message.textContent = "";
    progress.classList.remove("hidden"); bar.removeAttribute("value");
    label.textContent = globalThis.OpenCabinetI18n.t("msg.d96db638b7"); controls();
    try {
      if (!jobId) {
        const first = findGameSource(ids[0]);
        const session = await invoke("start_metadata_import", { platform: first?.platform || "" });
        jobId = session.job_id;
      }
      if (cancelling) { await endSession(); message.textContent = globalThis.OpenCabinetI18n.t("msg.4841c3b735"); return; }
      const onProgress = new window.__TAURI__.core.Channel();
      let currentGame = "", processed = 0;
      onProgress.onmessage = (update) => {
        if (!busy || cancelling || version !== progressVersion || update.job_id !== jobId) return;
        if (update.phase === "bulk_images") {
          processed = update.processed;
          if (update.current_file) currentGame = update.current_file;
          bar.value = update.total ? Math.round(processed / update.total * 100) : 0;
          indeterminate = false;
          label.textContent = globalThis.OpenCabinetI18n.t("msg.5316875d36", processed, ids.length, update.current_file ? ` · ${currentGame}` : "");
        } else if (update.phase === "images") {
          label.textContent = globalThis.OpenCabinetI18n.t("msg.9e48619668", processed, ids.length, currentGame, update.processed);
        } else {
          label.textContent = update.phase === "catalog" ? globalThis.OpenCabinetI18n.t("msg.ee6f83e7f6") : globalThis.OpenCabinetI18n.t("msg.8b34d77997");
          if (update.total) bar.value = Math.round(update.processed / update.total * 100);
          else bar.removeAttribute("value");
          indeterminate = !update.total;
        }
        syncTask();
      };
      const report = await invoke("download_bulk_game_images", { jobId, ids: [...ids], options, onProgress });
      report.results.forEach((result) => {
        const item = document.createElement("li");
        item.textContent = globalThis.OpenCabinetI18n.t("msg.cd0edaa1ae", result.title, result.added, result.message ? ` ${result.message}` : "");
        results.appendChild(item);
      });
      message.textContent = globalThis.OpenCabinetI18n.t("msg.a0db25cc72", report.cancelled || cancelling ? globalThis.OpenCabinetI18n.t("msg.4841c3b735") : globalThis.OpenCabinetI18n.t("msg.9b5e7bb2bb"), report.image_count, report.results.length, ids.length);
    } catch (reason) {
      message.textContent = cancelling ? globalThis.OpenCabinetI18n.t("msg.0d8486a166")
        : globalThis.OpenCabinetI18n.t("msg.99ba6f823d", reason);
    } finally {
      try { await endSession(); }
      catch (reason) { message.textContent += globalThis.OpenCabinetI18n.t("msg.96c584050a", reason); }
      jobId = null; ending = null;
      // Refresh from the database even if a later game failed or was cancelled.
      await loadGames();
      busy = false; cancelling = false; controls();
      progress.classList.add("hidden");
      taskHeading = globalThis.OpenCabinetI18n.t("msg.412098c3a9"); syncTask();
    }
  });
  async function analyze() {
    if (busy) return;
    busy = true; cancelling = false; typesReady = false; ending = null; activity = "analysis"; indeterminate = true;
    const version = ++progressVersion;
    renderImageTypeChoices(optionsBox, {}, quantities, typeChoices);
    optionsBox.textContent = globalThis.OpenCabinetI18n.t("msg.57d1e9615b");
    progress.classList.remove("hidden"); bar.removeAttribute("value"); label.textContent = globalThis.OpenCabinetI18n.t("msg.57d1e9615b"); controls();
    try {
      if (!jobId) {
        const first = findGameSource(ids[0]);
        const session = await invoke("start_metadata_import", { platform: first?.platform || "" });
        jobId = session.job_id;
      }
      if (cancelling) { await endSession(); return; }
      const onProgress = new window.__TAURI__.core.Channel();
      onProgress.onmessage = (update) => {
        if (!busy || cancelling || version !== progressVersion || update.job_id !== jobId) return;
        label.textContent = update.phase === "availability" ? globalThis.OpenCabinetI18n.t("msg.4a6486c168") + update.processed + globalThis.OpenCabinetI18n.t("msg.553c27d45c") + update.total
          : globalThis.OpenCabinetI18n.t("msg.8b34d77997");
        if (update.total) bar.value = Math.round(update.processed / update.total * 100);
        indeterminate = !update.total; syncTask();
      };
      const available = await invoke("get_metadata_image_types", { jobId, gameIds: [...ids], sourceIds: null, onProgress });
      if (cancelling) return;
      renderImageTypeChoices(optionsBox, available.counts, quantities, typeChoices);
      typesReady = true;
      message.textContent = available.skipped_games ? available.skipped_games + globalThis.OpenCabinetI18n.t("msg.c4d4fb9f01")
        : quantities.size ? globalThis.OpenCabinetI18n.t("msg.77ee89985f") : globalThis.OpenCabinetI18n.t("msg.62fdcbcf70");
    } catch (reason) {
      if (!cancelling) message.textContent = globalThis.OpenCabinetI18n.t("msg.e218c1c80d") + reason + ". Puedes reintentar.";
      await endSession().catch(() => {}); jobId = null; ending = null;
    } finally {
      if (cancelling) {
        await endSession().catch(() => {}); jobId = null; ending = null;
        message.textContent = globalThis.OpenCabinetI18n.t("msg.3b556a072c"); optionsBox.replaceChildren();
      }
      busy = false; cancelling = false; progress.classList.add("hidden"); controls();
      taskHeading = typesReady ? globalThis.OpenCabinetI18n.t("msg.c6ef0933c8") : globalThis.OpenCabinetI18n.t("msg.6adf9d42a8"); syncTask();
    }
  }
  return {
    open(gameIds) {
      if (busy || dialog.open || detached) { if (detached) restore(); return; }
      ids = gameIds.map(id => regionalGame(allGames.find(game => game.id === id)).id); quantities.clear(); typeChoices.clear(); optionsBox.replaceChildren(); typesReady = false;
      downloadAll.checked = false; detached = false; ++progressVersion;
      document.getElementById("bulk-images-selection").textContent = globalThis.OpenCabinetI18n.t("msg.e054c492bc", ids.length);
      results.replaceChildren(); message.textContent = ""; progress.classList.add("hidden"); controls();
      dialog.showModal();
      return analyze();
    },
  };
}

// --- Panel Lateral de Información del Juego ---
function renderGameCover(container, game, imageClass, placeholderClass, loader = null) {
  container.replaceChildren();
  container.classList.remove("has-cover");
  container.style.setProperty("--cover-ratio", String(2 / 3));
  const path = displayGameImages(game).find((image) => image.kind === "cover")?.path;
  if (path) {
    if (loader) loader.observe(container, path, game.title, imageClass);
    else {
      const image = mediaImage(path, game.title, imageClass);
      const fitCover = () => {
        if (image.naturalWidth > 0 && image.naturalHeight > 0) {
          container.style.setProperty("--cover-ratio", String(image.naturalWidth / image.naturalHeight));
          container.classList.add("has-cover");
        }
      };
      image.addEventListener("load", fitCover, { once: true });
      if (image.complete) fitCover();
      container.appendChild(image);
    }
  } else {
    const cover = document.createElement("div");
    cover.className = placeholderClass;
    cover.textContent = game.platform;
    const title = document.createElement("span");
    title.style.fontSize = "0.8rem";
    title.style.color = "var(--text-muted)";
    title.textContent = game.title;
    cover.append(document.createElement("br"), title);
    container.appendChild(cover);
  }
}

function formatLastPlayed(value) {
  if (!value) return globalThis.OpenCabinetI18n.t("msg.12fcd0c7b7");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(globalThis.OpenCabinetI18n.locale, {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: preferences.timeFormat === "12h" ? "h12" : "h23",
  }).formatToParts(date).map((part) => part.type === "dayPeriod"
    ? (date.getHours() < 12 ? "AM" : "PM") : part.value).join("");
}

function formatPlayTime(game) {
  const seconds = Math.max(0, Math.floor(game.play_time_seconds ?? (game.play_time || 0) * 60));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor(seconds % 86400 / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  let time;
  const t = globalThis.OpenCabinetI18n.t;
  const parts = [];
  if (days) parts.push(t("time.days", days));
  if (hours) parts.push(t("time.hours", hours));
  if (minutes) parts.push(t("time.minutes", minutes));
  time = parts.length ? parts.join(" ") : seconds ? t("time.seconds", seconds) : t("time.minutes", 0);
  return t("time.sessions", time, game.session_count || 0);
}

function updatePlayStatus(game) {
  const time = document.getElementById("details-play-time");
  time.textContent = formatPlayTime(game);
  time.title = globalThis.OpenCabinetI18n.t("msg.5eb694af2a", game.session_count || 0, game.is_running ? globalThis.OpenCabinetI18n.t("msg.1c07d89d05") : "");
  const play = document.getElementById("btn-play-game");
  const availability = selectedFileAvailability?.id === game.id ? selectedFileAvailability : null;
  const unavailable = availability?.available === false;
  play.disabled = Boolean(game.is_running) || launchingGames.has(game.id);
  play.classList?.toggle('missing-source',unavailable);
  const history=document.getElementById('btn-session-history');
  history.onclick=()=>openSessionHistory(game.id);
  play.innerHTML = game.is_running
    ? globalThis.OpenCabinetI18n.t("msg.cd7fe1c80d")
    : unavailable ? globalThis.OpenCabinetI18n.t("availability.missing")
    : launchingGames.has(game.id) ? '<span class="play-icon-shape">▶</span> INICIANDO...'
    : globalThis.OpenCabinetI18n.t("msg.aa6ae9fe63");
  play.title = unavailable ? globalThis.OpenCabinetI18n.t('library.replaceSource')+'\n'+(availability.missing_paths?.join("\n") || globalThis.OpenCabinetI18n.t("availability.missing")) : "";
}

async function checkSelectedGameFiles(game) {
  const request = ++fileAvailabilityRequest;
  selectedFileAvailability = { id: game.id, available: null };
  updatePlayStatus(game);
  try {
    const result = await invoke("get_game_availability", { gameId: game.id });
    if (request !== fileAvailabilityRequest || selectedGameId !== game.id) return;
    selectedFileAvailability = { id: game.id, ...result };
  } catch (error) {
    if (request !== fileAvailabilityRequest || selectedGameId !== game.id) return;
    selectedFileAvailability = null;
    console.error("File availability check failed", error);
  }
  if (selectedGameId === game.id) updatePlayStatus(game);
}

function playStatisticsSnapshot(game) {
  return { play_time_seconds: game.play_time_seconds || 0, session_count: game.session_count || 0,
    last_played: game.last_played, is_running: game.is_running };
}

function projectRegionalStatistics(game) {
  if (!game.regions?.length) return game;
  game.combined_statistics ??= playStatisticsSnapshot(game);
  const visible = preferences.combineRegionStatistics ? game.combined_statistics : regionalGame(game);
  game.play_time_seconds = visible.play_time_seconds || 0;
  game.play_time = Math.floor(game.play_time_seconds / 60);
  game.session_count = visible.session_count || 0;
  game.last_played = visible.last_played;
  // A running edition must block launching the entire group in either display mode.
  game.is_running = game.combined_statistics.is_running;
  return game;
}

function applyPlayStatistics(stats) {
  const game = allGames.find((item) => item.id === stats.id);
  if (!game) return;
  // Un proceso muy breve puede finalizar antes de que llegue la respuesta de Jugar.
  const combined = game.combined_statistics || game;
  if ((combined.session_count || 0) > stats.session_count) return;
  if (combined.session_count === stats.session_count && (combined.play_time_seconds || 0) > stats.play_time_seconds) return;
  if (stats.is_running && game.finished_session === stats.session_count) return;
  const previousGroup = window.OpenCabinetLibrary && ["hours", "sessions"].includes(libraryGrouping)
    ? window.OpenCabinetLibrary.values(game, libraryGrouping)[0] : null;
  game.play_time_seconds = stats.play_time_seconds;
  game.play_time = Math.floor(stats.play_time_seconds / 60);
  game.session_count = stats.session_count;
  game.last_played = stats.last_played;
  game.is_running = stats.is_running;
  if (game.regions?.length) {
    game.combined_statistics = playStatisticsSnapshot(stats);
    for (const regionalStats of stats.region_statistics || []) {
      const region = game.regions.find(item => item.game.id === regionalStats.id);
      if (region) Object.assign(region.game, playStatisticsSnapshot(regionalStats), {
        play_time: Math.floor(regionalStats.play_time_seconds / 60),
      });
    }
    projectRegionalStatistics(game);
  }
  if (!stats.is_running) game.finished_session = stats.session_count;
  if (selectedGameId === game.id) {
    updatePlayStatus(game);
    document.getElementById("details-last-played").textContent = formatLastPlayed(game.last_played);
  }
  if (selectedGameId === null && selectedPlatform !== null) updatePlatformStatistics();
  if (previousGroup !== null && previousGroup !== window.OpenCabinetLibrary.values(game, libraryGrouping)[0]) {
    renderPlatformFilters(); applyLibraryFilters();
  }
  const contextPlay = document.getElementById("context-play-game");
  if (Number(contextPlay.dataset.gameId) === game.id) contextPlay.disabled = Boolean(game.is_running);
}

async function setupPlayStatistics() {
  try {
    const unlisten = await window.__TAURI__.event.listen("play-statistics-updated", ({ payload }) => applyPlayStatistics(payload));
    if(window.OpenCabinetLibraryTools){
      const stop=await window.__TAURI__.event.listen('launch-diagnostic',({payload})=>getLibraryTools()?.diagnostic(payload.message));
      window.addEventListener('beforeunload',stop,{once:true});
    }
    window.addEventListener("beforeunload", unlisten, { once: true });
  } catch (error) {
    console.error("No se pudieron activar las actualizaciones de tiempo de juego:", error);
  }
}

function showGameDetails(game) {
  ++platformDetailsRequest;
  selectedGameId = game.id;
  const placeholder = document.getElementById("details-placeholder");
  const content = document.getElementById("details-content");
  if (!placeholder || !content) return;

  placeholder.classList.add("hidden");
  content.classList.remove("hidden");
  content.classList.remove("platform-details");
  const publisherLabel = document.getElementById("details-publisher-label");
  if (publisherLabel) publisherLabel.textContent = globalThis.OpenCabinetI18n.t("msg.936a161c39");

  renderGameMedia(game);

  const titleEl = document.getElementById("details-title");
  if (titleEl) titleEl.textContent = game.title;

  const platformEl = document.getElementById("details-platform");
  if (platformEl) platformEl.textContent = game.platform;

  const playBtn = document.getElementById("btn-play-game");
  if (playBtn) {
    playBtn.onclick = () => {
      if(selectedFileAvailability?.id===game.id&&selectedFileAvailability.available===false)void relocateGame(game);
      else launchGame(game.id, game.title);
    };
  }

  const releaseDateEl = document.getElementById("details-release-date");
  if (releaseDateEl) releaseDateEl.textContent = game.release_date || "-";

  const developerEl = document.getElementById("details-developer");
  if (developerEl) developerEl.textContent = game.developer || "-";

  const publisherEl = document.getElementById("details-publisher");
  if (publisherEl) publisherEl.textContent = game.publisher || "-";
  document.getElementById("details-genre").textContent = game.genre || "-";
  document.getElementById("details-game-mode").textContent = globalThis.OpenCabinetI18n.gameMode(game.game_mode) || "-";
  const romFile = document.getElementById("details-rom-file");
  const sourcePath = regionalGame(game).rom_path;
  romFile.textContent = game.steam_app_id ? `Steam · AppID ${game.steam_app_id}` : game.epic_app_id ? `Epic Games · ${game.epic_app_id}` : sourcePath?.split(/[\\/]/).pop() || "-";
  romFile.title = sourcePath || "";
  document.getElementById("details-last-played").textContent = formatLastPlayed(game.last_played);
  document.getElementById("details-max-players").textContent = game.max_players == null ? "-" : String(game.max_players);
  document.getElementById("details-description").textContent = game.description || globalThis.OpenCabinetI18n.t("msg.591e5cef97");

  updatePlayStatus(game);
  void checkSelectedGameFiles(game);
}

function resetGameDetails() {
  ++fileAvailabilityRequest; selectedFileAvailability = null;
  selectedGameId = null;
  logoPanelKey = null;
  detailsGameBox?.clear();
  if (selectedPlatform !== null && window.OpenCabinetPlatforms) {
    showPlatformDetails();
    return;
  }
  ++platformDetailsRequest;
  const placeholder = document.getElementById("details-placeholder");
  const content = document.getElementById("details-content");
  if (placeholder && content) {
    placeholder.classList.remove("hidden");
    content.classList.add("hidden");
  }
}

function getPlatformDetails(platform) {
  if (platform.id == null) return Promise.resolve({ images: [] });
  if (!platformDetailsCache.has(platform.id)) {
    const pending = invoke("get_platform_details", { platformId: platform.id }).catch((error) => {
      platformDetailsCache.delete(platform.id); throw error;
    });
    platformDetailsCache.set(platform.id, pending);
  }
  return platformDetailsCache.get(platform.id);
}

function platformSummary() {
  return window.OpenCabinetPlatforms.summarize(allGames, allEmulators, selectedPlatform);
}

function updatePlatformStatistics() {
  if (selectedGameId !== null || selectedPlatform === null || !window.OpenCabinetPlatforms) return;
  const stats = platformSummary();
  const text = (id, value) => { document.getElementById(id).textContent = value; };
  text("platform-total-games", String(stats.games.length));
  text("platform-default-emulator", stats.games.length && stats.games.every(game => game.steam_app_id) ? "Steam" : stats.games.length && stats.games.every(game => game.epic_app_id) ? "Epic Games" : stats.games.length && stats.games.every(game => game.launch_directly) ? globalThis.OpenCabinetI18n.t("msg.13bc07f324") : stats.emulator?.name || globalThis.OpenCabinetI18n.t("msg.8cbe82eda0"));
  text("platform-last-game", stats.last?.title || globalThis.OpenCabinetI18n.t("msg.12fcd0c7b7"));
  text("platform-last-played", formatLastPlayed(stats.last?.last_played));
  text("platform-sessions", String(stats.session_count));
  text("platform-total-time", formatPlayTime(stats));
  text("details-play-time", formatPlayTime(stats));
  text("platform-most-game", stats.most?.title || globalThis.OpenCabinetI18n.t("msg.12fcd0c7b7"));
  document.getElementById("details-play-time").title = globalThis.OpenCabinetI18n.t("msg.c8b271fbd2", stats.session_count);
  function card(button, label, game, icon) {
    const images = game ? displayGameImages(game) : [];
    const cover = images.find((image) => image.kind === "cover")?.path
      || images.find((image) => image.kind === "screenshot")?.path || images[0]?.path;
    const key = JSON.stringify([label, game?.id, game?.title, cover]);
    if (button.dataset.previewKey === key) return;
    button.dataset.previewKey = key;
    const photo = document.createElement("span"); photo.className = "platform-action-image";
    photo.textContent = icon;
    if (cover) {
      const image = mediaImage(cover, game.title, "", () => { photo.textContent = icon; });
      photo.replaceChildren(image);
    }
    const heading = document.createElement("span"); heading.textContent = label;
    const title = document.createElement("span"); title.className = "platform-action-title";
    title.textContent = game?.title || (icon === "🎲" ? globalThis.OpenCabinetI18n.t("msg.ee97928539") : globalThis.OpenCabinetI18n.t("msg.66bb9c8fc1"));
    button.replaceChildren(photo, heading, title);
  }
  function play(buttonId, game) {
    const button = document.getElementById(buttonId);
    card(button, buttonId === "btn-platform-last" ? globalThis.OpenCabinetI18n.t("msg.a5ffee78e2") : globalThis.OpenCabinetI18n.t("msg.a08ca15e2a"), game, "🎮");
    button.disabled = !stats.emulator || !game || Boolean(game.is_running) || launchingGames.has(game.id);
    button.title = !stats.emulator ? globalThis.OpenCabinetI18n.t("msg.1e68f8e6a6") : game?.title || globalThis.OpenCabinetI18n.t("msg.1ce4a0897e");
    button.onclick = () => { if (game) return launchGame(game.id, game.title); };
  }
  play("btn-platform-last", stats.last);
  play("btn-platform-most", stats.most);
  const random = document.getElementById("btn-platform-random");
  card(random, globalThis.OpenCabinetI18n.t("msg.8138cb323b"), null, "🎲");
  const available = stats.games.filter((game) => !game.is_running && !launchingGames.has(game.id));
  random.disabled = !stats.emulator || available.length === 0;
  random.title = !stats.emulator ? globalThis.OpenCabinetI18n.t("msg.1e68f8e6a6") : globalThis.OpenCabinetI18n.t("msg.d3abd0dd48");
  random.onclick = () => {
    const candidates = platformSummary().games.filter((game) => !game.is_running && !launchingGames.has(game.id));
    const game = candidates[Math.floor(Math.random() * candidates.length)];
    if (game) return launchGame(game.id, game.title);
  };
}

async function showPlatformDetails() {
  const token = ++platformDetailsRequest;
  const name = selectedPlatform;
  const platform = allPlatforms.find((item) => item.name.toLowerCase() === name.toLowerCase()) || { name };
  const content = document.getElementById("details-content");
  document.getElementById("details-placeholder").classList.add("hidden");
  content.classList.remove("hidden"); content.classList.add("platform-details");
  document.getElementById("details-title").textContent = name;
  document.getElementById("details-publisher-label").textContent = globalThis.OpenCabinetI18n.t("msg.b79530ac7c");
  const edit = document.getElementById("btn-edit-platform-details");
  edit.disabled = platform.id == null;
  edit.onclick = () => openPlatformDetailsEditor(platform);
  function display(details) {
    document.getElementById("details-release-date").textContent = details.release_date || "-";
    document.getElementById("details-developer").textContent = details.developer || "-";
    document.getElementById("details-publisher").textContent = details.manufacturer || "-";
    renderGameMedia({ id: `platform:${platform.id ?? name}`, title: name, platform: globalThis.OpenCabinetI18n.t("msg.e0236ea3bc"), images: details.images || [], is_platform: true });
  }
  display({}); updatePlatformStatistics();
  try {
    const details = await getPlatformDetails(platform);
    if (token === platformDetailsRequest && selectedGameId === null && selectedPlatform === name) display(details);
  } catch (error) {
    if (token === platformDetailsRequest) showToast(globalThis.OpenCabinetI18n.t("msg.5d6537cf1e", error), true);
  }
}

function openPlatformDetailsEditor(platform) {
  platformDetailsEditor ??= createPlatformDetailsEditor();
  return platformDetailsEditor.open(platform);
}

function createPlatformDetailsEditor() {
  const dialog = document.getElementById("platform-details-dialog");
  const form = document.getElementById("platform-details-form");
  const list = document.getElementById("platform-image-list");
  const error = document.getElementById("platform-editor-error");
  const add = document.getElementById("btn-add-platform-images");
  const save = document.getElementById("btn-save-platform-details");
  const kind = document.getElementById("platform-image-kind");
  const defaultEmulator = document.getElementById("platform-default-emulator-select");
  const boxSettings = window.OpenCabinetBoxSettings?.createEditor({ imageSource });
  const variablesEditor = window.OpenCabinetVariables?.createEditor(document.getElementById("platform-variables-editor"), document, { getNames: libraryVariableNames });
  const platformTabs = ["details","boxes","images","variables","folders"].map(name => ({ name,
    tab: document.getElementById(`platform-edit-tab-${name}`), panel: document.getElementById(`platform-edit-panel-${name}`) }));
  function showPlatformTab(name, focus = false) {
    document.getElementById("platform-editor-panels").scrollTop = 0;
    platformTabs.forEach(item => {
      const active = item.name === name; item.tab.setAttribute("aria-selected",String(active)); item.tab.tabIndex=active?0:-1;
      item.panel.classList.toggle("hidden",!active); if(active && focus)item.tab.focus();
    });
    document.getElementById("platform-box-settings").open = name === "boxes";
  }
  platformTabs.forEach((item,index) => {
    item.tab.addEventListener("click",()=>showPlatformTab(item.name));
    item.tab.addEventListener("keydown",event=>{
      let next;
      if(event.key==="ArrowDown")next=platformTabs[(index+1)%platformTabs.length];
      if(event.key==="ArrowUp")next=platformTabs[(index+platformTabs.length-1)%platformTabs.length];
      if(event.key==="Home")next=platformTabs[0];if(event.key==="End")next=platformTabs.at(-1);
      if(next && !next.tab.disabled){event.preventDefault();showPlatformTab(next.name,true);}
    });
  });
  form.addEventListener("invalid",event=>{const tab=platformTabs.find(item=>item.panel.contains?.(event.target));if(tab)showPlatformTab(tab.name);},true);
  let savedBoxSettings = null;
  let availableEmulators = [];
  const lbSearch = document.getElementById("btn-platform-lb-search");
  const lbDownload = document.getElementById("btn-platform-lb-download");
  const lbMetadata = document.getElementById("btn-platform-lb-metadata");
  const lbSource = document.getElementById("platform-lb-source");
  const lbProgress = document.getElementById("platform-lb-progress");
  const lbMessage = document.getElementById("platform-lb-message");
  const downloadAll = document.getElementById("platform-lb-download-all");
  const quantities = new Map();
  const typeChoices = new Map();
  let typesReady = false;
  function renderTypes(counts) {
    quantities.forEach((input, key) => typeChoices.set(key, !!input.checked)); quantities.clear();
    const container = document.getElementById("platform-lb-options");
    container.replaceChildren(); container.classList.add("image-type-checklist");
    PLATFORM_IMAGE_TYPES.forEach(([key, label]) => {
      if (!(counts[key] > 0)) return;
      const field = document.createElement("label"), caption = document.createElement("span");
      caption.textContent = `${key === "other" ? globalThis.OpenCabinetI18n.t("platform.images.other") : label} (${counts[key]})`;
      const input = document.createElement("input"); input.type = "checkbox"; input.name = key;
      input.checked = typeChoices.has(key) ? typeChoices.get(key) : ["logo", "screenshot", "other"].includes(key);
      input.onchange = () => { typeChoices.set(key, input.checked); controls(busy); };
      field.append(caption, input); container.appendChild(field); quantities.set(key, input);
    });
    if (!quantities.size) container.textContent = globalThis.OpenCabinetI18n.t("msg.2436866316");
  }
  async function loadTypes(token) {
    typesReady = false;
    if (!lbSource.value) { renderTypes({}); return; }
    const counts = await invoke("get_platform_image_types", { jobId, sourcePlatform: lbSource.value, onProgress: channel(token) });
    if (token !== operation || closing) return;
    renderTypes(counts); typesReady = true;
  }
  let current = null, images = [], busy = false, opening = false;
  let jobId = null, sessionPending = null, ending = null, downloading = false, closing = false, operation = 0;
  function controls(value) {
    busy = value;
    form.querySelectorAll("button, input, select").forEach((control) => { control.disabled = value; });
    defaultEmulator.disabled = value || availableEmulators.length === 0;
    boxSettings?.setBusy(value);
    downloadAll.disabled = value || !typesReady || !quantities.size;
    lbDownload.disabled = value || !jobId || !lbSource.value || !typesReady || ![...quantities.values()].some(input => input.checked);
    lbMetadata.disabled = value || !jobId || !lbSource.value;
    if (downloading && !closing) {
      document.getElementById("btn-close-platform-details").disabled = false;
      document.getElementById("btn-cancel-platform-details").disabled = false;
    }
  }
  function render() {
    list.replaceChildren();
    images.forEach((image) => {
      const row = document.createElement("div"); row.className = "game-image-item";
      const thumbnail = document.createElement("div"); thumbnail.className = "image-editor-thumbnail";
      thumbnail.appendChild(mediaImage(image.path, ""));
      const fields = document.createElement("div"); fields.className = "image-editor-fields";
      const filename = document.createElement("span"); filename.textContent = image.path.split(/[\\/]/).pop(); filename.title = image.path;
      const select = document.createElement("select"); select.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.1cc7c11dd8", filename.textContent));
      PLATFORM_IMAGE_TYPES.forEach(([value, label]) => { const option = document.createElement("option"); option.value = value; option.textContent = label; select.appendChild(option); });
      select.value = image.kind;
      select.onchange = () => { images = assignImageType(images, image.path, select.value); render(); };
      fields.append(filename, select);
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "delete-btn"; remove.textContent = "🗑️";
      remove.setAttribute("aria-label", `Quitar ${filename.textContent}`);
      remove.onclick = () => { images = images.filter((item) => item.path !== image.path); render(); };
      row.append(thumbnail, fields, remove); list.appendChild(row);
    });
  }
  function endSession() {
    if (ending) return ending;
    if (!jobId && !sessionPending) return Promise.resolve();
    ending = (async () => {
      try { if (sessionPending) await sessionPending; if (jobId) await invoke("end_metadata_import", { jobId }); }
      catch (reason) { console.error("No se pudo cerrar la descarga de consola:", reason); }
      finally { jobId = null; sessionPending = null; ending = null; }
    })();
    return ending;
  }
  async function close() {
    if (closing || (busy && !downloading)) return;
    ++operation;
    if (!jobId && !sessionPending) { boxSettings?.close(); dialog.close(); return; }
    closing = true; controls(true); lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.0e62f4f5d1");
    await endSession(); boxSettings?.close(); dialog.close(); closing = false; downloading = false; controls(false);
  }
  document.getElementById("btn-close-platform-details").onclick = close;
  document.getElementById("btn-cancel-platform-details").onclick = close;
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
  dialog.addEventListener("close", () => { current = null; images = []; list.replaceChildren(); });
  lbSource.onchange = async () => {
    if (busy || !jobId) return;
    const token = ++operation; typesReady = false; downloading = true; controls(true);
    try { await loadTypes(token); if (token === operation) lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.c887525256"); }
    catch (reason) { if (token === operation) lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.e78e2429a5", reason); }
    finally { if (token === operation) { downloading = false; lbProgress.classList.add("hidden"); controls(false); } }
  };
  function channel(token) {
    const channel = new window.__TAURI__.core.Channel();
    channel.onmessage = (value) => {
      if (operation !== token || closing || value.job_id !== jobId) return;
      lbProgress.classList.remove("hidden");
      if (value.total) lbProgress.value = Math.min(100, Math.floor(value.processed / value.total * 100)); else lbProgress.removeAttribute("value");
      lbMessage.textContent = value.phase === "catalog" ? globalThis.OpenCabinetI18n.t("msg.7252c7d8d3") : value.phase === "indexing" ? globalThis.OpenCabinetI18n.t("msg.be5d99978e")
        : value.total ? globalThis.OpenCabinetI18n.t("msg.37c81d138a", value.processed, value.total) : globalThis.OpenCabinetI18n.t("msg.f7c2f18575");
    };
    return channel;
  }
  lbSearch.onclick = async () => {
    if (busy || !current) return;
    const token = ++operation; downloading = true; controls(true); lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.c61d0b32bc");
    try {
      if (!jobId) sessionPending = invoke("start_metadata_import", { platform: current.name }).then((session) => { jobId = session.job_id; return session; });
      const session = sessionPending ? await sessionPending : null;
      if (token !== operation) return;
      const catalog = session?.catalog || await invoke("prepare_metadata_catalog", { jobId, refresh: false, onProgress: channel(token) });
      if (token !== operation) return;
      const previous = lbSource.value || session?.source_platform || metadataPlatformSuggestion(current.name, catalog.platforms);
      lbSource.replaceChildren();
      const empty = document.createElement("option"); empty.value = ""; empty.textContent = globalThis.OpenCabinetI18n.t("msg.81e799c128"); lbSource.appendChild(empty);
      catalog.platforms.forEach((name) => { const option = document.createElement("option"); option.value = name; option.textContent = name; lbSource.appendChild(option); });
      lbSource.value = catalog.platforms.includes(previous) ? previous : "";
      await loadTypes(token);
      if (token !== operation) return;
      lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.c887525256");
    } catch (reason) { if (token === operation) lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.e78e2429a5", reason); }
    finally { if (token === operation) { downloading = false; lbProgress.classList.add("hidden"); controls(false); } }
  };
  lbDownload.onclick = async () => {
    if (busy || !current || !jobId || !lbSource.value || !typesReady) return;
    const options = { selected_types: [...quantities].filter(([, input]) => input.checked).map(([key]) => key), download_all: !!downloadAll.checked };
    if (!options.selected_types.length) { lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.b192ed44c6"); return; }
    const token = ++operation; downloading = true; controls(true); lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.eb04e24b4f"); lbProgress.classList.remove("hidden"); lbProgress.removeAttribute("value");
    try {
      const report = await invoke("download_platform_images", { jobId, platformId: current.id, sourcePlatform: lbSource.value, options, existingImages: images, onProgress: channel(token) });
      if (token !== operation) return;
      report.images.forEach((image) => { images = assignImageType(images, image.path, image.kind); }); render();
      const published = report.published_counts;
      const total = published ? Object.values(published).reduce((sum, count) => sum + count, 0) : report.available_count;
      const counts = published ? globalThis.OpenCabinetI18n.t("msg.5f923cef12") + PLATFORM_IMAGE_TYPES.map(([key, label]) => `${label}: ${published[key] || 0}`).join(" · ") + "." : "";
      let outcome;
      if (report.failures.length) outcome = globalThis.OpenCabinetI18n.t("msg.2f5806cc56");
      else if (report.images.length) outcome = globalThis.OpenCabinetI18n.t("msg.9a97182b6f");
      else if (total === 0) outcome = globalThis.OpenCabinetI18n.t("msg.962581b146", lbSource.value);
      else if (report.already_present_count) outcome = globalThis.OpenCabinetI18n.t("msg.9d536a9d32");
      else if (report.kept_logo && report.available_count === 0) outcome = globalThis.OpenCabinetI18n.t("msg.dfd5b8818d");
      else outcome = globalThis.OpenCabinetI18n.t("msg.fedefc4723");
      lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.3dfa139429", report.images.length, report.already_present_count || 0, report.failures.length, outcome, counts);
    } catch (reason) { if (token === operation) lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.9342abe8d4", reason); }
    finally { if (token === operation) { downloading = false; lbProgress.classList.add("hidden"); controls(false); } }
  };
  lbMetadata.onclick = async () => {
    if (busy || !current || !jobId || !lbSource.value) return;
    const token = ++operation; downloading = true; controls(true);
    lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.12beaf30fb");
    try {
      const data = await invoke("get_catalog_platform_metadata", { jobId, sourcePlatform: lbSource.value, onProgress: channel(token) });
      if (token !== operation) return;
      let count = 0;
      for (const [key, id] of [["release_date", "platform-release-date"], ["developer", "platform-developer"], ["manufacturer", "platform-manufacturer"]]) {
        if (data[key]) { document.getElementById(id).value = data[key]; ++count; }
      }
      lbMessage.textContent = count ? globalThis.OpenCabinetI18n.t("msg.7b365bd569", count, data.name)
        : globalThis.OpenCabinetI18n.t("msg.c057b21db9");
    } catch (reason) { if (token === operation) lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.48aa978d5e", reason); }
    finally { if (token === operation) { downloading = false; lbProgress.classList.add("hidden"); controls(false); } }
  };
  add.onclick = async () => {
    if (busy) return;
    controls(true); error.textContent = "";
    try {
      const paths = await invoke("select_game_images", { kind: kind.value });
      paths.forEach((path) => { images = assignImageType(images, path, kind.value); });
      render();
    } catch (reason) { error.textContent = String(reason); }
    finally { controls(false); }
  };
  form.onsubmit = async (event) => {
    event.preventDefault(); if (busy || !current) return;
    controls(true); error.textContent = "";
    try {
      const details = await invoke("save_platform_details", { details: {
        platform_id: current.id, release_date: document.getElementById("platform-release-date").value || null,
        developer: document.getElementById("platform-developer").value.trim() || null,
        manufacturer: document.getElementById("platform-manufacturer").value.trim() || null, images,
        default_emulator_id: defaultEmulator.value ? Number(defaultEmulator.value) : null,
        box_3d: boxSettings?.getValue() ?? savedBoxSettings,
        variables: variablesEditor?.value() ?? null,
      } });
      platformDetailsCache.set(current.id, Promise.resolve(details));
      void refreshBoxBrandImages();
      libraryManufacturers[current.name] = details.manufacturer || "";
      libraryPlatformVariables[current.id] = details.variables || {};
      if (["manufacturer","categories"].includes(libraryGrouping)) { renderPlatformFilters(); applyLibraryFilters(); }
      await loadEmulators();
      if (!scanInProgress && !savingInlineEmulator && !inlineRetroarchSetup?.busy) updateScannerEmulatorCheck();
      if (selectedGameId === null && selectedPlatform?.toLowerCase() === current.name.toLowerCase()) showPlatformDetails();
      const selected = allGames.find(game => game.id === selectedGameId && game.platform.toLowerCase() === current.name.toLowerCase());
      if (selected) detailsGameBox?.update({ ...regionalGame(selected), title:selected.title }, displayGameImages(selected));
      await endSession(); controls(false); boxSettings?.close(); dialog.close(); showToast(globalThis.OpenCabinetI18n.t("msg.0c51f7f056"));
    } catch (reason) { error.textContent = String(reason); if(String(reason).toLowerCase().includes("variable"))showPlatformTab("variables"); }
    finally { controls(false); }
  };
  return { async open(platform) {
    if (dialog.open || opening) return;
    opening = true;
    try {
      const [details, emulators] = await Promise.all([
        invoke("get_platform_details", { platformId: platform.id }), invoke("get_emulators"),
      ]);
      allEmulators = emulators;
      platformDetailsCache.set(platform.id, Promise.resolve(details));
      availableEmulators = emulators.filter(emulator => emulator.platform.toLowerCase() === platform.name.toLowerCase()).sort((a, b) => a.id - b.id);
      defaultEmulator.replaceChildren();
      const automatic = document.createElement("option"); automatic.value = "";
      automatic.textContent = availableEmulators.length ? globalThis.OpenCabinetI18n.t("msg.66ccf9a964", availableEmulators[0].name) : globalThis.OpenCabinetI18n.t("msg.c85fce2af7");
      defaultEmulator.appendChild(automatic);
      availableEmulators.forEach(emulator => {
        const option = document.createElement("option"); option.value = String(emulator.id); option.textContent = emulator.name;
        defaultEmulator.appendChild(option);
      });
      defaultEmulator.value = availableEmulators.some(emulator => emulator.id === details.default_emulator_id) ? String(details.default_emulator_id) : "";
      current = platform; images = (details.images || []).map((image) => ({ ...image }));
      void getLibraryTools()?.renderFolders(document.getElementById('platform-folders-list'),platform,async(platform,folder)=>{if(busy)return;await close();await startSavedFolderScan(platform,folder);});
      const variableOverrides = details.variables || libraryPlatformVariables[platform.id] || {};
      variablesEditor?.set(window.OpenCabinetVariables.platformDefaults(platform.name, variableOverrides), variableOverrides);
      showPlatformTab("details");
      savedBoxSettings = details.box_3d || null;
      boxSettings?.open(savedBoxSettings, platform.name, allGames.filter(game => game.platform.toLowerCase() === platform.name.toLowerCase()).map(game => ({ ...game, images: gameImages(game) })));
      document.getElementById("platform-editor-title").textContent = globalThis.OpenCabinetI18n.t("msg.d9ca0d5f93", platform.name);
      document.getElementById("platform-release-date").value = details.release_date || "";
      document.getElementById("platform-developer").value = details.developer || "";
      document.getElementById("platform-manufacturer").value = details.manufacturer || "";
      kind.value = "logo"; error.textContent = ""; controls(false); render(); dialog.showModal();
      lbSource.replaceChildren(); lbSource.value = ""; lbProgress.classList.add("hidden");
      typesReady = false; quantities.clear(); typeChoices.clear(); downloadAll.checked = false;
      document.getElementById("platform-lb-options").replaceChildren(); controls(false);
      lbMessage.textContent = globalThis.OpenCabinetI18n.t("msg.715ac6b099");
      controls(false);
    } catch (reason) { showToast(globalThis.OpenCabinetI18n.t("msg.b5d4b31a97", reason), true); }
    finally { opening = false; }
  } };
}

// Confirmación con el estilo de la app, sin mensajes del navegador.
function confirmDeletion(title, message) {
  const dialog = document.getElementById("confirmation-dialog");
  if (dialog.open) return Promise.resolve(false);
  document.getElementById("confirmation-title").textContent = title;
  document.getElementById("confirmation-message").textContent = message;
  dialog.returnValue = "cancel";
  return new Promise((resolve) => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "delete");
    }, { once: true });
    dialog.showModal();
  });
}

function chooseGameDataRetention() {
  const dialog = document.getElementById("game-data-retention-dialog");
  if (dialog.open) return Promise.resolve(null);
  dialog.returnValue = "cancel";
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue === "keep" ? true : dialog.returnValue === "discard" ? false : null), { once: true });
    dialog.showModal();
  });
}

function setupEscapeDismissal() {
  if (escapeDismissalReady) return;
  escapeDismissalReady = true;
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || event.defaultPrevented || event.isComposing) return;
    // Holding Escape must not dismiss several stacked windows. Native dialogs
    // keep their cancel handlers, including confirmation and download cleanup.
    if (event.repeat) { event.preventDefault(); return; }
    if (document.querySelector("dialog[open]")) return;
    for (const name of ["options", "tools"]) {
      const menu = document.getElementById(`dropdown-${name}-menu`);
      if (!menu?.classList.contains("show")) continue;
      event.preventDefault();
      event.stopPropagation();
      menu.classList.remove("show");
      document.getElementById(`menu-${name}-dropdown`).classList.remove("active");
      document.getElementById(`btn-menu-${name}`).focus();
      return;
    }
    const modal = [...document.querySelectorAll(".modal-overlay:not(.hidden)")].reverse()
      .find((element) => modalDismissHandlers.has(element));
    if (!modal) return;
    event.preventDefault();
    event.stopPropagation();
    modalDismissHandlers.get(modal)();
  });
}

// Backdrop and Escape share each window's close/minimize behavior.
function setupModalBackdropClose(modal, close) {
  modalDismissHandlers.set(modal, close);
  setupEscapeDismissal();
  let pressedBackdrop = false;
  modal.addEventListener("pointerdown", (event) => {
    pressedBackdrop = event.button === 0 && event.target === modal;
  });
  modal.addEventListener("pointercancel", () => {
    pressedBackdrop = false;
  });
  modal.addEventListener("click", (event) => {
    const shouldClose = pressedBackdrop && event.target === modal;
    pressedBackdrop = false;
    if (shouldClose) close();
  });
}

// --- Edición de juegos ---
function metadataResultLabel(game) {
  return `${game.title} · ${game.platform}${game.source_key ? ` · ${game.source_key}` : ""}${game.release_date ? ` · ${game.release_date}` : ""}`;
}

function preferredMetadataMatch(games) {
  const exact = games.filter(game => game.exact);
  if (exact.length === 1) return exact[0].id;
  // Distinct repository serials remain selectable. Do not guess between regions,
  // editions or personal-catalog entries that only share a cleaned title.
  if (!exact.length || exact.some(game => !game.source_key)
    || new Set(exact.map(game => JSON.stringify([game.platform, game.title.trim().toLowerCase()]))).size !== 1) return null;
  return [...exact].sort((a, b) => a.source_key.length - b.source_key.length
    || (a.source_key < b.source_key ? -1 : a.source_key > b.source_key ? 1 : 0))[0].id;
}

function setupGameImageDownloader({ getGame, getImages, onImages, onBusy, onSource = () => {}, onState = () => {} }) {
  const panel = document.getElementById("editor-artwork-panel");
  const platform = document.getElementById("editor-artwork-platform");
  const query = document.getElementById("editor-artwork-query");
  const result = document.getElementById("editor-artwork-result");
  const message = document.getElementById("editor-artwork-message");
  const search = document.getElementById("btn-editor-artwork-search");
  const download = document.getElementById("btn-editor-artwork-download");
  const retry = document.getElementById("btn-editor-artwork-retry");
  const progress = document.getElementById("editor-artwork-progress");
  const quantities = new Map();
  const downloadAll = document.getElementById("editor-artwork-download-all");
  const typeChoices = new Map();
  const typesBox = document.getElementById("editor-artwork-options");
  let typesReady = false;
  let alive = false, busy = false, generation = 0, operation = 0, artworkOpened = false;
  let jobId = null, initializing = null, catalog = null, savedPlatform = null, preferredId = null;
  let candidates = [], retryAvailable = false;

  function controls() {
    downloadAll.disabled = busy;
    panel.setAttribute("aria-busy", String(busy));
    panel.querySelectorAll("input, select, button").forEach((element) => { element.disabled = busy; });
    download.disabled = busy || !typesReady || !quantities.size || !result.value || !platform.value || !jobId;
    retry.disabled = busy || !retryAvailable;
    onState({ visible: artworkOpened && !panel.classList.contains("hidden"), disabled: download.disabled });
  }
  function setBusy(value) { busy = value; onBusy(value); controls(); }
  function clearResults() {
    typesReady = false;
    renderImageTypeChoices(typesBox, {}, quantities, typeChoices, "game-artwork-form");
    candidates = []; result.replaceChildren(); result.value = "";
    retryAvailable = false; retry.classList.add("hidden");
    document.getElementById("editor-artwork-failures").replaceChildren();
  }
  function renderCatalog(summary) {
    const chosen = platform.value || savedPlatform || metadataPlatformSuggestion(getGame().platform, summary.platforms);
    catalog = summary; platform.replaceChildren();
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = globalThis.OpenCabinetI18n.t("msg.d9de7e56bc");
    platform.appendChild(placeholder);
    summary.platforms.forEach((name) => {
      const option = document.createElement("option"); option.value = name; option.textContent = name; platform.appendChild(option);
    });
    platform.value = summary.platforms.includes(chosen) ? chosen : "";
    document.getElementById("editor-artwork-catalog").textContent = globalThis.OpenCabinetI18n.t("msg.7b9f49f0a7", summary.game_count, summary.downloaded_at);
    search.textContent = globalThis.OpenCabinetI18n.t("msg.5f55edf900");
  }
  function channel(current, phase) {
    const bar = document.getElementById("editor-artwork-progress-bar");
    const label = document.getElementById("editor-artwork-progress-label");
    const labels = { catalog: globalThis.OpenCabinetI18n.t("msg.201d1effb2"), indexing: globalThis.OpenCabinetI18n.t("msg.e8a203706e"), availability: globalThis.OpenCabinetI18n.t("msg.c3212ba929"), images: globalThis.OpenCabinetI18n.t("msg.4163100e15") };
    const display = (update) => {
      if (!current()) return;
      progress.classList.remove("hidden");
      label.textContent = `${labels[update.phase] || globalThis.OpenCabinetI18n.t("msg.b496fae27c")}${update.total ? globalThis.OpenCabinetI18n.t("msg.31a990fbf8", update.processed, update.total, update.phase === "catalog" ? " bytes" : "") : ""}`;
      if (update.total) bar.value = Math.min(100, Math.floor(update.processed / update.total * 100));
      else bar.removeAttribute("value");
    };
    display({ phase });
    const stream = new window.__TAURI__.core.Channel();
    stream.onmessage = (update) => { if (update.job_id === jobId) display(update); };
    return stream;
  }
  async function perform(action, propagateError = false) {
    if (!alive || busy) return;
    const version = generation;
    const request = ++operation;
    const current = () => alive && version === generation && request === operation;
    setBusy(true); message.textContent = "";
    try { await action(current); }
    catch (error) {
      if (propagateError) throw error;
      if (current()) message.textContent = globalThis.OpenCabinetI18n.t("msg.3e6db31de9", error);
    }
    finally { if (current()) { setBusy(false); progress.classList.add("hidden"); ++operation; } }
  }
  async function ensureSession(current) {
    if (jobId) return;
    const game = getGame();
    initializing = invoke("start_metadata_import", { platform: game.platform, gameId: game.id });
    const session = await initializing;
    jobId = session.job_id;
    if (!current()) return;
    savedPlatform = session.source_platform; preferredId = session.source_id;
    if (session.catalog) renderCatalog(session.catalog);
    else {
      document.getElementById("editor-artwork-catalog").textContent = globalThis.OpenCabinetI18n.t("msg.cbd5e712f1");
      search.textContent = globalThis.OpenCabinetI18n.t("msg.b10bf0ae47");
    }
  }
  async function find(current, useSavedId = false) {
    await ensureSession(current);
    if (!current()) return;
    if (!catalog) {
      const summary = await invoke("prepare_metadata_catalog", { jobId, refresh: false, onProgress: channel(current, "catalog") });
      if (!current()) return;
      renderCatalog(summary);
    }
    clearResults();
    if (!platform.value) { message.textContent = globalThis.OpenCabinetI18n.t("msg.02eefba890"); platform.focus(); return; }
    if (!query.value.trim()) { message.textContent = globalThis.OpenCabinetI18n.t("msg.8e297f2799"); query.focus(); return; }
    const games = await invoke("search_metadata_games", { jobId, query: query.value.trim(), sourcePlatform: platform.value,
      preferredId: useSavedId ? preferredId || null : null });
    if (!current()) return;
    candidates = games;
    const placeholder = document.createElement("option"); placeholder.value = "";
    placeholder.textContent = games.length ? globalThis.OpenCabinetI18n.t("msg.e2232df663") : globalThis.OpenCabinetI18n.t("msg.bf9fc1983f"); result.appendChild(placeholder);
    games.forEach((game) => {
      const option = document.createElement("option"); option.value = String(game.id);
      option.textContent = metadataResultLabel(game);
      result.appendChild(option);
    });
    const preferred = preferredMetadataMatch(games);
    result.value = preferred === null ? "" : String(preferred);
    message.textContent = games.length ? globalThis.OpenCabinetI18n.t("msg.ac9b7a8684")
      : globalThis.OpenCabinetI18n.t("msg.fdb7f03e12");
    if (!games.length) query.focus();
    await loadTypes(current);
  }
  async function loadTypes(current) {
    typesReady = false;
    renderImageTypeChoices(typesBox, {}, quantities, typeChoices, "game-artwork-form");
    const selected = candidates.find((game) => String(game.id) === result.value);
    if (!selected || !jobId) return;
    typesBox.textContent = globalThis.OpenCabinetI18n.t("msg.57d1e9615b");
    const available = await invoke("get_metadata_image_types", { jobId, sourceIds: [selected.id], gameIds: null,
      onProgress: channel(current, "availability") });
    if (!current()) return;
    renderImageTypeChoices(typesBox, available.counts, quantities, typeChoices, "game-artwork-form");
    typesReady = true;
  }
  function readOptions() {
    const options = selectedImageTypes(quantities, document.getElementById("editor-artwork-download-all").checked);
    if (!typesReady || !options.selected_types.length) throw new Error(globalThis.OpenCabinetI18n.t("msg.b4b5b08bc1"));
    return options;
  }
  function acceptReport(report) {
    onImages(report.images);
    retryAvailable = report.failures.length > 0;
    retry.classList.toggle("hidden", !retryAvailable);
    const failures = document.getElementById("editor-artwork-failures"); failures.replaceChildren();
    report.failures.forEach((failure) => {
      const item = document.createElement("li");
      item.textContent = `${GAME_IMAGE_TYPES.find(([kind]) => kind === failure.kind)?.[1] || failure.kind}: ${failure.message}`;
      failures.appendChild(item);
    });
    message.textContent = report.images.length ? globalThis.OpenCabinetI18n.t("msg.aeaec5ec89", report.images.length)
      : report.available_count === 0 ? globalThis.OpenCabinetI18n.t("msg.3343bae758")
      : report.image_count > 0 ? globalThis.OpenCabinetI18n.t("msg.7bb4ed64e0") : globalThis.OpenCabinetI18n.t("msg.b8d9cfc95a");
    if (retryAvailable) message.textContent += globalThis.OpenCabinetI18n.t("msg.38c9837941", report.failures.length);
    if (!report.available_count) query.focus();
  }
  search.addEventListener("click", () => perform((current) => find(current)));
  document.getElementById("game-artwork-form").addEventListener("submit", (event) => event.preventDefault());
  query.addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); perform((current) => find(current)); } });
  platform.addEventListener("change", () => { clearResults(); controls(); message.textContent = globalThis.OpenCabinetI18n.t("msg.a2e7badbf4"); });
  result.addEventListener("change", () => { retryAvailable = false; retry.classList.add("hidden"); return perform(loadTypes); });
  function downloadSelected() {
    if (download.disabled) return;
    return perform(async (current) => {
      const selected = candidates.find((game) => String(game.id) === result.value);
      if (!selected) return;
      const options = readOptions(); retryAvailable = false; retry.classList.add("hidden");
      const report = await invoke("download_editor_game_images", { jobId, gameId: getGame().id, sourceId: selected.id,
        sourcePlatform: platform.value, options, existingImages: getImages(), onProgress: channel(current, "images") });
      if (current()) { acceptReport(report); if (report.images.length) onSource(selected.id); }
    });
  }
  download.addEventListener("click", downloadSelected);
  retry.addEventListener("click", () => perform(async (current) => {
    const report = await invoke("retry_editor_game_images", { jobId, existingImages: getImages(), onProgress: channel(current, "images") });
    if (current()) {
      acceptReport(report);
      const selected = candidates.find(game => String(game.id) === result.value);
      if (report.images.length && selected) onSource(selected.id);
    }
  }));

  return {
    download: downloadSelected,
    async lookupMetadata(title, onProgress) {
      if (busy) throw new Error(globalThis.OpenCabinetI18n.t("msg.38f2332774"));
      if (!alive) { alive = true; ++generation; }
      let found = null;
      await perform(async (current) => {
        await ensureSession(current);
        if (!current()) return;
        if (!catalog) {
          const stream = new window.__TAURI__.core.Channel();
          stream.onmessage = (progress) => { if (current() && progress.job_id === jobId) onProgress(progress); };
          const summary = await invoke("prepare_metadata_catalog", { jobId, refresh: false, onProgress: stream });
          if (!current()) return;
          renderCatalog(summary);
        }
        // Metadata lookup deliberately uses only the entered title, even if
        // this editor already has a platform mapping or a saved database ID.
        const games = await invoke("search_metadata_games", { jobId, query: title, sourcePlatform: null, preferredId: null });
        if (current()) found = games;
      }, true);
      return found;
    },
    useSource(game) {
      preferredId = game.id; savedPlatform = game.platform;
      platform.value = "";
      if (catalog) renderCatalog(catalog);
      clearResults();
      candidates = [game];
      const option = document.createElement("option"); option.value = String(game.id); option.textContent = metadataResultLabel(game);
      result.appendChild(option); result.value = String(game.id);
      if (artworkOpened) void perform(loadTypes);
      else controls();
    },
    async open() {
      if (busy) return;
      if (artworkOpened) { panel.classList.toggle("hidden"); controls(); return; }
      artworkOpened = true;
      alive = true; ++generation; clearResults(); platform.replaceChildren(); platform.value = "";
      query.value = getGame().title; message.textContent = "";
      document.getElementById("editor-artwork-catalog").textContent = globalThis.OpenCabinetI18n.t("msg.840085b1e9");
      typeChoices.clear(); typesReady = false;
      downloadAll.checked = false;
      panel.classList.remove("hidden");
      await perform(async (current) => {
        await ensureSession(current);
        if (current() && catalog) { renderCatalog(catalog); await find(current, true); }
      });
    },
    async release() {
      alive = false; ++generation;
      try {
        const session = initializing ? await initializing.catch(() => null) : null;
        const id = jobId || session?.job_id;
        if (id) await invoke("end_metadata_import", { jobId: id });
      } catch (error) { console.error("Error al cerrar la descarga de imágenes:", error); }
      jobId = initializing = catalog = savedPlatform = preferredId = null;
      artworkOpened = false;
      clearResults(); panel.classList.add("hidden"); progress.classList.add("hidden");
      setBusy(false);
    },
  };
}

function setupGameEditor() {
  const modal = document.getElementById("game-edit-modal");
  const form = document.getElementById("game-edit-form");
  const openButton = document.getElementById("btn-edit-game");
  const saveButton = document.getElementById("btn-save-game-edit");
  const downloadButton = document.getElementById("btn-download-game-edit");
  let activeEditorTab = "details", artworkState = { visible: false, disabled: true };
  function updateEditorActions() {
    const downloading = activeEditorTab === "images" && artworkState.visible;
    downloadButton.classList.toggle("hidden", !downloading);
    downloadButton.disabled = artworkState.disabled || networkBusy || saving || choosingImages || closing;
    saveButton.classList.toggle("primary-btn", !downloading);
    saveButton.classList.toggle("secondary-btn", downloading);
  }
  const platformSelect = document.getElementById("game-edit-platform");
  const imageKind = document.getElementById("game-image-kind");
  imageKind.replaceChildren();
  GAME_IMAGE_TYPES.forEach(([key, label]) => {
    const option = document.createElement("option"); option.value = key; option.textContent = label;
    imageKind.appendChild(option);
  });
  imageKind.value = "cover";
  let editingId = null;
  let editingSourceGame=null,draftRomPath=null,sessionHistoryView=null;
  const orderEditor = globalThis.OpenCabinetOrder?.createEditor({getGames:()=>allGames});
  let gameModeSource = null, gameModeLabel = "";
  function setGameModeDraft(value) {
    gameModeSource = value ?? null;
    gameModeLabel = globalThis.OpenCabinetI18n.gameMode(value) || "";
    document.getElementById("game-edit-game-mode").value = gameModeLabel;
  }
  const variablesEditor = window.OpenCabinetVariables?.createEditor(document.getElementById("game-variables-editor"), document, { getNames: libraryVariableNames });
  const gameBoxEditor = window.OpenCabinetBoxSettings?.createEditor({ imageSource, prefix: "game" });
  const inheritBox = document.getElementById("game-box-use-platform");
  function updateBoxInheritance() {
    document.getElementById("game-box-custom-options").classList.toggle("hidden", inheritBox.checked);
    document.getElementById("game-box-settings").open = !inheritBox.checked;
    gameBoxEditor?.setBusy(inheritBox.checked);
  }
  inheritBox.addEventListener("change", updateBoxInheritance);
  const regionEditor = window.OpenCabinetRegions?.createEditor(document.getElementById("game-regions-editor"), (game, group) => {
    if (editorState() !== savedEditorState) { showToast(globalThis.OpenCabinetI18n.t("msg.b07d1254db"), true); return; }
    openEditor(game, group);
  });
  let savedEditorState = null;
  function editorState() {
    return JSON.stringify([[...form.querySelectorAll("input,select,textarea")].filter(input=>input.id!=='game-edit-source-select').map(input => [input.id, input.value, input.checked]), draftImages, draftManuals, discEditor?.value(), regionEditor?.value()]);
  }
  const editorTabs = ["details", "order", "execution", "history", "images", "manuals", "discs", "regions", "box", "variables"].map(name => ({
    name, tab: document.getElementById(`game-edit-tab-${name}`),
    panel: document.getElementById(name === "discs" ? "game-discs-section" : `game-edit-panel-${name}`),
  }));
  function showEditorTab(name, focus = false) {
    activeEditorTab = name;
    updateEditorActions();
    document.getElementById("game-editor-panels").scrollTop = 0;
    sessionHistoryView?.dispose();sessionHistoryView=null;
    if(name==='history'&&editingId!==null){
      const group=allGames.find(game=>game.id===selectedGameId)||editingSourceGame;
      sessionHistoryView=getLibraryTools()?.mountHistory(document.getElementById('game-edit-history'),group,{combine:preferences.combineRegionStatistics,regionId:editingId});
    }
    if (name === "execution") {
      syncExecutionSources();
      const discs = discEditor?.value();
      if (discs) document.getElementById("game-edit-rom-path").value = discs.map(disc => `${disc.label}: ${disc.rom_path}`).join("\n");
    }
    editorTabs.forEach(item => {
      const active = item.name === name;
      item.tab.setAttribute("aria-selected", String(active));
      item.tab.tabIndex = active ? 0 : -1;
      item.panel.classList.toggle("hidden", !active);
      if (active && focus) item.tab.focus();
    });
  }
  editorTabs.forEach(item => {
    item.tab.addEventListener("click", () => showEditorTab(item.name));
    item.tab.addEventListener("keydown", event => {
      const available = editorTabs.filter(item => !item.tab.disabled);
      const index = available.indexOf(item);
      let next;
      if (event.key === "ArrowDown") next = available[(index + 1) % available.length];
      if (event.key === "ArrowUp") next = available[(index + available.length - 1) % available.length];
      if (event.key === "Home") next = available[0];
      if (event.key === "End") next = available[available.length - 1];
      if (next) { event.preventDefault(); showEditorTab(next.name, true); }
    });
  });
  form.addEventListener("invalid", event => {
    const item = editorTabs.find(item => item.panel.contains?.(event.target));
    if (item) showEditorTab(item.name);
  }, true);
  const emulatorSelect = document.getElementById("game-edit-emulator");
  const customArguments = document.getElementById("game-edit-custom-arguments");
  const argumentsInput = document.getElementById("game-edit-arguments");
  let editingDirectly = false, editingStore = false;
  const sourceSelect=document.getElementById('game-edit-source-select');
  function syncExecutionSources(){
    sourceSelect.replaceChildren();
    const discs=editingDirectly?[{rom_path:draftRomPath||editingSourceGame?.rom_path,label:''}]:discEditor?.sources?.()||editingSourceGame?.discs||[];
    discs.forEach((disc,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=(disc.label?disc.label+' · ':'')+disc.rom_path;sourceSelect.appendChild(option);});
    document.getElementById('btn-game-edit-source').disabled=editingStore||!!editingSourceGame?.is_running;
  }
  document.getElementById('btn-game-edit-source').addEventListener('click',async()=>{
    if(editingId===null||editingStore||editingSourceGame?.is_running||saving||choosingImages||closing||networkBusy)return;
    const id=editingId,index=Number(sourceSelect.value);
    choosingImages=true;const wasDisabled=saveButton.disabled;saveButton.disabled=true;metadataControls();
    try{
      const picked=await getLibraryTools()?.pickSource(editingSourceGame);if(editingId!==id||!picked)return;
      if(editingDirectly)draftRomPath=picked.rom_path;else discEditor?.replace(index,picked.rom_path);
      syncExecutionSources();const sources=discEditor?.sources?.();
      document.getElementById('game-edit-rom-path').value=editingDirectly?draftRomPath:sources.map(d=>`${d.label}: ${d.rom_path}`).join('\n');
    }catch(error){showToast(String(error),true);}
    finally{choosingImages=false;saveButton.disabled=wasDisabled;metadataControls();}
  });
  function executionEmulators() {
    return allEmulators.filter(emu => emu.platform.toLowerCase() === platformSelect.value.toLowerCase())
      .sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)) || a.id - b.id);
  }
  function updateExecutionHelp() {
    const emulators = executionEmulators();
    const selected = emulatorSelect.value ? emulators.find(emu => String(emu.id) === emulatorSelect.value) : emulators[0];
    argumentsInput.disabled = editingStore || !customArguments.checked;
    argumentsInput.placeholder = editingDirectly ? globalThis.OpenCabinetI18n.t("msg.6ed141b8d7") : selected?.arguments || '"%ROM%"';
    document.getElementById("game-edit-execution-help").textContent = editingStore
      ? globalThis.OpenCabinetI18n.t("msg.f819fbd3b4")
      : editingDirectly ? globalThis.OpenCabinetI18n.t("msg.ab0518d324")
      : selected ? `Ejecutable: ${selected.executable_path}${selected.retroarch_core_path ? globalThis.OpenCabinetI18n.t("msg.f5c964e951", selected.retroarch_core_path) : ""}`
      : globalThis.OpenCabinetI18n.t("msg.a1e88310d2");
  }
  function fillExecutionEmulators(id = null) {
    emulatorSelect.replaceChildren();
    const available = executionEmulators();
    const option = document.createElement("option"); option.value = "";
    option.textContent = editingDirectly || editingStore ? globalThis.OpenCabinetI18n.t("msg.9216725078")
      : globalThis.OpenCabinetI18n.t("msg.ac789bdc41", available[0] ? `: ${available[0].name}` : globalThis.OpenCabinetI18n.t("msg.d081ff7b86"));
    emulatorSelect.appendChild(option);
    if (!editingDirectly && !editingStore) {
      available.forEach(emu => {
        const option = document.createElement("option"); option.value = String(emu.id); option.textContent = emu.name;
        emulatorSelect.appendChild(option);
      });
      if (id !== null && !available.some(emu => emu.id === id)) {
        const missing = document.createElement("option"); missing.value = String(id); missing.textContent = globalThis.OpenCabinetI18n.t("msg.58d8e8e3e7");
        emulatorSelect.appendChild(missing);
      }
    }
    emulatorSelect.value = id === null || editingDirectly || editingStore ? "" : String(id);
    emulatorSelect.disabled = editingDirectly || editingStore;
    customArguments.disabled = editingStore;
    updateExecutionHelp();
  }
  emulatorSelect.addEventListener("change", updateExecutionHelp);
  customArguments.addEventListener("change", updateExecutionHelp);
  platformSelect.addEventListener("change", () => {
    fillExecutionEmulators();
    if (!variablesEditor) return;
    const game = allGames.find(item => item.id === editingId);
    const platform = allPlatforms.find(item => item.name === platformSelect.value);
    if (!game || !platform) return;
    try {
      const overrides = variablesEditor.value();
      variablesEditor.set(window.OpenCabinetVariables.gameDefaults(game,window.OpenCabinetVariables.platformValues(platform,libraryVariableContext())),overrides);
    } catch(error) { showEditorTab("variables"); showToast(String(error),true); }
  });
  document.getElementById("btn-game-edit-open-files").addEventListener("click", async () => {
    if (editingId === null) return;
    try { await invoke("open_game_files", { id: editingId }); }
    catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.a18cc956cb", error), true); }
  });
  const discEditor = window.OpenCabinetDiscs?.createEditor(document.getElementById("game-disc-list"), invoke,
    error => showToast(globalThis.OpenCabinetI18n.t("msg.2b56ed39e1", error), true));
  document.getElementById("btn-add-game-discs").addEventListener("click", () => {
    if (!saving && !choosingImages && !networkBusy && !closing) discEditor?.add();
  });
  let saving = false;
  let choosingImages = false;
  let networkBusy = false;
  let closing = false;
  let draftImages = [];
  let savedManuals = [], draftManuals = [];
  let editorManualData=null;
  const editorManualReader=window.OpenCabinetManualReader?.create({imageSource,onClose:()=>{editorManualData?.dispose();editorManualData=null;}});
  let manualVersion = 0;
  let draftCatalogId = null;
  let metadataResults = [], metadataVersion = 0;
  const metadataPanel = document.getElementById("editor-metadata-panel");
  const metadataResult = document.getElementById("editor-metadata-result");
  const metadataSearch = document.getElementById("btn-editor-metadata-search");
  const metadataApply = document.getElementById("btn-editor-metadata-apply");
  const metadataMessage = document.getElementById("editor-metadata-message");
  const metadataProgress = document.getElementById("editor-metadata-progress");
  function metadataControls() {
    updateEditorActions();
    const disabled = saving || choosingImages || closing || networkBusy;
    document.getElementById("btn-add-game-manuals").disabled = disabled;
    document.getElementById("btn-open-game-manuals").disabled = disabled;
    document.getElementById("btn-refresh-game-manuals").disabled = disabled;
    document.getElementById("game-manual-list").querySelectorAll("button").forEach(button => { button.disabled = disabled; });
    metadataSearch.disabled = metadataResult.disabled = disabled;
    metadataApply.disabled = disabled || !metadataResults.some((game) => String(game.id) === metadataResult.value);
  }
  function resetMetadata() {
    ++metadataVersion; metadataResults = []; metadataResult.replaceChildren(); metadataResult.value = "";
    document.getElementById("editor-metadata-preview").textContent = "";
    metadataProgress.classList.add("hidden"); metadataControls();
  }
  function previewMetadata() {
    const game = metadataResults.find((game) => String(game.id) === metadataResult.value);
    document.getElementById("editor-metadata-preview").textContent = game ? [game.title, globalThis.OpenCabinetI18n.t("msg.a3011897b1", game.platform),
      `Lanzamiento: ${game.release_date || "—"}`, globalThis.OpenCabinetI18n.t("msg.3ea6961dd5", game.developer || "—"), globalThis.OpenCabinetI18n.t("msg.647325454a", game.publisher || "—"),
      globalThis.OpenCabinetI18n.t("msg.439c200421", game.genre || "—"), globalThis.OpenCabinetI18n.t("msg.22b204f176", globalThis.OpenCabinetI18n.gameMode(game.game_mode) || "—"), globalThis.OpenCabinetI18n.t("msg.e4eefae773", game.max_players || "—"),
      "", game.description || globalThis.OpenCabinetI18n.t("msg.591e5cef97")].join("\n") : "";
    metadataControls();
  }
  const addImages = document.getElementById("btn-add-game-images");
  const downloadImages = document.getElementById("btn-download-game-images");
  const downloader = setupGameImageDownloader({
    onState: state => { artworkState = state; updateEditorActions(); },
    onSource: id => { draftCatalogId = id; },
    getGame: () => ({ id: editingId, title: document.getElementById("game-edit-name").value.trim(), platform: platformSelect.value }),
    getImages: () => draftImages.map((image) => ({ ...image })),
    onImages: (images) => {
      images.forEach((image) => {
        if (!draftImages.some((current) => current.path === image.path)) draftImages.push({ ...image });
      });
      renderImageEditor();
    },
    onBusy: (value) => {
      networkBusy = value;
      metadataControls();
      saveButton.disabled = value || saving || choosingImages || closing || allPlatforms.length === 0;
      addImages.disabled = downloadImages.disabled = value || saving || choosingImages || closing;
      document.getElementById("game-image-list").querySelectorAll("button, select").forEach((element) => { element.disabled = value || saving || closing; });
    },
  });
  downloadImages.addEventListener("click", () => {
    if (!saving && !choosingImages && !closing && editingId !== null) return downloader.open();
  });
  downloadButton.addEventListener("click", () => {
    if (!saving && !choosingImages && !closing && editingId !== null) return downloader.download();
  });

  metadataSearch.addEventListener("click", async () => {
    if (saving || choosingImages || closing || networkBusy || editingId === null) return;
    const title = document.getElementById("game-edit-name").value.trim();
    if (!title) { showToast(globalThis.OpenCabinetI18n.t("msg.784957efc1"), true); document.getElementById("game-edit-name").focus(); return; }
    resetMetadata(); metadataPanel.classList.remove("hidden");
    metadataMessage.textContent = globalThis.OpenCabinetI18n.t("msg.6e497bdaaf");
    metadataProgress.classList.remove("hidden");
    const bar = document.getElementById("editor-metadata-progress-bar"); bar.removeAttribute("value");
    document.getElementById("editor-metadata-progress-label").textContent = globalThis.OpenCabinetI18n.t("msg.ad0266fefa");
    const version = metadataVersion, id = editingId;
    const current = () => version === metadataVersion && id === editingId && !closing;
    try {
      const games = await downloader.lookupMetadata(title, (progress) => {
        if (!current()) return;
        const phase = { catalog: globalThis.OpenCabinetI18n.t("msg.201d1effb2"), indexing: globalThis.OpenCabinetI18n.t("msg.e8a203706e") }[progress.phase] || globalThis.OpenCabinetI18n.t("msg.ad0266fefa");
        document.getElementById("editor-metadata-progress-label").textContent = phase;
        if (progress.total) bar.value = Math.floor(progress.processed / progress.total * 100);
        else bar.removeAttribute("value");
      });
      if (!current() || games === null) return;
      metadataResults = games;
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = games.length ? globalThis.OpenCabinetI18n.t("msg.d6deb70f0f") : globalThis.OpenCabinetI18n.t("msg.bf9fc1983f");
      metadataResult.appendChild(placeholder);
      games.forEach((game) => {
        const option = document.createElement("option"); option.value = String(game.id);
        option.textContent = metadataResultLabel(game);
        metadataResult.appendChild(option);
      });
      const preferred = preferredMetadataMatch(games);
      metadataResult.value = preferred === null ? "" : String(preferred);
      metadataMessage.textContent = games.length ? globalThis.OpenCabinetI18n.t("msg.65cce526cf", games.length)
        : globalThis.OpenCabinetI18n.t("msg.7f1021b4ee");
      previewMetadata();
    } catch (error) { if (current()) metadataMessage.textContent = globalThis.OpenCabinetI18n.t("msg.6ceb40d967", error); }
    finally { if (current()) { metadataProgress.classList.add("hidden"); metadataControls(); } }
  });
  metadataResult.addEventListener("change", previewMetadata);
  document.getElementById("game-edit-name").addEventListener("input", () => {
    resetMetadata(); metadataMessage.textContent = globalThis.OpenCabinetI18n.t("msg.e18fe45b19");
  });
  metadataApply.addEventListener("click", () => {
    if (saving || networkBusy || choosingImages || closing) return;
    const game = metadataResults.find((game) => String(game.id) === metadataResult.value);
    if (!game) return;
    for (const [field, input] of [["release_date", "release-date"], ["developer", "developer"], ["publisher", "publisher"],
      ["genre", "genre"], ["game_mode", "game-mode"], ["max_players", "max-players"], ["description", "description"]]) {
      if (game[field] !== null && game[field] !== undefined && String(game[field]).trim() !== "") {
        if (field === "game_mode") setGameModeDraft(game[field]);
        else document.getElementById(`game-edit-${input}`).value = String(game[field]);
      }
    }
    draftCatalogId = game.id;
    downloader.useSource(game);
    metadataMessage.textContent = globalThis.OpenCabinetI18n.t("msg.3b7644cc13");
  });

  function renderImageEditor() {
    const list = document.getElementById("game-image-list");
    const panels = document.getElementById("game-editor-panels");
    const scrollTop = panels.scrollTop;
    // Keep the surviving controls mounted so category changes and removals do
    // not lose focus or collapse the scroll container while rebuilding a list.
    const existing = new Map([...list.children].map(item => [item.dataset.imagePath, item]));
    const paths = new Set(draftImages.map(image => image.path));
    for (const [path, item] of existing) {
      if (paths.has(path)) continue;
      if (item.contains(document.activeElement)) {
        const next = item.nextElementSibling || item.previousElementSibling;
        (next?.querySelector("select") || addImages).focus({ preventScroll: true });
      }
      item.remove();
    }
    if (!draftImages.length) {
      list.textContent = globalThis.OpenCabinetI18n.t("msg.2c1c83e3fa");
      panels.scrollTop = scrollTop;
      return;
    }
    if (!existing.size) list.replaceChildren();
    draftImages.forEach((image) => {
      const previous = existing.get(image.path);
      if (previous) {
        previous.querySelector("select").value = image.kind;
        return;
      }
      const item = document.createElement("div");
      item.className = "game-image-item";
      item.dataset.imagePath = image.path;
      const thumbnail = document.createElement("div");
      thumbnail.className = "image-editor-thumbnail";
      thumbnail.appendChild(mediaImage(image.path, globalThis.OpenCabinetI18n.t("msg.c5341f198f")));
      const fields = document.createElement("div");
      fields.className = "image-editor-fields";
      const name = document.createElement("span");
      name.textContent = image.path.split(/[\\/]/).pop();
      name.title = image.path;
      const kind = document.createElement("select");
      kind.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.1cc7c11dd8", name.textContent));
      GAME_IMAGE_TYPES.forEach(([key, label]) => {
        const option = document.createElement("option");
        option.value = key;
        option.textContent = label;
        kind.appendChild(option);
      });
      kind.value = image.kind;
      kind.disabled = networkBusy || saving || closing;
      kind.addEventListener("change", () => {
        draftImages = assignImageType(draftImages, image.path, kind.value);
        renderImageEditor();
      });
      fields.append(name, kind);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.disabled = networkBusy || saving || closing;
      remove.className = "delete-btn";
      remove.textContent = "🗑️";
      remove.title = globalThis.OpenCabinetI18n.t("msg.d51882b2fa");
      remove.setAttribute("aria-label", `Quitar ${name.textContent}`);
      remove.addEventListener("click", () => {
        draftImages = draftImages.filter((current) => current.path !== image.path);
        renderImageEditor();
      });
      item.append(thumbnail, fields, remove);
      list.appendChild(item);
    });
    panels.scrollTop = scrollTop;
  }

  function renderManuals() {
    const list = document.getElementById("game-manual-list");
    list.replaceChildren();
    if (!savedManuals.length && !draftManuals.length) list.textContent = globalThis.OpenCabinetI18n.t("msg.dc75c4bee8");
    for (const [paths, pending] of [[savedManuals, false], [draftManuals, true]]) {
      for (const path of paths) {
        const row = document.createElement("div"); row.className = "game-manual-item";
        const name = document.createElement("span"); name.className = "game-manual-name";
        name.textContent = `${path.split(/[\\/]/).pop()}${pending ? globalThis.OpenCabinetI18n.t("msg.57b3b593fd") : ""}`; name.title = path;
        const action = document.createElement("button"); action.type = "button"; action.className = "secondary-btn";
        action.textContent = pending ? globalThis.OpenCabinetI18n.t("msg.f039f4a8c9") : globalThis.OpenCabinetI18n.t("msg.74e094e879");
        action.addEventListener("click", async () => {
          if (saving || choosingImages || closing || networkBusy) return;
          if (pending) { draftManuals = draftManuals.filter(p => p !== path); renderManuals(); }
          else {
            try {
              if(path.toLowerCase().endsWith('.cbz')&&editorManualReader){
                choosingImages=true;metadataControls();
                const data=await window.OpenCabinetManualPDF.render(path,{imageSource,platform:platformSelect.value});
                editorManualReader.close(false,false);editorManualData=data;
                editorManualReader.open(data,{title:document.getElementById('game-edit-name').value,focusTarget:action});
              }else await invoke("open_game_manual", { id: editingId, path });
            }
            catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.49219768fa", error), true); }
            finally{choosingImages=false;metadataControls();}
          }
        });
        row.append(name, action); list.appendChild(row);
      }
    }
    metadataControls();
  }
  async function refreshManuals() {
    const id = editingId;
    const version = ++manualVersion;
    if (id === null) return;
    try {
      const paths = await invoke("get_game_manuals", { id });
      if (id !== editingId || closing || version !== manualVersion) return;
      savedManuals = paths;
      draftManuals = draftManuals.filter(path => !paths.includes(path));
      renderManuals();
    } catch (error) {
      if (id === editingId && !closing && version === manualVersion) showToast(globalThis.OpenCabinetI18n.t("msg.02a7640533", error), true);
    }
  }
  document.getElementById("btn-refresh-game-manuals").addEventListener("click", refreshManuals);
  document.getElementById("btn-open-game-manuals").addEventListener("click", async () => {
    if (editingId === null || saving || choosingImages || closing || networkBusy) return;
    const id = editingId;
    try { await invoke("open_game_folder", { id, kind: "manuals" }); if (editingId === id) await refreshManuals(); }
    catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.079a669890", error), true); }
  });
  window.addEventListener("focus", () => {
    if (editingId !== null && !saving && !choosingImages && !closing) refreshManuals();
  });
  document.getElementById("btn-add-game-manuals").addEventListener("click", async () => {
    if (editingId === null || saving || choosingImages || closing || networkBusy) return;
    choosingImages = true; metadataControls();
    const saveDisabled = saveButton.disabled; saveButton.disabled = true;
    try {
      const paths = await invoke("select_game_manuals", {});
      paths.forEach(path => { if (!savedManuals.includes(path) && !draftManuals.includes(path)) draftManuals.push(path); });
      renderManuals();
    } catch (error) { showToast(globalThis.OpenCabinetI18n.t("msg.eeea924f6e", error), true); }
    finally { choosingImages = false; saveButton.disabled = saveDisabled; metadataControls(); }
  });

  addImages.addEventListener("click", async () => {
    if (saving || choosingImages || networkBusy || closing || discEditor?.busy || editingId === null) return;
    const kind = document.getElementById("game-image-kind").value;
    choosingImages = true;
    metadataControls();
    addImages.disabled = true;
    const saveDisabled = saveButton.disabled;
    saveButton.disabled = true;
    try {
      const paths = await invoke("select_game_images", { kind });
      paths.forEach((path) => { draftImages = assignImageType(draftImages, path, kind); });
      renderImageEditor();
    } catch (error) {
      showToast(globalThis.OpenCabinetI18n.t("msg.e891e70ad6", error), true);
    } finally {
      choosingImages = false;
      metadataControls();
      addImages.disabled = false;
      saveButton.disabled = saveDisabled;
    }
  });

  async function close() {
    if (saving || choosingImages || closing) return;
    editorManualReader?.close(false,false);
    sessionHistoryView?.dispose();sessionHistoryView=null;
    closing = true;
    resetMetadata(); metadataPanel.classList.add("hidden");
    await downloader.release();
    modal.classList.add("hidden");
    gameBoxEditor?.close();
    editingId = null;
    draftImages = [];
    savedManuals = []; draftManuals = [];
    ++manualVersion;
    document.getElementById("game-manual-list").replaceChildren();
    document.getElementById("game-image-list").replaceChildren();
    openButton.focus();
    closing = false;
    addImages.disabled = downloadImages.disabled = false;
  }

  async function openEditor(override = null, groupOverride = null) {
    if (saving || choosingImages || networkBusy || closing) return;
    const group = groupOverride || allGames.find((item) => item.id === selectedGameId);
    if (!group) return;
    const game = override || regionalGame(group);
    openButton.disabled = true;
    try {
      if (override && editingId !== null) await downloader.release();
      if (!await loadPlatforms()) return;
      editingId = game.id;
      editingSourceGame=game;draftRomPath=null;
      regionEditor?.setGame(group, game.id);
      document.getElementById("game-edit-current-region").textContent = group.regions?.length
        ? globalThis.OpenCabinetI18n.t("msg.963abdf142", group.regions.find(region => region.game.id === game.id)?.label || game.title) : "";
      if (variablesEditor) {
        const platform = allPlatforms.find(p => p.name.toLowerCase() === game.platform.toLowerCase()) || { name:game.platform };
        variablesEditor.set(window.OpenCabinetVariables.gameDefaults(game, window.OpenCabinetVariables.platformValues(platform,libraryVariableContext())), libraryGameVariables[game.id] || {});
      }
      discEditor?.setGame(game);
      orderEditor?.setGame(game);
      editingStore = Boolean(game.steam_app_id || game.epic_app_id);
      editingDirectly = Boolean(game.launch_directly) && !editingStore;
      editorTabs.find(item => item.name === "discs").tab.disabled = editingStore || editingDirectly;
      editorTabs.find(item => item.name === "regions").tab.disabled = editingStore || editingDirectly;
      showEditorTab("details");
      document.getElementById("game-edit-rom-path").value = game.discs?.length
        ? game.discs.map(disc => `${disc.label}: ${disc.rom_path}`).join("\n") : game.rom_path || "";
      customArguments.checked = game.execution?.arguments != null && !editingStore;
      argumentsInput.value = game.execution?.arguments ?? "";
      draftCatalogId = null;
      resetMetadata(); metadataPanel.classList.add("hidden");
      draftImages = gameImages(game);
      savedManuals = []; draftManuals = []; renderManuals();
      renderImageEditor();
      document.getElementById("game-edit-name").value = game.title;
      document.getElementById("game-edit-release-date").value = game.release_date || "";
      document.getElementById("game-edit-developer").value = game.developer || "";
      document.getElementById("game-edit-publisher").value = game.publisher || "";
      document.getElementById("game-edit-genre").value = game.genre || "";
      setGameModeDraft(game.game_mode);
      document.getElementById("game-edit-max-players").value = game.max_players == null ? "" : String(game.max_players);
      document.getElementById("game-edit-description").value = game.description || "";
      platformSelect.replaceChildren();
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = allPlatforms.length ? globalThis.OpenCabinetI18n.t("msg.d9de7e56bc") : globalThis.OpenCabinetI18n.t("msg.5c1c3e5898");
      placeholder.disabled = true;
      platformSelect.appendChild(placeholder);
      allPlatforms.forEach((platform) => {
        const option = document.createElement("option");
        option.value = platform.name;
        option.textContent = platform.name;
        platformSelect.appendChild(option);
      });
      platformSelect.value = allPlatforms.find(
        (platform) => platform.name.toLowerCase() === game.platform.toLowerCase(),
      )?.name || "";
      platformSelect.disabled = Boolean(group.regions?.length);
      fillExecutionEmulators(game.execution?.emulator_id ?? null);
      inheritBox.checked = !game.box_3d;
      if (gameBoxEditor) {
        const platform = allPlatforms.find(item => item.name === game.platform);
        let defaults = null;
        try { if (platform) defaults = (await getPlatformDetails(platform)).box_3d || null; }
        catch (error) { console.error("No se pudo cargar la caja de la consola:", error); }
        gameBoxEditor.open(game.box_3d || null, game.platform, [{ ...game, images: gameImages(game) }], defaults);
      }
      updateBoxInheritance();
      saveButton.disabled = allPlatforms.length === 0;
      modal.classList.remove("hidden");
      document.getElementById("game-edit-name").focus();
      await refreshManuals();
      savedEditorState = editorState();
    } finally {
      openButton.disabled = false;
    }
  }
  openButton.addEventListener("click", () => openEditor());
  document.getElementById("btn-close-game-edit").addEventListener("click", close);
  document.getElementById("btn-cancel-game-edit").addEventListener("click", close);
  setupModalBackdropClose(modal, close);
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      const focusable = [...modal.querySelectorAll("button, input, select, textarea")].filter((element) => !element.disabled && !element.closest?.(".hidden") && element.tabIndex !== -1);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (saving || choosingImages || networkBusy || closing || discEditor?.busy || editingId === null) return;
    let variables = null;
    try { variables = variablesEditor?.value() ?? null; }
    catch(error) { showEditorTab("variables"); showToast(String(error),true); return; }
    let gameBox;
    try { if (gameBoxEditor) gameBox = inheritBox.checked ? null : gameBoxEditor.getValue(); }
    catch(error) { showEditorTab("box"); showToast(String(error),true); return; }
    let orderPatch;
    try { orderPatch = orderEditor?.value(); }
    catch(error) { showEditorTab("order"); showToast(String(error),true); return; }
    const details = {
      ...(orderPatch !== undefined ? { orderGroup:orderPatch } : {}),
      ...(gameBox !== undefined ? { box3d: gameBox } : {}),
      variables,
      regions: regionEditor?.value() ?? null,
      id: editingId,
      ...(draftRomPath!==null?{romPath:draftRomPath}:{}),
      execution: {
        emulator_id: emulatorSelect.value ? Number(emulatorSelect.value) : null,
        arguments: customArguments.checked && !editingStore ? argumentsInput.value : null,
      },
      discs: discEditor?.value() ?? null,
      catalogId: draftCatalogId,
      title: document.getElementById("game-edit-name").value.trim(),
      platform: platformSelect.value,
      releaseDate: document.getElementById("game-edit-release-date").value || null,
      developer: document.getElementById("game-edit-developer").value.trim() || null,
      publisher: document.getElementById("game-edit-publisher").value.trim() || null,
      images: draftImages.map((image) => ({ ...image })),
      manuals: [...draftManuals],
      genre: document.getElementById("game-edit-genre").value.trim() || null,
      gameMode: document.getElementById("game-edit-game-mode").value.trim() === gameModeLabel.trim()
        ? gameModeSource : document.getElementById("game-edit-game-mode").value.trim() || null,
      maxPlayers: document.getElementById("game-edit-max-players").value === "" ? null : Number(document.getElementById("game-edit-max-players").value),
      description: document.getElementById("game-edit-description").value.trim() || null,
    };
    if (details.maxPlayers !== null && (!Number.isInteger(details.maxPlayers) || details.maxPlayers < 1 || details.maxPlayers > 2147483647)) {
      showEditorTab("details");
      showToast(globalThis.OpenCabinetI18n.t("msg.427b00d77e"), true);
      return;
    }
    if (!details.title || !allPlatforms.some((platform) => platform.name === details.platform)) {
      showEditorTab("details");
      showToast(globalThis.OpenCabinetI18n.t("msg.237cbcd5ad"), true);
      return;
    }
    saving = true;
    const controls = [...form.querySelectorAll("input, select, textarea, button")].map((control) => [control, control.disabled]);
    controls.forEach(([control]) => { control.disabled = true; });
    let orderRefreshFailed = false;
    try {
      let updated = await invoke("update_game", { details });
      const current = allGames.find((game) => game.id === updated.id);
      if (orderPatch !== undefined) {
        try {
          const refreshed = await invoke("get_games");
          updated = refreshed.find(game=>game.id===updated.id) || updated;
          allGames = refreshed.map(projectRegionalStatistics);
        } catch { orderRefreshFailed = true; }
      }
      // Conservar las actualizaciones de sesión que llegaron mientras se guardaba el formulario.
      const currentStats = current?.combined_statistics || current;
      if (currentStats && (currentStats.session_count || 0) >= (updated.session_count || 0)
          && (currentStats.play_time_seconds || 0) >= (updated.play_time_seconds || 0)) {
        ["play_time", "play_time_seconds", "session_count", "last_played", "is_running", "finished_session"]
          .forEach((key) => { if (currentStats[key] !== undefined) updated[key] = currentStats[key]; });
        updated.finished_session = current.finished_session;
        updated.regions?.forEach(region => {
          const previous = current.regions?.find(item => item.game.id === region.game.id)?.game;
          if (previous) Object.assign(region.game, playStatisticsSnapshot(previous));
        });
      }
      projectRegionalStatistics(updated);
      allGames = allGames.map((game) => game.id === updated.id ? updated : game);
      // An image can be replaced in place. Recheck its disk signature after editing.
      const editedCover = displayGameImages(updated).find(image => image.kind === "cover")?.path;
      if (editedCover) catalogCoverCache?.invalidate(editedCover);
      gameImages(updated).filter(image => ['box_full','inlay'].includes(image.kind)).forEach(image => catalogCoverCache?.invalidate(image.path));
      updated.regions?.forEach(region => gameImages(region.game).forEach(image => catalogCoverCache?.invalidate(image.path)));
      if (variables !== null) libraryGameVariables[details.id] = variables;
      allGames.sort((a, b) => a.title.localeCompare(b.title, globalThis.OpenCabinetI18n.locale));
      // Mantiene visible el juego editado si cambió de consola o de título.
      if (selectedPlatform !== null) selectedPlatform = updated.platform;
      const search = document.getElementById("search-input");
      const query = search.value.toLowerCase().trim();
      if (!updated.title.toLowerCase().includes(query) && !updated.platform.toLowerCase().includes(query)) {
        search.value = "";
      }
      selectedGameId = updated.id;
      selectedGameIds = new Set([updated.id]);
      selectionAnchorId = updated.id;
      galleryGameId = null;
      galleryImagePath = null;
      renderPlatformFilters();
      applyLibraryFilters();
      saving = false;
      detailsGameBox?.refreshManuals();
      await close();
      showToast(globalThis.OpenCabinetI18n.t(orderRefreshFailed ? "order.saved_refresh_failed" : "msg.d81a84c181"),orderRefreshFailed);
    } catch (error) {
      showToast(globalThis.OpenCabinetI18n.t("msg.165b111771", error), true);
    } finally {
      saving = false;
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
    }
  });
}

// --- Lanzamiento de Juegos ---
async function launchGame(gameId, gameTitle) {
  const selected = allGames.find((game) => game.id === gameId);
  if (selected?.is_running || launchingGames.has(gameId)) return;
  launchingGames.add(gameId);
  let discId = null;
  let regionId = null;
  try {
    const repairDisc=(game,disc,isCurrent)=>getLibraryTools()?.replaceDisc(game,disc,isCurrent);
    let source = selected;
    if (selected?.regions?.length > 1) {
      regionId = await window.OpenCabinetRegions.chooseRegion(selected, invoke,{repairDisc});
      if (regionId === null) return;
      source = selected.regions.find(region => region.game.id === regionId)?.game;
      if (!source) throw new Error(globalThis.OpenCabinetI18n.t("msg.5877fb995a"));
    }
    if (source?.discs?.length > 1) {
      const discs = await invoke("get_game_discs", { id: source.id });
      discId = await window.OpenCabinetDiscs.chooseDisc(source, discs,{repairDisc});
      if (discId === null) return;
    }
    updatePlatformStatistics();
    if (selected && selectedGameId === gameId) updatePlayStatus(selected);
    showToast(`🚀 Iniciando ${gameTitle}...`);
    const result = await invoke("launch_game", { gameId, ...(regionId !== null ? { regionId } : {}), ...(discId !== null ? { discId } : {}) });
    applyPlayStatistics({ ...result, id: gameId });
    showToast(`🎮 ${result.message}`);
  } catch (error) {
    console.error("Error al lanzar juego:", error);
    getLibraryTools()?.diagnostic(String(error));
    showToast(`❌ ${error}`, true);
  } finally {
    launchingGames.delete(gameId);
    updatePlatformStatistics();
    const current = allGames.find((game) => game.id === gameId);
    if (current && selectedGameId === gameId) updatePlayStatus(current);
  }
}

// --- Carga y Gestión de Emuladores ---
async function loadEmulators() {
  try {
    const emulators = await invoke("get_emulators");
    allEmulators = emulators;
    allGames.forEach(game => {
      if (game.execution?.emulator_id != null && !emulators.some(emu => emu.id === game.execution.emulator_id && emu.platform.toLowerCase() === game.platform.toLowerCase())) {
        game.execution.emulator_id = null;
      }
    });
    renderEmulatorsTable(allEmulators);
    updatePlatformStatistics();
  } catch (error) {
    console.error("Error al cargar emuladores:", error);
    showToast(globalThis.OpenCabinetI18n.t("msg.031388d20b"), true);
  }
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
}

function renderEmulatorsTable(emulators) {
  const tbody = document.getElementById("emulator-table-body");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!emulators || emulators.length === 0) {
    tbody.innerHTML = globalThis.OpenCabinetI18n.t("msg.6d82f69e12");
    return;
  }

  emulators.forEach((emu) => {
    const tr = document.createElement("tr");
    tr.innerHTML = globalThis.OpenCabinetI18n.t("msg.366501f922", escapeHtml(emu.name), escapeHtml(emu.platform), escapeHtml(emu.executable_path), escapeHtml(emu.retroarch_core_path ? `-L "${emu.retroarch_core_path}" ${emu.arguments || '"%ROM%"'}` : emu.arguments || '"%ROM%"'), emu.id, emu.id, escapeHtml(emu.name));

    const editBtn = tr.querySelector(".edit-btn");
    editBtn.addEventListener("click", () => {
      startEditEmulator(emu);
    });

    const delBtn = tr.querySelector(".delete-btn");
    delBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = parseInt(e.target.getAttribute("data-id"));
      const name = e.target.getAttribute("data-name");
      if (await confirmDeletion(globalThis.OpenCabinetI18n.t("msg.c5e874a266"), globalThis.OpenCabinetI18n.t("msg.6542e8b7a2", name))) {
        await deleteEmulator(id, name);
      }
    });

    tbody.appendChild(tr);
  });
}

function startEditEmulator(emu) {
  if (retroarchSetup?.busy || savingEmulator) return;
  const editIdInput = document.getElementById("editing-emu-id");
  if (editIdInput) editIdInput.value = emu.id;

  const nameInput = document.getElementById("emu-name");
  if (nameInput) nameInput.value = emu.name;

  const platformInput = document.getElementById("emu-platform");
  if (platformInput) {
    platformInput.value = allPlatforms.find(
      (platform) => platform.name.toLowerCase() === emu.platform.toLowerCase(),
    )?.name || "";
  }

  const pathInput = document.getElementById("emu-path");
  if (pathInput) pathInput.value = emu.executable_path;

  const argsInput = document.getElementById("emu-args");
  if (argsInput) argsInput.value = emu.arguments || '"%ROM%"';
  emulatorArgumentDefaults?.edit();
  retroarchSetup?.edit(emu);

  const titleEl = document.getElementById("emu-form-title");
  if (titleEl) titleEl.textContent = globalThis.OpenCabinetI18n.t("msg.eaeed7a0ac", emu.name);

  const btnSave = document.getElementById("btn-save-emu");
  if (btnSave) btnSave.innerHTML = globalThis.OpenCabinetI18n.t("msg.7a28a67ea0");

  const btnCancel = document.getElementById("btn-cancel-edit-emu");
  if (btnCancel) btnCancel.classList.remove("hidden");

  document
    .getElementById("emulator-form")
    ?.scrollIntoView({ behavior: "smooth" });
}

function resetEmulatorForm() {
  if (retroarchSetup?.busy) return;
  const editIdInput = document.getElementById("editing-emu-id");
  if (editIdInput) editIdInput.value = "";

  const form = document.getElementById("emulator-form");
  if (form) form.reset();
  retroarchSetup?.reset();

  const argsInput = document.getElementById("emu-args");
  if (argsInput) argsInput.value = '"%ROM%"';
  emulatorArgumentDefaults?.reset();

  const titleEl = document.getElementById("emu-form-title");
  if (titleEl) titleEl.textContent = globalThis.OpenCabinetI18n.t("msg.87b0a93902");

  const btnSave = document.getElementById("btn-save-emu");
  if (btnSave) btnSave.innerHTML = globalThis.OpenCabinetI18n.t("msg.856129e2b9");

  const btnCancel = document.getElementById("btn-cancel-edit-emu");
  if (btnCancel) btnCancel.classList.add("hidden");
}

async function handleAddEmulator(e) {
  e.preventDefault();
  if (retroarchSetup?.busy || savingEmulator) return;
  const editingId = document.getElementById("editing-emu-id")?.value;
  const nameInput = document.getElementById("emu-name");
  const platformInput = document.getElementById("emu-platform");
  const pathInput = document.getElementById("emu-path");
  const argsInput = document.getElementById("emu-args");

  const name = nameInput.value.trim();
  const platform = platformInput.value.trim();
  const executablePath = pathInput.value.trim();
  const argumentsVal = argsInput.value.trim();

  if (!name || !platform || !executablePath) {
    showToast(globalThis.OpenCabinetI18n.t("msg.1132fbf118"), true);
    return;
  }

  if (!allPlatforms.some((item) => item.name === platform)) {
    showToast(globalThis.OpenCabinetI18n.t("msg.81134a8216"), true);
    return;
  }

  try {
    savingEmulator = true;
    const retroarchCorePath = await retroarchSetup?.prepare() || null;
    if (editingId) {
      await invoke("update_emulator", {
        id: parseInt(editingId),
        name,
        platform,
        executablePath,
        arguments: argumentsVal,
        retroarchCorePath,
      });
      showToast(globalThis.OpenCabinetI18n.t("msg.2102683c89", name));
    } else {
      await invoke("add_emulator", {
        name,
        platform,
        executablePath,
        arguments: argumentsVal,
        retroarchCorePath,
      });
      showToast(globalThis.OpenCabinetI18n.t("msg.83cbc6a37a", name, platform));
    }

    resetEmulatorForm();
    await loadEmulators();
    updateScannerEmulatorCheck();
  } catch (error) {
    console.error("Error al guardar/actualizar emulador:", error);
    showToast(globalThis.OpenCabinetI18n.t("msg.43f78154e1", error), true);
  } finally {
    savingEmulator = false;
  }
}

async function deleteEmulator(id, name) {
  try {
    await invoke("delete_emulator", { id });
    showToast(globalThis.OpenCabinetI18n.t("msg.5f8b40b556", name));
    resetEmulatorForm();
    await loadEmulators();
    updateScannerEmulatorCheck();
  } catch (error) {
    console.error("Error al eliminar emulador:", error);
    showToast(globalThis.OpenCabinetI18n.t("msg.73dd65508e", error), true);
  }
}

function populateEmulatorPlatformDropdown() {
  const select = document.getElementById("emu-platform");
  const previousValue = select.value;
  select.replaceChildren();
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = allPlatforms.length ? globalThis.OpenCabinetI18n.t("msg.d9de7e56bc") : globalThis.OpenCabinetI18n.t("msg.5248a1af67");
  placeholder.disabled = true;
  placeholder.defaultSelected = true;
  select.appendChild(placeholder);
  allPlatforms.forEach((platform) => {
    const option = document.createElement("option");
    option.value = platform.name;
    option.textContent = platform.name;
    select.appendChild(option);
  });
  select.value = allPlatforms.some((platform) => platform.name === previousValue) ? previousValue : "";
  select.disabled = allPlatforms.length === 0;
  document.getElementById("btn-save-emu").disabled = allPlatforms.length === 0;
  document.getElementById("emu-platform-help").textContent = allPlatforms.length
    ? globalThis.OpenCabinetI18n.t("msg.c623225ecc")
    : globalThis.OpenCabinetI18n.t("msg.13d03a623c");
}

// --- Carga de Plataformas desde la BD SQLite ---
async function loadPlatforms() {
  try {
    const platforms = await invoke("get_platforms");
    allPlatforms = platforms;
    populateEmulatorPlatformDropdown();
    renderPlatformsTable();
    renderPlatformFilters();
    if (selectedGameId === null && selectedPlatform !== null && window.OpenCabinetPlatforms) showPlatformDetails();
    return true;
  } catch (error) {
    console.error("Error al cargar plataformas desde la BD:", error);
    allPlatforms = [];
    populateEmulatorPlatformDropdown();
    showToast(globalThis.OpenCabinetI18n.t("msg.de90ee277b"), true);
    return false;
  }
}

function renderPlatformsTable() {
  const tbody = document.getElementById("platform-table-body");
  tbody.replaceChildren();
  if (allPlatforms.length === 0) {
    const cell = document.createElement("td");
    cell.colSpan = 3;
    cell.textContent = globalThis.OpenCabinetI18n.t("msg.12f47d7b73");
    const row = document.createElement("tr");
    row.appendChild(cell);
    tbody.appendChild(row);
  }
  allPlatforms.forEach((platform) => {
    const row = document.createElement("tr");
    [platform.name, platform.default_extensions].forEach((value) => {
      const cell = document.createElement("td");
      cell.textContent = value;
      row.appendChild(cell);
    });
    const actions = document.createElement("td");
    actions.className = "action-buttons-cell";
    const edit = document.createElement("button");
    edit.type = "button";
    edit.className = "edit-btn";
    edit.textContent = "✏️";
    edit.title = globalThis.OpenCabinetI18n.t("msg.fd33839788");
    edit.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.4b5017e503", platform.name));
    edit.addEventListener("click", () => {
      document.getElementById("editing-platform-id").value = platform.id;
      document.getElementById("platform-name").value = platform.name;
      document.getElementById("platform-extensions").value = platform.default_extensions;
      document.getElementById("platform-form-title").textContent = globalThis.OpenCabinetI18n.t("msg.1b440eccbb");
      document.getElementById("btn-save-platform").textContent = globalThis.OpenCabinetI18n.t("msg.2c2b380803");
      document.getElementById("btn-cancel-edit-platform").classList.remove("hidden");
      document.getElementById("platform-name").focus();
    });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "delete-btn";
    remove.textContent = "🗑️";
    remove.title = globalThis.OpenCabinetI18n.t("msg.679163a7ea");
    remove.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.7a35747e4e", platform.name));
    remove.addEventListener("click", async () => {
      if (!await confirmDeletion(globalThis.OpenCabinetI18n.t("msg.679163a7ea"), globalThis.OpenCabinetI18n.t("msg.69e6f04591", platform.name))) return;
      remove.disabled = true;
      try {
        await invoke("delete_platform", { id: platform.id });
        await refreshPlatformData();
        resetPlatformForm();
        showToast(globalThis.OpenCabinetI18n.t("msg.f1a48e2932", platform.name));
      } catch (error) {
        showToast(globalThis.OpenCabinetI18n.t("msg.43f78154e1", error), true);
      } finally {
        remove.disabled = false;
      }
    });
    const details = document.createElement("button");
    details.type = "button"; details.className = "edit-btn"; details.textContent = "🖼️";
    details.title = globalThis.OpenCabinetI18n.t("msg.2d1d5f9ba1");
    details.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.8b336eb6ff", platform.name));
    details.addEventListener("click", () => openPlatformDetailsEditor(platform));
    actions.append(edit, details, remove);
    row.appendChild(actions);
    tbody.appendChild(row);
  });
}

function resetPlatformForm() {
  document.getElementById("platform-form").reset();
  document.getElementById("editing-platform-id").value = "";
  document.getElementById("platform-form-title").textContent = globalThis.OpenCabinetI18n.t("msg.345dfb6277");
  document.getElementById("btn-save-platform").textContent = globalThis.OpenCabinetI18n.t("msg.f3730555ad");
  document.getElementById("btn-cancel-edit-platform").classList.add("hidden");
}

async function refreshPlatformData() {
  if (!await loadPlatforms()) throw new Error(globalThis.OpenCabinetI18n.t("msg.b64dbfc8d1"));
  if (window.OpenCabinetLibrary) {
    const navigation = await invoke("get_library_navigation");
    libraryCategories = navigation.categories ?? window.OpenCabinetLibrary.defaults();
    libraryManufacturers = navigation.manufacturers;
    libraryGameVariables = navigation.game_variables || {};
    libraryPlatformVariables = navigation.platform_variables || {};
  }
  await loadGames();
  await loadEmulators();
  const scannerPlatform = document.getElementById("scan-platform-select").value;
  populatePlatformDropdown();
  const select = document.getElementById("scan-platform-select");
  if ([...select.options].some((option) => option.value === scannerPlatform)) {
    select.value = scannerPlatform;
  }
  select.dispatchEvent(new Event("change"));
}

function setupPlatformModal() {
  const modal = document.getElementById("platform-modal");
  const openButton = document.getElementById("btn-open-platforms");
  const close = () => {
    modal.classList.add("hidden");
    resetPlatformForm();
    openButton.focus();
  };
  openButton.addEventListener("click", async (event) => {
    event.stopPropagation();
    if (inlineRetroarchSetup?.busy || savingInlineEmulator) return;
    document.getElementById("dropdown-options-menu").classList.remove("show");
    document.getElementById("menu-options-dropdown").classList.remove("active");
    document.getElementById("emulator-modal").classList.add("hidden");
    document.getElementById("scanner-modal").classList.add("hidden");
    resetPlatformForm();
    modal.classList.remove("hidden");
    document.getElementById("platform-name").focus();
    await loadPlatforms();
  });
  document.getElementById("btn-close-platform-modal").addEventListener("click", close);
  document.getElementById("btn-cancel-edit-platform").addEventListener("click", resetPlatformForm);
  setupModalBackdropClose(modal, close);
  modal.addEventListener("keydown", (event) => {
    if (event.key === "Tab") {
      const focusable = [...modal.querySelectorAll("button, input")]
        .filter((element) => !element.disabled && element.type !== "hidden" && !element.classList.contains("hidden"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });
  document.getElementById("platform-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("platform-name").value.trim();
    const defaultExtensions = document.getElementById("platform-extensions").value.trim();
    const editingId = document.getElementById("editing-platform-id").value;
    if (!name) {
      showToast(globalThis.OpenCabinetI18n.t("msg.b2fa682c6e"), true);
      return;
    }
    const save = document.getElementById("btn-save-platform");
    if (save.disabled) return;
    save.disabled = true;
    try {
      const previous = allPlatforms.find((platform) => platform.id === Number(editingId));
      const platform = await invoke(editingId ? "update_platform" : "add_platform", {
        ...(editingId ? { id: Number(editingId) } : {}), name, defaultExtensions,
      });
      if (previous && selectedPlatform?.toLowerCase() === previous.name.toLowerCase()) {
        selectedPlatform = platform.name;
      }
      await refreshPlatformData();
      resetPlatformForm();
      showToast(globalThis.OpenCabinetI18n.t("msg.54c6812b66", platform.name, editingId ? globalThis.OpenCabinetI18n.t("msg.ec4cc7e5b3") : globalThis.OpenCabinetI18n.t("msg.eb1e6e21a0")));
    } catch (error) {
      showToast(globalThis.OpenCabinetI18n.t("msg.43f78154e1", error), true);
    } finally {
      save.disabled = false;
    }
  });
}

// --- Filtros de la biblioteca ---
function renderPlatformFilters() {
  if (!allGames.length && (libraryLoading || libraryLoadError)) return;
  if (window.OpenCabinetLibrary) return renderLibraryNavigation();
  const list = document.getElementById("platform-list");
  const counts = new Map();
  allGames.forEach((game) => {
    counts.set(game.platform, (counts.get(game.platform) || 0) + 1);
  });
  if (selectedPlatform !== null && !counts.has(selectedPlatform)) {
    selectedPlatform = null;
  }

  list.replaceChildren();
  const platforms = [...counts.keys()].sort((a, b) => a.localeCompare(b, globalThis.OpenCabinetI18n.locale));
  [null, ...platforms].forEach((platform) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "platform-filter";
    if (platform !== null) button.dataset.platform = platform;
    button.setAttribute("aria-pressed", String(platform === selectedPlatform));
    button.setAttribute("aria-controls", "games-grid");
    const name = document.createElement("span");
    name.className = "platform-filter-name";
    name.textContent = platform === null ? globalThis.OpenCabinetI18n.t("msg.4ff402d768") : platform;
    const count = document.createElement("span");
    count.className = "platform-filter-count";
    count.textContent = String(platform === null ? allGames.length : counts.get(platform));
    button.append(name, count);
    button.addEventListener("click", () => {
      selectedPlatform = platform;
      selectedGameIds.clear(); selectedGameId = null; selectionAnchorId = null;
      list.querySelectorAll("button").forEach((item) => {
        item.setAttribute("aria-pressed", String(item === button));
      });
      applyLibraryFilters();
    });
    list.appendChild(button);
  });
}

function applyLibraryFilters() {
  const query = document.getElementById("search-input").value.toLowerCase().trim();
  const group = window.OpenCabinetLibrary && selectedLibraryGroup !== null ? libraryGroupNodes.get(selectedLibraryGroup) : null;
  const filtered = allGames.filter((game) =>
    (group ? group.ids.has(game.id) : selectedPlatform === null || game.platform === selectedPlatform) &&
    (game.title.toLowerCase().includes(query) || game.platform.toLowerCase().includes(query)),
  );
  renderGames(filtered);
}

function setupSearch() {
  const searchInput = document.getElementById("search-input");
  if (!searchInput) return;

  searchInput.addEventListener("input", applyLibraryFilters);
  if (!window.OpenCabinetLibrary) return;
  document.getElementById("library-grouping").addEventListener("change", event => {
    libraryGrouping = event.target.value;
    selectedLibraryGroup = null; selectedPlatform = null;
    selectedGameIds.clear(); selectedGameId = null; selectionAnchorId = null;
    renderPlatformFilters(); applyLibraryFilters();
  });
  libraryCategoryEditor = window.OpenCabinetLibrary.createEditor({ document, invoke,
    getCategories: () => libraryCategories ?? window.OpenCabinetLibrary.defaults(), getPlatforms: () => allPlatforms,
    getVariableNames: libraryVariableNames,
    onSave: categories => {
      libraryCategories = categories; renderPlatformFilters(); applyLibraryFilters();
      showToast(globalThis.OpenCabinetI18n.t("msg.71b348e134"));
    },
  });
  const categoryButton = document.getElementById("btn-library-categories");
  categoryButton.disabled = true;
  categoryButton.addEventListener("click", () => libraryCategoryEditor.open());
}

function renderLibraryNavigation() {
  const list = document.getElementById("platform-list");
  const tree = window.OpenCabinetLibrary.groups(allGames, libraryGrouping,
    libraryCategories ?? window.OpenCabinetLibrary.defaults(), allPlatforms, libraryManufacturers, libraryVariableContext());
  libraryGroupNodes = new Map();
  function index(nodes) { for (const node of nodes) { libraryGroupNodes.set(node.id, node); index(node.children); } }
  index(tree);
  if (libraryGrouping === "platform" && selectedPlatform !== null) selectedLibraryGroup = `platform:${selectedPlatform}`;
  if (selectedLibraryGroup !== null && !libraryGroupNodes.has(selectedLibraryGroup)) {
    selectedLibraryGroup = null; selectedPlatform = null;
  }
  list.setAttribute("aria-label", window.OpenCabinetLibrary.modes.find(([value]) => value === libraryGrouping)?.[1] || globalThis.OpenCabinetI18n.t("msg.c9169c12cb"));
  const scrollTop = list.scrollTop;
  list.replaceChildren();
  function button(node) {
    const item = document.createElement("button"); item.type = "button"; item.className = "platform-filter";
    if (node.platform) item.dataset.platform = node.platform;
    item.dataset.libraryGroup = node.id ?? "";
    item.setAttribute("aria-pressed", String(node.id === selectedLibraryGroup));
    item.setAttribute("aria-controls", "games-grid");
    const label = document.createElement("span"); label.className = "platform-filter-name"; label.textContent = node.label;
    if (libraryGrouping === "date" && /^\d{4}-\d{2}-\d{2}$/.test(node.label)) label.textContent = node.label.split("-").reverse().join("/");
    const count = document.createElement("span"); count.className = "platform-filter-count"; count.textContent = String(node.ids.size);
    item.append(label, count);
    item.onclick = () => {
      selectedLibraryGroup = node.id; selectedPlatform = node.platform ?? null;
      selectedGameIds.clear(); selectedGameId = null; selectionAnchorId = null;
      list.querySelectorAll(".platform-filter").forEach(el => el.setAttribute("aria-pressed", String(el === item)));
      applyLibraryFilters();
    };
    return item;
  }
  list.appendChild(button({ id: null, label: globalThis.OpenCabinetI18n.t("msg.4ff402d768"), ids: new Set(allGames.map(g => g.id)) }));
  function append(nodes, container) {
    for (const node of nodes) {
      if (!node.children.length) { container.appendChild(button(node)); continue; }
      const row = document.createElement("div"); row.className = "library-tree-row";
      const children = document.createElement("div"); children.className = "library-tree-children";
      const toggle = document.createElement("button"); toggle.type = "button"; toggle.className = "library-tree-toggle";
      function sync() {
        const collapsed = collapsedLibraryGroups.has(node.id); children.classList.toggle("hidden", collapsed);
        toggle.textContent = collapsed ? "▸" : "▾"; toggle.setAttribute("aria-expanded", String(!collapsed));
        toggle.setAttribute("aria-label", `${collapsed ? globalThis.OpenCabinetI18n.t("msg.e095e6d559") : globalThis.OpenCabinetI18n.t("msg.a4698e72ab")} ${node.label}`);
      }
      toggle.onclick = () => { if (collapsedLibraryGroups.has(node.id)) collapsedLibraryGroups.delete(node.id); else collapsedLibraryGroups.add(node.id); sync(); };
      sync(); row.append(toggle, button(node)); container.append(row, children); append(node.children, children);
    }
  }
  append(tree, list); list.scrollTop = scrollTop;
}

// --- Notificaciones Toast ---
function showToast(message, isError = false) {
  const toast = document.getElementById("toast-notification");
  if (!toast) return;

  toast.textContent = message;
  toast.className = `toast ${isError ? "error" : ""}`;

  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => {
    toast.className = "toast hidden";
  }, 4000);
}

// --- Flujo del Escaneador de ROMs ---
function isPcPlatform(platform) {
  return ["pc", "pcgames", "pcwindows", "windows", "windowsgames", "microsoftwindows"].includes(String(platform).toLowerCase().replace(/[^a-z0-9]/g, ""));
}

function importRunsDirectly() {
  return (importMode === "single" || importMode === "folder") && !!document.getElementById("scan-launch-directly")?.checked;
}

function importUsesFileSelection() {
  return importMode === "single" || (importMode === "folder" && importRunsDirectly());
}

function updateImportSourceUI() {
  const single = importUsesFileSelection(), steam = importMode === "steam", epic = importMode === "epic", store = steam || epic, pc = isPcPlatform(getSelectedPlatformName());
  const visible = (id, show) => { const item = document.getElementById(id); if (show) item?.classList.remove("hidden"); else item?.classList.add("hidden"); };
  const files = importConfigPage === "files";
  for (const [id, active] of [["import-platform-step", !files], ["import-files-step", files]]) {
    visible(id, active);
    const section = document.getElementById(id); if (section) section.disabled = !active;
  }
  visible("btn-import-next", !files); visible("btn-execute-scan", files);
  const next = document.getElementById("btn-import-next");
  if (next) next.disabled = scanInProgress || !!inlineRetroarchSetup?.busy || savingInlineEmulator || (!single && !store && pc);
  const heading = document.getElementById("import-step-label");
  if (heading) heading.textContent = files ? globalThis.OpenCabinetI18n.t("msg.3d51f6a56c") : globalThis.OpenCabinetI18n.t("msg.132f00c3a5");
  visible("scan-folder-step", !single && !store); visible("scan-single-step", single); visible("scan-steam-step", steam); visible("scan-epic-step", epic);
  visible("scan-folder-console-help", !single && !store && /^(?:sony)?(?:playstation|ps)[34]$/.test(getSelectedPlatformName().toLowerCase().replace(/[^a-z0-9]/g,'')));
  visible("scan-direct-choice", !store && !pc);
  visible("scan-emulator-step", !pc && !store); visible("scan-direct-help", single && pc); visible("scan-pc-folder-help", !single && !store && pc);
  for (const id of ["scan-folder-input", "scan-extensions-input"]) { const input = document.getElementById(id); if (input) input.disabled = single || store; }
  const folder = document.getElementById("scan-folder-input"); if (folder) folder.required = !single && !store;
  for (const id of ["scan-file-input", "scan-single-title"]) { const input = document.getElementById(id); if (input) { input.disabled = !single; input.required = single; } }
  const label = document.getElementById("scan-file-label"); if (label) label.textContent = (pc || importRunsDirectly()) ? globalThis.OpenCabinetI18n.t("msg.215b9a8198") : globalThis.OpenCabinetI18n.t("msg.8aafd7c83d");
  const submit = document.getElementById("btn-execute-scan");
  if (submit && !scanInProgress) { submit.textContent = store ? globalThis.OpenCabinetI18n.t("msg.649475b2ef", epic ? "Epic Games" : "Steam") : single ? globalThis.OpenCabinetI18n.t("msg.36f227205d") : globalThis.OpenCabinetI18n.t("msg.cd70ffa805"); submit.disabled = (!single && !store && pc) || !!inlineRetroarchSetup?.busy || savingInlineEmulator; }
}

function warmImportCatalog() {
  return metadataCatalogWarmup ||= invoke("preload_metadata_catalog").then(summary => {
    metadataCatalogSummary = summary; return summary;
  }).catch(() => { metadataCatalogWarmup = null; return null; });
}

function chooseImportMode(mode) {
  if (scanInProgress || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
  ++singleFileRequest; importMode = mode;
  const directChoice = document.getElementById("scan-launch-directly"); if (directChoice) directChoice.checked = false;
  if (mode) warmImportCatalog();
  importConfigPage = "platform";
  if (mode === "steam" || mode === "epic") document.getElementById("scan-platform-select").value = allPlatforms.find(platform => isPcPlatform(platform.name))?.name || "PC";
  document.getElementById("import-mode-step").classList.toggle("hidden", mode !== null);
  const config = document.getElementById("import-config-step"); config.classList.toggle("hidden", mode === null); config.disabled = mode === null;
  document.getElementById("scan-file-input").value = ""; document.getElementById("scan-single-title").value = "";
  ["scan-result-container", "scan-progress-container"].forEach(id => document.getElementById(id).classList.add("hidden"));
  document.getElementById("scan-steam-status").textContent = "";
  document.getElementById("scan-steam-warnings").classList.add("hidden");
  document.getElementById("scan-epic-status").textContent = "";
  document.getElementById("scan-epic-warnings").classList.add("hidden");
  updateScannerEmulatorCheck();
}

function setupScannerModal() {
  document.getElementById("scan-launch-directly")?.addEventListener("change", () => {
    ++singleFileRequest;
    document.getElementById("scan-file-input").value = "";
    document.getElementById("scan-single-title").value = "";
    updateScannerEmulatorCheck();
  });
  const modal = document.getElementById("scanner-modal");
  const btnOpenScanner = document.getElementById("btn-scan-roms");
  const btnCloseModal = document.getElementById("btn-close-scanner-modal");
  const platformSelect = document.getElementById("scan-platform-select");
  const emuSelect = document.getElementById("scan-emu-select");
  const customPlatformGroup = document.getElementById("custom-platform-group");
  const customPlatformInput = document.getElementById("custom-platform-input");
  const scanForm = document.getElementById("scanner-form");
  const btnBrowseFolder = document.getElementById("btn-browse-folder");
  const scanFolderInput = document.getElementById("scan-folder-input");
  const noEmuInlineBox = document.getElementById("no-emu-inline-box");
  document.getElementById("btn-import-single")?.addEventListener("click", () => chooseImportMode("single"));
  document.getElementById("btn-import-folder")?.addEventListener("click", () => chooseImportMode("folder"));
  document.getElementById("btn-import-steam")?.addEventListener("click", () => chooseImportMode("steam"));
  document.getElementById("btn-import-epic")?.addEventListener("click", () => chooseImportMode("epic"));
  document.getElementById("btn-browse-epic")?.addEventListener("click", async () => {
    if (scanInProgress || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
    const token = ++singleFileRequest;
    try { const path = await invoke("select_epic_folder"); if (token === singleFileRequest && importMode === "epic" && path) document.getElementById("scan-epic-path").value = path; }
    catch (error) { if (token === singleFileRequest) showToast(globalThis.OpenCabinetI18n.t("msg.3107ed9081", error), true); }
  });
  document.getElementById("btn-browse-steam")?.addEventListener("click", async () => {
    if (scanInProgress || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
    const token = ++singleFileRequest;
    try { const path = await invoke("select_steam_folder"); if (token === singleFileRequest && importMode === "steam" && path) document.getElementById("scan-steam-path").value = path; }
    catch (error) { if (token === singleFileRequest) showToast(globalThis.OpenCabinetI18n.t("msg.feb645c193", error), true); }
  });
  document.getElementById("btn-import-back")?.addEventListener("click", () => {
    if (scanInProgress || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
    if (importConfigPage === "files") { importConfigPage = "platform"; updateImportSourceUI(); platformSelect.focus(); }
    else chooseImportMode(null);
  });
  function continueToFiles() {
    if (scanInProgress || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
    const platform = getSelectedPlatformName(), pc = isPcPlatform(platform);
    const store = importMode === "steam" || importMode === "epic";
    if (!platform) { showToast(globalThis.OpenCabinetI18n.t("msg.325a998f3b"), true); platformSelect.focus(); return; }
    if (store && !pc) { showToast(globalThis.OpenCabinetI18n.t("msg.c564b74c55"), true); return; }
    if (importMode === "folder" && pc) { showToast(globalThis.OpenCabinetI18n.t("msg.04dbcccb3c"), true); return; }
    if (!pc && !importRunsDirectly() && (!allEmulators.some(emu => emu.platform.toLowerCase() === platform.toLowerCase()) || emuSelect.value === "__add_new__")) {
      showToast(globalThis.OpenCabinetI18n.t("msg.6bf33b4ff0", platform), true); return;
    }
    importConfigPage = "files"; updateImportSourceUI();
    document.getElementById(store ? `scan-${importMode}-path` : importUsesFileSelection() ? "btn-browse-game-file" : "btn-browse-folder").focus();
  }
  document.getElementById("btn-import-next")?.addEventListener("click", continueToFiles);
  document.getElementById("btn-browse-game-file")?.addEventListener("click", async () => {
    if (scanInProgress || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
    const platform = getSelectedPlatformName();
    if (!platform) { showToast(globalThis.OpenCabinetI18n.t("msg.fa691ddc0a"), true); return; }
    const token = ++singleFileRequest, button = document.getElementById("btn-browse-game-file"); button.disabled = true;
    try {
      const selected = await invoke("select_game_file", { platform, launchDirectly: importRunsDirectly(), extensions: document.getElementById("scan-extensions-input").value.split(",").map(value => value.trim()).filter(Boolean) });
      if (token !== singleFileRequest || !importUsesFileSelection() || !selected) return;
      document.getElementById("scan-file-input").value = selected.rom_path;
      document.getElementById("scan-single-title").value = selected.title;
      document.getElementById("scan-single-title").focus();
    } catch (error) { if (token === singleFileRequest) showToast(globalThis.OpenCabinetI18n.t("msg.b11f414346", error), true); }
    finally { if (!scanInProgress) button.disabled = false; }
  });
  if (window.OpenCabinetRetroArch && !inlineRetroarchSetup) {
    inlineRetroarchSetup = window.OpenCabinetRetroArch.create({
      document, invoke, Channel: window.__TAURI__.core.Channel,
      onTask: event => trackRetroArchOperation("scanner-modal", event),
      getPlatform: getSelectedPlatformName,
      onIdentityChanged: () => inlineEmulatorArgumentDefaults?.refresh(),
      elementIds: {
        "emu-type":"inline-emu-type", "emu-path":"inline-emu-path", "emu-name":"inline-emu-name",
        "emu-platform":"scan-platform-select", "emu-args":"inline-emu-args", "retroarch-options":"inline-retroarch-options",
        "ra-system":"inline-ra-system", "ra-core":"inline-ra-core", "ra-status":"inline-ra-status",
        "ra-core-description":"inline-ra-core-description", "ra-firmware":"inline-ra-firmware", "ra-progress":"inline-ra-progress",
        "btn-install-retroarch":"btn-inline-install-retroarch", "btn-refresh-ra-cores":"btn-inline-refresh-ra-cores",
        "btn-cancel-ra":"btn-inline-cancel-ra", "btn-browse-emu":"btn-browse-inline-emu",
        "btn-save-emu":"btn-inline-save-emu", "btn-cancel-edit-emu":null, "btn-close-modal":"btn-close-scanner-modal",
      },
      extraControls: [customPlatformInput, emuSelect, document.getElementById("btn-execute-scan"), document.getElementById("btn-import-next"), document.getElementById("btn-import-back")],
    });
  }

  // Botón para examinar carpetas de Windows (diálogo nativo moderno de rfd)
  btnBrowseFolder?.addEventListener("click", async () => {
    try {
      const selectedPath = await invoke("select_folder");
      if (selectedPath) {
        scanFolderInput.value = selectedPath;
      }
    } catch (err) {
      console.error("Error al abrir selector de carpeta:", err);
      showToast(globalThis.OpenCabinetI18n.t("msg.3a284be5bf"), true);
    }
  });

  // Abrir modal de escaneo desde Menú > Herramientas
  btnOpenScanner?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (retroarchSetup?.busy || savingEmulator) return;
    // Read only the local catalog; opening the importer never downloads it or
    // creates a metadata catalog job. The backend shares this cache with later steps.
    warmImportCatalog();
    if (inlineRetroarchSetup?.busy || savingInlineEmulator) { retroarchProgressTask?.restore(); modal.classList.remove("hidden"); return; }
    document.getElementById("dropdown-tools-menu")?.classList.remove("show");
    document.getElementById("menu-tools-dropdown")?.classList.remove("active");
    document.getElementById("platform-modal").classList.add("hidden");
    if (scanInProgress) {
      if (importProgressTask) { importProgressTask.restore(); return; }
      modal.classList.remove("hidden");
      return;
    }
    await loadEmulators();
    await loadPlatforms();
    populatePlatformDropdown();

    if (customPlatformGroup) customPlatformGroup.classList.add("hidden");
    if (customPlatformInput) customPlatformInput.value = "";

    chooseImportMode(null);
    platformSelect.dispatchEvent(new Event("change"));
    modal.classList.remove("hidden");
    document.getElementById('scan-save-folder').checked=false;
    savedFolderScan=null;
    if(savedFolderImport){
      const {platform,folder}=savedFolderImport;savedFolderImport=null;
      savedFolderScan=createSavedFolderScan();
      chooseImportMode('folder');platformSelect.value=platform.name;platformSelect.dispatchEvent(new Event('change'));
      scanFolderInput.value=folder.directory;document.getElementById('scan-extensions-input').value=folder.extensions.join(', ');
      if(allEmulators.some(emu=>emu.platform.toLowerCase()===platform.name.toLowerCase())){
        importConfigPage='files';updateImportSourceUI();void handleExecuteScan();
      }
    }
  });

  // Cerrar modal
  function closeScanner() {
    if (inlineRetroarchSetup?.busy || savingInlineEmulator) {
      if (retroarchProgressTask?.modalId === "scanner-modal") retroarchProgressTask.minimize();
      return;
    }
    if(closeSavedFolderScan())return;
    if (scanInProgress) { importProgressTask?.minimize(); return; }
    inlineRetroarchSetup?.reset();
    inlineEmulatorArgumentDefaults?.reset();
    ++singleFileRequest;
    modal.classList.add("hidden");
  }
  btnCloseModal?.addEventListener("click", closeScanner);
  setupModalBackdropClose(modal, closeScanner);

  // Cambio de selección de plataforma
  platformSelect?.addEventListener("change", () => {
    ++singleFileRequest;
    document.getElementById("scan-file-input").value = "";
    document.getElementById("scan-single-title").value = "";
    const selected = platformSelect.value;
    if (selected === "__custom__") {
      customPlatformGroup?.classList.remove("hidden");
      if (customPlatformInput) customPlatformInput.focus();
    } else {
      customPlatformGroup?.classList.add("hidden");
    }

    const platformName = getSelectedPlatformName();
    const matchedPlatform = allPlatforms.find(
      (p) => p.name.toLowerCase() === platformName.toLowerCase(),
    );

    const extInput = document.getElementById("scan-extensions-input");
    if (extInput) {
      if (matchedPlatform) {
        extInput.value = matchedPlatform.default_extensions;
      } else {
        extInput.value = ".iso, .zip, .7z, .bin, .chd";
      }
    }

    updateScannerEmulatorCheck();
  });

  customPlatformInput?.addEventListener("input", () => {
    ++singleFileRequest;
    document.getElementById("scan-file-input").value = "";
    updateScannerEmulatorCheck();
  });

  // Listener para cuando se selecciona "➕ Configurar nuevo emulador..." en plataformas con emuladores
  emuSelect?.addEventListener("change", () => {
    const targetPlatformSpan = document.getElementById(
      "inline-target-platform",
    );
    if (emuSelect.value === "__add_new__") {
      noEmuInlineBox?.classList.remove("hidden");
      const currentPlatform = getSelectedPlatformName();
      if (targetPlatformSpan) targetPlatformSpan.textContent = currentPlatform;
      const inlineNameInput = document.getElementById("inline-emu-name");
      if (inlineNameInput && document.getElementById("inline-emu-type")?.value !== "retroarch")
        inlineNameInput.value = `${currentPlatform} Emulator`;
    } else {
      noEmuInlineBox?.classList.add("hidden");
    }
  });

  // Envío del formulario de escaneo
  scanForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (importConfigPage !== "files") { continueToFiles(); return; }
    await handleExecuteScan();
  });

  // Handler para guardar emulador inline directamente desde el escaneador
  const btnInlineSaveEmu = document.getElementById("btn-inline-save-emu");
  btnInlineSaveEmu?.addEventListener("click", saveScannerEmulator);
}

async function saveScannerEmulator() {
    if (savingInlineEmulator || inlineRetroarchSetup?.busy || scanInProgress) return;
    const platform = getSelectedPlatformName();
    const name = document.getElementById("inline-emu-name")?.value.trim();
    const executablePath = document
      .getElementById("inline-emu-path")
      ?.value.trim();
    const argumentsVal =
      document.getElementById("inline-emu-args")?.value.trim() || "";

    if (!platform) {
      showToast(globalThis.OpenCabinetI18n.t("msg.7af6ac90e7"), true);
      return;
    }

    if (!name || !executablePath) {
      showToast(
        globalThis.OpenCabinetI18n.t("msg.502b2d3d45"),
        true,
      );
      return;
    }

    const controls = ["btn-inline-save-emu", "scan-platform-select", "custom-platform-input", "scan-emu-select", "btn-execute-scan", "btn-import-next", "btn-import-back", "btn-close-scanner-modal"]
      .map(id => document.getElementById(id)).filter(Boolean).map(element => [element, element.disabled]);
    savingInlineEmulator = true;
    controls.forEach(([element]) => { element.disabled = true; });
    try {
      const retroarchCorePath = await inlineRetroarchSetup?.prepare() || null;
      const matchedPlatform = allPlatforms.find(
        (p) => p.name.toLowerCase() === platform.toLowerCase(),
      );

      if (!matchedPlatform) {
        const extRaw = document
          .getElementById("scan-extensions-input")
          ?.value.trim();
        await invoke("add_platform", {
          name: platform,
          defaultExtensions: extRaw || ".iso, .zip, .7z, .bin",
        });
        await loadPlatforms();
      }

      await invoke("add_emulator", { name, platform, executablePath, arguments: argumentsVal, retroarchCorePath });

      showToast(globalThis.OpenCabinetI18n.t("msg.c03ce9adf0", name, platform));
      await loadEmulators();
      updateScannerEmulatorCheck();
    } catch (err) {
      showToast(globalThis.OpenCabinetI18n.t("msg.a9b9283933", err), true);
    } finally {
      savingInlineEmulator = false;
      controls.forEach(([element, disabled]) => { element.disabled = disabled; });
      updateImportSourceUI();
    }
}

function getSelectedPlatformName() {
  const platformSelect = document.getElementById("scan-platform-select");
  if (!platformSelect) return "";
  if (platformSelect.value === "__custom__") {
    return document.getElementById("custom-platform-input")?.value.trim() || "";
  }
  return platformSelect.value;
}

function populatePlatformDropdown() {
  const platformSelect = document.getElementById("scan-platform-select");
  if (!platformSelect) return;

  const platformNames = new Set(allPlatforms.map((p) => p.name));
  allEmulators.forEach((e) => platformNames.add(e.platform));
  allGames.forEach((g) => platformNames.add(g.platform));
  if (![...platformNames].some(isPcPlatform)) platformNames.add("PC");

  const sortedPlatforms = Array.from(platformNames).sort();

  platformSelect.replaceChildren();
  [...sortedPlatforms, "__custom__"].forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name === "__custom__" ? globalThis.OpenCabinetI18n.t("msg.bb13f15677") : name;
    platformSelect.appendChild(option);
  });

  if (sortedPlatforms.length > 0) {
    platformSelect.value = sortedPlatforms[0];
  }
}

function updateScannerEmulatorCheck() {
  const platform = getSelectedPlatformName();
  updateImportSourceUI();
  if (importMode === "steam" || importMode === "epic" || isPcPlatform(platform) || importRunsDirectly()) {
    document.getElementById("emu-select-group")?.classList.add("hidden");
    document.getElementById("no-emu-inline-box")?.classList.add("hidden");
    return;
  }
  inlineRetroarchSetup?.platformChanged();
  const emuSelectGroup = document.getElementById("emu-select-group");
  const emuSelect = document.getElementById("scan-emu-select");
  const noEmuInlineBox = document.getElementById("no-emu-inline-box");
  const targetPlatformSpan = document.getElementById("inline-target-platform");

  if (!platform) {
    emuSelectGroup?.classList.add("hidden");
    noEmuInlineBox?.classList.remove("hidden");
    if (targetPlatformSpan) {
      targetPlatformSpan.textContent =
        globalThis.OpenCabinetI18n.t("msg.e9e18f3b49");
    }
    return;
  }

  const matchingEmulators = allEmulators.filter(
    (e) => e.platform.toLowerCase() === platform.toLowerCase(),
  );

  if (matchingEmulators.length > 0) {
    emuSelectGroup?.classList.remove("hidden");
    if (emuSelect) {
      emuSelect.innerHTML = matchingEmulators
        .map(
          (e) =>
            `<option value="${e.id}">${e.name} (${e.executable_path})</option>`,
        )
        .join("");
      emuSelect.innerHTML += globalThis.OpenCabinetI18n.t("msg.7c1a8d7dff");
      const preferred = [...matchingEmulators].sort((a, b) => Number(Boolean(b.is_default)) - Number(Boolean(a.is_default)) || a.id - b.id)[0];
      emuSelect.value = String(preferred.id);
    }

    if (emuSelect && emuSelect.value === "__add_new__") {
      noEmuInlineBox?.classList.remove("hidden");
      if (targetPlatformSpan) targetPlatformSpan.textContent = platform;
    } else {
      noEmuInlineBox?.classList.add("hidden");
    }
  } else {
    emuSelectGroup?.classList.add("hidden");
    noEmuInlineBox?.classList.remove("hidden");
    if (targetPlatformSpan) {
      targetPlatformSpan.textContent = platform;
    }
    const inlineNameInput = document.getElementById("inline-emu-name");
    if (inlineNameInput && document.getElementById("inline-emu-type")?.value !== "retroarch") {
      inlineNameInput.value = `${platform} Emulator`;
    }
  }
}

function reviewScannedGames(preview,operation=null) {
  const platform = getSelectedPlatformName();
  const direct = importRunsDirectly() || isPcPlatform(platform);
  const addFile = document.getElementById("btn-review-add-file");
  const addFolder = document.getElementById("btn-review-add-folder");
  const addStatus = document.getElementById("scan-review-add-status");
  const extensions = document.getElementById("scan-extensions-input").value.split(",").map(v => v.trim()).filter(Boolean);
  const canAddFolder = !direct && importMode !== "steam" && importMode !== "epic";
  let alive = true, adding = false, activeProgress = null;
  addFolder.classList[canAddFolder ? "remove" : "add"]("hidden");
  addFile.disabled = false; addFolder.disabled = false; addStatus.textContent = "";
  const container = document.getElementById("scan-review-container");
  const list = document.getElementById("scan-review-list");
  const proceed = document.getElementById("btn-confirm-scan-review");
  const cancel = document.getElementById("btn-cancel-scan-review");
  const summary = document.getElementById("scan-review-summary");
  list.replaceChildren();
  const entries = [];
  function updateSummary() {
    const remaining = entries.filter((entry) => !entry.removed).length;
    const removed = entries.filter(entry => entry.removed && !entry.split).length;
    summary.textContent = globalThis.OpenCabinetI18n.t("msg.b4eff6c556", remaining, preview.skipped_count)
      + (removed ? globalThis.OpenCabinetI18n.t("msg.fdebce779d", removed) : "");
    proceed.disabled = adding || remaining === 0;
  }
  const fragment = document.createDocumentFragment();
  function addReviewEntry(game, destination) {
    const item = document.createElement("li");
    const title = document.createElement("input");
    title.type = "text";
    title.value = game.title;
    title.required = true;
    title.autocomplete = "off";
    title.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.fae4f22389", game.rom_path.split(/[\\/]/).pop()));
    title.oninput = () => title.setCustomValidity("");
    const entry = { game, title, removed: false };
    entries.push(entry);
    const filename = document.createElement("span");
    filename.textContent = game.steam ? `Steam · AppID ${game.steam.app_id}` : game.epic ? `Epic Games · ${game.epic.app_id}` : game.rom_path.split(/[\\/]/).pop();
    filename.title = game.steam?.manifest_path || game.epic?.manifest_path || game.rom_path;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "secondary-btn scan-review-remove";
    remove.textContent = "🗑️";
    remove.title = globalThis.OpenCabinetI18n.t("msg.1e821bbc3a");
    remove.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.53e7b659e2", game.title, filename.textContent));
    remove.onclick = () => {
      entry.removed = true;
      item.remove();
      updateSummary();
    };
    item.append(title, filename, remove);
    if (game.discs?.length || game.existing_game_id) {
      const discPanel = document.createElement("div"); discPanel.className = "disc-import-panel";
      const suggestedTarget = game.existing_game_id;
      game.existing_game_id = null;
      if (suggestedTarget) {
        const label = document.createElement("label"); label.className = "preference-toggle";
        const check = document.createElement("input"); check.type = "checkbox";
        const target = allGames.find(g => g.id === suggestedTarget);
        const text = document.createElement("span"); text.textContent = globalThis.OpenCabinetI18n.t("msg.bcded9091a", target?.title || suggestedTarget);
        check.onchange = () => { game.existing_game_id = check.checked ? suggestedTarget : null; };
        label.append(check, text); discPanel.append(label);
      }
      const discList = document.createElement("div"); discPanel.append(discList);
      function renderDiscs() {
        discList.replaceChildren();
        (game.discs || []).forEach((disc, index) => {
          const row = document.createElement("div"); row.className = "disc-import-row";
          const text = document.createElement("span"); text.textContent = `${disc.label} · ${disc.rom_path.split(/[\\/]/).pop()}`; text.title = disc.rom_path;
          const del = document.createElement("button"); del.type = "button"; del.className = "secondary-btn";
          del.textContent = globalThis.OpenCabinetI18n.t("msg.39271cab9d"); del.disabled = game.discs.length <= 1;
          del.onclick = () => { game.discs.splice(index, 1); game.rom_path = game.discs[0].rom_path; renderDiscs(); };
          row.append(text, del); discList.append(row);
        });
      }
      renderDiscs();
      if (game.discs?.length > 1) {
        const split = document.createElement("button"); split.type = "button"; split.className = "secondary-btn"; split.textContent = globalThis.OpenCabinetI18n.t("msg.253e9d459e");
        split.onclick = () => {
          entry.removed = true; entry.split = true; item.remove();
          game.discs.forEach(disc => addReviewEntry({ ...game, title: title.value.trim() || game.title, rom_path: disc.rom_path, discs: [disc], existing_game_id: null }, list));
          updateSummary();
        };
        discPanel.append(split);
      }
      item.append(discPanel);
    }
    destination.appendChild(item);
  }
  preview.games.forEach(game => addReviewEntry(game, fragment));
  list.appendChild(fragment);
  updateSummary();
  container.classList.remove("hidden");
  container.scrollIntoView({ block: "nearest", behavior: "smooth" });
  document.getElementById("scan-review-title").focus({ preventScroll: true });
  return new Promise((resolve) => {
    async function addGames(folder) {
      if (!alive || adding) return;
      adding = true; addFile.disabled = true; addFolder.disabled = true; updateSummary();
      addStatus.textContent = globalThis.OpenCabinetI18n.t("import.review-add-busy");
      try {
        let extra;
        if (folder) {
          const folderPath = await invoke("select_folder");
          if (!alive || !folderPath) { if (alive) addStatus.textContent = ""; return; }
          const onProgress = new window.__TAURI__.core.Channel();
          activeProgress = onProgress;
          onProgress.onmessage = progress => { if (alive && activeProgress === onProgress) addStatus.textContent = globalThis.OpenCabinetI18n.t("import.review-add-busy") + (progress.current_file ? ` ${progress.current_file}` : ""); };
          extra = await invoke("scan_roms_folder", { folderPath, platform, customExtensions: extensions.length ? extensions : null, onProgress });
        } else {
          const selected = await invoke("select_game_file", { platform, extensions, launchDirectly: direct });
          if (!alive || !selected) { if (alive) addStatus.textContent = ""; return; }
          extra = await invoke("preview_single_game", { filePath: selected.rom_path, platform, title: selected.title, launchDirectly: direct });
        }
        if (!alive) return;
        if (!direct && extra.games.some(game => game.discs?.length)) {
          extra = await invoke("prepare_disc_import", { preview: extra, platform });
          if (!alive) return;
        }
        const key = path => path.replace(/\\/g, "/").toLowerCase();
        const paths = game => game.discs?.length ? game.discs.map(disc => disc.rom_path) : [game.rom_path];
        const seen = new Set(entries.filter(entry => !entry.removed).flatMap(entry => paths(entry.game).map(key)));
        preview.total_found += extra.total_found;
        preview.skipped_count += extra.skipped_count;
        for (const game of extra.games) {
          const originals = paths(game);
          if (originals.some(path => seen.has(key(path)))) {
            if (!game.discs?.length) { preview.skipped_count++; continue; }
            game.discs = game.discs.filter(disc => !seen.has(key(disc.rom_path)));
            preview.skipped_count += originals.length - game.discs.length;
            if (!game.discs.length) continue;
            game.rom_path = game.discs[0].rom_path;
          }
          paths(game).forEach(path => seen.add(key(path)));
          addReviewEntry(game, list);
        }
        addStatus.textContent = "";
      } catch (error) {
        if (alive) addStatus.textContent = globalThis.OpenCabinetI18n.t("import.review-add-error", error);
      } finally {
        activeProgress = null;
        if (alive) { adding = false; addFile.disabled = false; addFolder.disabled = false; updateSummary(); }
      }
    }
    addFile.onclick = () => addGames(false);
    addFolder.onclick = () => { if (canAddFolder) return addGames(true); };
    function finish(confirmed) {
      if(!alive)return;
      if(operation){if(!confirmed)operation.cancelled=true;operation.cancelStep=null;}
      alive = false; activeProgress = null; addFile.onclick = null; addFolder.onclick = null;
      proceed.onclick = null;
      cancel.onclick = null;
      container.classList.add("hidden");
      list.replaceChildren();
      resolve(confirmed);
    }
    proceed.onclick = () => {
      if (adding || !alive) return;
      const retained = entries.filter((entry) => !entry.removed);
      if (retained.length === 0) return;
      const titleInputs = retained.map((entry) => entry.title);
      const titles = titleInputs.map((input) => input.value.trim());
      const invalidIndex = titles.findIndex((title) => title.length === 0);
      if (invalidIndex !== -1) {
        const input = titleInputs[invalidIndex];
        input.setCustomValidity(globalThis.OpenCabinetI18n.t("msg.40d5fb252e"));
        input.focus();
        input.reportValidity();
        return;
      }
      preview.games = retained.map((entry, index) => ({ ...entry.game, title: titles[index] }));
      finish(true);
    };
    cancel.onclick = () => finish(false);
    if(operation)operation.cancelStep=()=>finish(false);
  });
}

function updateScanProgress(progress) {
  const bar = document.getElementById("scan-progress-bar");
  const label = document.getElementById("scan-progress-label");
  const counts = document.getElementById("scan-progress-counts");
  document.getElementById("scan-current-file").textContent = progress.current_file || "";
  if (progress.phase === "discovering") {
    bar.removeAttribute("value");
    label.textContent = globalThis.OpenCabinetI18n.t("msg.8c9c30f1f4");
    counts.textContent = `${progress.processed} entradas revisadas`;
  } else {
    const done = progress.phase === "done";
    const percent = progress.total ? Math.floor(progress.processed / progress.total * 100) : 0;
    bar.value = done ? 100 : Math.min(99, percent);
    label.textContent = done ? globalThis.OpenCabinetI18n.t("msg.0ff259b714") : progress.processed === progress.total
      ? globalThis.OpenCabinetI18n.t("msg.16c800c24b") : globalThis.OpenCabinetI18n.t("msg.9edeef8976", progress.processed, progress.total);
    counts.textContent = `${progress.added_count} nuevos · ${progress.skipped_count} ya existentes`;
  }
}

function updateMetadataProgress(progress) {
  const bar = document.getElementById("scan-progress-bar");
  const label = document.getElementById("scan-progress-label");
  const counts = document.getElementById("scan-progress-counts");
  document.getElementById("scan-progress-container").classList.remove("hidden");
  document.getElementById("scan-current-file").textContent = progress.current_file || "";
  const labels = { catalog: globalThis.OpenCabinetI18n.t("msg.9693bec541"), indexing: globalThis.OpenCabinetI18n.t("msg.a637cd3b06"),
    matching: globalThis.OpenCabinetI18n.t("msg.6b4a0ba88b"), availability: globalThis.OpenCabinetI18n.t("msg.c3212ba929"), images: globalThis.OpenCabinetI18n.t("msg.4163100e15") };
  label.textContent = labels[progress.phase] || globalThis.OpenCabinetI18n.t("msg.018ac3b312");
  if (progress.total) {
    bar.value = Math.min(100, Math.floor(progress.processed / progress.total * 100));
  } else {
    bar.removeAttribute("value");
  }
  if (progress.phase === "catalog") {
    const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1);
    counts.textContent = progress.total ? globalThis.OpenCabinetI18n.t("msg.116095103a", mb(progress.processed), mb(progress.total)) : `${mb(progress.processed)} MB`;
  } else {
    counts.textContent = progress.total !== null && progress.total !== undefined
      ? globalThis.OpenCabinetI18n.t("msg.92f7da5a90", progress.processed, progress.total) : `${progress.processed} registros procesados`;
  }
}

function metadataPlatformSuggestion(platform, platforms) {
  const normalize = (value) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const aliases = { ps2: "Sony Playstation 2", playstation2: "Sony Playstation 2", ps1: "Sony Playstation",
    pc: "Windows", pcgames: "Windows", pcwindows: "Windows", microsoftwindows: "Windows", windowsgames: "Windows",
    playstation: "Sony Playstation", psp: "Sony PSP", snes: "Super Nintendo Entertainment System",
    nintendosnes: "Super Nintendo Entertainment System", nintendones: "Nintendo Entertainment System",
    segamegadrivegenesis: "Sega Genesis", segamegacdsegacd: "Sega CD", necpcengineturbografx16: "NEC TurboGrafx-16",
    nes: "Nintendo Entertainment System", genesis: "Sega Genesis", gamecube: "Nintendo GameCube",
    wii: "Nintendo Wii", dreamcast: "Sega Dreamcast", xbox: "Microsoft Xbox", xbox360: "Microsoft Xbox 360" };
  Object.assign(aliases,{sonyplaystationportable:'Sony PSP',nintendonintendoentertainmentsystem:'Nintendo Entertainment System',nintendosupernintendoentertainmentsystem:'Super Nintendo Entertainment System'});
  const canonical=value=>normalize(aliases[normalize(value)]||value);
  const target = canonical(platform);
  return platforms.find((name) => canonical(name) === target) || "";
}

function createImportProgressTask() {
  const card = document.getElementById("import-task");
  card.classList.remove("import-task-success");
  const title = document.getElementById("import-task-title");
  const label = document.getElementById("import-task-label");
  const counts = document.getElementById("import-task-counts");
  const bar = document.getElementById("import-task-bar");
  const cancel = document.getElementById("btn-import-task-cancel");
  const retry = document.getElementById("btn-import-task-retry");
  const proceed = document.getElementById("btn-import-task-continue");
  const dismiss = document.getElementById("btn-import-task-dismiss");
  const restore = document.getElementById("btn-import-task-restore");
  const floating = window.OpenCabinetTaskWindows?.attach(card);
  let started = false, finished = false, committing = false, onCancel = null;
  function hideReview() { retry.classList.add("hidden"); proceed.classList.add("hidden"); }
  function cancelControl() {
    if (onCancel && !committing && !finished) cancel.classList.remove("hidden"); else cancel.classList.add("hidden");
    cancel.onclick = onCancel;
  }
  function show() { if (floating) floating.show(); else card.classList.remove("hidden"); }
  hideReview(); card.classList.add("hidden"); dismiss.classList.add("hidden");
  const api = {
    get running() { return started && !finished; },
    start(cancelAction) {
      if (finished) return;
      title.textContent = globalThis.OpenCabinetI18n.t("msg.461a09faea");
      hideReview(); api.setCancel(cancelAction); api.minimize();
    },
    setCancel(action) { onCancel = action; cancel.disabled = false; cancelControl(); },
    minimize() {
      started = true; show();
      document.getElementById("scanner-modal").classList.add("hidden");
    },
    restore() { card.classList.add("hidden"); restoreTaskModal("scanner-modal"); },
    reveal() { api.minimize(); },
    busy(value, cancelling = false) {
      if (finished) return;
      retry.disabled = proceed.disabled = value || cancelling;
      cancel.disabled = cancelling;
      if (cancelling) { label.textContent = globalThis.OpenCabinetI18n.t("msg.d5ae44f105"); counts.textContent = globalThis.OpenCabinetI18n.t("msg.87f7a4cad6"); }
    },
    update(progress) {
      if (finished) return;
      const labels = { discovering: globalThis.OpenCabinetI18n.t("msg.7477b3f234"), catalog: globalThis.OpenCabinetI18n.t("msg.7252c7d8d3"), indexing: globalThis.OpenCabinetI18n.t("msg.be5d99978e"), matching: globalThis.OpenCabinetI18n.t("msg.b66e6720fc"), availability: globalThis.OpenCabinetI18n.t("msg.57d1e9615b"), images: globalThis.OpenCabinetI18n.t("msg.98b857dbca"), platform_images: globalThis.OpenCabinetI18n.t("msg.de1a70e800"), importing: globalThis.OpenCabinetI18n.t("msg.aaeb0d8568") };
      label.textContent = labels[progress.phase] || globalThis.OpenCabinetI18n.t("msg.4b315006c9");
      title.textContent = progress.phase === "availability" ? globalThis.OpenCabinetI18n.t("msg.98a8680784") : progress.phase === "matching" ? globalThis.OpenCabinetI18n.t("msg.619f08a5bf") : progress.phase === "discovering" ? (importMode === "steam" ? globalThis.OpenCabinetI18n.t("msg.634d5b79bb") : importMode === "epic" ? globalThis.OpenCabinetI18n.t("msg.7401493d36") : globalThis.OpenCabinetI18n.t("msg.05a1314198")) : globalThis.OpenCabinetI18n.t("msg.461a09faea");
      if (progress.total) bar.value = Math.min(100, Math.floor(progress.processed / progress.total * 100));
      else bar.removeAttribute("value");
      counts.textContent = progress.phase === "catalog"
        ? `${(progress.processed / 1048576).toFixed(1)}${progress.total ? globalThis.OpenCabinetI18n.t("msg.80c0721571", (progress.total / 1048576).toFixed(1)) : ""} MB`
        : progress.total != null ? globalThis.OpenCabinetI18n.t("msg.5c8ef09676", progress.processed, progress.total, progress.phase === "images" ? globalThis.OpenCabinetI18n.t("msg.06b0938d35") : "") : "";
    },
    waiting(summary, heading = globalThis.OpenCabinetI18n.t("msg.41405c376e")) {
      if (finished) return;
      title.textContent = heading; label.textContent = summary; counts.textContent = globalThis.OpenCabinetI18n.t("msg.c106b1d057"); bar.value = 100;
    },
    review(report, onRetry, onContinue) {
      if (finished) return;
      label.textContent = globalThis.OpenCabinetI18n.t("msg.1e478b34a7", report.image_count, report.failures.length);
      counts.textContent = globalThis.OpenCabinetI18n.t("msg.9009d1e9c1");
      retry.classList.remove("hidden"); proceed.classList.remove("hidden");
      retry.onclick = onRetry; proceed.onclick = onContinue;
    },
    error(reason, onRetry, onContinue = null) {
      if (finished) return;
      label.textContent = globalThis.OpenCabinetI18n.t("msg.1a44230556");
      counts.textContent = String(reason);
      retry.classList.remove("hidden"); retry.onclick = onRetry;
      if (onContinue) proceed.classList.remove("hidden"); else proceed.classList.add("hidden");
      proceed.onclick = onContinue;
    },
    committing() {
      committing = true;
      hideReview(); cancel.classList.add("hidden"); cancel.onclick = null;
      label.textContent = globalThis.OpenCabinetI18n.t("msg.aaeb0d8568"); counts.textContent = ""; bar.removeAttribute("value");
    },
    finish(heading, summary, failed = false) {
      if (failed) card.classList.remove("import-task-success"); else card.classList.add("import-task-success");
      finished = true; title.textContent = heading; label.textContent = summary; counts.textContent = "";
      hideReview(); cancel.classList.add("hidden"); cancel.onclick = retry.onclick = proceed.onclick = null;
      dismiss.classList.remove("hidden");
      bar.value = failed ? 0 : 100;
    },
  };
  importProgressTask = api;
  restore.onclick = api.restore;
  dismiss.onclick = () => { if (finished) card.classList.add("hidden"); };
  cancelControl();
  return api;
}

function restoreTaskModal(modalId) {
  if (modalId !== "scanner-modal" && scanInProgress && !document.getElementById("scanner-modal").classList.contains("hidden")) importProgressTask?.minimize();
  if (retroarchProgressTask?.active && retroarchProgressTask.modalId !== modalId) retroarchProgressTask.minimize();
  ["scanner-modal", "emulator-modal", "platform-modal"].forEach(id => {
    if (id !== modalId) document.getElementById(id).classList.add("hidden");
  });
  document.getElementById(modalId).classList.remove("hidden");
}

function trackRetroArchOperation(modalId, event) {
  if (!retroarchProgressTask) {
    const card = document.getElementById("retroarch-task"), title = document.getElementById("retroarch-task-title");
    const label = document.getElementById("retroarch-task-label"), counts = document.getElementById("retroarch-task-counts");
    const bar = document.getElementById("retroarch-task-bar"), cancel = document.getElementById("btn-retroarch-task-cancel");
    const dismiss = document.getElementById("btn-retroarch-task-dismiss"), restore = document.getElementById("btn-retroarch-task-restore");
    const floating = window.OpenCabinetTaskWindows?.attach(card);
    let current = null, active = false, owner = null;
    retroarchProgressTask = {
      get active() { return active; }, get modalId() { return owner; },
      minimize() {
        if (!owner) return;
        document.getElementById(owner).classList.add("hidden");
        if (floating) floating.show(); else card.classList.remove("hidden");
      },
      restore() { if (!owner) return; restoreTaskModal(owner); card.classList.add("hidden"); },
      handle(source, update) {
        if (update.type === "start") {
          current = update.operationId; owner = source; active = true;
          title.textContent = "RetroArch"; label.textContent = update.label; counts.textContent = ""; bar.removeAttribute("value");
          dismiss.classList.add("hidden"); cancel.classList.remove("hidden"); cancel.disabled = false;
          cancel.onclick = () => update.cancel();
          if (document.getElementById(owner).classList.contains("hidden")) retroarchProgressTask.minimize(); else card.classList.add("hidden");
        } else if (current === update.operationId && active) {
          if (update.type === "progress") {
            const progress = update.progress;
            label.textContent = progress.phase;
            if (progress.total) bar.value = Math.min(100, Math.round(progress.processed / progress.total * 100)); else bar.removeAttribute("value");
            const unit = /Preparando/.test(progress.phase) ? globalThis.OpenCabinetI18n.t("msg.3340292fcf") : "bytes";
            counts.textContent = progress.total ? unit === "bytes"
              ? globalThis.OpenCabinetI18n.t("msg.116095103a", (progress.processed / 1048576).toFixed(1), (progress.total / 1048576).toFixed(1))
              : globalThis.OpenCabinetI18n.t("msg.c3ecc74227", progress.processed, progress.total, unit) : "";
          } else if (update.type === "cancelling") {
            label.textContent = globalThis.OpenCabinetI18n.t("msg.c5b0af9a5e"); cancel.disabled = true;
          } else if (update.type === "cancel-error") {
            label.textContent = globalThis.OpenCabinetI18n.t("msg.0afb96bdd7", update.error); cancel.disabled = false;
          } else if (update.type === "end") {
            active = false; title.textContent = update.error ? globalThis.OpenCabinetI18n.t("msg.6a412b09b1") : globalThis.OpenCabinetI18n.t("msg.fe590c58ed");
            label.textContent = update.error ? String(update.error) : globalThis.OpenCabinetI18n.t("msg.0f2fe15026");
            counts.textContent = ""; bar.value = update.error ? 0 : 100;
            cancel.classList.add("hidden"); cancel.onclick = null; dismiss.classList.remove("hidden");
          }
        }
      },
    };
    restore.onclick = () => retroarchProgressTask.restore();
    dismiss.onclick = () => { if (!active) card.classList.add("hidden"); };
  }
  retroarchProgressTask.handle(modalId, event);
}

// This step owns a backend session until it is cancelled/skipped or passed to
// import_scanned_roms. Tokens reject progress and search results from old sessions.
function createImportMediaRecovery(preview, platform, onChange) {
  const list = document.getElementById("import-media-recovery-list");
  const status = document.getElementById("import-media-recovery-status");
  const selected = new Map(), manual = new Set();
  let alive = true, generation = 0, rows = [];
  function render() {
    list.replaceChildren();
    for (const row of rows) {
      const game = preview.games.find(game => game.rom_path === row.rom_path);
      if (!game || game.existing_game_id || !row.collections.length) continue;
      const item = document.createElement("li"); item.className = "metadata-match-card";
      const label = document.createElement("label"); label.textContent = game.title;
      const select = document.createElement("select"); select.autocomplete = "off";
      select.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.c616557848", game.title));
      const none = document.createElement("option"); none.value = ""; none.textContent = globalThis.OpenCabinetI18n.t("msg.b47835d01e"); select.appendChild(none);
      for (const collection of row.collections) {
        const option = document.createElement("option"); option.value = collection.id;
        option.textContent = globalThis.OpenCabinetI18n.t("msg.399394e7f3", collection.title, collection.platform, collection.image_count, collection.has_statistics ? globalThis.OpenCabinetI18n.t("msg.5e2ee458cf") : "", collection.manual_count ? globalThis.OpenCabinetI18n.t("msg.cc07766692", collection.manual_count) : "", collection.filename);
        option.title = collection.rom_path || collection.filename;
        select.appendChild(option);
      }
      select.value = selected.get(row.rom_path) || "";
      const info = document.createElement("p"); info.className = "help-text";
      function explain() {
        const chosen = row.collections.find(collection => collection.id === selected.get(row.rom_path));
        info.textContent = chosen ? globalThis.OpenCabinetI18n.t("msg.7ef6944e30", chosen.image_count, chosen.has_statistics ? globalThis.OpenCabinetI18n.t("msg.3ff24ea706") : "", chosen.manual_count ? globalThis.OpenCabinetI18n.t("msg.57f6ae768d", chosen.manual_count) : "", chosen.image_count ? globalThis.OpenCabinetI18n.t("msg.3e72153161") : globalThis.OpenCabinetI18n.t("msg.520c71fa96"))
          : globalThis.OpenCabinetI18n.t("msg.7792108852");
      }
      select.onchange = async () => {
        if (!alive) return;
        const previous = selected.get(row.rom_path);
        if (select.value && [...selected].some(([path,id]) => path !== row.rom_path && id === select.value)) {
          select.value = previous || ""; info.textContent = globalThis.OpenCabinetI18n.t("msg.2a8f2784ca"); return;
        }
        selected.set(row.rom_path, select.value || null); manual.add(row.rom_path); explain();
        await onChange();
      };
      explain(); label.appendChild(select); item.append(label, info); list.appendChild(item);
    }
  }
  return {
    async refresh(sources = []) {
      const token = ++generation;
      status.textContent = globalThis.OpenCabinetI18n.t("msg.073eefe49f");
      try {
        const report = await invoke("find_media_collections", { preview, platform, sources });
        if (!alive || token !== generation) return;
        rows = report.rows;
        for (const row of rows) {
          if (!manual.has(row.rom_path)) selected.set(row.rom_path, row.recommended_id);
          else if (selected.get(row.rom_path) && !row.collections.some(c => c.id === selected.get(row.rom_path))) selected.set(row.rom_path, null);
        }
        const used = new Set();
        for (const row of rows) {
          const id = selected.get(row.rom_path);
          if (id && used.has(id)) selected.set(row.rom_path, null);
          else if (id) used.add(id);
        }
        const count = rows.filter(row => selected.get(row.rom_path)).length;
        status.textContent = globalThis.OpenCabinetI18n.t("msg.2986af3057", count, count === 1 ? globalThis.OpenCabinetI18n.t("msg.29079a034d") : globalThis.OpenCabinetI18n.t("msg.b0d26bdb7e"))
          + (report.warnings.length ? ` Avisos: ${report.warnings.join(" · ")}` : "");
        render();
      } catch (error) {
        if (alive && token === generation) {
          status.textContent = globalThis.OpenCabinetI18n.t("msg.c984e8cb4a", error);
          rows = []; selected.clear(); list.replaceChildren();
        }
      }
    },
    selections: () => preview.games.map(game => ({ rom_path: game.rom_path, collection_id: selected.get(game.rom_path) || null })),
    has: path => rows.find(row => row.rom_path === path)?.collections.some(c => c.id === selected.get(path) && c.image_count > 0) || false,
    dispose() { alive = false; ++generation; },
  };
}

function reviewMetadataImport(preview, platform, task, operation=null) {
  const initialGameCount = preview.games.length;
  const container = document.getElementById("scan-metadata-container");
  const progress = document.getElementById("scan-progress-container");
  document.getElementById("lb-search-progress-slot").appendChild(progress);
  const recoveryPanel = document.getElementById("import-media-recovery");
  const recoveryToggle = document.getElementById("btn-toggle-import-recovery");
  recoveryPanel.classList.add("hidden");
  recoveryToggle.setAttribute("aria-expanded", "false");
  recoveryToggle.onclick = () => {
    const show = recoveryPanel.classList.contains("hidden");
    if (show) recoveryPanel.classList.remove("hidden"); else recoveryPanel.classList.add("hidden");
    recoveryToggle.setAttribute("aria-expanded", String(show));
  };
  const platformSelect = document.getElementById("lb-platform");
  const list = document.getElementById("lb-match-list");
  const message = document.getElementById("lb-message");
  const search = document.getElementById("btn-lb-search");
  const update = document.getElementById("btn-lb-update");
  const proceed = document.getElementById("btn-lb-import");
  const skip = document.getElementById("btn-lb-skip");
  const cancel = document.getElementById("btn-lb-cancel");
  const retry = document.getElementById("btn-lb-retry");
  const reportBox = document.getElementById("lb-download-report");
  const optionsBox = document.getElementById("lb-media-options");
  const typesStatus = document.getElementById("lb-media-status");
  const mediaInputs = new Map();
  document.getElementById("lb-download-all").checked = false;
  const typeChoices = new Map();
  optionsBox.replaceChildren();
  optionsBox.textContent = globalThis.OpenCabinetI18n.t("msg.f9601e5e50");
  typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.c0d27b54d3");
  optionsBox.setAttribute("aria-busy", "true");
  list.replaceChildren(); reportBox.classList.add("hidden"); message.textContent = "";
  platformSelect.replaceChildren(); platformSelect.value = "";
  document.getElementById("lb-catalog-status").textContent = globalThis.OpenCabinetI18n.t("msg.840085b1e9");
  document.getElementById("lb-platform-group").classList.add("hidden");
  container.classList.remove("hidden");
  container.scrollIntoView({ block: "nearest", behavior: "smooth" });
  document.getElementById("scan-metadata-title").focus({ preventScroll: true });

  return new Promise((resolve) => {
    let alive = true, busy = true, cancelling = false, generation = 0, detached = false;
    let typesReady = false, reviewMessage = "";
    let typesDirty = true, availabilityVersion = 0, availabilityTask = Promise.resolve();
    let initialRecovery = Promise.resolve();
    const pendingRows = new Set(), rowControls = new Map();
    let jobId = null, catalog = null, savedPlatform = null, matchedPlatform = null, rows = [], report = null;
    let startingSession = null;
    const recovery = createImportMediaRecovery(preview, platform, () => startTypesRefresh());

    async function ensureSession() {
      if (!alive) return false;
      if (typeof jobId === "string" && jobId.trim()) return true;
      if (!startingSession) startingSession = (async () => {
        const session = await invoke("start_metadata_import", { platform });
        const id = session?.job_id;
        if (typeof id !== "string" || !id.trim()) throw new Error(globalThis.OpenCabinetI18n.t("msg.1fcf4b7bff"));
        if (!alive) { await invoke("end_metadata_import", { jobId: id }); return false; }
        jobId = id;
        savedPlatform = session.source_platform;
        if (session.catalog) { platformSelect.value = savedPlatform || ""; renderCatalog(session.catalog); }
        else {
          catalog = null; metadataCatalogSummary = null; platformSelect.replaceChildren(); platformSelect.value = "";
          document.getElementById("lb-catalog-status").textContent = globalThis.OpenCabinetI18n.t("msg.4e6a7aaa24");
        }
        return true;
      })().finally(() => { startingSession = null; });
      return startingSession;
    }

    function controls() {
      container.setAttribute("aria-busy", String(busy));
      container.querySelectorAll("input, select, button").forEach((element) => { element.disabled = busy || cancelling || !!report; });
      cancel.disabled = cancelling;
      recoveryToggle.disabled = false;
      skip.disabled = busy || cancelling || preview.games.length === 0;
      search.disabled = busy || cancelling || pendingRows.size > 0 || !!report || preview.games.length === 0;
      update.disabled = busy || cancelling || pendingRows.size > 0 || !!report || !jobId || !catalog || preview.games.length === 0;
      update.classList[!!catalog?.source&&catalog.source!=='OpenCabinet-BDD'?'add':'remove']('hidden');
      proceed.disabled = busy || cancelling || pendingRows.size > 0 || !jobId || preview.games.length === 0 || (!report && (!typesReady || matchedPlatform !== platformSelect.value));
      platformSelect.disabled ||= pendingRows.size > 0 || !jobId;
      rowControls.forEach(({ button, select, remove }, row) => {
        if (pendingRows.has(row)) button.disabled = select.disabled = remove.disabled = true;
      });
      retry.disabled = busy || cancelling || !report?.failures.length;
      proceed.textContent = report ? globalThis.OpenCabinetI18n.t("msg.1a0487f5ef") : globalThis.OpenCabinetI18n.t("msg.719b5d3b75");
      task.busy(busy, cancelling);
    }

    function channel(phase) {
      const token = ++generation;
      const display = (progress) => { task.update(progress); updateMetadataProgress(progress); };
      display({ phase, processed: 0, total: null, current_file: null });
      const result = new window.__TAURI__.core.Channel();
      result.onmessage = (progress) => {
        if (alive && token === generation && progress.job_id === jobId) display(progress);
      };
      return result;
    }

    async function close(value, keepSession = false) {
      if (!alive) return;
      if(operation){if(value===false)operation.cancelled=true;operation.cancelStep=null;}
      alive = false; cancelling = true; ++generation; ++availabilityVersion; controls();
      recovery.dispose();
      if (!keepSession && jobId) {
        try { await invoke("end_metadata_import", { jobId }); }
        catch (error) { console.error("Error al cerrar la búsqueda del catálogo:", error); }
      }
      search.onclick = update.onclick = proceed.onclick = skip.onclick = cancel.onclick = retry.onclick = null;
      platformSelect.onchange = null;
      recoveryToggle.onclick = null;
      container.classList.add("hidden");
      document.getElementById("scan-progress-container").classList.add("hidden");
      document.getElementById("scan-progress-slot").appendChild(progress);
      list.replaceChildren();
      resolve(value);
    }

    async function perform(action) {
      if (!alive || busy) return;
      busy = true; controls(); message.textContent = "";
      try { await action(); return true; }
      catch (error) {
        if (alive) {
          message.textContent = globalThis.OpenCabinetI18n.t("msg.613a9bbc44", error);
          if (!typesReady) { typesStatus.textContent = message.textContent; optionsBox.setAttribute("aria-busy", "false"); }
          if (detached) task.error(error, () => report ? retry.onclick?.() : proceed.onclick?.(), report ? () => proceed.onclick?.() : null);
          else task.waiting(message.textContent, globalThis.OpenCabinetI18n.t("msg.915d70705c"));
        }
      }
      finally {
        if (alive) {
          busy = false; ++generation; controls();
          search.textContent = catalog ? globalThis.OpenCabinetI18n.t("msg.304fd1a4a5") : globalThis.OpenCabinetI18n.t("msg.ef6c36bba5");
          document.getElementById("scan-progress-container").classList.add("hidden");
        }
      }
    }

    function renderCatalog(summary) {
      catalog = summary;
      metadataCatalogSummary = summary;
      const previous = platformSelect.value || savedPlatform || metadataPlatformSuggestion(platform, summary.platforms);
      platformSelect.replaceChildren();
      const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = globalThis.OpenCabinetI18n.t("msg.d8609c9e5c");
      platformSelect.appendChild(placeholder);
      summary.platforms.forEach((name) => {
        const option = document.createElement("option"); option.value = name; option.textContent = name; platformSelect.appendChild(option);
      });
      platformSelect.value = summary.platforms.includes(previous) ? previous : "";
      document.getElementById("lb-catalog-status").textContent = globalThis.OpenCabinetI18n.t("msg.3428ce0697", summary.game_count, summary.downloaded_at);
      document.getElementById("lb-platform-group").classList.remove("hidden");
      search.textContent = globalThis.OpenCabinetI18n.t("msg.304fd1a4a5");
    }

    function invalidateMatches() {
      ++availabilityVersion; typesDirty = true;
      typesReady = false; renderImageTypeChoices(optionsBox, {}, mediaInputs, typeChoices);
      rows = []; matchedPlatform = null; list.replaceChildren(); controls();
      message.textContent = globalThis.OpenCabinetI18n.t("msg.725a4fcdd0");
      typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.772d99c2df");
    }

    function renderMatches() {
      list.replaceChildren();
      rowControls.clear();
      let cards = [];
      function refreshOrder() {
        const resolved = row => row.selected_id !== null || preview.games.some(g => g.rom_path === row.rom_path && g.existing_game_id);
        const ordered = [...cards].sort((a, b) => Number(resolved(a.row)) - Number(resolved(b.row)));
        if (ordered.some(({ card }, index) => list.children[index] !== card)) {
          const focused = document.activeElement;
          list.replaceChildren(...ordered.map(({ card }) => card));
          if (focused && list.contains(focused)) focused.focus({ preventScroll: true });
        }
        const matched = rows.filter(resolved).length;
        const removed = initialGameCount - preview.games.length;
        message.textContent = preview.games.length === 0 ? globalThis.OpenCabinetI18n.t("msg.fdadbf3f4a") : globalThis.OpenCabinetI18n.t("msg.bbfd94fcf4", matched, rows.length)
          + (matched < rows.length ? globalThis.OpenCabinetI18n.t("msg.150fbf9e8f", rows.length - matched) : "")
          + (removed ? globalThis.OpenCabinetI18n.t("msg.c8cea56341", removed, removed === 1 ? globalThis.OpenCabinetI18n.t("msg.74283de109") : globalThis.OpenCabinetI18n.t("msg.ac6e8252f3")) : "")
          + globalThis.OpenCabinetI18n.t("msg.6cde565286");
        task.waiting(message.textContent, globalThis.OpenCabinetI18n.t("msg.80146f3049"));
        reviewMessage = message.textContent;
      }
      rows.forEach((row) => {
        const game = preview.games.find(game => game.rom_path === row.rom_path);
        const card = document.createElement("li"); card.className = "metadata-match-card";
        const heading = document.createElement("h4"); heading.textContent = game.title;
        const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-btn metadata-match-remove";
        remove.textContent = "🗑️"; remove.title = globalThis.OpenCabinetI18n.t("msg.1e821bbc3a");
        remove.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.53e7b659e2", game.title, game.rom_path.split(/[\\/]/).pop()));
        remove.onclick = () => {
          if (!alive || busy || cancelling || report || pendingRows.has(row) || !rows.includes(row)) return;
          const scrollTop = list.scrollTop;
          const next = card.nextElementSibling || card.previousElementSibling;
          if (card.contains(document.activeElement)) {
            (next?.querySelector(".metadata-match-remove") || cancel).focus({ preventScroll: true });
          }
          preview.games = preview.games.filter(candidate => candidate.rom_path !== row.rom_path);
          rows = rows.filter(candidate => candidate !== row);
          cards = cards.filter(entry => entry.row !== row);
          const hadMatches = rows.some(row => row.selected_id !== null);
          card.remove(); refreshOrder(); matchesChanged(hadMatches); controls();
          list.scrollTop = scrollTop;
        };
        const status = document.createElement("p"); status.className = "help-text";
        const select = document.createElement("select"); select.autocomplete = "off";
        select.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.d3a5691be5", game.title));
        const searchRow = document.createElement("div"); searchRow.className = "metadata-search-row";
        const query = document.createElement("input"); query.type = "text"; query.autocomplete = "off"; query.value = game.title;
        query.setAttribute("aria-label", globalThis.OpenCabinetI18n.t("msg.9f68d81783", game.title));
        const button = document.createElement("button"); button.type = "button"; button.className = "secondary-btn"; button.textContent = globalThis.OpenCabinetI18n.t("msg.5f55edf900");
        searchRow.append(query, button);
        const details = document.createElement("details");
        const summary = document.createElement("summary"); summary.textContent = globalThis.OpenCabinetI18n.t("msg.25b76dadfd");
        const body = document.createElement("p"); body.className = "metadata-details";
        details.append(summary, body);

        function updateDetails() {
          if (game.existing_game_id) {
            card.classList.remove("metadata-match-unmatched");
            status.textContent = globalThis.OpenCabinetI18n.t("msg.0bb2626158");
            body.textContent = status.textContent; return;
          }
          const chosen = row.candidates.find((game) => game.id === row.selected_id);
          heading.textContent = preferences.useCatalogTitles && chosen?.title?.trim() ? chosen.title : game.title;
          if (chosen) card.classList.remove("metadata-match-unmatched");
          else card.classList.add("metadata-match-unmatched");
          status.textContent = chosen ? `${chosen.exact ? globalThis.OpenCabinetI18n.t("msg.c6aba42fdd") : globalThis.OpenCabinetI18n.t("msg.331570c2ec")} · ${chosen.platform}`
            : row.candidates.length ? globalThis.OpenCabinetI18n.t("msg.1e11ef651d") : globalThis.OpenCabinetI18n.t("msg.24aa8da1b9");
          body.textContent = chosen ? [chosen.title, globalThis.OpenCabinetI18n.t("msg.a3011897b1", chosen.platform), globalThis.OpenCabinetI18n.t("msg.66e351ec27", chosen.release_date || "—"),
            globalThis.OpenCabinetI18n.t("msg.3ea6961dd5", chosen.developer || "—"), globalThis.OpenCabinetI18n.t("msg.647325454a", chosen.publisher || "—"), globalThis.OpenCabinetI18n.t("msg.439c200421", chosen.genre || "—"),
            globalThis.OpenCabinetI18n.t("msg.22b204f176", globalThis.OpenCabinetI18n.gameMode(chosen.game_mode) || "—"), globalThis.OpenCabinetI18n.t("msg.e4eefae773", chosen.max_players || "—"),
            "", chosen.description || globalThis.OpenCabinetI18n.t("msg.591e5cef97")].join("\n") : globalThis.OpenCabinetI18n.t("msg.00a1bafb3d");
        }

        function populate() {
          select.replaceChildren();
          const none = document.createElement("option"); none.value = ""; none.textContent = game.existing_game_id ? globalThis.OpenCabinetI18n.t("msg.863cd4369e") : globalThis.OpenCabinetI18n.t("msg.e05b9112eb"); select.appendChild(none);
          row.candidates.forEach((game) => {
            const option = document.createElement("option"); option.value = String(game.id);
            option.textContent = metadataResultLabel(game);
            select.appendChild(option);
          });
          select.value = row.selected_id === null ? "" : String(row.selected_id);
          updateDetails();
        }
        rowControls.set(row, { button, select, remove });
        select.onchange = () => { if (game.existing_game_id) return; return editMatch(row, async () => {
          const hadMatches = rows.some(row => row.selected_id !== null);
          row.selected_id = select.value ? Number(select.value) : null;
          updateDetails(); refreshOrder(); matchesChanged(hadMatches);
        }); };
        button.onclick = () => editMatch(row, async () => {
          if (game.existing_game_id) return;
          if (!query.value.trim()) { query.focus(); return; }
          const candidates = await invoke("search_metadata_games", { jobId, query: query.value.trim(), sourcePlatform: matchedPlatform });
          if (!alive || !rows.includes(row)) return;
          const hadMatches = rows.some(row => row.selected_id !== null);
          row.candidates = candidates;
          row.selected_id = preferredMetadataMatch(candidates);
          populate();
          refreshOrder(); matchesChanged(hadMatches);
        });
        query.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); button.onclick(); } };
        populate(); card.append(heading, status, select, searchRow, details, remove); cards.push({ row, card });
      });
      refreshOrder();
    }

    async function editMatch(row, action) {
      if (!alive || busy || cancelling || report || pendingRows.has(row) || !rows.includes(row)) return;
      pendingRows.add(row); controls();
      try { await action(); }
      catch (error) { if (alive) message.textContent = globalThis.OpenCabinetI18n.t("msg.15c4c2e916", error); }
      finally { pendingRows.delete(row); if (alive) controls(); }
    }
    function matchesChanged(hadMatches) {
      typesDirty = true;
      if (!typesReady || !hadMatches) startTypesRefresh();
      // Once there are choices, keep them usable while correcting other games.
      // Reconcile the final availability when Download and import is pressed.
    }
    function startTypesRefresh() {
      const operation = refreshTypes();
      const token = availabilityVersion;
      availabilityTask = operation.catch(error => {
        if (alive && token === availabilityVersion) {
          typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.f1ec4566d0", error);
          if (!mediaInputs.size) optionsBox.textContent = globalThis.OpenCabinetI18n.t("msg.7344a22264");
          optionsBox.setAttribute("aria-busy", "false");
        }
      }).finally(() => { if (alive) controls(); });
      return availabilityTask;
    }
    async function refreshTypes() {
      const token = ++availabilityVersion;
      const snapshot = rows.map(row => ({ rom_path: row.rom_path, selected_id: row.selected_id }));
      typesReady = false;
      typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.3515747a0a");
      optionsBox.setAttribute("aria-busy", "true");
      if (!mediaInputs.size) optionsBox.textContent = globalThis.OpenCabinetI18n.t("msg.57d1e9615b");
      await initialRecovery;
      if (!alive || token !== availabilityVersion) return;
      await recovery.refresh(snapshot.map(row => ({ rom_path: row.rom_path, id: row.selected_id })));
      if (!alive || token !== availabilityVersion) return;
      const sourceIds = [...new Set(snapshot.filter(row => !recovery.has(row.rom_path)).map(row => row.selected_id).filter(id => id !== null))];
      if (!sourceIds.length) {
        renderImageTypeChoices(optionsBox, {}, mediaInputs, typeChoices);
        typesStatus.textContent = snapshot.some(row => recovery.has(row.rom_path)) ? globalThis.OpenCabinetI18n.t("msg.e1c3079c85") : globalThis.OpenCabinetI18n.t("msg.fe094e7b3b");
        optionsBox.setAttribute("aria-busy", "false");
        typesReady = true; typesDirty = false; return;
      }
      if (!mediaInputs.size) optionsBox.textContent = globalThis.OpenCabinetI18n.t("msg.134e0f783f");
      const onProgress = new window.__TAURI__.core.Channel();
      let analysing = true;
      typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.5a764fc571");
      onProgress.onmessage = progress => {
        if (alive && analysing && token === availabilityVersion && progress.job_id === jobId)
          typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.97a463d6a5", progress.processed, progress.total ? globalThis.OpenCabinetI18n.t("msg.80c0721571", progress.total) : "");
      };
      let available;
      try {
        if (!await ensureSession() || !alive || token !== availabilityVersion) return;
        available = await invoke("get_metadata_image_types", { jobId, sourceIds, gameIds: null, onProgress });
      }
      catch (error) { if (alive && token === availabilityVersion) typesReady = mediaInputs.size > 0; throw error; }
      finally { analysing = false; }
      if (!alive || token !== availabilityVersion) return;
      renderImageTypeChoices(optionsBox, available.counts, mediaInputs, typeChoices);
      const count = Object.values(available.counts).filter(value => value > 0).length;
      typesStatus.textContent = count ? globalThis.OpenCabinetI18n.t("msg.032bfcb683", count) : globalThis.OpenCabinetI18n.t("msg.97b98fb8bd");
      optionsBox.setAttribute("aria-busy", "false");
      typesReady = true; typesDirty = false;
    }
    function readOptions() { return selectedImageTypes(mediaInputs, document.getElementById("lb-download-all").checked); }

    async function showReport(result) {
      report = result;
      if (!result.failures.length) { await close({ jobId, mediaSelections: recovery.selections() }, true); return; }
      reportBox.classList.remove("hidden");
      document.getElementById("lb-download-summary").textContent = globalThis.OpenCabinetI18n.t("msg.10ef6e5568", result.metadata_count, result.image_count, result.failures.length);
      const failures = document.getElementById("lb-download-failures"); failures.replaceChildren();
      result.failures.forEach((failure) => {
        const item = document.createElement("li");
        const name = GAME_IMAGE_TYPES.find(([kind]) => kind === failure.kind)?.[1] || failure.kind;
        item.textContent = `${failure.title} · ${name}: ${failure.message}`; failures.appendChild(item);
      });
      if (detached) task.review(result, () => retry.onclick?.(), () => proceed.onclick?.());
      else reportBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    search.onclick = () => perform(async () => {
      if (!await ensureSession()) return;
      if (!catalog) {
        search.textContent = globalThis.OpenCabinetI18n.t("msg.e8a203706e");
        const summary = await invoke("prepare_metadata_catalog", { jobId, refresh: false, onProgress: channel("catalog") });
        if (!alive) return;
        renderCatalog(summary);
      }
      const sourcePlatform = platformSelect.value;
      if (!sourcePlatform) {
        message.textContent = globalThis.OpenCabinetI18n.t("msg.69368401b0");
        typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.39cf1a746f");
        optionsBox.setAttribute("aria-busy", "false"); platformSelect.focus(); return;
      }
      ++availabilityVersion; typesDirty = true;
      typesStatus.textContent = globalThis.OpenCabinetI18n.t("msg.63e9b8d049");
      optionsBox.setAttribute("aria-busy", "true");
      if (!mediaInputs.size) optionsBox.textContent = globalThis.OpenCabinetI18n.t("msg.b66e6720fc");
      matchedPlatform = null; rows = []; list.replaceChildren();
      const matches = await invoke("match_metadata_games", { jobId, preview, platform, sourcePlatform, onProgress: channel("matching") });
      if (!alive) return;
      rows = matches; matchedPlatform = sourcePlatform; renderMatches(); startTypesRefresh();
    }).then(() => availabilityTask);
    update.onclick = () => perform(async () => {
      if (!await ensureSession()) return;
      const summary = await invoke("prepare_metadata_catalog", { jobId, refresh: true, onProgress: channel("catalog") });
      if (!alive) return;
      renderCatalog(summary); invalidateMatches();
    }).then(success => { if (success && alive && platformSelect.value) return search.onclick(); });
    platformSelect.onchange = () => { invalidateMatches(); return search.onclick(); };
    proceed.onclick = () => {
      if (preview.games.length === 0) return;
      if (report) return close({ jobId, mediaSelections: recovery.selections() }, true);
      return perform(async () => {
        if (!await ensureSession()) return;
        if (typesDirty) await refreshTypes();
        if (!alive) return;
        const options = readOptions();
        detached = true;
        task.start(() => cancel.onclick?.());
        const result = await invoke("stage_metadata_import", { jobId, preview, platform, sourcePlatform: matchedPlatform,
          useCatalogTitles: preferences.useCatalogTitles,
          selections: rows.map((row) => ({ rom_path: row.rom_path, id: row.selected_id })), mediaSelections: recovery.selections(), options, onProgress: channel("images") });
        if (alive) await showReport(result);
      });
    };
    retry.onclick = () => perform(async () => {
      if (!await ensureSession()) return;
      const result = await invoke("retry_metadata_images", { jobId, onProgress: channel("images") });
      if (alive) await showReport(result);
    });
    skip.onclick = () => { if (preview.games.length > 0) return close({ mediaSelections: recovery.selections() }); };
    cancel.onclick = () => { message.textContent = globalThis.OpenCabinetI18n.t("msg.f23a2c4893"); return close(false); };
    if(operation)operation.cancelStep=()=>close(false);
    task.setCancel(() => cancel.onclick?.());
    controls();
    if (metadataCatalogSummary) renderCatalog(metadataCatalogSummary);
    (async () => {
      try {
        initialRecovery = recovery.refresh();
        if (!await ensureSession()) return;
      } catch (error) {
        if (alive) {
          document.getElementById("lb-catalog-status").textContent = globalThis.OpenCabinetI18n.t("msg.2cfc918059");
          message.textContent = globalThis.OpenCabinetI18n.t("msg.6e0dcad3bc", error);
          typesStatus.textContent = message.textContent;
          optionsBox.textContent = globalThis.OpenCabinetI18n.t("msg.d1a3ae8be8");
          optionsBox.setAttribute("aria-busy", "false");
        }
      } finally { if (alive) { busy = false; controls(); task.waiting(message.textContent || globalThis.OpenCabinetI18n.t("msg.f32af9ee1b")); } }
      if (alive && jobId) await search.onclick();
    })();
  });
}

async function handleExecuteScan() {
  if (scanInProgress || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
  const platform = getSelectedPlatformName();
  const single = importUsesFileSelection(), steam = importMode === "steam", epic = importMode === "epic", store = steam || epic, pc = isPcPlatform(platform);
  if (importMode === null) { showToast(globalThis.OpenCabinetI18n.t("msg.fb8c3eb197"), true); return; }
  const filePath = document.getElementById("scan-file-input")?.value.trim();
  const title = document.getElementById("scan-single-title")?.value.trim();
  const folderPath = document.getElementById("scan-folder-input")?.value.trim();
  const extRaw = document.getElementById("scan-extensions-input")?.value.trim();
  const emuSelect = document.getElementById("scan-emu-select");

  if (!platform) {
    showToast(globalThis.OpenCabinetI18n.t("msg.06a2cccaa0"), true);
    return;
  }

  if (single && (!filePath || !title)) { showToast(globalThis.OpenCabinetI18n.t("msg.987306718d"), true); return; }
  if (store && !pc) { showToast(globalThis.OpenCabinetI18n.t("msg.74d9e5b971", epic ? "Epic Games" : "Steam"), true); return; }
  if (!single && !store && pc) { showToast(globalThis.OpenCabinetI18n.t("msg.04dbcccb3c"), true); return; }
  if (!single && !store && !folderPath) {
    showToast(
      globalThis.OpenCabinetI18n.t("msg.a98bc78f1e"),
      true,
    );
    return;
  }

  const matchingEmulators = allEmulators.filter(
    (e) => e.platform.toLowerCase() === platform.toLowerCase(),
  );

  if (!pc && !importRunsDirectly() && (
    matchingEmulators.length === 0 ||
    (emuSelect && emuSelect.value === "__add_new__")
  )) {
    showToast(
      globalThis.OpenCabinetI18n.t("msg.3a0fbe20ac", platform),
      true,
    );
    return;
  }

  const customExtensions = extRaw
    ? extRaw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
    : null;

  scanInProgress = true;
  const savedScan=savedFolderScan;
  const waitForScan=promise=>savedScan?savedScan.wait(promise):promise;
  const form = document.getElementById("scanner-form");
  form.classList.add("hidden");
  const controls = [...form.querySelectorAll("input, select, button")].map((element) => [element, element.disabled]);
  controls.forEach(([element]) => { element.disabled = true; });
  form.setAttribute("aria-busy", "true");
  const submit = form.querySelector('button[type="submit"]');
  const submitLabel = submit.textContent;
  submit.textContent = single ? globalThis.OpenCabinetI18n.t("msg.14b744efda") : globalThis.OpenCabinetI18n.t("msg.ff38c72ea7");
  const progressContainer = document.getElementById("scan-progress-container");
  progressContainer.classList.remove("hidden");
  updateScanProgress({ phase: "discovering", processed: 0, current_file: null });
  const resultContainer = document.getElementById("scan-result-container");
  resultContainer.replaceChildren();
  resultContainer.classList.add("hidden");
  progressContainer.scrollIntoView({ block: "nearest", behavior: "smooth" });
  let acceptProgress = true;
  let activeChannel = null;
  let metadataJobId = null;
  let mediaSelections = [];
  const task = createImportProgressTask();
  task.update?.({ phase: "discovering", processed: 0, total: null });
  function progressChannel() {
    const channel = new window.__TAURI__.core.Channel();
    activeChannel = channel;
    channel.onmessage = (progress) => {
      if (acceptProgress && activeChannel === channel) {
        task.update?.(progress); updateScanProgress(progress);
      }
    };
    return channel;
  }
  try {
    const matchedPlatform = allPlatforms.find((p) => p.name.toLowerCase() === platform.toLowerCase());
    if (!matchedPlatform) {
      await invoke("add_platform", { name: platform, defaultExtensions: pc ? ".exe" : extRaw || ".iso, .zip, .7z, .bin" });
      await loadPlatforms();
    }
    let preview;
    if (store) {
      const source = epic ? "epic" : "steam";
      const path = document.getElementById(`scan-${source}-path`).value.trim() || null;
      const report = await invoke(`scan_${source}_games`, { ...(epic ? { manifestsPath: path } : { steamPath: path }), onProgress: progressChannel() });
      preview = report.preview;
      document.getElementById(`scan-${source}-path`).value = epic ? report.manifests_path : report.steam_path;
      document.getElementById(`scan-${source}-status`).textContent = globalThis.OpenCabinetI18n.t("msg.141fe074f9", epic ? "Epic Games" : `${report.library_count} bibliotecas`, preview.games.length, preview.skipped_count, report.ignored_count);
      const warnings = document.getElementById(`scan-${source}-warning-list`); warnings.replaceChildren();
      (report.warnings || []).forEach(warning => { const item = document.createElement("li"); item.textContent = warning; warnings.appendChild(item); });
      document.getElementById(`scan-${source}-warnings`).classList.toggle("hidden", !report.warnings?.length);
    } else preview = single ? await invoke("preview_single_game", { filePath, platform, title, launchDirectly: importRunsDirectly() }) : await waitForScan(invoke("scan_roms_folder", {
      folderPath,
      customExtensions,
      platform,
      onProgress: progressChannel(),
    }));
    activeChannel = null;
    if(savedScan?.cancelled)throw savedScan;
    if(!single&&!store&&document.getElementById('scan-save-folder')?.checked){
      const platformRecord=allPlatforms.find(item=>item.name.toLowerCase()===platform.toLowerCase());
      await invoke('save_library_folder',{platformId:platformRecord.id,directory:folderPath,extensions:customExtensions||extRaw.split(',').map(value=>value.trim()).filter(Boolean)});
    }
    if (!store && !pc && preview.games.some(g => g.discs?.length)) {
      preview = await waitForScan(invoke("prepare_disc_import", { preview, platform }));
    }
    if (preview.games.length > 0) {
      task.waiting?.(globalThis.OpenCabinetI18n.t("msg.b15f195dc5"), globalThis.OpenCabinetI18n.t("msg.1671c8200e"));
      progressContainer.classList.add("hidden");
      form.removeAttribute("aria-busy");
      submit.textContent = globalThis.OpenCabinetI18n.t("msg.82c39c4ea1");
      if (!await reviewScannedGames(preview,savedScan)) {
        task.finish(globalThis.OpenCabinetI18n.t("msg.1a044e0769"), globalThis.OpenCabinetI18n.t("msg.4cb81b1462"), true);
        resultContainer.classList.remove("hidden");
        resultContainer.textContent = globalThis.OpenCabinetI18n.t("msg.5602b9780b");
        return;
      }
      form.setAttribute("aria-busy", "true");
    }
    if(savedScan?.cancelled)throw savedScan;
    if (preview.games.length > 0) {
      progressContainer.classList.add("hidden");
      form.removeAttribute("aria-busy");
      submit.textContent = globalThis.OpenCabinetI18n.t("msg.352b552c96");
      const metadata = await reviewMetadataImport(preview, platform, task,savedScan);
      if (metadata === false) {
        task.finish(globalThis.OpenCabinetI18n.t("msg.1a044e0769"), globalThis.OpenCabinetI18n.t("msg.4cb81b1462"), true);
        resultContainer.classList.remove("hidden");
        resultContainer.textContent = globalThis.OpenCabinetI18n.t("msg.5602b9780b");
        return;
      }
      metadataJobId = metadata?.jobId || null;
      mediaSelections = metadata?.mediaSelections || [];
      form.setAttribute("aria-busy", "true");
    }
    submit.textContent = globalThis.OpenCabinetI18n.t("msg.dd167ec760");
    if(savedScan?.cancelled)throw savedScan;
    if(savedScan)savedScan.committing=true;
    task.committing();
    progressContainer.classList.remove("hidden");
    const res = preview.games.length === 0
      ? { added_count: 0, skipped_count: preview.skipped_count, total_found: preview.total_found }
      : await invoke("import_scanned_roms", { preview, platform, jobId: metadataJobId, mediaSelections, onProgress: progressChannel() });

    acceptProgress = false;
    task.finish(globalThis.OpenCabinetI18n.t("msg.0ff259b714"), globalThis.OpenCabinetI18n.t("msg.b7ea33c270", res.added_count, res.attached_count ? globalThis.OpenCabinetI18n.t("msg.dd792678e4", res.attached_count) : "", res.enrichment ? globalThis.OpenCabinetI18n.t("msg.c46ba08eb4", res.enrichment.image_count) : ""));
    updateScanProgress({ phase: "done", processed: res.total_found, total: res.total_found, ...res });
    resultContainer.classList.remove("hidden");
    const summary = document.createElement("div");
    summary.className = "scan-result-card";
    const heading = document.createElement("h4");
    heading.textContent = globalThis.OpenCabinetI18n.t("msg.5abc15f456");
    summary.appendChild(heading);
    [globalThis.OpenCabinetI18n.t("msg.a3011897b1", platform), globalThis.OpenCabinetI18n.t("msg.f35612bb4d", res.added_count),
      ...(res.attached_count ? [globalThis.OpenCabinetI18n.t("msg.bb8ed32215", res.attached_count)] : []),
      globalThis.OpenCabinetI18n.t("msg.f6a2a45739", res.skipped_count), globalThis.OpenCabinetI18n.t("msg.e11f3a8726", res.total_found)]
      .forEach((text) => {
        const line = document.createElement("p");
        line.textContent = text;
        summary.appendChild(line);
      });
    resultContainer.appendChild(summary);
    if (res.enrichment) {
      const line = document.createElement("p");
      line.textContent = globalThis.OpenCabinetI18n.t("msg.fe936fd488", res.enrichment.metadata_count, res.enrichment.image_count, res.enrichment.failed_image_count);
      summary.appendChild(line);
    }

    showToast(
      globalThis.OpenCabinetI18n.t("msg.7cfb3e791b", res.added_count, res.attached_count ? globalThis.OpenCabinetI18n.t("msg.dd792678e4", res.attached_count) : "", platform),
    );
    if (res.enrichment) platformDetailsCache.clear();
    await loadGames();
  } catch (error) {
    if(savedScan?.cancelled)return;
    task.finish(globalThis.OpenCabinetI18n.t("msg.1b0c3b796a"), String(error), true);
    console.error("Error al escanear carpeta:", error);
    progressContainer.classList.add("hidden");
    resultContainer.classList.remove("hidden");
    resultContainer.textContent = globalThis.OpenCabinetI18n.t("msg.faae61ff68", error);
    showToast(globalThis.OpenCabinetI18n.t("msg.3f98fd271d", error), true);
  } finally {
    acceptProgress = false;
    if (metadataJobId) {
      try { await invoke("end_metadata_import", { jobId: metadataJobId }); }
      catch (error) { console.error("Error al cerrar la importación:", error); }
    }
    scanInProgress = false;
    form.removeAttribute("aria-busy");
    controls.forEach(([element, disabled]) => { element.disabled = disabled; });
    submit.textContent = submitLabel;
    form.classList.remove("hidden");
    if(savedScan&&savedFolderScan===savedScan){
      savedFolderScan=null;
      if(savedScan.cancelled){
        task.finish(globalThis.OpenCabinetI18n.t('msg.1a044e0769'),globalThis.OpenCabinetI18n.t('msg.4cb81b1462'),true);
        document.getElementById('import-task').classList.add('hidden');
        if(importProgressTask===task)importProgressTask=null;
        document.getElementById('scanner-modal').classList.add('hidden');
        progressContainer.classList.add('hidden');resultContainer.classList.add('hidden');
        ++singleFileRequest;chooseImportMode(null);
      }
    }
  }
}

function setupEmulatorExecutableBrowsers() {
  if(window.OpenCabinetEmulatorDefaults) {
    const load=invoke('get_emulator_argument_presets');
    const create=(prefix,button,editing)=>window.OpenCabinetEmulatorDefaults.create({
      name:document.getElementById(prefix+'name'),path:document.getElementById(prefix+'path'),args:document.getElementById(prefix+'args'),
      button:document.getElementById(button),editing:document.getElementById(editing),load
    });
    emulatorArgumentDefaults=create('emu-','btn-recommend-emu-args','editing-emu-id');
    inlineEmulatorArgumentDefaults=create('inline-emu-','btn-recommend-inline-emu-args','');
  }
  [
    ["btn-browse-emu", "emu-path"],
    ["btn-browse-inline-emu", "inline-emu-path"],
  ].forEach(([buttonId, inputId]) => {
    const button = document.getElementById(buttonId);
    const input = document.getElementById(inputId);
    button.addEventListener("click", async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        const selectedPath = await invoke("select_emulator_executable");
        if (selectedPath) {
          input.value = selectedPath;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (error) {
        console.error("Error al seleccionar ejecutable:", error);
        showToast(globalThis.OpenCabinetI18n.t("msg.799b1e6115"), true);
      } finally {
        button.disabled = inputId === "emu-path" ? Boolean(retroarchSetup?.busy) : Boolean(inlineRetroarchSetup?.busy);
      }
    });
  });
}

// --- Control de Barra de Menús y Modales ---
function setupMenuBarAndModal() {
  const optionsDropdown = document.getElementById("menu-options-dropdown");
  const btnOptions = document.getElementById("btn-menu-options");
  const optionsMenu = document.getElementById("dropdown-options-menu");

  const toolsDropdown = document.getElementById("menu-tools-dropdown");
  const btnTools = document.getElementById("btn-menu-tools");
  const toolsMenu = document.getElementById("dropdown-tools-menu");

  const btnOpenEmulators = document.getElementById("btn-open-emulators");
  const modalEmu = document.getElementById("emulator-modal");
  const btnCloseModalEmu = document.getElementById("btn-close-modal");
  const btnCancelEdit = document.getElementById("btn-cancel-edit-emu");

  // Cancelar edición de emulador
  btnCancelEdit?.addEventListener("click", () => {
    resetEmulatorForm();
  });

  // Toggle Menú Opciones
  btnOptions?.addEventListener("click", (e) => {
    e.stopPropagation();
    toolsMenu?.classList.remove("show");
    toolsDropdown?.classList.remove("active");
    const isShown = optionsMenu?.classList.toggle("show");
    optionsDropdown?.classList.toggle("active", isShown);
  });

  // Toggle Menú Herramientas
  btnTools?.addEventListener("click", (e) => {
    e.stopPropagation();
    optionsMenu?.classList.remove("show");
    optionsDropdown?.classList.remove("active");
    const isShown = toolsMenu?.classList.toggle("show");
    toolsDropdown?.classList.toggle("active", isShown);
  });

  // Cerrar menús al hacer clic fuera
  window.addEventListener("click", () => {
    optionsMenu?.classList.remove("show");
    optionsDropdown?.classList.remove("active");
    toolsMenu?.classList.remove("show");
    toolsDropdown?.classList.remove("active");
  });

  // Abrir modal de emuladores
  btnOpenEmulators?.addEventListener("click", async (e) => {
    e.stopPropagation();
    if (retroarchSetup?.busy) { retroarchProgressTask?.restore(); return; }
    if (retroarchSetup?.busy || savingEmulator || inlineRetroarchSetup?.busy || savingInlineEmulator) return;
    document.getElementById("platform-modal").classList.add("hidden");
    optionsMenu?.classList.remove("show");
    optionsDropdown?.classList.remove("active");
    modalEmu?.classList.remove("hidden");
    resetEmulatorForm();
    document.getElementById("btn-save-emu").disabled = true;
    await loadPlatforms();
    await loadEmulators();
  });

  // Cerrar modal de emuladores
  btnCloseModalEmu?.addEventListener("click", () => {
    if (retroarchSetup?.busy) { retroarchProgressTask?.minimize(); return; }
    modalEmu?.classList.add("hidden");
    resetEmulatorForm();
  });

  setupModalBackdropClose(modalEmu, () => {
    if (retroarchSetup?.busy) { retroarchProgressTask?.minimize(); return; }
    modalEmu.classList.add("hidden");
    resetEmulatorForm();
  });

  const emuForm = document.getElementById("emulator-form");
  if (emuForm) {
    emuForm.addEventListener("submit", handleAddEmulator);
  }
}

// --- Barra de título integrada ---
async function setupTitlebar() {
  const appWindow = window.__TAURI__.window.getCurrentWindow();
  const maximizeButton = document.getElementById("btn-window-maximize");

  function handleWindowError(error) {
    console.error("Error al controlar la ventana:", error);
    showToast(globalThis.OpenCabinetI18n.t("msg.7e7d5d3560"), true);
  }

  async function syncMaximizeButton() {
    const maximized = await appWindow.isMaximized();
    const label = maximized ? globalThis.OpenCabinetI18n.t("msg.eda02893d3") : globalThis.OpenCabinetI18n.t("msg.092b9ccfbf");
    maximizeButton.dataset.maximized = String(maximized);
    maximizeButton.title = label;
    maximizeButton.setAttribute("aria-label", label);
  }

  document.getElementById("btn-window-minimize").addEventListener("click", () => {
    appWindow.minimize().catch(handleWindowError);
  });
  maximizeButton.addEventListener("click", () => {
    appWindow.toggleMaximize().then(syncMaximizeButton).catch(handleWindowError);
  });
  document.getElementById("btn-window-close").addEventListener("click", () => {
    appWindow.close().catch(handleWindowError);
  });

  // También actualiza el icono al maximizar con doble clic o desde Windows.
  appWindow.onResized(() => {
    syncMaximizeButton().catch(handleWindowError);
  }).catch(handleWindowError);
  try {
    if (preferences.startMaximized) await appWindow.maximize();
    else await appWindow.unmaximize();
    await syncMaximizeButton();
  } catch (error) {
    handleWindowError(error);
  } finally {
    // Show the window with the saved startup state already applied.
    await appWindow.show().catch(handleWindowError);
  }
}

// --- Inicialización ---
function setupDetailsResizer() {
  const panel = document.getElementById("game-details-panel");
  const resizer = document.getElementById("details-resizer");
  const main = panel.parentElement;
  const librarySidebar = document.querySelector(".library-sidebar");
  let preferredWidth = 420;
  let drag = null;

  function updateWidth() {
    // Reserva espacio para el catálogo incluso al achicar la ventana.
    const maxWidth = Math.max(0, main.clientWidth - librarySidebar.offsetWidth - resizer.offsetWidth - 240);
    const minWidth = Math.min(260, maxWidth);
    const width = Math.round(Math.min(maxWidth, Math.max(minWidth, preferredWidth)));
    panel.style.width = `${width}px`;
    resizer.setAttribute("aria-valuemin", String(minWidth));
    resizer.setAttribute("aria-valuemax", String(maxWidth));
    resizer.setAttribute("aria-valuenow", String(width));
  }

  resizer.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    event.preventDefault();
    resizer.focus();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: panel.getBoundingClientRect().width,
    };
    resizer.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-details");
  });

  resizer.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    preferredWidth = drag.startWidth + drag.startX - event.clientX;
    updateWidth();
    preferredWidth = panel.getBoundingClientRect().width;
  });

  function stopDragging(event) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag = null;
    document.body.classList.remove("resizing-details");
    if (resizer.hasPointerCapture(event.pointerId)) {
      resizer.releasePointerCapture(event.pointerId);
    }
  }

  resizer.addEventListener("pointerup", stopDragging);
  resizer.addEventListener("pointercancel", stopDragging);
  resizer.addEventListener("lostpointercapture", stopDragging);
  resizer.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    preferredWidth = panel.getBoundingClientRect().width +
      (event.key === "ArrowLeft" ? 20 : -20);
    updateWidth();
    preferredWidth = panel.getBoundingClientRect().width;
  });

  new ResizeObserver(updateWidth).observe(main);
  updateWidth();
}

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const restored = await invoke("get_restored_preferences");
    if (restored) {
      window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify(restored));
      await invoke("acknowledge_restored_preferences");
      window.location.reload(); return;
    }
  } catch (error) { console.error("Could not apply restored preferences", error); }
  globalThis.OpenCabinetI18n.translateDOM();
  const languageReady = invoke("set_ui_language", { language: preferences.language }).catch(error => console.error(error));
  setupGameContextMenu();
  setupPlatformContextMenu();
  setupMenuBarAndModal();
  setupPreferences();
  void invoke("save_backup_preferences", { preferences }).catch(error => console.error(error));
  setupAbout();
  setupAppUpdates();
  setupEmulatorExecutableBrowsers();
  if (window.OpenCabinetRetroArch) retroarchSetup = window.OpenCabinetRetroArch.create({document, invoke, Channel:window.__TAURI__.core.Channel,
    onIdentityChanged: () => emulatorArgumentDefaults?.refresh(),
    onTask: event => trackRetroArchOperation("emulator-modal", event)});
  setupPlatformModal();
  setupGameEditor();
  setupDetailsResizer();
  setupSearch();
  // Wire import and menus before any database or recovery work can delay them.
  setupScannerModal();
  window.OpenCabinetKeyboard?.setup({ document, window });
  await languageReady;
  const loading = loadInitialLibrary();
  await setupTitlebar();
  await setupPlayStatistics();
  await loading;
  void appUpdates.check(true);
  // Image discovery is maintenance, not a prerequisite for showing the catalog.
  invoke("get_media_library_status").then(media => {
    if (media.warnings.length) showToast(globalThis.OpenCabinetI18n.t("msg.823deb5062", media.warnings.join(" · ")), true);
  }).catch(error => { console.error("No se pudo preparar la biblioteca de imágenes:", error); showToast(globalThis.OpenCabinetI18n.t("msg.e60a363ea4", error), true); });
});
