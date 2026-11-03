
const $ = id => document.getElementById(id);
const urlInput = $("url");
const list = $("list");
const status = $("status");
const warning = $("warning");
const REQUIRED = ["id", "name", "version", "main"];

function setStatus(message, error = false) {
  status.textContent = message;
  status.style.color = error ? "#ff8d8d" : "#aaa";
}

function userScriptsAvailable() {
  try { return !!chrome.userScripts; } catch (_) { return false; }
}

function loadPlugins() {
  return new Promise(resolve => chrome.storage.local.get({ plugins: [] }, r => resolve(r.plugins || [])));
}
function savePlugins(plugins) {
  return new Promise(resolve => chrome.storage.local.set({ plugins }, resolve));
}

function normalizeManifest(data) {
  if (data?.versions && !data.id) {
    const first = Object.values(data.versions)[0];
    if (first) data = first;
  }
  if (!data || typeof data !== "object") throw new Error("Manifest is not an object.");
  for (const key of REQUIRED) {
    if (typeof data[key] !== "string" || !data[key].trim()) throw new Error(`Missing manifest field: ${key}`);
  }
  if (!/^[A-Za-z0-9._-]+$/.test(data.id)) throw new Error("Invalid plugin id.");
  return {
    id: data.id,
    name: data.name,
    version: data.version,
    main: data.main,
    description: typeof data.description === "string" ? data.description : "",
    author: typeof data.author === "string" ? data.author : "",
    homepage: typeof data.homepage === "string" ? data.homepage : ""
  };
}

async function fetchPlugin(manifestUrl) {
  const response = await fetch(manifestUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
  const manifest = normalizeManifest(await response.json());
  return { manifest, manifestUrl, mainUrl: new URL(manifest.main, manifestUrl).href, enabled: true };
}

function sync() {
  return new Promise(resolve => chrome.runtime.sendMessage({ type: "sync-plugins" }, () => resolve()));
}

async function addPlugin() {
  const manifestUrl = urlInput.value.trim();
  if (!manifestUrl) return setStatus("Manifest URLを入力してください。", true);
  try {
    const plugin = await fetchPlugin(manifestUrl);
    const plugins = await loadPlugins();
    const index = plugins.findIndex(p => p?.manifest?.id === plugin.manifest.id);
    if (index >= 0) {
      plugin.enabled = plugins[index].enabled !== false;
      plugins[index] = plugin;
    } else plugins.push(plugin);
    await savePlugins(plugins);
    await sync();
    urlInput.value = "";
    setStatus("Plugin added.");
    render();
  } catch (e) { setStatus(e.message || "Failed to load plugin.", true); }
}

async function toggle(index) {
  const plugins = await loadPlugins();
  if (!plugins[index]) return;
  plugins[index].enabled = !plugins[index].enabled;
  if (plugins[index].error) delete plugins[index].error;
  await savePlugins(plugins);
  await sync();
  render();
}

async function update(index) {
  const plugins = await loadPlugins();
  const current = plugins[index];
  if (!current) return;
  try {
    const fresh = await fetchPlugin(current.manifestUrl);
    fresh.enabled = current.enabled;
    delete fresh.error;
    plugins[index] = fresh;
    await savePlugins(plugins);
    await sync();
    setStatus("Plugin updated & reloaded.");
    render();
  } catch (e) { setStatus(e.message || "Update failed.", true); }
}

async function remove(index) {
  const plugins = await loadPlugins();
  if (!plugins[index]) return;
  plugins.splice(index, 1);
  await savePlugins(plugins);
  await sync();
  render();
}

function render() {
  loadPlugins().then(plugins => {
    list.textContent = "";
    if (!plugins.length) {
      const empty = document.createElement("div");
      empty.className = "empty";
      empty.textContent = "No plugins installed.";
      list.appendChild(empty);
      return;
    }
    plugins.forEach((plugin, index) => {
      const row = document.createElement("div"); row.className = "plugin" + (plugin.enabled ? " enabled" : " disabled");
      const info = document.createElement("div"); info.className = "info";
      const name = document.createElement("div");
      name.className = "name";
      const author = typeof plugin.manifest.author === "string" ? plugin.manifest.author.trim() : (plugin.manifest.author?.name || "");
      name.textContent = author ? `${plugin.manifest.name} (${author})` : plugin.manifest.name;

      const meta = document.createElement("div"); meta.className = "meta";
      const statusText = plugin.error ? " · ⚠️ 初期化エラー" : (plugin.enabled ? " · 有効" : " · 無効");
      meta.textContent = `${plugin.manifest.id} · v${plugin.manifest.version}${statusText}`;
      info.append(name, meta);

      if (plugin.error) {
        const err = document.createElement("div");
        err.className = "pluginError";
        const kind = plugin.error.kind === "load" ? "Load Error" : plugin.error.kind === "execution" ? "Execution Error" : "Runtime Error";
        err.textContent = `[${kind}] ${plugin.error.message || "Unknown error"}`;
        err.title = plugin.error.message || "Unknown error";
        info.appendChild(err);
      }

      const actions = document.createElement("div"); actions.className = "actions";
      const toggleLabel = document.createElement("label"); toggleLabel.className = "toggleWrap";
      const toggleInput = document.createElement("input"); toggleInput.type = "checkbox"; toggleInput.checked = plugin.enabled;
      const check = document.createElement("span"); check.className = "check";
      const toggleText = document.createElement("span"); toggleText.textContent = plugin.enabled ? "ON" : "OFF";
      toggleInput.addEventListener("change", () => toggle(index));
      toggleLabel.append(toggleInput, check, toggleText);

      const updateButton = document.createElement("button"); updateButton.title = "再読み込み"; updateButton.textContent = "↻"; updateButton.onclick = () => update(index);
      const deleteButton = document.createElement("button"); deleteButton.className = "danger"; deleteButton.title = "削除"; deleteButton.textContent = "×"; deleteButton.onclick = () => remove(index);
      actions.append(toggleLabel, updateButton, deleteButton);
      row.append(info, actions); list.appendChild(row);
    });
  });
}

$("add").addEventListener("click", addPlugin);
urlInput.addEventListener("keydown", e => { if (e.key === "Enter") addPlugin(); });

if (!userScriptsAvailable()) {
  warning.textContent = "Chromeの拡張機能(詳細)で「ユーザー スクリプトを許可する」を有効にしてください。\n Please enable “Allow User Scripts” in Chrome Extensions (Details).";
  warning.style.display = "block";
}

sync().then(render);

chrome.storage.onChanged?.addListener((changes, area) => {
  if (area === "local" && changes.plugins) render();
});

setTimeout(() => {
  window.addEventListener("blur", () => {
    window.close();
  });
}, 300);

window.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    window.close();
  }
});

const recommendedSelect = $("recommended");
if (recommendedSelect) {
  recommendedSelect.addEventListener("change", () => {
    if (recommendedSelect.value) {
      urlInput.value = recommendedSelect.value;
      urlInput.focus();
      recommendedSelect.selectedIndex = 0;
    }
  });
}