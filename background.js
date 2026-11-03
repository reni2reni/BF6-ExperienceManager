
const PORTAL_MATCH = [
  "https://portal.battlefield.com/bf6/*"
];
const HOST_ID = "bf2042-portal-plugin-host";
const EXT_VERSION = "3.14.0";

// ページ初回表示時に userScripts の登録が間に合わないケースを補うためのキャッシュ。
const pluginSourceCache = new Map();
const pageInjectionQueue = new Map();
const pageInjectionState = new Map();

function isBlocksRoute(url) {
  try {
    const u = new URL(url);
    if (u.origin !== "https://portal.battlefield.com") return false;
    const parts = u.pathname.split("/").filter(Boolean);
    return parts[0] === "bf6" && (
      parts.slice(1).join("/") === "experience/rules/blocks" ||
      parts.slice(2).join("/") === "experience/rules/blocks"
    );
  } catch (_) {
    return false;
  }
}

function enqueuePageInjection(tabId, url) {
  if (!Number.isInteger(tabId) || !isBlocksRoute(url)) return Promise.resolve();
  const previous = pageInjectionQueue.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => injectCurrentPage(tabId, url));
  pageInjectionQueue.set(tabId, next.finally(() => {
    if (pageInjectionQueue.get(tabId) === next) pageInjectionQueue.delete(tabId);
  }));
  return next;
}

function userScriptsAvailable() {
  try {
    return !!chrome.userScripts;
  } catch (_) {
    return false;
  }
}

async function getPlugins() {
  const { plugins = [] } = await chrome.storage.local.get({ plugins: [] });
  return Array.isArray(plugins) ? plugins : [];
}

async function fetchSource(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return await response.text();
      if (i === retries - 1) throw new Error(`Plugin HTTP ${response.status}`);
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise(r => setTimeout(r, 600 * (i + 1)));
    }
  }
}

async function getCachedPluginSource(plugin) {
  const key = String(plugin?.manifest?.id || "") + "\n" + String(plugin?.mainUrl || "");
  if (pluginSourceCache.has(key)) return pluginSourceCache.get(key);
  const source = await fetchSource(plugin.mainUrl, 4);
  pluginSourceCache.set(key, source);
  return source;
}

function buildPluginCode(plugin, source) {
  const pluginId = JSON.stringify(String(plugin.manifest.id));
  return `${hostSource()}\n;(() => {\n  const host = window.__BF2042_PLUGIN_HOST__;\n  const sourceId = ${pluginId};\n  host.__bf6LoadedPluginSources = host.__bf6LoadedPluginSources || Object.create(null);\n  if (host.__bf6LoadedPluginSources[sourceId] === "loaded") {\n    host.runPluginInitializers?.();\n    return;\n  }\n  try {\n    ${source}\n    host.__bf6LoadedPluginSources[sourceId] = "loaded";\n  } catch (error) {\n    delete host.__bf6LoadedPluginSources[sourceId];\n    host.reportPluginError?.(sourceId, "execution", error);\n    throw error;\n  }\n  host.runPluginInitializers?.();\n})();\n`;
}

async function injectCurrentPage(tabId, url) {
  if (!userScriptsAvailable() || !chrome.userScripts.execute || !isBlocksRoute(url)) return;

  // まず登録を完了させる。登録済みスクリプトは次回ナビゲーション用、
  // execute() は「現在表示中の最初のページ」を救済する二段構え。
  await syncPlugins();

  const plugins = await getPlugins();
  const sources = [];
  for (const plugin of plugins) {
    if (!plugin?.enabled || !plugin?.mainUrl || !plugin?.manifest?.id) continue;
    try {
      const source = await getCachedPluginSource(plugin);
      sources.push(buildPluginCode(plugin, source));
    } catch (error) {
      await setPluginError(plugin.manifest.id, "load", error?.message || error);
    }
  }
  if (!sources.length) return;

  const combined = sources.join("\n");
  const results = await chrome.userScripts.execute({
    target: { tabId, frameIds: [0] },
    world: "MAIN",
    injectImmediately: true,
    js: [{ code: combined }]
  });

  const failed = results.filter(r => r && r.error);
  if (failed.length) throw new Error(failed.map(r => r.error).join("; "));
  pageInjectionState.set(tabId, { url, at: Date.now() });
}

function hostSource() {
  return `(() => {
    const state = window.__BF2042_PLUGIN_HOST__ || { 
      definitions: undefined, 
      plugins: Object.create(null), 
      menuItems: [], 
      menuWeight: 0,
      initQueue: Promise.resolve(),
      activeWorkspace: null
    };
    window.__BF2042_PLUGIN_HOST__ = state;

    if (typeof window.showBlockHelpWindow === "undefined") {
      window.showBlockHelpWindow = function() {};
    }

    function reportPluginError(pluginId, kind, error) {
      try {
        const message = error && (error.stack || error.message) ? String(error.stack || error.message) : String(error);
        window.dispatchEvent(new CustomEvent("bf6-experience-manager-plugin-error", {
          detail: { pluginId: String(pluginId || ""), kind: String(kind || "runtime"), message }
        }));
      } catch (_) {}
    }
    state.reportPluginError = reportPluginError;

    const originalDebug = console.debug;
    if (!state.hooked) {
      state.hooked = true;
      console.debug = function (...args) {
        if (args.length === 2 && args[0] === "Frostbite Block Definitions") {
          state.definitions = args[1];
        }
        return originalDebug.apply(this, args);
      };
    }

    if (!state.mouseHooked) {
      state.mouseHooked = true;
      const rememberMouse = (event) => {
        state.lastMouse = { x: event.clientX, y: event.clientY };
      };
      const rememberContext = (event) => {
        state.lastMouse = { x: event.clientX, y: event.clientY };
        state.lastContext = { x: event.clientX, y: event.clientY };
      };
      window.addEventListener("mousemove", rememberMouse, true);
      window.addEventListener("contextmenu", rememberContext, true);
    }

    function getSelectedBlocks(scope) {
      try {
        if (scope && scope.block) return [scope.block];
        if (scope && Array.isArray(scope.blocks)) return scope.blocks.filter(Boolean);
        const ws = getMainWorkspace();
        if (!ws) return [];
        if (typeof ws.getSelected === "function") {
          const selected = ws.getSelected();
          if (selected) return Array.isArray(selected) ? selected : [selected];
        }
      } catch (_) {}
      return [];
    }

    function getMouseCoords() {
      try {
        if (state.lastMouse) return { x: state.lastMouse.x, y: state.lastMouse.y };
        const ws = getMainWorkspace();
        if (ws && typeof ws.getParentSvg === "function") {
          const svg = ws.getParentSvg();
          if (svg && typeof svg.getBoundingClientRect === "function") {
            const r = svg.getBoundingClientRect();
            return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
          }
        }
      } catch (_) {}
      return { x: 0, y: 0 };
    }

    function getMainWorkspace() {
      try {
        const Blockly = window._Blockly || window.Blockly;
        return Blockly && typeof Blockly.getMainWorkspace === "function" ? Blockly.getMainWorkspace() : null;
      } catch (_) { return null; }
    }

    function getDarkRedEnabled() {
      try { return window.localStorage.getItem("bf6-dark-red") !== "0"; } catch (_) { return true; }
    }

    function setDarkRedEnabled(enabled) {
      const ws = getMainWorkspace();
      if (!ws || typeof ws.getTheme !== "function" || typeof ws.setTheme !== "function") {
        throw new Error("Blockly main workspace/theme is not ready");
      }
      const theme = ws.getTheme();
      const styles = theme && theme.blockStyles;
      const variableStyle = styles && styles["variable-block-style"];
      if (!variableStyle) throw new Error("variable-block-style is not available");

      if (!state.darkRedOriginal && variableStyle.colourPrimary !== "#6e0000") {
        state.darkRedOriginal = {
          colourPrimary: variableStyle.colourPrimary,
          colourSecondary: variableStyle.colourSecondary,
          colourTertiary: variableStyle.colourTertiary
        };
      }

      if (enabled) {
        variableStyle.colourPrimary = "#6e0000";
        variableStyle.colourSecondary = "#870000";
        variableStyle.colourTertiary = "#460000";
      } else {
        const orig = state.darkRedOriginal || { colourPrimary: "#ee4242", colourSecondary: "#b73333", colourTertiary: "#7c2222" };
        variableStyle.colourPrimary = orig.colourPrimary;
        variableStyle.colourSecondary = orig.colourSecondary;
        variableStyle.colourTertiary = orig.colourTertiary;
      }

      ws.setTheme(theme);

      try {
        if (typeof ws.getAllBlocks === "function") {
          ws.getAllBlocks(false).forEach(b => {
            if (typeof b.applyColour === "function") b.applyColour();
            else if (typeof b.render === "function") b.render();
          });
        }
      } catch (_) {}

      try { window.localStorage.setItem("bf6-dark-red", enabled ? "1" : "0"); } catch (_) {}
      state.darkRedEnabled = !!enabled;
      return !!enabled;
    }

    function syncDarkRedTheme() {
      const enabled = getDarkRedEnabled();
      try { setDarkRedEnabled(enabled); } catch (error) { state.darkRedPending = enabled; }
      return enabled;
    }

    const shared = {
      copyTextToClipboard: async (text) => {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          return navigator.clipboard.writeText(String(text ?? ""));
        }
        const ta = document.createElement("textarea");
        ta.value = String(text ?? "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("Clipboard copy failed");
        return true;
      },
      loadFromLocalStorage: (key, defaultValue = null) => {
        try {
          const raw = window.localStorage.getItem(String(key));
          if (raw === null) return defaultValue;
          try { return JSON.parse(raw); } catch (_) { return raw; }
        } catch (_) {
          return defaultValue;
        }
      },
      saveToLocalStorage: (key, value) => {
        try {
          const raw = typeof value === "string" ? value : JSON.stringify(value);
          window.localStorage.setItem(String(key), raw);
        } catch (error) {
          console.error("[BF6 ExperienceManager] saveToLocalStorage failed", error);
        }
      },
      logError: (context, error) => {
        console.error("[BF6 ExperienceManager] " + context, error);
        if (state.currentPluginId) reportPluginError(state.currentPluginId, "runtime", error);
      }
    };

    const plugins = {
      getPlugin: (id) => {
        const key = String(id || "");
        if (!state.plugins[key]) {
          const itemRegistry = [];
          state.plugins[key] = {
            id: key,
            registerItem: (item) => {
              if (item) {
                if (!item.__bf6ExperienceManagerMenuOrder) {
                  item.__bf6ExperienceManagerMenuOrder = ++state.menuWeight;
                  item.weight = -1000000 + item.__bf6ExperienceManagerMenuOrder;
                }
                if (!itemRegistry.some(x => x && x.id === item.id)) itemRegistry.push(item);
              }
              return item;
            },
            getRegisteredItems: () => itemRegistry.slice(),
            getSelectedBlocks,
            getMouseCoords,
            createMenu: (title) => {
              const menuEl = document.createElement("div");
              menuEl.className = "bf2042-portal-custom-menu";
              menuEl.style.cssText = "display:inline-flex;align-items:center;gap:4px;margin:0 4px;";

              const menuObj = {
                title: String(title || ""),
                element: menuEl,
                container: menuEl,
                addItem: (label, onClick) => {
                  const btn = document.createElement("button");
                  btn.textContent = typeof label === "function" ? label() : String(label || "");
                  btn.style.cssText = "background:#222;color:#fff;border:1px solid #555;padding:4px 8px;cursor:pointer;border-radius:3px;font-size:12px;";
                  btn.onclick = (e) => { e.preventDefault(); if (typeof onClick === "function") onClick(e); };
                  menuEl.appendChild(btn);
                  return btn;
                },
                addButton: (label, onClick) => menuObj.addItem(label, onClick),
                addMenuItem: (label, onClick) => menuObj.addItem(label, onClick),
                addSeparator: () => {
                  const sep = document.createElement("span");
                  sep.style.cssText = "border-left:1px solid #555;height:14px;margin:0 2px;";
                  menuEl.appendChild(sep);
                  return sep;
                },
                show: () => { menuEl.style.display = "inline-flex"; },
                hide: () => { menuEl.style.display = "none"; },
                toggle: () => { menuEl.style.display = menuEl.style.display === "none" ? "inline-flex" : "none"; },
                close: () => { menuEl.style.display = "none"; }
              };
              return Object.assign(menuEl, menuObj);
            },
            registerMenu: (menuOrId, optMenu) => {
              try {
                const menu = optMenu || menuOrId;
                if (menu && typeof menu.render === "function") menu.render();
                const el = (menu && (menu.element || menu.container)) || (menu instanceof HTMLElement ? menu : null);
                if (el && el instanceof HTMLElement && !el.isConnected) {
                  const parent = document.querySelector(".custom-navbar") || document.querySelector("header") || document.body;
                  parent.appendChild(el);
                }
              } catch (_) {}
              return menuOrId;
            }
          };
        }
        return state.plugins[key];
      }
    };

    const startup = {
      getVersion: () => EXT_VERSION,
      getManifest: () => ({ url: "", version: EXT_VERSION }),
      getBlockDefinitions: () => state.definitions,
      init: () => Promise.resolve()
    };

    const current = window.BF2042Portal || {};
    current.Startup = startup;
    current.Shared = shared;
    current.Plugins = plugins;
    window.BF2042Portal = current;

    if (!state.darkRedActionHooked) {
      state.darkRedActionHooked = true;
      window.addEventListener("bf6-experience-manager-action", (event) => {
        try {
          const action = event?.detail?.action;
          if (action !== "toggle-dark-red") return;
          setDarkRedEnabled(!getDarkRedEnabled());
        } catch (error) {
          reportPluginError("BF6 ExperienceManager", "runtime", error);
        }
      }, true);
    }

    if (!state.darkRedQueryHooked) {
      state.darkRedQueryHooked = true;
      window.addEventListener("bf6-experience-manager-darkred-query", (event) => {
        try {
          window.dispatchEvent(new CustomEvent("bf6-experience-manager-darkred-result", {
            detail: { requestId: event?.detail?.requestId, enabled: getDarkRedEnabled() }
          }));
        } catch (_) {}
      }, true);
    }

    if (!state.optionsQueryHooked) {
      state.optionsQueryHooked = true;
      window.addEventListener("bf6-experience-manager-query", (event) => {
        try {
          const detail = event && event.detail ? event.detail : {};
          const ws = getMainWorkspace();
          let block = null;
          if (ws && detail.blockId && typeof ws.getBlockById === "function") block = ws.getBlockById(String(detail.blockId));
          if (!block && ws && typeof ws.getSelected === "function") {
            const selected = ws.getSelected();
            block = Array.isArray(selected) ? selected[0] : selected;
          }
          if (!block) return;
          const inline = typeof block.getInputsInline === "function" ? !!block.getInputsInline() : !!block.inputsInline;
          const collapsed = typeof block.isCollapsed === "function" ? !!block.isCollapsed() : !!block.collapsed_;
          window.dispatchEvent(new CustomEvent("bf6-experience-manager-query-result", {
            detail: { requestId: detail.requestId, inline, collapsed }
          }));
        } catch (_) {}
      }, true);
    }

    // --- ブロックのコピー/ペースト/操作ロジック ---
    if (!state.optionsActionHooked) {
      state.optionsActionHooked = true;

      function extractBlockForClipboard(block) {
        const Blockly = window._Blockly || window.Blockly;
        try {
          const full = Blockly.serialization.blocks.save(block);
          if (full && full.next) delete full.next;
          return full;
        } catch (_) {
          try {
            if (Blockly.Xml) {
              const xml = Blockly.Xml.blockToDom(block, true);
              return { _legacyXml: Blockly.Xml.domToText(xml) };
            }
          } catch (_) {}
          return null;
        }
      }

      function getSelectedStackConnections(blocks) {
        const selected = new Set((blocks || []).filter(Boolean));
        const connections = [];
        const connectedIds = new Set();
        for (const block of blocks || []) {
          if (!block || !block.nextConnection) continue;
          try {
            const target = block.nextConnection.targetBlock?.();
            if (target && selected.has(target) && target.previousConnection) {
              connections.push({ from: String(block.id), to: String(target.id) });
              connectedIds.add(String(block.id));
              connectedIds.add(String(target.id));
            }
          } catch (_) {}
        }
        return { connections, connectedIds };
      }

      function traverseSerializedBlocks(node, cb) {
        if (!node) return;
        cb(node);
        if (node.inputs && typeof node.inputs === "object") {
          for (const input of Object.values(node.inputs)) {
            if (input && input.block) traverseSerializedBlocks(input.block, cb);
            if (input && input.shadow) traverseSerializedBlocks(input.shadow, cb);
          }
        }
        if (node.next && node.next.block) traverseSerializedBlocks(node.next.block, cb);
      }

      function extractVariableDefinitions(serializedRoot) {
        const varsById = new Map();
        traverseSerializedBlocks(serializedRoot, (b) => {
          if (b.fields && b.fields.VAR) {
            const raw = b.fields.VAR;
            let id = null, name = null, type = "";
            if (raw && typeof raw === "object") {
              id = raw.id || null;
              name = raw.name || null;
              type = raw.type || "";
            } else if (typeof raw === "string") {
              id = null;
              name = raw;
              type = "";
            }
            const isObjectVar = !!(b.extraState && b.extraState.isObjectVar);
            if (name) {
              const key = id || name + "::" + type;
              if (!varsById.has(key)) {
                varsById.set(key, { id, name, type, isObjectVar });
              }
            }
          }
        });
        return Array.from(varsById.values());
      }

      function registerVariablesBeforePaste(ws, varDefs) {
        try {
          const varMap = ws.getVariableMap ? ws.getVariableMap() : null;
          for (const v of varDefs) {
            try {
              let existing = null;
              if (varMap && typeof varMap.getVariable === "function") {
                try { existing = varMap.getVariable(v.id); } catch (_) { existing = null; }
              }
              if (!existing && varMap && typeof varMap.getVariableById === "function") {
                try { existing = varMap.getVariableById(v.id); } catch (_) { existing = null; }
              }
              if (!existing && varMap && typeof varMap.getVariableByName === "function") {
                try { existing = varMap.getVariableByName(v.name); } catch (_) { existing = null; }
              }
              if (existing) continue;

              if (varMap && typeof varMap.createVariable === "function") {
                try { varMap.createVariable(v.name, v.type || "", v.id); } catch (_) {
                  try { varMap.createVariable(v.name, v.type || "", undefined); } catch (_) {}
                }
              } else if (typeof ws.createVariable === "function") {
                try { ws.createVariable(v.name, v.type || "", v.id); } catch (_) {
                  try { ws.createVariable(v.name, v.type || "", undefined); } catch (_) {}
                }
              }
            } catch (inner) {}
          }
        } catch (err) {}
      }

      function ensureVariableExists(ws, name, type) {
        try {
          const varMap = ws.getVariableMap();
          if (!varMap) return null;
          let existing = null;
          try { existing = varMap.getVariable(name); } catch (_) { existing = null; }
          if (!existing && typeof varMap.getVariableByName === "function") {
            try { existing = varMap.getVariableByName(name); } catch (_) { existing = null; }
          }
          if (!existing) {
            if (typeof varMap.createVariable === "function") return varMap.createVariable(name, type || "", undefined);
            if (typeof ws.createVariable === "function") return ws.createVariable(name, type || "", undefined);
          }
          return existing;
        } catch (e) {
          return null;
        }
      }

      function sanitizeForWorkspace(ws, root) {
        traverseSerializedBlocks(root, (b) => {
          if (b.type === "variableReferenceBlock" || b.type === "subroutineArgumentBlock") return;
          if (b.fields) {
            for (const [key, val] of Object.entries(b.fields)) {
              const ku = key.toUpperCase();
              if (ku === "VAR" || ku === "VARIABLE" || ku.startsWith("VAR")) {
                let varName = val;
                if (val && typeof val === "object" && val.name) varName = val.name;
                if (typeof varName === "string" && varName.length > 0) {
                  ensureVariableExists(ws, varName, val?.type || "");
                }
              }
            }
          }
        });
        return root;
      }

      function renameSubroutineIfNeeded(ws, data) {
        try {
          if (!data || data.type !== "subroutineBlock") return data;
          const originalName = data.extraState?.subroutineName || data.fields?.SUBROUTINE_NAME;
          if (!originalName) return data;

          const existingNames = new Set();
          for (const b of ws.getAllBlocks(false)) {
            if (b.type === "subroutineBlock") {
              const name = (b.extraState && b.extraState.subroutineName) || (b.getField && b.getField("SUBROUTINE_NAME")?.getValue());
              if (name) existingNames.add(name);
            }
          }

          if (!existingNames.has(originalName)) return data;

          let i = 1, newName = originalName + i;
          while (existingNames.has(newName)) {
            i++;
            newName = originalName + i;
          }

          if (data.extraState) data.extraState.subroutineName = newName;
          if (data.fields) data.fields.SUBROUTINE_NAME = newName;

          traverseSerializedBlocks(data, (b) => {
            if (b.fields && b.fields.SUBROUTINE_NAME === originalName) {
              b.fields.SUBROUTINE_NAME = newName;
            }
          });

          return data;
        } catch (err) {
          return data;
        }
      }

      function createBlockInstance(ws, data) {
        const Blockly = window._Blockly || window.Blockly;
        const varDefs = extractVariableDefinitions(data);
        if (varDefs.length > 0) registerVariablesBeforePaste(ws, varDefs);
        data = renameSubroutineIfNeeded(ws, data);
        data = sanitizeForWorkspace(ws, data);

        const existing = new Set(ws.getAllBlocks(false));
        let created = null;
        try {
          if (Blockly.serialization?.blocks?.append) {
            created = Blockly.serialization.blocks.append(data, ws);
          } else if (data._legacyXml && Blockly.Xml) {
            created = Blockly.Xml.domToBlock(Blockly.Xml.textToDom(data._legacyXml), ws);
          }
        } catch (_) {}

        if (!created || typeof created.initSvg !== "function") {
          for (const b of ws.getAllBlocks(false)) {
            if (!existing.has(b) && !b.getParent()) { created = b; break; }
          }
        }
        return created;
      }

      function getWorkspaceCoords(ws, e) {
        try {
          let canvas = typeof ws.getCanvas === "function" ? ws.getCanvas() : null;
          if (!canvas) canvas = document.querySelector(".blocklyBlockCanvas");
          if (canvas && canvas.ownerSVGElement && typeof canvas.getScreenCTM === "function") {
            const pt = canvas.ownerSVGElement.createSVGPoint();
            pt.x = e.clientX;
            pt.y = e.clientY;
            const ctm = canvas.getScreenCTM();
            if (ctm && typeof ctm.inverse === "function") {
              const p = pt.matrixTransform(ctm.inverse());
              return { x: p.x, y: p.y };
            }
          }
        } catch (_) {}
        const metrics = ws.getMetrics ? ws.getMetrics() : {};
        return { x: (metrics.viewLeft || 0) + 50, y: (metrics.viewTop || 0) + 50 };
      }

      function autoConnectBlock(createdBlock) {
        if (!createdBlock || !createdBlock.workspace) return;
        const ws = createdBlock.workspace;
        const myConns = [];
        if (createdBlock.outputConnection) myConns.push(createdBlock.outputConnection);
        if (createdBlock.previousConnection) myConns.push(createdBlock.previousConnection);
        const last = createdBlock.lastConnectionInStack ? createdBlock.lastConnectionInStack() : createdBlock;
        if (last && last.nextConnection) myConns.push(last.nextConnection);
        if (!myConns.length) return;

        let bestDist = 75, bestMy = null, bestTarget = null;
        for (const other of ws.getAllBlocks(false)) {
          if (other === createdBlock || other.getRootBlock() === createdBlock) continue;
          const targets = [];
          if (other.previousConnection) targets.push(other.previousConnection);
          if (other.nextConnection) targets.push(other.nextConnection);
          if (other.inputList) {
            for (const input of other.inputList) if (input.connection) targets.push(input.connection);
          }
          for (const myC of myConns) {
            for (const tC of targets) {
              if (!tC) continue;
              let can = false;
              try {
                if (typeof tC.canConnectWithReason_ === "function") can = (tC.canConnectWithReason_(myC) <= 1);
                else if (typeof tC.isConnectionAllowed === "function") can = tC.isConnectionAllowed(myC);
                else can = true;
              } catch (_) {}
              if (!can) continue;
              const dist = Math.hypot(myC.x - tC.x, myC.y - tC.y);
              if (dist < bestDist) { bestDist = dist; bestMy = myC; bestTarget = tC; }
            }
          }
        }
        if (bestMy && bestTarget) {
          try {
            if (bestTarget.type === 1 || bestTarget.type === 3) bestTarget.connect(bestMy);
            else bestMy.connect(bestTarget);
            createdBlock.render();
          } catch (_) {}
        }
      }

      window.addEventListener("bf6-experience-manager-action", (event) => {
        try {
          const detail = event && event.detail ? event.detail : {};
          const Blockly = window._Blockly || window.Blockly;
          const ws = getMainWorkspace();
          if (!ws) return;
          let block = null;
          if (detail.blockId && typeof ws.getBlockById === "function") {
            block = ws.getBlockById(String(detail.blockId));
          }
          if (!block && typeof ws.getSelected === "function") {
            const selected = ws.getSelected();
            block = Array.isArray(selected) ? selected[0] : selected;
          }

          if (detail.action === "copy-block") {
            const ids = Array.isArray(detail.selectedBlockIds) ? detail.selectedBlockIds.map(String) : [];
            const selectedBlocks = [];
            const seen = new Set();

            // コピー対象は必ず selectedBlockIds を最優先。
            // Blocklyの現在選択(block)は、メニューを押した瞬間に1個へ戻るため
            // フォールバックとしてのみ使用する。
            for (const id of ids) {
              try {
                let b = ws.getBlockById?.(id) || null;
                // 念のため全ブロックも検索（DOM data-idとBlockly idの差異対策）
                if (!b && typeof ws.getAllBlocks === "function") {
                  const all = ws.getAllBlocks(false) || [];
                  b = all.find(x => String(x?.id) === String(id)) || null;
                }
                if (b && !seen.has(String(b.id))) {
                  seen.add(String(b.id));
                  selectedBlocks.push(b);
                }
              } catch (_) {}
            }
            if (!selectedBlocks.length && block) selectedBlocks.push(block);

            // 接続されたstack（previous/next）は1ブロックずつ独立してコピーする。
            // 一方、inputに内包された子だけは親のシリアライズに含まれるため重複を避ける。
            const selectedSet = new Set(selectedBlocks);
            const copyRoots = selectedBlocks.filter(b => {
              let p = typeof b.getParent === "function" ? b.getParent() : null;
              if (!p) return true;
              while (p) {
                if (selectedSet.has(p)) {
                  let isInputChild = false;
                  try {
                    if (Array.isArray(p.inputList)) {
                      isInputChild = p.inputList.some(input => input?.connection?.targetBlock?.() === b);
                    }
                  } catch (_) {}
                  if (isInputChild) return false;
                }
                p = typeof p.getParent === "function" ? p.getParent() : null;
              }
              return true;
            });

            const stackInfo = getSelectedStackConnections(copyRoots);
            const blocks = copyRoots.map(b => {
              const data = extractBlockForClipboard(b);
              if (data && stackInfo.connectedIds.has(String(b.id))) {
                try {
                  const pos = b.getRelativeToSurfaceXY?.();
                  if (pos) data._bf6Position = { x: Number(pos.x) || 0, y: Number(pos.y) || 0 };
                } catch (_) {}
              }
              return data;
            }).filter(Boolean);
            const data = blocks.length > 1
              ? { _bf6MultiBlockClipboard: 1, blocks, sourceIds: copyRoots.map(b => String(b.id)), connections: stackInfo.connections }
              : blocks[0];

            if (data) {
              const jsonText = JSON.stringify(data, null, 2);
              state.lastBlockJson = jsonText;
              shared.copyTextToClipboard(jsonText);
            }
            return;
          }

          if (detail.action === "cut-block" && block) {
            const ids = Array.isArray(detail.selectedBlockIds) ? detail.selectedBlockIds.map(String) : [];
            const selectedBlocks = [];
            const seen = new Set();

            for (const id of ids) {
              try {
                const b = ws.getBlockById?.(id);
                if (b && !seen.has(b.id)) {
                  seen.add(b.id);
                  selectedBlocks.push(b);
                }
              } catch (_) {}
            }
            if (!selectedBlocks.length) selectedBlocks.push(block);

            const selectedSet = new Set(selectedBlocks);
            const roots = selectedBlocks.filter(b => {
              let p = typeof b.getParent === "function" ? b.getParent() : null;
              if (!p) return true;
              while (p) {
                if (selectedSet.has(p)) {
                  let isInputChild = false;
                  try {
                    if (Array.isArray(p.inputList)) {
                      isInputChild = p.inputList.some(input => input?.connection?.targetBlock?.() === b);
                    }
                  } catch (_) {}
                  if (isInputChild) return false;
                }
                p = typeof p.getParent === "function" ? p.getParent() : null;
              }
              return true;
            });
            const blocks = roots.map(extractBlockForClipboard).filter(Boolean);
            const data = blocks.length > 1
              ? { _bf6MultiBlockClipboard: 1, blocks }
              : blocks[0];

            if (data) {
              const jsonText = JSON.stringify(data, null, 2);
              state.lastBlockJson = jsonText;
              shared.copyTextToClipboard(jsonText);
              for (const b of roots) {
                try { if (typeof b.dispose === "function") b.dispose(true, true); } catch (_) {}
              }
              if (typeof ws.resizeContents === "function") ws.resizeContents();
            }
            return;
          }

          if (detail.action === "paste-block") {
            const raw = detail.clipboardText || state.lastBlockJson;
            if (!raw) return;
            let data = null;
            try { data = JSON.parse(raw); } catch (_) { return; }

            const isMulti = data && data._bf6MultiBlockClipboard === 1 && Array.isArray(data.blocks);
            const validBlocks = (isMulti ? data.blocks : [data]).filter(Boolean);
            if (!validBlocks.length) return;

            const connections = isMulti && Array.isArray(data.connections) ? data.connections : [];
            const sourceIds = isMulti && Array.isArray(data.sourceIds) ? data.sourceIds.map(String) : [];
            const connectedIds = new Set();
            for (const pair of connections) {
              if (pair?.from != null) connectedIds.add(String(pair.from));
              if (pair?.to != null) connectedIds.add(String(pair.to));
            }
            const hasConnectedSelection = connections.length > 0;

            if (Blockly.Events && typeof Blockly.Events.disable === "function") {
              Blockly.Events.disable();
            }

            const createdBlocks = [];
            try {
              const base = getWorkspaceCoords(ws, { clientX: detail.x, clientY: detail.y });

              if (!hasConnectedSelection) {
                // 個別ブロックの複数選択は元の処理をそのまま使用する。
                const positions = validBlocks.map((d, i) => ({
                  x: Number.isFinite(Number(d?.x)) ? Number(d.x) : i * 40,
                  y: Number.isFinite(Number(d?.y)) ? Number(d.y) : i * 40
                }));
                const minX = Math.min(...positions.map(p => p.x));
                const minY = Math.min(...positions.map(p => p.y));

                for (let i = 0; i < validBlocks.length; i++) {
                  const newBlock = createBlockInstance(ws, validBlocks[i]);
                  if (!newBlock) continue;
                  const Coordinate = Blockly.utils?.Coordinate || function(x, y) { this.x = x; this.y = y; };
                  newBlock.moveTo?.(new Coordinate(
                    base.x + (positions[i].x - minX),
                    base.y + (positions[i].y - minY)
                  ));
                  newBlock.render?.();
                  createdBlocks.push(newBlock);
                }
                if (createdBlocks.length === 1) autoConnectBlock(createdBlocks[0]);
              } else {
                // 連結ブロックだけBlockUtility方式で配置する。
                // コピー時の実座標からX列を揃え、上下関係を維持する。
                const positions = validBlocks.map((d, i) => {
                  const p = d?._bf6Position;
                  return {
                    x: Number.isFinite(Number(p?.x)) ? Number(p.x) : (Number.isFinite(Number(d?.x)) ? Number(d.x) : i * 40),
                    y: Number.isFinite(Number(p?.y)) ? Number(p.y) : (Number.isFinite(Number(d?.y)) ? Number(d.y) : i * 40)
                  };
                });
                const connectedIndexes = [];
                for (let i = 0; i < validBlocks.length; i++) {
                  if (connectedIds.has(String(sourceIds[i] ?? ""))) connectedIndexes.push(i);
                }
                const minX = connectedIndexes.length ? Math.min(...connectedIndexes.map(i => positions[i].x)) : 0;
                const minY = connectedIndexes.length ? Math.min(...connectedIndexes.map(i => positions[i].y)) : 0;

                for (let i = 0; i < validBlocks.length; i++) {
                  const newBlock = createBlockInstance(ws, validBlocks[i]);
                  if (!newBlock) continue;
                  const Coordinate = Blockly.utils?.Coordinate || function(x, y) { this.x = x; this.y = y; };
                  if (connectedIds.has(String(sourceIds[i] ?? ""))) {
                    // 連結対象はXを完全に揃え、Yだけ元の上下間隔を維持する。
                    newBlock.moveTo?.(new Coordinate(base.x, base.y + (positions[i].y - minY)));
                  } else {
                    // 混在時の非連結ブロックは元の配置方式を維持。
                    newBlock.moveTo?.(new Coordinate(base.x + (positions[i].x - minX), base.y + (positions[i].y - minY)));
                  }
                  newBlock.render?.();
                  createdBlocks.push(newBlock);
                }

                const createdBySourceId = new Map();
                createdBlocks.forEach((b, i) => {
                  const sid = sourceIds[i];
                  if (sid != null) createdBySourceId.set(String(sid), b);
                });
                for (const pair of connections) {
                  const from = createdBySourceId.get(String(pair?.from));
                  const to = createdBySourceId.get(String(pair?.to));
                  if (!from || !to || !from.nextConnection || !to.previousConnection) continue;
                  try {
                    if (!from.nextConnection.isConnected?.() && !to.previousConnection.isConnected?.()) {
                      from.nextConnection.connect(to.previousConnection);
                    }
                  } catch (_) {}
                }
                createdBlocks.forEach(b => b.render?.());
              }
              ws.resizeContents?.();
            } finally {
              if (Blockly.Events && typeof Blockly.Events.enable === "function") Blockly.Events.enable();
            }

            if (createdBlocks.length && Blockly.Events && typeof Blockly.Events.fire === "function") {
              const CreateEvent = Blockly.Events.BlockCreate || Blockly.Events.Create;
              if (typeof CreateEvent === "function") {
                // 複数ブロックの貼り付けは1回の操作なので、
                // 生成された全BlockCreateイベントを同じUndoグループにまとめる。
                // これにより、5個貼り付けてもCtrl+Zは1回で元に戻る。
                let groupStarted = false;
                try {
                  if (typeof Blockly.Events.setGroup === "function") {
                    Blockly.Events.setGroup(true);
                    groupStarted = true;
                  }
                  for (const created of createdBlocks) {
                    try { Blockly.Events.fire(new CreateEvent(created)); } catch (_) {}
                  }
                } finally {
                  if (groupStarted) {
                    try { Blockly.Events.setGroup(false); } catch (_) {}
                  }
                }
              }
            }
            return;
          }

          if (!block) return;

          if (detail.action === "toggle-inputs-inline") {
            const inline = typeof block.getInputsInline === "function" ? !!block.getInputsInline() : !!block.inputsInline;
            if (typeof block.setInputsInline === "function") block.setInputsInline(!inline);
            else block.inputsInline = !inline;
          } else if (detail.action === "toggle-collapse") {
            const collapsed = typeof block.isCollapsed === "function" ? !!block.isCollapsed() : !!block.collapsed_;
            if (typeof block.setCollapsed === "function") block.setCollapsed(!collapsed);
            else block.collapsed_ = !collapsed;
          } else {
            return;
          }
          if (typeof block.render === "function") block.render();
          if (ws && typeof ws.resizeContents === "function") ws.resizeContents();
        } catch (error) {
          console.error("[BF6 ExperienceManager] Options action", error);
        }
      }, true);
    }

     if (!state.nativePasteHooked) {
      state.nativePasteHooked = true;

      window.addEventListener("keydown", (e) => {
        // Ctrl+V (Macなら Cmd+V) の検知
        const isPaste = (e.ctrlKey || e.metaKey) && (e.key === "v" || e.key === "V" || e.keyCode === 86);
        if (!isPaste) return;

        // 入力フォーム等の入力中は除外
        const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
        if (tag === "input" || tag === "textarea") return;

        try {
          const Blockly = window._Blockly || window.Blockly;
          const ws = getMainWorkspace();
          if (!ws) return;

          // 1. 最新のマウス座標からワークスペース上の座標を算出
          const mousePt = state.lastMouse || { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          const coords = getWorkspaceCoords(ws, { clientX: mousePt.x, clientY: mousePt.y });
          const targetX = Math.round(coords.x + 24);
          const targetY = Math.round(coords.y + 24);

          // 2. Modern Blockly (Blockly.clipboard) の貼り付け予定座標をマウス位置に書き換える
          if (Blockly.clipboard) {
            const clip = Blockly.clipboard;
            // copyData_ または saveInfo に保持されている座標を書き換え
            if (clip.copyData_ && clip.copyData_.saveInfo) {
              clip.copyData_.saveInfo.x = targetX;
              clip.copyData_.saveInfo.y = targetY;
            } else if (clip.pasteData_ && clip.pasteData_.saveInfo) {
              clip.pasteData_.saveInfo.x = targetX;
              clip.pasteData_.saveInfo.y = targetY;
            }
          }

          // 3. 旧仕様 (Blockly.clipboardXml_ 等) への対応
          if (Blockly.clipboardXml_) {
            Blockly.clipboardSource_ = ws;
          }

          // 4. 生成直後のブロックを検知して確実にマウス位置へ追尾させるフォールバック
          const existingBlocks = new Set(ws.getAllBlocks(false));
          setTimeout(() => {
            const currentBlocks = ws.getAllBlocks(false);
            for (const b of currentBlocks) {
              if (!existingBlocks.has(b) && !b.getParent()) {
                const Coordinate = Blockly.utils?.Coordinate || function(x, y) { this.x = x; this.y = y; };
                if (typeof b.moveTo === "function") {
                  b.moveTo(new Coordinate(targetX, targetY));
                }
                if (typeof b.render === "function") b.render();
                break;
              }
            }
          }, 0);

        } catch (_) {}
      }, true); // キャプチャ段階で先に書き換える
    }
      
    if (!state.menuQueryHooked) {
      state.menuQueryHooked = true;
      window.addEventListener("bf6-experience-manager-menu-query", (event) => {
        try {
          const ids = [];
          const labels = [];
          for (const plugin of Object.values(state.plugins)) {
            if (!plugin || typeof plugin.getRegisteredItems !== "function") continue;
            for (const item of plugin.getRegisteredItems()) {
              if (item && item.id) ids.push(String(item.id));
              if (item && item.displayText) labels.push(String(typeof item.displayText === "function" ? item.displayText() : item.displayText));
            }
          }
          window.dispatchEvent(new CustomEvent("bf6-experience-manager-menu-result", {
            detail: { requestId: event?.detail?.requestId, ids, labels }
          }));
        } catch (_) {}
      }, true);
    }

    // --- 強化版: ワークスペース監視＆プラグイン初期化管理 ---
    async function waitForWorkspaceReady() {
      // ワークスペースが準備完了（DOMにSVGが配置され描画準備ができた状態）になるまで検知
      return new Promise((resolve) => {
        let attempts = 0;
        const check = () => {
          const ws = getMainWorkspace();
          if (ws && ws.svgGroup_ && document.body.contains(ws.svgGroup_)) {
            resolve(ws);
            return;
          }
          attempts++;
          if (attempts < 60) { // 最大30秒待機
            setTimeout(check, 500);
          } else {
            resolve(null);
          }
        };
        check();
      });
    }

    state.runPluginInitializers = function (force = false) {
      state.initQueue = state.initQueue.then(async () => {
        const ws = await waitForWorkspaceReady();
        if (!ws) return;

        // ワークスペースのインスタンスが切り替わった場合は強制再実行
        const workspaceChanged = state.activeWorkspace !== ws;
        state.activeWorkspace = ws;

        try { syncDarkRedTheme(); } catch (_) {}

        const plugins = Object.values(state.plugins);
        for (const plugin of plugins) {
          if (!plugin || typeof plugin.initializeWorkspace !== "function") continue;

          // 同じワークスペースでは二重初期化しない。
          // ページ遷移時は disposeAllPlugins() が初期化状態を解除するため、
          // 新しいワークスペースが生成された時だけ再初期化される。
          if (plugin.__bf6ExperienceManagerInitialized &&
              plugin.__bf6ExperienceManagerWorkspace === ws) {
            continue;
          }
          if (plugin.__bf6ExperienceManagerInitializing) continue;

          plugin.__bf6ExperienceManagerInitializing = true;
          state.currentPluginId = plugin.id;

          let success = false;
          let lastError = null;

          // 指数バックオフによる確実なリトライ（最大8回）
          for (let attempt = 0; attempt < 8; attempt++) {
            try {
              await plugin.initializeWorkspace();
              success = true;
              break;
            } catch (err) {
              lastError = err;
              const delay = Math.min(250 * Math.pow(1.5, attempt), 2000);
              await new Promise(r => setTimeout(r, delay));
            }
          }

          state.currentPluginId = null;
          plugin.__bf6ExperienceManagerInitializing = false;

          if (success) {
            plugin.__bf6ExperienceManagerInitialized = true;
            plugin.__bf6ExperienceManagerWorkspace = ws;
            // 成功した旨を通知し、以前のエラーがあればクリア
            window.dispatchEvent(new CustomEvent("bf6-experience-manager-plugin-success", {
              detail: { pluginId: plugin.id }
            }));
          } else if (lastError) {
            plugin.__bf6ExperienceManagerInitialized = false;
            shared.logError(plugin.id + " initializeWorkspace", String(lastError));
            reportPluginError(plugin.id, "runtime", lastError);
          }
        }
      });
      return state.initQueue;
    };

    // ページ遷移 / ?ID=変更時のプラグイン終了処理。
    // userScripts は同一SPAドキュメント内のURL変更では再実行されないため、
    // history APIだけでなくURLポーリングでも確実に検知する。
    if (!state.navigationCleanupHooked) {
      state.navigationCleanupHooked = true;

      const isBlocksRoute = (url) => {
        try {
          const u = new URL(url == null ? location.href : String(url), location.href);
          return u.origin === "https://portal.battlefield.com" &&
            u.pathname === "/bf6/ja-jp/experience/rules/blocks";
        } catch (_) {
          return false;
        }
      };

      const disposeAllPlugins = (reason) => {
        if (state.navigationDisposing) return;
        state.navigationDisposing = true;
        try {
          for (const plugin of Object.values(state.plugins)) {
            if (!plugin) continue;
            try {
              if (typeof plugin.dispose === "function") plugin.dispose(reason);
              else if (typeof plugin.cleanup === "function") plugin.cleanup(reason);
              else if (typeof plugin.destroy === "function") plugin.destroy(reason);
            } catch (error) {
              reportPluginError(plugin.id, "dispose", error);
            }
            plugin.__bf6ExperienceManagerInitialized = false;
            plugin.__bf6ExperienceManagerInitializing = false;
            plugin.__bf6ExperienceManagerWorkspace = null;
          }
          state.activeWorkspace = null;
        } finally {
          state.navigationDisposing = false;
        }
      };
      state.disposeAllPlugins = disposeAllPlugins;

      const normalizeUrl = (url) => {
        try { return new URL(url == null ? location.href : String(url), location.href).href; }
        catch (_) { return location.href; }
      };

      const handleNavigation = (nextUrl, reason) => {
        const currentUrl = location.href;
        const targetUrl = normalizeUrl(nextUrl);
        if (targetUrl === currentUrl) return;

        const wasBlocks = isBlocksRoute(currentUrl);
        const willBeBlocks = isBlocksRoute(targetUrl);

        // blocks?ID=A → blocks?ID=B もURL変更として終了→再初期化。
        if (wasBlocks) disposeAllPlugins(reason);
        if (willBeBlocks) setTimeout(() => state.runPluginInitializers(), 300);
      };

      const origPush = history.pushState;
      history.pushState = function(...args) {
        const targetUrl = normalizeUrl(args[2]);
        const result = origPush.apply(this, args);
        handleNavigation(targetUrl, "history.pushState");
        return result;
      };

      const origReplace = history.replaceState;
      history.replaceState = function(...args) {
        const targetUrl = normalizeUrl(args[2]);
        const result = origReplace.apply(this, args);
        handleNavigation(targetUrl, "history.replaceState");
        return result;
      };

      window.addEventListener("popstate", () => {
        const url = location.href;
        if (isBlocksRoute(url)) {
          disposeAllPlugins("popstate");
          setTimeout(() => state.runPluginInitializers(), 300);
        } else {
          disposeAllPlugins("popstate");
        }
      }, true);

      window.addEventListener("hashchange", () => {
        const url = location.href;
        if (isBlocksRoute(url)) {
          disposeAllPlugins("hashchange");
          setTimeout(() => state.runPluginInitializers(), 300);
        } else {
          disposeAllPlugins("hashchange");
        }
      }, true);

      window.addEventListener("pagehide", () => disposeAllPlugins("pagehide"), true);
      window.addEventListener("beforeunload", () => disposeAllPlugins("beforeunload"), true);

      state.lastNavigationUrl = location.href;
      state.navigationMonitor = setInterval(() => {
        const currentUrl = location.href;
        if (currentUrl === state.lastNavigationUrl) return;
        const previousUrl = state.lastNavigationUrl;
        state.lastNavigationUrl = currentUrl;

        const wasBlocks = isBlocksRoute(previousUrl);
        const willBeBlocks = isBlocksRoute(currentUrl);
        if (wasBlocks) disposeAllPlugins("url-change");
        if (willBeBlocks) setTimeout(() => state.runPluginInitializers(), 300);
      }, 100);
    }

    // Blockly が先に消えるSPA遷移にも対応。URL変更よりDOM変更が先に起きても、
    // その時点で全プラグインを終了させる。これでスクロール制限が次ページへ残らない。
    if (!state.blocklyLifecycleHooked) {
      state.blocklyLifecycleHooked = true;
      let hadBlockly = !!document.querySelector(".blocklySvg");
      const blocklyLifecycleObserver = new MutationObserver(() => {
        const hasBlockly = !!document.querySelector(".blocklySvg");
        if (hadBlockly && !hasBlockly) {
          try { state.disposeAllPlugins?.("Blockly removed (navigation)"); } catch (_) {}
          state.activeWorkspace = null;
        }
        hadBlockly = hasBlockly;
      });
      blocklyLifecycleObserver.observe(document.documentElement, { childList: true, subtree: true });
      state.blocklyLifecycleObserver = blocklyLifecycleObserver;
    }

    // SPA遷移（URL変化）やDOM変化でブロックエディタが現れた際に自動追随
    if (!state.observerHooked) {
      state.observerHooked = true;

      const triggerCheck = () => {
        const ws = getMainWorkspace();
        if (ws && ws !== state.activeWorkspace) {
          state.runPluginInitializers(true);
        }
      };

      const obs = new MutationObserver(() => triggerCheck());
      obs.observe(document.documentElement, { childList: true, subtree: true });

      // history / URL 監視は上の navigationCleanupHooked で一元管理。

      // 外部(Content Script)からの再初期化要請を受け付ける
      window.addEventListener("bf6-experience-manager-trigger-init", () => {
        state.runPluginInitializers(true);
      });
    }

    // 初回実行トリガー
    state.runPluginInitializers();
  })();`;
}

async function unregisterPlugin(id) {
  if (!userScriptsAvailable()) return;
  await chrome.userScripts.unregister({ ids: [id] }).catch(() => { });
}

async function registerHostScript() {
  if (!userScriptsAvailable()) return;
  await unregisterPlugin(HOST_ID);
  await chrome.userScripts.register([{
    id: HOST_ID,
    matches: PORTAL_MATCH,
    runAt: "document_start", // DOM生成初期から待機
    world: "MAIN",
    js: [{ code: hostSource() }]
  }]);
}

async function registerPlugin(plugin) {
  if (!userScriptsAvailable()) {
    throw new Error("Chromeの「Allow User Scripts」を有効にしてください。");
  }

  await unregisterPlugin(plugin.manifest.id);

  const source = await getCachedPluginSource(plugin);
  // 同一ドキュメントへの救済注入と通常の userScripts 注入が重なっても、
  // プラグイン本体を二重評価しないようにする。
  const code = buildPluginCode(plugin, source);

  await chrome.userScripts.register([{
    id: plugin.manifest.id,
    matches: PORTAL_MATCH,
    runAt: "document_idle",
    world: "MAIN",
    js: [{ code }]
  }]);
}

async function setPluginError(id, kind, message) {
  const plugins = await getPlugins();
  let changed = false;
  for (const plugin of plugins) {
    if (plugin?.manifest?.id === id) {
      plugin.error = { kind, message: String(message || "Unknown error"), at: Date.now() };
      changed = true;
      break;
    }
  }
  if (changed) await chrome.storage.local.set({ plugins });
}

async function clearPluginError(id) {
  const plugins = await getPlugins();
  let changed = false;
  for (const plugin of plugins) {
    if (plugin?.manifest?.id === id && plugin.error) {
      delete plugin.error;
      changed = true;
      break;
    }
  }
  if (changed) await chrome.storage.local.set({ plugins });
}

let isSyncing = false;
async function syncPlugins() {
  if (!userScriptsAvailable() || isSyncing) return;
  isSyncing = true;

  try {
    await registerHostScript();

    const plugins = await getPlugins();
    const activeIds = new Set([HOST_ID]);

    for (const plugin of plugins) {
      if (!plugin || !plugin.manifest || !plugin.manifest.id) continue;
      if (!plugin.enabled || !plugin.mainUrl) {
        await unregisterPlugin(plugin.manifest.id);
        continue;
      }
      try {
        await registerPlugin(plugin);
        activeIds.add(plugin.manifest.id);
      } catch (error) {
        console.warn("Plug-in load failed:", plugin.manifest.id, error);
        await setPluginError(plugin.manifest.id, "load", error?.message || error);
      }
    }

    const registered = await chrome.userScripts.getScripts();
    for (const script of registered) {
      if (!activeIds.has(script.id)) {
        await unregisterPlugin(script.id);
      }
    }
  } finally {
    isSyncing = false;
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) return;

  if (message.type === "plugin-error") {
    setPluginError(message.pluginId, message.kind || "runtime", message.message || "Unknown error")
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (message.type === "plugin-success") {
    clearPluginError(message.pluginId)
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "open-plugin-manager") {
    const url = chrome.runtime.getURL("popup.html");
    (async () => {
      try {
        const width = 500;
        const height = 620;
        let left;
        let top;
        if (chrome.system?.display?.getInfo) {
          const displays = await chrome.system.display.getInfo();
          const primary = displays.find(d => d.isPrimary) || displays[0];
          if (primary?.workArea) {
            const wa = primary.workArea;
            left = Math.round(wa.left + (wa.width - width) / 2);
            top = Math.round(wa.top + (wa.height - height) / 2);
          }
        }
        const options = { url, type: "popup", width, height };
        if (Number.isFinite(left)) options.left = left;
        if (Number.isFinite(top)) options.top = top;
        await chrome.windows.create(options);
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, error: String(error?.message || error) });
      }
    })();
    return true;
  }

  if (message.type === "portal-page-ready") {
    const tabId = _sender?.tab?.id;
    const url = String(message.url || _sender?.tab?.url || "");
    // document_idle 到達直後 + 少し遅らせた再試行で、
    // ポータル側のSPA初期化と拡張機能登録の競合を吸収する。
    enqueuePageInjection(tabId, url).catch(error => {
      console.warn("BF6 current-page injection failed:", error);
    });
    return false;
  }

  if (message.type === "sync-plugins") {
    syncPlugins()
      .then(() => sendResponse({ ok: true, userScripts: userScriptsAvailable() }))
      .catch(error => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(() => { syncPlugins(); });
chrome.runtime.onStartup.addListener(() => { syncPlugins(); });
// Service Worker が起動した瞬間にも登録を試みる。
// これによりブラウザ起動後の最初のポータル表示で登録競合を減らす。
syncPlugins().catch(error => console.warn("BF6 startup sync failed:", error));