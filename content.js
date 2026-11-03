(() => {
  // ▼ ブロック画面かどうかの厳密判定
  function isBlocksPage() {
    return location.pathname.includes('/experience/rules/blocks');
  }

  // ▼ ブロック画面以外に移動した時にスクロール制限を解除する処理
  function releaseScrollRestriction() {
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
    window.onwheel = null;
    window.onmousewheel = null;
  }

  // 画面移動を監視し、ブロック画面以外ならスクロールを即時解放
  let prevIsBlocks = isBlocksPage();
  setInterval(() => {
    const currentIsBlocks = isBlocksPage();
    if (prevIsBlocks && !currentIsBlocks) {
      releaseScrollRestriction();
    }
    prevIsBlocks = currentIsBlocks;
  }, 200);

  const ITEM_CLASS = 'bf6-experience-manager-menu-item';
  const OPTIONS_CLASS = 'bf6-experience-manager-options-item';
  const CLIPBOARD_CLASS = 'bf6-experience-manager-clipboard-item';
  const MULTI_SELECT_CLASS = 'bf6-multi-selected';
  const LABEL = 'BF6 ExperienceManager';
  const MENU_SELECTOR = '.blocklyContextMenu';
  let lastContextTarget = null;
  let lastContextPath = [];
  let lastContextEvent = null;
  // 右クリック直後の対象を唯一の判定元にする。
  // メニューDOMの残骸や前回のメニュー項目からblock/workspaceを推測しない。
  let lastContextIsBlock = false;
  let activeSubmenu = null;
  let activeSubmenuLabels = null;
  let activeSubmenuMenu = null;
  let pluginMenuIds = new Set();
  let pluginMenuLabels = new Set();
  let menuQueryCounter = 0;
  let queryCounter = 0;

  // ▼ 言語設定が日本語かどうかを判定
  function isJapanese() {
    return location.pathname.includes('/ja-jp') || document.documentElement.lang?.startsWith('ja');
  }

  // ▼ 日本語/英語のメニュー翻訳辞書
  const JA_TRANSLATIONS = [
    { pattern: /^options\s*>?/i, text: 'オプション >' },
    { pattern: /^(duplicate(\s*block)?|重複)$/i, text: 'ブロックを複製' },
    { pattern: /^delete\s*(\d+)\s*blocks?$/i, replace: (_, n) => `${n} 個のブロックを削除` },
    { pattern: /^delete\s*block$/i, text: 'ブロックを削除' },
    { pattern: /^add\s*comment$/i, text: 'コメントを追加' },
    { pattern: /^remove\s*comment$/i, text: 'コメントを削除' },
    { pattern: /^inline\s*inputs$/i, text: '内部入力' },
    { pattern: /^external\s*inputs$/i, text: '外部入力' },
    { pattern: /^collapse\s*block$/i, text: 'ブロックを折りたたむ' },
    { pattern: /^expand\s*block$/i, text: 'ブロックを展開' },
    { pattern: /^disable\s*block$/i, text: 'ブロックを無効にする' },
    { pattern: /^enable\s*block$/i, text: 'ブロックを有効にする' },
    { pattern: /^undo$/i, text: '元に戻す' },
    { pattern: /^redo$/i, text: 'やり直す' },
    { pattern: /^clean\s*up(\s*blocks)?$/i, text: 'ブロックを整理' },
    { pattern: /^help$/i, text: 'ヘルプ' }
  ];

  function translateText(rawText) {
    if (!isJapanese()) return rawText;
    for (const item of JA_TRANSLATIONS) {
      if (item.pattern.test(rawText)) {
        return typeof item.replace === 'function' ? rawText.replace(item.pattern, item.replace) : item.text;
      }
    }
    return rawText;
  }

  function findMenus() {
    return Array.from(document.querySelectorAll(MENU_SELECTOR));
  }

  // ▼ 右クリックメニューの並び替え
  // 各メニューは独立して扱い、別メニューへ項目を移動できないようにする。
  const MENU_ORDER_STORAGE_KEY = 'bf6-context-menu-order-v1';
  let menuDragState = null;
  const menuUndoHistory = new Map();
  const menuRedoHistory = new Map();
  const menuDefaultOrders = new Map();

  // メニュー編集ON/OFFは保存しない。
  // ページ（window）が新しくなった時だけOFFに戻り、
  // 同じページ内ではメニューを閉じてもON/OFF状態を維持する。
  const MENU_EDIT_STATE_KEY = '__bf6MenuEditEnabled';
  if (typeof window[MENU_EDIT_STATE_KEY] !== 'boolean') {
    window[MENU_EDIT_STATE_KEY] = false;
  }

  function isMenuEditEnabled() {
    return window[MENU_EDIT_STATE_KEY] === true;
  }

  function setMenuEditEnabled(enabled) {
    window[MENU_EDIT_STATE_KEY] = !!enabled;
    if (!enabled && menuDragState) finishMenuDrag();

    // ONにした瞬間に、現在表示中の全メニューへ☰を生成する。
    // Optionsサブメニューは .blocklyContextMenu ではないため、明示的に対象にする。
    if (enabled) {
      document.querySelectorAll(MENU_SELECTOR).forEach(menu => {
        ensureMenuDragHandles(menu);
      });
      document.querySelectorAll('.bf6-experience-manager-options-submenu').forEach(sub => {
        ensureMenuDragHandles(sub);
      });
    }

    document.querySelectorAll('.bf6-menu-drag-handle').forEach(handle => {
      handle.style.display = enabled ? 'inline-flex' : 'none';
    });
    document.querySelectorAll('[data-bf6-menu-edit-toggle]').forEach(toggle => {
      const label = toggle._bf6Label || toggle;
      const ja = isJapanese();
      label.textContent = ja
        ? (enabled ? 'メニュー編集 ON' : 'メニュー編集 OFF')
        : (enabled ? 'Menu Edit ON' : 'Menu Edit OFF');
    });
  }

  function getMenuOrderStore() {
    try {
      const raw = localStorage.getItem(MENU_ORDER_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function saveMenuOrderStore(store) {
    try {
      localStorage.setItem(MENU_ORDER_STORAGE_KEY, JSON.stringify(store));
    } catch (_) { }
  }

  function menuItemKey(item) {
    if (!item || item.classList.contains(OPTIONS_CLASS)) return 'options';
    const action = item.getAttribute?.('data-action');
    if (action) return 'action:' + action;
    const stableKey = item.getAttribute?.('data-bf6-menu-key');
    if (stableKey) return 'custom:' + stableKey;
    const pluginId = item.getAttribute?.('data-bf6-plugin-id');
    if (pluginId) return 'plugin:' + pluginId;
    const textEl = item.querySelector?.('.blocklyMenuItemContent') || item;
    const clone = textEl.cloneNode?.(true);
    clone?.querySelectorAll?.('.bf6-menu-drag-handle').forEach(el => el.remove());
    const rawText = (clone ? clone.textContent : textEl.textContent)?.trim() || '';
    // ▼ 翻訳後の文字列で統一してキーの分裂を防ぐ
    const text = translateText(rawText);
    return 'text:' + text.replace(/\s+/g, ' ').slice(0, 160);
  }

  function getMenuOrderKey(container) {
    if (container.matches?.(MENU_SELECTOR)) {
      // ▼ 属性がまだセットされていないタイミングでも lastContextIsBlock から確実に判定
      const mode = container.getAttribute('data-clipboard-mode') || (lastContextIsBlock ? 'block' : 'workspace');
      return mode === 'block' ? 'context:block' : 'context:workspace';
    }
    if (container.classList.contains('bf6-experience-manager-options-submenu')) return 'context:options';
    return 'context:unknown';
  }

  function getDraggableMenuItems(container) {
    if (!container) return [];
    if (container.matches?.(MENU_SELECTOR)) {
      return Array.from(container.querySelectorAll(':scope > .blocklyMenuItem')).filter(item => !item.classList.contains('bf6-menu-drag-placeholder'));
    }
    if (container.classList.contains('bf6-experience-manager-options-submenu')) {
      return Array.from(container.children).filter(item =>
        !item.classList.contains('bf6-menu-drag-placeholder') &&
        !item.classList.contains('bf6-menu-drag-ghost')
      );
    }
    return [];
  }

  // ドラッグ完了直後のDOM再構築で保存した順番を一瞬だけ
  // 古い順番へ戻されるのを防ぐ。MutationObserver等は同じイベント後に
  // 実行されるため、microtaskが終わるまで対象メニューの自動整列を止める。
  const menuOrderApplySuppressed = new WeakSet();

  function applySavedMenuOrder(container) {
    // ドラッグ中、およびドロップ直後の再構築中は絶対に並び替えない。
    if (menuDragState && menuDragState.container === container) return;
    if (menuOrderApplySuppressed.has(container)) return;

    const orderKey = getMenuOrderKey(container);
    const store = getMenuOrderStore();
    const saved = Array.isArray(store[orderKey]) ? store[orderKey] : [];
    if (!saved.length) return;

    const items = getDraggableMenuItems(container);
    const orderKeyForDefault = getMenuOrderKey(container);
    if (!menuDefaultOrders.has(orderKeyForDefault)) {
      menuDefaultOrders.set(orderKeyForDefault, items.map(menuItemKey));
    }
    const byKey = new Map(items.map(item => [menuItemKey(item), item]));
    const ordered = [];
    for (const key of saved) {
      const item = byKey.get(key);
      if (item) { ordered.push(item); byKey.delete(key); }
    }
    for (const item of items) if (byKey.has(menuItemKey(item))) ordered.push(item);
    for (const item of ordered) container.appendChild(item);
  }

  function getCurrentMenuOrder(container) {
    return getDraggableMenuItems(container).map(menuItemKey);
  }

  function saveCurrentMenuOrder(container, previousOrder) {
    const current = getCurrentMenuOrder(container);
    const orderKey = getMenuOrderKey(container);
    const store = getMenuOrderStore();
    const saved = Array.isArray(store[orderKey]) ? store[orderKey].slice() : [];

    // ▼ 今回画面に存在しない（一時的に隠れている）項目の位置関係を壊さないマージ処理
    const currentSet = new Set(current);
    const merged = [];

    // 既存リストのうち、現在画面にある要素の位置スロットを current の順番で埋める
    let currentIdx = 0;
    for (const key of saved) {
      if (currentSet.has(key)) {
        if (currentIdx < current.length) {
          merged.push(current[currentIdx++]);
        }
      } else {
        // 現在非表示の項目はそのまま元の位置関係を維持して残す
        merged.push(key);
      }
    }
    // 今回新しく登場した項目（savedに未登録だったプラグイン等）を末尾に追加
    while (currentIdx < current.length) {
      if (!merged.includes(current[currentIdx])) {
        merged.push(current[currentIdx]);
      }
      currentIdx++;
    }

    if (previousOrder && JSON.stringify(previousOrder) !== JSON.stringify(current)) {
      const undo = menuUndoHistory.get(orderKey) || [];
      undo.push(previousOrder.slice());
      if (undo.length > 50) undo.shift();
      menuUndoHistory.set(orderKey, undo);
      menuRedoHistory.set(orderKey, []);
    }

    store[orderKey] = merged;
    saveMenuOrderStore(store);
  }

  function applyMenuOrderArray(container, order) {
    if (!container || !Array.isArray(order)) return;
    const items = getDraggableMenuItems(container);
    const byKey = new Map(items.map(item => [menuItemKey(item), item]));
    const ordered = [];
    for (const key of order) {
      const item = byKey.get(key);
      if (item) { ordered.push(item); byKey.delete(key); }
    }
    for (const item of items) if (byKey.has(menuItemKey(item))) ordered.push(item);
    for (const item of ordered) container.appendChild(item);
  }

  function resetAllMenuOrders() {
    try { localStorage.removeItem(MENU_ORDER_STORAGE_KEY); } catch (_) {}
    menuUndoHistory.clear();
    menuRedoHistory.clear();
    document.querySelectorAll(MENU_SELECTOR + ', .bf6-experience-manager-options-submenu').forEach(container => {
      const key = getMenuOrderKey(container);
      const def = menuDefaultOrders.get(key);
      if (def) applyMenuOrderArray(container, def);
    });
  }

  function menuHistoryStep(container, direction) {
    const key = getMenuOrderKey(container);
    const source = direction === 'undo' ? menuUndoHistory : menuRedoHistory;
    const target = direction === 'undo' ? menuRedoHistory : menuUndoHistory;
    const list = source.get(key) || [];
    if (!list.length) return false;
    const current = getCurrentMenuOrder(container);
    const next = list.pop();
    source.set(key, list);
    const targetList = target.get(key) || [];
    targetList.push(current);
    if (targetList.length > 50) targetList.shift();
    target.set(key, targetList);
    applyMenuOrderArray(container, next);
    const store = getMenuOrderStore();
    store[key] = getCurrentMenuOrder(container);
    saveMenuOrderStore(store);
    return true;
  }

  function createMenuDropIndicator(container, referenceItem) {
    const indicator = document.createElement('div');
    indicator.className = 'bf6-menu-drag-placeholder';
    indicator.setAttribute('aria-hidden', 'true');
    const h = Math.max(2, Math.round(referenceItem.getBoundingClientRect().height));
    indicator.style.cssText = [
      `height:${h}px`,
      'box-sizing:border-box',
      'margin:0',
      'padding:0',
      'border-top:3px solid #2f8cff',
      'background:rgba(47,140,255,0.08)',
      'pointer-events:none',
      'position:relative',
      'z-index:9999'
    ].join(';');
    container.insertBefore(indicator, referenceItem);
    return indicator;
  }

  function createDragGhost(item, pointerX, pointerY) {
    const ghost = item.cloneNode(true);
    ghost.classList.remove('bf6-menu-dragging');
    ghost.classList.add('bf6-menu-drag-ghost');
    ghost.querySelectorAll?.('.bf6-menu-drag-handle').forEach(el => el.style.cursor = 'grabbing');
    const rect = item.getBoundingClientRect();
    ghost.style.cssText = [
      'position:fixed',
      `left:${Math.round(pointerX - Math.min(32, rect.width / 2))}px`,
      `top:${Math.round(pointerY - rect.height / 2)}px`,
      `width:${Math.round(rect.width)}px`,
      `height:${Math.round(rect.height)}px`,
      'box-sizing:border-box',
      'margin:0',
      'opacity:0.88',
      'pointer-events:none',
      'z-index:2147483647',
      'background:rgb(62,76,78)',
      'border:1px solid rgba(47,140,255,.75)',
      'box-shadow:0 5px 18px rgba(0,0,0,.38)',
      'transform:translateZ(0)'
    ].join(';');
    document.body.appendChild(ghost);
    return ghost;
  }

  function positionDragGhost(state, e) {
    if (!state.ghost) return;
    const rect = state.item.getBoundingClientRect();
    state.ghost.style.left = Math.round(e.clientX - Math.min(32, rect.width / 2)) + 'px';
    state.ghost.style.top = Math.round(e.clientY - rect.height / 2) + 'px';
  }

  function updateDropIndicator(state, e) {
    if (!state || !state.container || !state.placeholder) return;

    // elementFromPointで別のメニューを拾っても、開始元container以外は無視する。
    // elementFromPointではなく各項目の中心位置から挿入先を決める。
    // プレースホルダーと元項目が当たり判定に入り込んで、元位置↔移動先を
    // 高速で行き来するチラつきを防ぐ。
    const valid = getDraggableMenuItems(state.container).filter(item => item !== state.item);
    let reference = null;
    for (const target of valid) {
      const rect = target.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) {
        reference = target;
        break;
      }
    }
    if (reference === state.placeholder) reference = reference.nextElementSibling;
    if (reference) state.container.insertBefore(state.placeholder, reference);
    else state.container.appendChild(state.placeholder);
    state.moved = true;
  }

  function ensureMenuDragHandles(container) {
    if (!container || !isMenuEditEnabled()) return;
    const items = getDraggableMenuItems(container);
    for (const item of items) {
      if (item.hasAttribute('data-bf6-menu-edit-toggle')) continue;
      if (item.dataset.bf6DragReady === '1') {
        const existing = item.querySelector('.bf6-menu-drag-handle');
        if (existing) existing.style.display = 'inline-flex';
        continue;
      }
      item.dataset.bf6DragReady = '1';
      item.style.position = 'relative';
      item.style.paddingLeft = '8px';

      const handle = document.createElement('span');
      handle.className = 'bf6-menu-drag-handle';
      handle.textContent = '☰';
      handle.setAttribute('aria-hidden', 'true');
      handle.title = 'ドラッグして並び替え';
      handle.style.cssText = [
        'display:inline-flex', 'align-items:center', 'justify-content:center',
        'width:22px', 'margin-right:5px', 'color:#9aa5a7', 'font-size:18px',
        'line-height:1', 'cursor:grab', 'user-select:none', 'touch-action:none',
        'vertical-align:middle', 'flex:none'
      ].join(';');

      const content = item.querySelector?.('.blocklyMenuItemContent');
      if (content) {
        content.style.display = 'flex';
        content.style.alignItems = 'center';
        content.style.gap = '0';
        content.insertBefore(handle, content.firstChild);
      } else {
        item.insertBefore(handle, item.firstChild);
      }

      handle.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();

        const currentItems = getDraggableMenuItems(container);
        if (!currentItems.includes(item)) return;

        const rect = item.getBoundingClientRect();
        const placeholder = createMenuDropIndicator(container, item);
        const ghost = createDragGhost(item, e.clientX, e.clientY);

        // 元の項目は場所だけ残して透明化。実際に動くのはゴースト。
        item.style.visibility = 'hidden';
        item.classList.add('bf6-menu-dragging');

        menuDragState = {
          container,
          item,
          placeholder,
          ghost,
          pointerId: e.pointerId,
          moved: false,
          startX: e.clientX,
          startY: e.clientY,
          itemHeight: rect.height,
          startOrder: getCurrentMenuOrder(container)
        };

        handle.style.cursor = 'grabbing';
        try { handle.setPointerCapture(e.pointerId); } catch (_) { }
      }, true);

      handle.addEventListener('click', e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
      }, true);
    }
  }

  function finishMenuDrag() {
    if (!menuDragState) return;
    const state = menuDragState;
    const { container, item, placeholder, ghost } = state;

    // ドロップ処理から自動整列が割り込まないよう、ここからmicrotask完了まで
    // 対象メニューの保存順適用を一時停止する。
    menuOrderApplySuppressed.add(container);

    // この時点ではまだmenuDragStateを消さない。DOM変更を監視している処理が
    // 同期的に走っても「ドラッグ中」として扱えるようにする。
    if (placeholder?.parentNode === container) {
      container.insertBefore(item, placeholder);
    }
    placeholder?.remove?.();
    ghost?.remove?.();

    item.style.visibility = '';
    item.classList.remove('bf6-menu-dragging');
    item.querySelector('.bf6-menu-drag-handle')?.style && (item.querySelector('.bf6-menu-drag-handle').style.cursor = 'grab');

    // 最終DOM順をそのまま保存。以後のBlockly再構築でもこの順を復元する。
    if (state.moved) saveCurrentMenuOrder(container, state.startOrder);

    // 現在のDOM順を確定させてから、再構築処理に制御を返す。
    queueMicrotask(() => {
      if (menuDragState === state) menuDragState = null;
      menuOrderApplySuppressed.delete(container);
    });
  }

  document.addEventListener('pointermove', e => {
    const state = menuDragState;
    if (!state || e.pointerId !== state.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();
    state.moved = true;
    positionDragGhost(state, e);
    updateDropIndicator(state, e);
  }, true);

  document.addEventListener('pointerup', e => {
    if (menuDragState && e.pointerId === menuDragState.pointerId) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      finishMenuDrag();
    }
  }, true);

  document.addEventListener('pointercancel', e => {
    if (menuDragState && e.pointerId === menuDragState.pointerId) finishMenuDrag();
  }, true);

  document.addEventListener('keydown', e => {
    if (!isMenuEditEnabled() || menuDragState) return;
    if (!e.ctrlKey || e.altKey || e.metaKey) return;
    const active = document.querySelector('.bf6-experience-manager-options-submenu:hover') || document.querySelector(MENU_SELECTOR + ':hover');
    if (!active) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) {
      if (menuHistoryStep(active, 'undo')) { e.preventDefault(); e.stopPropagation(); }
    } else if (e.key.toLowerCase() === 'z' && e.shiftKey) {
      if (menuHistoryStep(active, 'redo')) { e.preventDefault(); e.stopPropagation(); }
    }
  }, true);

  function installDarkMenuStyle() {
    if (document.getElementById('bf6-experience-manager-dark-menu-style')) return;
    const styleElement = document.createElement('style');
    styleElement.id = 'bf6-experience-manager-dark-menu-style';
    styleElement.setAttribute('type', 'text/css');
    styleElement.textContent = `
      .blocklyWidgetDiv .blocklyMenu,
      .blocklyWidgetDiv .blocklyContextMenu,
      .blocklyContextMenu {
        background: rgb(22, 29, 30) !important;
        color: #ffffff !important;
        padding: 3px 0 !important;
        min-width: 200px !important;
        border-radius: 6px !important;
        overflow: hidden !important;
      }
      .blocklyWidgetDiv .blocklyMenuItem,
      .blocklyWidgetDiv .blocklyMenuItemContent,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItemContent,
      .blocklyContextMenu .blocklyMenuItem,
      .blocklyContextMenu .blocklyMenuItemContent {
        color: #ffffff !important;
        background: rgb(22, 29, 30) !important;
        font-size: 15px !important;
        line-height: 1.3 !important;
      }
      .blocklyWidgetDiv .blocklyMenuItem,
      .blocklyContextMenu .blocklyMenuItem {
        padding: 5px 18px !important;
      }
      .bf6-menu-drag-handle {
        position: relative !important;
        z-index: 2 !important;
        flex: 0 0 22px !important;
      }
      .bf6-options-menu-item .bf6-menu-drag-handle {
        margin-left: -4px !important;
        margin-right: 5px !important;
      }
      .bf6-options-font-control .bf6-menu-drag-handle {
        align-self: center !important;
      }

      .blocklyWidgetDiv .blocklyMenuItem.blocklyMenuItemHighlight,
      .blocklyWidgetDiv .blocklyMenuItem.blocklyMenuItemHighlight .blocklyMenuItemContent,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemHighlight,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemHighlight .blocklyMenuItemContent,
      .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemHighlight,
      .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemHighlight .blocklyMenuItemContent,
      .blocklyWidgetDiv .blocklyMenuItem:hover:not(.blocklyMenuItemDisabled),
      .blocklyWidgetDiv .blocklyMenuItem:hover:not(.blocklyMenuItemDisabled) .blocklyMenuItemContent,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem:hover:not(.blocklyMenuItemDisabled),
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem:hover:not(.blocklyMenuItemDisabled) .blocklyMenuItemContent,
      .blocklyContextMenu .blocklyMenuItem:hover:not(.blocklyMenuItemDisabled),
      .blocklyContextMenu .blocklyMenuItem:hover:not(.blocklyMenuItemDisabled) .blocklyMenuItemContent {
        background: rgb(62, 76, 78) !important;
        color: #ffffff !important;
      }
      .blocklyWidgetDiv .blocklyMenuItem.blocklyMenuItemDisabled,
      .blocklyWidgetDiv .blocklyMenuItem.blocklyMenuItemDisabled .blocklyMenuItemContent,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemDisabled,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemDisabled .blocklyMenuItemContent,
      .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemDisabled,
      .blocklyContextMenu .blocklyMenuItem.blocklyMenuItemDisabled .blocklyMenuItemContent,
      .blocklyWidgetDiv .blocklyMenuItem[aria-disabled="true"],
      .blocklyWidgetDiv .blocklyMenuItem[aria-disabled="true"] .blocklyMenuItemContent,
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem[aria-disabled="true"],
      .blocklyWidgetDiv .blocklyContextMenu .blocklyMenuItem[aria-disabled="true"] .blocklyMenuItemContent,
      .blocklyContextMenu .blocklyMenuItem[aria-disabled="true"],
      .blocklyContextMenu .blocklyMenuItem[aria-disabled="true"] .blocklyMenuItemContent {
        color: #aaaaaa !important;
        background: rgb(22, 29, 30) !important;
        cursor: default !important;
      }
      .bf6-menu-dragging { opacity: 1 !important; }
      .bf6-menu-drag-handle:hover { color: #ffffff !important; }
      .bf6-menu-drag-handle { cursor: grab !important; }
      [data-bf6-menu-edit-toggle] {
        color: #66ccff !important;
        font-weight: 600 !important;
      }
      .bf6-menu-drag-placeholder {
        pointer-events: none !important;
        border-top: 3px solid #2f8cff !important;
        background: rgba(47,140,255,0.08) !important;
        box-sizing: border-box !important;
      }
      .bf6-menu-drag-ghost,
      .bf6-menu-drag-ghost * {
        pointer-events: none !important;
      }
      
    `;
    document.head.appendChild(styleElement);
  }

  function styleMenu(menu) {
    installDarkMenuStyle();
    menu.style.setProperty('background-color', 'rgb(22, 29, 30)', 'important');
    menu.style.setProperty('color', '#fff', 'important');
    menu.style.setProperty('height', 'auto', 'important');
    menu.style.setProperty('max-height', 'none', 'important');
    menu.style.setProperty('overflow-y', 'visible', 'important');
    menu.style.setProperty('color-scheme', 'dark', 'important');
  }

  if (!document.getElementById('bf6-multi-select-style')) {
    const style = document.createElement('style');
    style.id = 'bf6-multi-select-style';
    style.textContent = `
      path.bf6-path-selected {
        stroke: #66ccff !important;
        stroke-width: 3px !important;
        filter: brightness(1.18);
      }
    `;
    document.head.appendChild(style);
  }

  function getBlockId() {
    try {
      const target = lastContextTarget;
      if (!target || typeof target.closest !== 'function') return null;
      const blockEl = target.closest('g.blocklyDraggable');
      if (blockEl) {
        const id = blockEl.getAttribute('data-id') || blockEl.dataset?.id;
        if (id) return String(id);
      }
    } catch (_) { }
    return null;
  }

  const multiSelectedBlockIds = new Set();
  let contextSelectedBlockIds = [];

  function getBlockIdFromEvent(event) {
    try {
      const target = event?.target;
      if (!target) return null;
      const g = target.closest ? target.closest('g.blocklyDraggable') : null;
      if (g) {
        const id = g.getAttribute('data-id') || g.dataset?.id;
        if (id) return String(id);
      }
    } catch (_) { }
    return null;
  }

  function paintMultiSelection() {
    try {
      document.querySelectorAll('.bf6-path-selected').forEach(el => el.classList.remove('bf6-path-selected'));
      const ws = (window._Blockly || window.Blockly)?.getMainWorkspace?.();
      for (const id of multiSelectedBlockIds) {
        let blockEl = null;
        if (ws && typeof ws.getBlockById === 'function') {
          const b = ws.getBlockById(id);
          if (b && typeof b.getSvgRoot === 'function') blockEl = b.getSvgRoot();
        }
        if (!blockEl) {
          blockEl = document.querySelector(`g[data-id="${id}"]`);
        }
        if (!blockEl) continue;

        for (const child of blockEl.children) {
          if (child.tagName && child.tagName.toLowerCase() === 'path' && child.classList.contains('blocklyPath')) {
            child.classList.add('bf6-path-selected');
          }
        }
      }
    } catch (_) { }
  }

  function clearMultiSelection() {
    multiSelectedBlockIds.clear();
    document.querySelectorAll('.bf6-path-selected').forEach(el => el.classList.remove('bf6-path-selected'));
  }

  function addOrToggleMultiSelection(blockId) {
    if (!blockId) return;
    const id = String(blockId);
    if (multiSelectedBlockIds.has(id)) {
      multiSelectedBlockIds.delete(id);
    } else {
      multiSelectedBlockIds.add(id);
    }
    paintMultiSelection();
  }

  // ▼ 右クリックメニューの誤爆・誤操作防止ガード
  let lastContextMenuTime = 0;

  window.addEventListener('contextmenu', () => {
    lastContextMenuTime = Date.now();
  }, true);

  const blockMenuAccidentalTriggers = (e) => {
    const onMenu = e.target.closest && (e.target.closest(MENU_SELECTOR) || e.target.closest('.bf6-experience-manager-options-submenu'));
    if (!onMenu) return;

    // 1. 左クリック（button: 0）以外によるメニュー項目の操作を完全遮断
    if (e.button !== 0 && e.button !== undefined) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }

    // 2. 右クリックでメニューが出現した直後（250ms以内）はクリックを一切受け付けない（指離脱による誤爆防止）
    if (Date.now() - lastContextMenuTime < 250) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return;
    }
  };

  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'click'].forEach(evtName => {
    window.addEventListener(evtName, blockMenuAccidentalTriggers, true);
  });

  window.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    if (e.shiftKey) {
      const blockId = getBlockIdFromEvent(e);
      if (blockId) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        addOrToggleMultiSelection(blockId);
      }
    } else {
      const onMenu = e.target.closest && (e.target.closest(MENU_SELECTOR) || e.target.closest('.bf6-experience-manager-options-submenu'));
      if (!onMenu) {
        clearMultiSelection();
        contextSelectedBlockIds = [];
      }
    }
  }, true);

  window.addEventListener('click', e => {
    if (e.shiftKey && getBlockIdFromEvent(e)) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  }, true);

  function getMultiSelectedBlockIdsForContext(blockId) {
    const id = blockId ? String(blockId) : null;
    if (id && multiSelectedBlockIds.has(id) && multiSelectedBlockIds.size > 0) {
      return Array.from(multiSelectedBlockIds);
    }
    if (id) {
      multiSelectedBlockIds.clear();
      multiSelectedBlockIds.add(id);
      paintMultiSelection();
      return [id];
    }
    return Array.from(multiSelectedBlockIds);
  }

  function closeAllMenus() {
    closeSubmenu();
    document.querySelectorAll('.blocklyContextMenu').forEach(m => {
      m.style.display = 'none';
      if (m.isConnected) m.remove();
    });
    try {
      const Blockly = window._Blockly || window.Blockly;
      if (Blockly?.WidgetDiv?.hide) Blockly.WidgetDiv.hide();
      if (Blockly?.ContextMenu?.hide) Blockly.ContextMenu.hide();
      if (Blockly?.hideChaff) Blockly.hideChaff();
    } catch (_) { }
  }

  function sendBlockAction(action, extra = {}) {
    const blockId = getBlockId();
    const isCopyOrCut = action === 'copy-block' || action === 'cut-block';
    const selectedBlockIds = isCopyOrCut
      ? (contextSelectedBlockIds.length
        ? Array.from(contextSelectedBlockIds)
        : (multiSelectedBlockIds.size ? Array.from(multiSelectedBlockIds) : getMultiSelectedBlockIdsForContext(blockId)))
      : (multiSelectedBlockIds.size > 0
        ? Array.from(multiSelectedBlockIds)
        : getMultiSelectedBlockIdsForContext(blockId));
    const detail = {
      action,
      blockId: blockId || (selectedBlockIds[0] ?? null),
      selectedBlockIds,
      x: lastContextEvent?.clientX ?? 0,
      y: lastContextEvent?.clientY ?? 0,
      ...extra
    };
    try {
      window.dispatchEvent(new CustomEvent('bf6-experience-manager-action', { detail }));
    } catch (_) { }
    closeAllMenus();
  }

  function setInputsInlineToggled() {
    sendBlockAction('toggle-inputs-inline');
  }

  function collapseBlockToggled() {
    sendBlockAction('toggle-collapse');
  }

  function closeSubmenu() {
    if (activeSubmenu) { activeSubmenu.remove(); activeSubmenu = null; }
    activeSubmenuLabels = null;
    activeSubmenuMenu = null;
  }

  window.addEventListener('bf6-experience-manager-plugin-error', e => {
    const d = e?.detail || {};
    if (!d.pluginId) return;
    try {
      chrome.runtime.sendMessage({
        type: 'plugin-error',
        pluginId: String(d.pluginId),
        kind: String(d.kind || 'runtime'),
        message: String(d.message || 'Unknown error')
      });
    } catch (_) { }
  }, true);

  window.addEventListener('bf6-experience-manager-query-result', e => {
    const d = e?.detail || {};
    if (!activeSubmenuLabels || d.requestId !== activeSubmenuLabels.requestId) return;
    const isJa = isJapanese();
    if (isJa) {
      if (activeSubmenuLabels.vertical?._bf6Label) activeSubmenuLabels.vertical._bf6Label.textContent = d.inline ? '入力を縦に並べる' : '入力を横に並べる';
      if (activeSubmenuLabels.collapse?._bf6Label) activeSubmenuLabels.collapse._bf6Label.textContent = d.collapsed ? 'ブロックを展開' : 'ブロックを折りたたむ';
    } else {
      if (activeSubmenuLabels.vertical?._bf6Label) activeSubmenuLabels.vertical._bf6Label.textContent = d.inline ? 'Show Inputs Horizontally' : 'Show Inputs Vertically';
      if (activeSubmenuLabels.collapse?._bf6Label) activeSubmenuLabels.collapse._bf6Label.textContent = d.collapsed ? 'Expand Block' : 'Collapse Block';
    }
  }, true);

  window.addEventListener('bf6-experience-manager-darkred-result', e => {
    const d = e?.detail || {};
    if (!activeSubmenuLabels || d.requestId !== activeSubmenuLabels.requestId) return;
    if (activeSubmenuLabels.darkRed?._bf6Label) activeSubmenuLabels.darkRed._bf6Label.textContent = d.enabled ? 'RED Variable ON' : 'RED Variable OFF';
  }, true);

  function openSubmenu(item) {
    closeSubmenu();
    activeSubmenuMenu = item.closest?.(MENU_SELECTOR) || null;
    const sub = document.createElement('div');
    activeSubmenu = sub;
    sub.className = 'bf6-experience-manager-options-submenu';
    Object.assign(sub.style, {
      position: 'fixed', zIndex: '2147483647', minWidth: '200px',
      background: 'rgb(22, 29, 30)', color: '#fff', border: '1px solid #3a4648',
      boxShadow: '0 2px 8px rgba(0,0,0,.22)', padding: '3px 0',
      fontFamily: 'inherit', fontSize: '15px',
      borderRadius: '6px', overflow: 'hidden'
    });

    const make = (label, action, disabled = false) => {
      const el = document.createElement('div');
      el.className = 'bf6-options-menu-item';
      Object.assign(el.style, {
        padding: '5px 18px',
        whiteSpace: 'nowrap',
        background: 'rgb(22, 29, 30)',
        color: disabled ? '#777777' : '#ffffff',
        cursor: disabled ? 'default' : 'pointer',
        fontSize: '15px',
        lineHeight: '1.3'
      });

      const labelEl = document.createElement('span');
      labelEl.className = 'bf6-options-menu-label';
      labelEl.textContent = label;
      el.appendChild(labelEl);
      el._bf6Label = labelEl;

      if (!disabled) {
        el.addEventListener('mouseenter', () => el.style.background = 'rgb(48, 60, 62)');
        el.addEventListener('mouseleave', () => el.style.background = 'rgb(22, 29, 30)');
        let activated = false;
        const activate = e => {
          if (e.target?.closest?.('.bf6-menu-drag-handle, button')) return;
          e.preventDefault();
          e.stopPropagation();
          e.stopImmediatePropagation?.();
          if (activated) return;
          activated = true;
          setTimeout(() => { activated = false; }, 200);
          action();
        };
        el.addEventListener('click', activate, true);
      }
      sub.appendChild(el);
      return el;
    };

    const isJa = isJapanese();
    const blockId = getBlockId();
    const isBlockContext = !!(activeSubmenuMenu &&
      activeSubmenuMenu.getAttribute('data-clipboard-mode') === 'block' &&
      blockId);

    const vertical = isBlockContext
      ? make(isJa ? '入力を縦に並べる' : 'Show Inputs Vertically', setInputsInlineToggled)
      : null;

    const collapse = isBlockContext
      ? make(isJa ? 'ブロックを折りたたむ' : 'Collapse Block', collapseBlockToggled)
      : null;

    // 3. RED Variable ボタン
    const darkRed = make('RED Variable ON', () => {
      try {
        window.dispatchEvent(new CustomEvent('bf6-experience-manager-action', { detail: { action: 'toggle-dark-red' } }));
      } catch (_) { }
      const isNowOn = !darkRed._bf6Label.textContent.endsWith('ON');
      darkRed._bf6Label.textContent = isNowOn ? 'RED Variable ON' : 'RED Variable OFF';
    }, false);
    darkRed.style.color = '#ffffff';
    darkRed.style.cursor = 'pointer';

    // 4. Workspace Expand ボタン
    const isExpand = getWorkspaceExpand();
    const expandBtn = make(isExpand ? 'Workspace Expand ON' : 'Workspace Expand OFF', () => {
      const next = !getWorkspaceExpand();
      setWorkspaceExpand(next);
      expandBtn._bf6Label.textContent = next ? 'Workspace Expand ON' : 'Workspace Expand OFF';
    }, false);
    expandBtn.style.color = '#ffffff';
    expandBtn.style.cursor = 'pointer';

    /*
    // 5. 文字サイズ設定（12px 〜 20px）
    const fontControl = document.createElement('div');
    fontControl.className = 'bf6-options-menu-item bf6-options-font-control';
    fontControl.setAttribute('data-bf6-menu-key', 'block-list');
    fontControl.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:5px 18px;font-size:14px;color:#fff;border-top:1px solid #3a4648;user-select:none;';
    const fLabel = document.createElement('span');
    fLabel.textContent = isJa ? '←ブロックリスト' : '←BlockList';

    const fGroup = document.createElement('div');
    fGroup.style.cssText = 'display:flex;align-items:center;gap:6px;';

    const valDisplay = document.createElement('span');
    valDisplay.style.cssText = 'font-size:15px;color:#66ccff;min-width:32px;text-align:center;font-weight:bold;';
    valDisplay.textContent = getToolboxFontSize() + 'px';

    const createFBtn = (text, delta) => {
      const b = document.createElement('button');
      b.textContent = text;
      b.style.cssText = 'background:#2d3839;color:#fff;border:2px solid #556668;border-radius:3px;padding:2px 2px;cursor:pointer;font-size:10px;line-height:1.2;';
      b.addEventListener('mouseenter', () => b.style.background = '#425355');
      b.addEventListener('mouseleave', () => b.style.background = '#2d3839');
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const cur = getToolboxFontSize();
        const next = setToolboxFontSize(cur + delta);
        valDisplay.textContent = next + 'px';
      });
      return b;
    };

    fGroup.appendChild(createFBtn('◀', -1));
    fGroup.appendChild(valDisplay);
    fGroup.appendChild(createFBtn('▶', 1));
    fontControl.appendChild(fLabel);
    fontControl.appendChild(fGroup);
    sub.appendChild(fontControl);
    */

    // 6. メニュー編集 ON/OFF
    const menuEditToggle = make(
      isMenuEditEnabled()
        ? (isJa ? 'メニュー編集 ON' : 'Menu Edit ON')
        : (isJa ? 'メニュー編集 OFF' : 'Menu Edit OFF'),
      () => setMenuEditEnabled(!isMenuEditEnabled())
    );
    menuEditToggle.setAttribute('data-bf6-menu-edit-toggle', '1');
    menuEditToggle.style.borderTop = '1px solid #3a4648';
    menuEditToggle.style.marginTop = '3px';
    menuEditToggle.style.cursor = 'pointer';

    const menuResetButton = document.createElement('button');
    menuResetButton.textContent = 'RESET';
    menuResetButton.title = isJa ? 'メニューの並び順を初期状態に戻す' : 'Reset menu order';
    menuResetButton.style.cssText = 'margin:4px 8px 4px 20px;padding:2px 7px;background:#2d3839;color:#fff;border:1px solid #556668;border-radius:3px;cursor:pointer;font-size:11px;line-height:1.2;float:right;';
    menuResetButton.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      resetAllMenuOrders();
      applySavedMenuOrder(sub);
      ensureMenuDragHandles(sub);
    });
    menuEditToggle.appendChild(menuResetButton);

    // 7. プラグインマネージャー
    const manager = make(isJa ? 'プラグインマネージャー' : 'Plug-in Manager', () => {
      closeAllMenus();
      try { chrome.runtime.sendMessage({ type: 'open-plugin-manager' }); } catch (_) { }
    });
    manager.style.borderTop = '1px solid #3a4648';
    manager.style.marginTop = '3px';

    applySavedMenuOrder(sub);
    ensureMenuDragHandles(sub);

    const requestId = `q-${Date.now()}-${++queryCounter}`;
    activeSubmenuLabels = { vertical, collapse, darkRed, expandBtn, menuEditToggle, manager, requestId };
    document.body.appendChild(sub);
    sub.addEventListener('mouseleave', () => {
      setTimeout(() => {
        if (activeSubmenu && !activeSubmenu.matches(':hover') && !item.matches(':hover')) {
          closeSubmenu();
        }
      }, 120);
    });
    try {
      window.dispatchEvent(new CustomEvent('bf6-experience-manager-query', { detail: { requestId, blockId } }));
      window.dispatchEvent(new CustomEvent('bf6-experience-manager-darkred-query', { detail: { requestId } }));
    } catch (_) { }

    const r = item.getBoundingClientRect();
    sub.style.top = Math.round(r.top) + 'px';
    sub.style.left = Math.round(r.right - 80) + 'px';

    const sr = sub.getBoundingClientRect();
    const rightSpace = window.innerWidth - r.right;
    if (rightSpace < 50 || sr.right > window.innerWidth - 4) {
      sub.style.left = Math.max(4, Math.round(r.left - sr.width + 50)) + 'px';
    }
    if (sr.bottom > window.innerHeight - 4) {
      sub.style.top = Math.max(4, Math.round(window.innerHeight - sr.height - 4)) + 'px';
    }
  }

  function requestPluginMenuIds() {
    const requestId = `m-${Date.now()}-${++menuQueryCounter}`;
    try {
      window.dispatchEvent(new CustomEvent('bf6-experience-manager-menu-query', { detail: { requestId } }));
    } catch (_) { }
  }

  window.addEventListener('bf6-experience-manager-menu-result', e => {
    const ids = e?.detail?.ids;
    if (!Array.isArray(ids)) return;
    pluginMenuIds = new Set(ids.map(String));
    pluginMenuLabels = new Set(Array.isArray(e?.detail?.labels) ? e.detail.labels.map(String) : []);
    reorderPluginItems();
  }, true);

  const BUILTIN_MENU_REGEX = /undo|redo|clean|delete|duplicate|comment|inline|collapse|expand|disable|enable|help|元に戻|やり直|整理|削除|複製|コメント|外部入力|内部入力|折りたた|展開|無効|有効|ヘルプ/i;

  function reorderPluginItems() {
    for (const menu of findMenus()) {
      if (menuDragState && menuDragState.container === menu) continue;
      const options = menu.querySelector?.('.' + OPTIONS_CLASS);
      if (!options) continue;

      // 各項目のテキスト翻訳
      for (const item of menu.querySelectorAll?.('.blocklyMenuItem') || []) {
        if (item.classList.contains(OPTIONS_CLASS) || item.classList.contains(CLIPBOARD_CLASS)) continue;
        const contentEl = item.querySelector?.('.blocklyMenuItemContent') || item;
        const currentText = contentEl.textContent?.trim() || '';
        const translated = translateText(currentText);
        if (contentEl.textContent !== translated) {
          contentEl.textContent = translated;
        }
      }

      const orderKey = getMenuOrderKey(menu);
      const store = getMenuOrderStore();
      const hasCustomOrder = Array.isArray(store[orderKey]) && store[orderKey].length > 0;

      // ▼ 保存された並び順が存在する場合は、デフォルトの強制並び替えをスキップして保存順を適用する
      if (hasCustomOrder) {
        applySavedMenuOrder(menu);
        ensureMenuDragHandles(menu);
        continue;
      }

      // --- 以下は保存データがまだ無い初回のみのデフォルト並び替え ---
      let duplicateItem = null;
      let subroutineItem = null;
      const pluginItems = [];
      const builtinItems = [];

      for (const item of menu.querySelectorAll?.('.blocklyMenuItem') || []) {
        if (item.classList.contains(OPTIONS_CLASS) || item.classList.contains(CLIPBOARD_CLASS)) continue;
        const contentEl = item.querySelector?.('.blocklyMenuItemContent') || item;
        const translated = contentEl.textContent?.trim() || '';

        if (/^(duplicate(\s*block)?|重複|ブロックを複製)$/i.test(translated) || /^複製/i.test(translated)) {
          duplicateItem = item;
        } else if (/subroutine|サブルーチン/i.test(translated)) {
          subroutineItem = item;
        } else if (BUILTIN_MENU_REGEX.test(translated)) {
          builtinItems.push(item);
        } else {
          pluginItems.push(item);
        }
      }

      if (menu.firstElementChild !== options) {
        menu.insertBefore(options, menu.firstElementChild);
      }

      let currentAnchor = options;
      const copyItem = menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="copy"]');
      const cutItem = menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="cut"]');
      const pasteItem = menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="paste"]');

      if (copyItem) { if (currentAnchor.nextSibling !== copyItem) menu.insertBefore(copyItem, currentAnchor.nextSibling); currentAnchor = copyItem; }
      if (duplicateItem) { if (currentAnchor.nextSibling !== duplicateItem) menu.insertBefore(duplicateItem, currentAnchor.nextSibling); currentAnchor = duplicateItem; }
      if (subroutineItem) { if (currentAnchor.nextSibling !== subroutineItem) menu.insertBefore(subroutineItem, currentAnchor.nextSibling); currentAnchor = subroutineItem; }
      if (cutItem) { if (currentAnchor.nextSibling !== cutItem) menu.insertBefore(cutItem, currentAnchor.nextSibling); currentAnchor = cutItem; }
      if (pasteItem) { if (currentAnchor.nextSibling !== pasteItem) menu.insertBefore(pasteItem, currentAnchor.nextSibling); currentAnchor = pasteItem; }

      for (const item of pluginItems) {
        if (currentAnchor.nextSibling !== item) menu.insertBefore(item, currentAnchor.nextSibling);
        currentAnchor = item;
      }
      for (const item of builtinItems) {
        if (currentAnchor.nextSibling !== item) menu.insertBefore(item, currentAnchor.nextSibling);
        currentAnchor = item;
      }

      applySavedMenuOrder(menu);
      ensureMenuDragHandles(menu);
    }
  }

  let submenuTimer = null;

  function addOptionsItem(menu) {
    if (menu.querySelector?.('.' + OPTIONS_CLASS)) return;

    const item = document.createElement('div');
    item.className = 'blocklyMenuItem ' + OPTIONS_CLASS;
    item.setAttribute('role', 'menuitem');
    item.style.cssText = 'color:#fff!important;font-weight:400!important;border:0!important;outline:none!important;box-shadow:none!important;cursor:pointer;';

    const content = document.createElement('div');
    content.className = 'blocklyMenuItemContent';
    content.textContent = isJapanese() ? 'オプション >' : 'Options >';
    content.style.cssText = 'color:#fff!important;font-weight:400!important;border:0!important;outline:none!important;box-shadow:none!important;';

    item.appendChild(content);

    item.addEventListener('mouseenter', () => {
      menu.querySelectorAll('.blocklyMenuItemHighlight').forEach(el => {
        if (el !== item) el.classList.remove('blocklyMenuItemHighlight');
      });
      item.classList.add('blocklyMenuItemHighlight');
      if (submenuTimer) { clearTimeout(submenuTimer); submenuTimer = null; }
      openSubmenu(item);
    }, true);

    menu.addEventListener('mouseover', (e) => {
      const target = e.target.closest('.blocklyMenuItem');
      if (target && target !== item) {
        item.classList.remove('blocklyMenuItemHighlight');
        closeSubmenu();
      }
    }, true);

    item.addEventListener('mousedown', e => { e.preventDefault(); e.stopPropagation(); openSubmenu(item); }, true);
    menu.insertBefore(item, menu.firstElementChild);
  }

  function isBlockContextMenu(menu) {
    // BlocklyのメニューDOMは再利用されるため、
    // 「現在の右クリック対象」だけで block / workspace を決める。
    // 既存メニュー内のコピー・切り取り等から推測すると、
    // 前回のblockメニュー状態をworkspaceへ持ち越す原因になる。
    return !!lastContextIsBlock;
  }

  function addClipboardItems(menu) {
    const isBlock = isBlockContextMenu(menu);
    const targetMode = isBlock ? 'block' : 'workspace';

    // メニューDOMが再利用されるため、モードだけで早期returnしない。
    // workspaceなら貼り付け、blockならコピー+切り取りが揃っている場合だけ再利用する。
    const hasCorrectClipboardItems = isBlock
      ? !!menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="copy"]') &&
        !!menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="cut"]') &&
        !menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="paste"]')
      : !!menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="paste"]') &&
        !menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="copy"]') &&
        !menu.querySelector('.' + CLIPBOARD_CLASS + '[data-action="cut"]');

    if (menu.getAttribute('data-clipboard-mode') === targetMode && hasCorrectClipboardItems) {
      return;
    }

    menu.querySelectorAll('.' + CLIPBOARD_CLASS).forEach(el => el.remove());
    menu.setAttribute('data-clipboard-mode', targetMode);

    const isJa = isJapanese();

    const createItem = (label, onClick, actionName) => {
      const item = document.createElement('div');
      item.className = 'blocklyMenuItem ' + CLIPBOARD_CLASS;
      item.setAttribute('role', 'menuitem');
      if (actionName) item.setAttribute('data-action', actionName);
      item.style.cssText = 'color:#fff!important;font-weight:400!important;border:0!important;outline:none!important;box-shadow:none!important;cursor:pointer;';

      const content = document.createElement('div');
      content.className = 'blocklyMenuItemContent';
      content.textContent = label;
      content.style.cssText = 'color:#fff!important;font-weight:400!important;border:0!important;outline:none!important;box-shadow:none!important;';
      item.appendChild(content);

      item.addEventListener('mouseenter', () => {
        menu.querySelectorAll('.blocklyMenuItemHighlight').forEach(el => el.classList.remove('blocklyMenuItemHighlight'));
        item.classList.add('blocklyMenuItemHighlight');
        closeSubmenu();
      });
      item.addEventListener('mouseleave', () => {
        item.classList.remove('blocklyMenuItemHighlight');
      });
      item.addEventListener('mousedown', e => {
        // ▼ 左クリック以外（右クリック等）は完全に無視
        if (e.button !== 0) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        closeAllMenus();
        onClick();
      }, true);
      return item;
    };

    if (isBlock) {
      menu.appendChild(createItem(isJa ? 'コピー' : 'Copy', () => sendBlockAction('copy-block'), 'copy'));
      menu.appendChild(createItem(isJa ? '切り取り' : 'Cut', () => sendBlockAction('cut-block'), 'cut'));
    } else {
      menu.appendChild(createItem(isJa ? '貼り付け' : 'Paste', async () => {
        let clipboardText = null;
        try { clipboardText = await navigator.clipboard.readText(); } catch (_) { }
        sendBlockAction('paste-block', { clipboardText });
      }, 'paste'));
    }
  }

  document.addEventListener('mousemove', (e) => {
    if (!activeSubmenu) return;
    const t = e.target;
    const isOverSub = activeSubmenu.contains(t);
    const isOverOptions = t.closest?.('.' + OPTIONS_CLASS);

    if (isOverSub || isOverOptions) {
      if (submenuTimer) { clearTimeout(submenuTimer); submenuTimer = null; }
    } else {
      if (!submenuTimer) {
        submenuTimer = setTimeout(() => {
          closeSubmenu();
          submenuTimer = null;
        }, 120);
      }
    }
  }, true);

  function addManagerItem(menu) {
    if (!menu || !menu.isConnected) return;
    styleMenu(menu);
    addOptionsItem(menu);
    addClipboardItems(menu);
    requestPluginMenuIds();
    reorderPluginItems();
  }

  function scan() {
    const menus = findMenus();
    if (menus.length === 0) {
      if (activeSubmenu) closeSubmenu();
      return;
    }
    if (activeSubmenuMenu && (!activeSubmenuMenu.isConnected || !menus.includes(activeSubmenuMenu))) {
      closeSubmenu();
    }
    for (const menu of menus) {
      addManagerItem(menu);
    }
    reorderPluginItems();
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 20);
  }

  document.addEventListener('click', e => {
    if (e.button !== undefined && e.button !== 0) return;
    const blockId = getBlockIdFromEvent(e);
    if (!blockId) {
      if (!e.shiftKey) clearMultiSelection();
      return;
    }

    if (e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();
      addOrToggleMultiSelection(blockId);
    } else {
      clearMultiSelection();
      contextSelectedBlockIds = [];
    }
  }, true);

  // ▼ ブロックのダブルクリック（サブルクリック）で Collapse / Expand を切り替える
  document.addEventListener('dblclick', e => {
    const blockId = getBlockIdFromEvent(e);
    if (!blockId) return;

    // 入力欄やボタンの上でのダブルクリックは除外
    const tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'button') return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    // 選択状態を同期
    if (!multiSelectedBlockIds.has(String(blockId))) {
      multiSelectedBlockIds.clear();
      multiSelectedBlockIds.add(String(blockId));
      paintMultiSelection();
    }
    contextSelectedBlockIds = Array.from(multiSelectedBlockIds);

    // 折りたたみ / 展開のアクションを送信
    sendBlockAction('toggle-collapse');
  }, true);

  // ▼ ブロックのマウス中央ボタン（ホイールクリック / 3ボタン目）で 内部入力の縦横切り替えをトグル
  document.addEventListener('auxclick', e => {
    // 1 (中クリック) 以外のボタンは除外
    if (e.button !== 1) return;

    const blockId = getBlockIdFromEvent(e);
    if (!blockId) return;

    const tag = e.target.tagName ? e.target.tagName.toLowerCase() : '';
    if (tag === 'input' || tag === 'textarea' || tag === 'button') return;

    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation?.();

    if (!multiSelectedBlockIds.has(String(blockId))) {
      multiSelectedBlockIds.clear();
      multiSelectedBlockIds.add(String(blockId));
      paintMultiSelection();
    }
    contextSelectedBlockIds = Array.from(multiSelectedBlockIds);

    // 入力の水平/垂直切り替えアクションを送信
    sendBlockAction('toggle-inputs-inline');
  }, true);
  
  const multiSelectionObserver = new MutationObserver(() => {
    if (multiSelectedBlockIds.size) paintMultiSelection();
  });
  multiSelectionObserver.observe(document.body || document.documentElement, { childList: true, subtree: true });

  document.addEventListener('contextmenu', e => {
    const contextBlockId = getBlockIdFromEvent(e);
    // この右クリックの判定結果を保存（保存領域ではなく現在ページ内だけの状態）。
    lastContextIsBlock = !!contextBlockId;
    if (contextBlockId) {
      if (!multiSelectedBlockIds.has(String(contextBlockId))) {
        multiSelectedBlockIds.clear();
        multiSelectedBlockIds.add(String(contextBlockId));
        paintMultiSelection();
      }
    } else {
      clearMultiSelection();
    }
    contextSelectedBlockIds = Array.from(multiSelectedBlockIds);
    lastContextTarget = e.target;
    lastContextPath = typeof e.composedPath === 'function' ? e.composedPath() : [e.target];
    lastContextEvent = e;
    closeSubmenu();
    scheduleScan();
    setTimeout(scheduleScan, 50);
    setTimeout(scheduleScan, 150);
  }, true);

  document.addEventListener('mousedown', e => {
    if (activeSubmenu && !activeSubmenu.contains(e.target)) closeSubmenu();
  }, true);
  document.addEventListener('click', e => {
    if (activeSubmenu && !activeSubmenu.contains(e.target)) closeSubmenu();
  }, true);
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeSubmenu();
  }, true);

  new MutationObserver((mutations) => {
    if (activeSubmenu && (!activeSubmenuMenu || !activeSubmenuMenu.isConnected)) closeSubmenu();
    const hasMenuChange = mutations.some(m => {
      for (const node of m.addedNodes) {
        if (node.nodeType === 1 && (node.matches?.(MENU_SELECTOR) || node.querySelector?.(MENU_SELECTOR))) return true;
      }
      for (const node of m.removedNodes) {
        if (node.nodeType === 1 && (node.matches?.(MENU_SELECTOR) || node.querySelector?.(MENU_SELECTOR))) return true;
      }
      return false;
    });
    if (hasMenuChange || document.querySelector(MENU_SELECTOR)) {
      scheduleScan();
    }
  }).observe(document.body || document.documentElement, { childList: true, subtree: true });

  /* ▼ Create Rulesタイトルの消去・復元処理 */
  function getWorkspaceExpand() {
    try { return localStorage.getItem('bf6-workspace-expand') !== '0'; } catch (_) { return true; }
  }

  function setWorkspaceExpand(enabled) {
    try { localStorage.setItem('bf6-workspace-expand', enabled ? '1' : '0'); } catch (_) { }
    applyWorkspaceExpand(enabled);
  }

  function applyWorkspaceExpand(enabled) {
    let style = document.getElementById('bf6-workspace-expand-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'bf6-workspace-expand-style';
      document.head.appendChild(style);
    }

    if (enabled) {
      style.textContent = `
        .bf6-hide-expanded {
          display: none !important;
          height: 0px !important;
          min-height: 0px !important;
          max-height: 0px !important;
          margin: 0px !important;
          padding: 0px !important;
          overflow: hidden !important;
        }
      `;

      // 1. 上部タイトルバーを非表示
      document.querySelectorAll('h1, h2, h3, h4, [class*="title"], span, div').forEach(el => {
        if (el.children.length <= 1) {
          const text = el.textContent?.trim() || '';
          if (/^create\s*rules?$/i.test(text) || text === 'ルールの作成') {
            if (!el.querySelector('button')) {
              const p = el.parentElement;
              const target = (p && p !== document.body && !p.querySelector('button') && p.clientHeight < 120) ? p : el;
              target.classList.add('bf6-hide-expanded');
            }
          }
        }
      });

      // 2. 画面最下部のナビゲーションパネルを非表示
      document.querySelectorAll('footer').forEach(el => {
        if (!el.querySelector('.blocklySvg')) el.classList.add('bf6-hide-expanded');
      });

      document.querySelectorAll('div, nav, section').forEach(el => {
        if (el.querySelector('.blocklySvg') || el.classList.contains('bf6-hide-expanded')) return;
        const cls = String(el.className || '').toLowerCase();
        if (cls.includes('footer') || cls.includes('navigation') || cls.includes('bottom') || cls.includes('step') || cls.includes('wizard')) {
          const rect = el.getBoundingClientRect();
          if (rect.top > window.innerHeight * 0.65 && rect.height > 20 && rect.height < 150 && rect.width > window.innerWidth * 0.4) {
            if (el.querySelector('button, [role="button"], a, svg')) {
              el.classList.add('bf6-hide-expanded');
            }
          }
        }
      });

      // 3. 右側の「今すぐ購入」ボタン・パネルを非表示
      document.querySelectorAll('button, a, [role="button"], [class*="buy"], [class*="purchase"]').forEach(el => {
        if (el.querySelector('.blocklySvg')) return;
        const text = el.textContent?.trim() || '';
        const href = el.getAttribute('href') || '';
        const isBuy = /今すぐ購入|購入する|購入|buy\s*now|get\s*battlefield|purchase/i.test(text) ||
          /buy|purchase|store/i.test(href) ||
          /buy|purchase/i.test(el.className);

        if (isBuy) {
          let target = el;
          const p = el.parentElement;
          if (p && p !== document.body && p.children.length <= 3 && p.clientHeight < 150 && !p.querySelector('.blocklySvg') && p.tagName !== 'HEADER' && p.tagName !== 'NAV') {
            target = p;
          }
          target.classList.add('bf6-hide-expanded');
        }
      });

    } else {
      style.textContent = '';
      document.querySelectorAll('.bf6-hide-expanded').forEach(el => el.classList.remove('bf6-hide-expanded'));
    }

    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
      const ws = (window._Blockly || window.Blockly)?.getMainWorkspace?.();
      if (ws?.resize) ws.resize();
      if (ws?.resizeContents) ws.resizeContents();
    }, 150);
  }

  /* ▼ 左ブロックメニューの文字サイズ＆行の高さ連動管理（12px 〜 18px） */
  const TOOLBOX_FONT_SIZES = [10, 15, 20, 25]; // 15の次を20, 25に設定

  function getToolboxFontSize() {
    try {
      const val = parseInt(localStorage.getItem('bf6-toolbox-font-size'), 10);
      return Number.isFinite(val) ? Math.max(10, Math.min(25, val)) : 15;
    } catch (_) {
      return 15;
    }
  }

  function setToolboxFontSize(size) {
    const clamped = Math.max(10, Math.min(25, size));
    try { localStorage.setItem('bf6-toolbox-font-size', clamped); } catch (_) { }
    applyToolboxFontSize(clamped);
    return clamped;
  }

  function applyToolboxFontSize(size) {
    let style = document.getElementById('bf6-toolbox-font-style');
    if (!style) {
      style = document.createElement('style');
      style.id = 'bf6-toolbox-font-style';
      document.head.appendChild(style);
    }

    // ▼ 15px を含め、すべてのサイズで行間・余白を半分にスリム化
    let rowHeight = 24;
    let padY = 2;
    if (size <= 10) { rowHeight = 18; padY = 1; }
    else if (size <= 15) { rowHeight = 23; padY = 2; } // 15px：34pxから23pxへ半分に縮小
    else if (size <= 20) { rowHeight = 28; padY = 2; } // 20px
    else { rowHeight = 34; padY = 3; }                 // 25px

    const iconSize = Math.max(10, Math.min(18, size - 2));

    style.textContent = `
    /* ▼ Toolbox最上部の余白を完全にゼロ化 */
      .blocklyToolboxDiv {
        padding-top: 0px !important;
      }
      #bf6-toolbox-font-control-bar {
        margin-top: 0px !important;
        top: 0px !important;
      }

      .blocklyToolboxDiv,
      .blocklyToolboxDiv * {
        box-sizing: border-box !important;
      }
      .blocklyToolboxDiv,
      .blocklyToolboxDiv * {
        box-sizing: border-box !important;
      }
      .blocklyToolboxDiv [role="treeitem"],
      .blocklyToolboxDiv .blocklyTreeRow,
      .blocklyToolboxDiv .blocklyToolboxCategory,
      .blocklyToolboxDiv .blocklyToolboxItem,
      .blocklyToolboxDiv .blocklyTreeRowContentContainer {
        height: ${rowHeight}px !important;
        min-height: ${rowHeight}px !important;
        max-height: ${rowHeight}px !important;
        line-height: ${rowHeight}px !important;
        padding-top: ${padY}px !important;
        padding-bottom: ${padY}px !important;
        margin-top: 0px !important;
        margin-bottom: 0px !important;
        display: flex !important;
        align-items: center !important;
      }
      .blocklyToolboxDiv .blocklyTreeLabel {
        font-size: ${size}px !important;
        line-height: ${rowHeight}px !important;
        padding: 0 !important;
        margin: 0 !important;
      }
      .blocklyToolboxDiv .blocklyTreeIcon {
        width: ${iconSize}px !important;
        height: ${iconSize}px !important;
        min-width: ${iconSize}px !important;
        max-height: ${iconSize}px !important;
        margin-right: 5px !important;
        padding: 0 !important;
      }
      .blocklyToolboxDiv .blocklyTreeSeparator {
        margin: 1px 0 !important;
        height: 1px !important;
      }
    `;

    // DOM要素へも直接高さを注入して確実に連動
    try {
      const items = document.querySelectorAll('.blocklyToolboxDiv [role="treeitem"], .blocklyToolboxDiv .blocklyTreeRow');
      items.forEach(el => {
        el.style.setProperty('height', rowHeight + 'px', 'important');
        el.style.setProperty('min-height', rowHeight + 'px', 'important');
        el.style.setProperty('max-height', rowHeight + 'px', 'important');
        el.style.setProperty('padding-top', padY + 'px', 'important');
        el.style.setProperty('padding-bottom', padY + 'px', 'important');
      });
    } catch (_) { }
  }

  // 起動時に適用
  applyToolboxFontSize(getToolboxFontSize());

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (getWorkspaceExpand()) {
        setTimeout(() => applyWorkspaceExpand(true), 300);
        setTimeout(() => applyWorkspaceExpand(true), 1000);
      }
    }
  }, 400);

  const runExpand = () => { if (getWorkspaceExpand()) applyWorkspaceExpand(true); };
  setTimeout(runExpand, 500);
  setTimeout(runExpand, 1200);
  setTimeout(runExpand, 2500);

  /* ▼ 左側ブロックメニュー（Toolbox）の境界線ドラッグリサイズ機能 */
  let isToolboxDragging = false;

  function initToolboxResizer() {
    if (isToolboxDragging) return;

    const toolbox = document.querySelector('.blocklyToolboxDiv');
    if (!toolbox) return;

    // スクロールバーを確実に復元・有効化
    toolbox.style.overflowY = 'auto';
    toolbox.style.overflowX = 'hidden';

    const savedWidth = localStorage.getItem('bf6-toolbox-width');
    if (savedWidth) {
      const currentW = parseInt(toolbox.style.width, 10);
      const targetW = parseInt(savedWidth, 10);
      if (currentW !== targetW) {
        toolbox.style.setProperty('width', targetW + 'px', 'important');
        (window._Blockly || window.Blockly)?.getMainWorkspace?.()?.resize?.();
        window.dispatchEvent(new Event('resize'));
      }
    }

    /* ▼ 左ブロックリストの一番上（検索欄の上）にコントローラーを配置 */
    function initToolboxFontControl() {
      const toolbox = document.querySelector('.blocklyToolboxDiv');
      if (!toolbox) return;
      if (document.getElementById('bf6-toolbox-font-control-bar')) return;

      const bar = document.createElement('div');
      bar.id = 'bf6-toolbox-font-control-bar';
      bar.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 10px;
      background: rgb(22, 29, 30);
      border-bottom: 1px solid #3a4648;
      color: #fff;
      font-size: 12px;
      user-select: none;
      box-sizing: border-box;
      width: 100%;
      flex-shrink: 0;
      position: sticky;
      top: 0;
      z-index: 10;
    `;

      const label = document.createElement('span');
      label.style.cssText = 'color: #9aa5a7; font-size: 11px;';
      label.textContent = isJapanese() ? '文字サイズ' : 'Font Size';

      const fGroup = document.createElement('div');
      fGroup.style.cssText = 'display: flex; align-items: center; gap: 6px;';

      const valDisplay = document.createElement('span');
      valDisplay.id = 'bf6-toolbox-font-val';
      valDisplay.style.cssText = 'font-size: 12px; color: #66ccff; min-width: 32px; text-align: center; font-weight: bold;';
      valDisplay.textContent = getToolboxFontSize() + 'px';

      const stepSize = (direction) => {
        const cur = getToolboxFontSize();
        let idx = TOOLBOX_FONT_SIZES.indexOf(cur);
        if (idx === -1) {
          idx = TOOLBOX_FONT_SIZES.reduce((prev, curr, i) => Math.abs(curr - cur) < Math.abs(TOOLBOX_FONT_SIZES[prev] - cur) ? i : prev, 0);
        }
        const nextIdx = Math.max(0, Math.min(TOOLBOX_FONT_SIZES.length - 1, idx + direction));
        const next = setToolboxFontSize(TOOLBOX_FONT_SIZES[nextIdx]);
        valDisplay.textContent = next + 'px';
      };

      const createFBtn = (text, dir) => {
        const b = document.createElement('button');
        b.textContent = text;
        b.style.cssText = 'background:#2d3839;color:#fff;border:1px solid #556668;border-radius:3px;padding:2px 7px;cursor:pointer;font-size:11px;line-height:1.2;';
        b.addEventListener('mouseenter', () => b.style.background = '#425355');
        b.addEventListener('mouseleave', () => b.style.background = '#2d3839');
        b.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          stepSize(dir);
        });
        return b;
      };

      fGroup.appendChild(createFBtn('◀', -1));
      fGroup.appendChild(valDisplay);
      fGroup.appendChild(createFBtn('▶', 1));

      bar.appendChild(label);
      bar.appendChild(fGroup);

      // ▼ 検索欄よりも上、Toolboxの最先頭に配置
      toolbox.insertBefore(bar, toolbox.firstChild);
    }

    // 画面遷移・DOM再描画に対応できるよう定期監視
    setInterval(initToolboxFontControl, 500);
    const container = toolbox.parentElement || document.body;
    let resizer = container.querySelector('.bf6-toolbox-resizer');

    // 既に存在する場合は境界線の位置のみ追従更新
    if (resizer) {
      resizer.style.left = (toolbox.offsetLeft + toolbox.offsetWidth - 4) + 'px';
      return;
    }

    // スクロールバーと干渉しないよう親コンテナ上にドラッグハンドルを配置
    resizer = document.createElement('div');
    resizer.className = 'bf6-toolbox-resizer';
    resizer.title = 'ドラッグして横幅を変更 (ダブルクリックで初期化)';
    resizer.style.cssText = `
      position: absolute;
      top: ${toolbox.offsetTop}px;
      left: ${toolbox.offsetLeft + toolbox.offsetWidth - 4}px;
      width: 10px;
      height: ${toolbox.offsetHeight || 100}%;
      cursor: col-resize;
      z-index: 99999;
      background: transparent;
    `;

    const line = document.createElement('div');
    line.style.cssText = `
      position: absolute;
      top: 0;
      left: 4px;
      width: 2px;
      height: 100%;
      background: rgba(102, 204, 255, 0.4);
      transition: background 0.15s, width 0.15s;
      pointer-events: none;
    `;
    resizer.appendChild(line);

    resizer.addEventListener('mouseenter', () => {
      line.style.background = '#66ccff';
      line.style.width = '4px';
    });
    resizer.addEventListener('mouseleave', () => {
      if (!isToolboxDragging) {
        line.style.background = 'rgba(102, 204, 255, 0.4)';
        line.style.width = '2px';
      }
    });

    let startX = 0;
    let startWidth = 0;

    resizer.addEventListener('mousedown', (e) => {
      isToolboxDragging = true;
      startX = e.clientX;
      startWidth = toolbox.offsetWidth;
      line.style.background = '#66ccff';
      line.style.width = '4px';
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    });

    resizer.addEventListener('dblclick', (e) => {
      e.preventDefault();
      localStorage.removeItem('bf6-toolbox-width');
      toolbox.style.removeProperty('width');
      (window._Blockly || window.Blockly)?.getMainWorkspace?.()?.resize?.();
      window.dispatchEvent(new Event('resize'));
      resizer.style.left = (toolbox.offsetLeft + toolbox.offsetWidth - 4) + 'px';
    });

    const onMouseMove = (e) => {
      if (!isToolboxDragging) return;
      const delta = e.clientX - startX;
      const newWidth = Math.max(120, Math.min(700, startWidth + delta));
      toolbox.style.setProperty('width', newWidth + 'px', 'important');
      resizer.style.left = (toolbox.offsetLeft + toolbox.offsetWidth - 4) + 'px';

      (window._Blockly || window.Blockly)?.getMainWorkspace?.()?.resize?.();
      window.dispatchEvent(new Event('resize'));
    };

    const onMouseUp = () => {
      if (!isToolboxDragging) return;
      isToolboxDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      line.style.background = 'rgba(102, 204, 255, 0.4)';
      line.style.width = '2px';
      localStorage.setItem('bf6-toolbox-width', toolbox.offsetWidth);
      resizer.style.left = (toolbox.offsetLeft + toolbox.offsetWidth - 4) + 'px';
    };

    window.addEventListener('mousemove', onMouseMove, true);
    window.addEventListener('mouseup', onMouseUp, true);

    container.appendChild(resizer);
  }


  setInterval(initToolboxResizer, 500);

})();

// 以前のプロジェクトメニュー幅設定を破棄（リサイズ機能は廃止）
try { localStorage.removeItem('bf6-project-menu-width'); } catch (_) {}


/* ▼ Workspace Expand時：プロジェクト設定メニュー内に元々存在する最小化ボタンを表示位置だけ調整 */
(function initProjectMenuMinimizeButton() {
  const MOVE_CLASS = 'bf6-project-minimize-positioned';
  let lastButton = null;
  let originalStyle = null;

  function isWorkspaceExpand() {
    try { return localStorage.getItem('bf6-workspace-expand') !== '0'; } catch (_) { return true; }
  }
  function findPublish() {
    const els = document.querySelectorAll('button, a, [role="button"], div, span');
    for (const el of els) {
      const txt = (el.textContent || '').trim();
      if (!txt || txt.length > 40) continue;
      if (/^(publish|公開|パブリッシュ)$/i.test(txt)) {
        return el.closest('button,a,[role="button"]') || el;
      }
    }
    return null;
  }
  function findProjectMenu(publish) {
    if (!publish) return null;
    let el = publish.parentElement;
    let best = null;
    while (el && el !== document.body) {
      const r = el.getBoundingClientRect();
      if (r.left <= 80 && r.right <= window.innerWidth * .55 && r.height > 80) {
        best = el;
      }
      el = el.parentElement;
    }
    return best || publish.parentElement;
  }
  function labelOf(el) {
    return `${el.textContent || ''} ${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('data-tooltip') || ''}`.toLowerCase();
  }
  function looksLikeMinimize(el) {
    if (!el || el === lastButton) return false;
    const s = labelOf(el);
    return /(minimi[sz]|collapse|close|hide|最小化|閉じる|折りたたむ|隠す)/i.test(s) || /(^|\s)([-–—]$|−$)/.test(s);
  }
  function findExistingButton(menu, publish) {
    if (!menu) return null;
    const mr = menu.getBoundingClientRect();
    const pr = publish ? publish.getBoundingClientRect() : mr;
    const pool = new Set();
    const add = root => {
      if (!root) return;
      root.querySelectorAll?.('button, a, [role="button"]')?.forEach(x => pool.add(x));
    };
    // まずメニュー自身。その下の範囲外にある既存ボタンも含める。
    add(menu);
    add(menu.parentElement);
    add(menu.parentElement?.parentElement);
    const all = document.querySelectorAll('button, a, [role="button"]');
    for (const el of all) {
      if (!looksLikeMinimize(el)) continue;
      const r = el.getBoundingClientRect();
      const sameLeftArea = r.left < Math.max(mr.right + 80, window.innerWidth * .55);
      const nearMenu = Math.abs(r.left - mr.left) < 120 || (r.left >= mr.left && r.left <= mr.right + 40);
      const belowPublish = r.top >= pr.bottom - 30;
      // display:none の要素も候補に残す。元ボタンが範囲外/クリップされているケースを想定。
      if ((sameLeftArea && nearMenu && belowPublish) || (el.parentElement && (el.parentElement === menu || el.parentElement === menu.parentElement))) {
        pool.add(el);
      }
    }
    let best = null, bestScore = Infinity;
    for (const el of pool) {
      if (!looksLikeMinimize(el)) continue;
      const r = el.getBoundingClientRect();
      const score = Math.abs((r.left || mr.left) - mr.left) + Math.abs((r.top || pr.bottom) - pr.bottom);
      if (score < bestScore) { best = el; bestScore = score; }
    }
    return best;
  }
  function saveOriginal(btn) {
    if (lastButton === btn && originalStyle) return;
    lastButton = btn;
    originalStyle = {
      position: btn.style.position,
      left: btn.style.left,
      top: btn.style.top,
      right: btn.style.right,
      bottom: btn.style.bottom,
      margin: btn.style.margin,
      display: btn.style.display,
      visibility: btn.style.visibility,
      opacity: btn.style.opacity,
      zIndex: btn.style.zIndex,
      transform: btn.style.transform
    };
  }
  function restore() {
    if (!lastButton || !lastButton.isConnected) { lastButton = null; originalStyle = null; return; }
    const b = lastButton;
    if (originalStyle) {
      for (const k of Object.keys(originalStyle)) b.style[k] = originalStyle[k] || '';
    }
    b.classList.remove(MOVE_CLASS);
    lastButton = null;
    originalStyle = null;
  }
  function positionButton() {
    if (!isWorkspaceExpand()) { restore(); return; }
    const publish = findPublish();
    const menu = findProjectMenu(publish);
    if (!publish || !menu) return;
    const btn = findExistingButton(menu, publish);
    if (!btn) return;
    saveOriginal(btn);

    // DOMは既存のまま。プロジェクト設定メニュー内で、Publishの少し下へ表示。
    // これにより「下部ナビのボタン」を探すのではなく、元々このメニュー範囲外にあるボタンを救出する。
    if (btn.parentElement !== menu) menu.appendChild(btn);
    const pr = publish.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    const y = Math.max(0, pr.bottom - mr.top + 6);
    btn.classList.add(MOVE_CLASS);
    btn.style.setProperty('position', 'absolute', 'important');
    btn.style.setProperty('left', '0px', 'important');
    btn.style.setProperty('top', `${y}px`, 'important');
    btn.style.setProperty('right', 'auto', 'important');
    btn.style.setProperty('bottom', 'auto', 'important');
    btn.style.setProperty('margin', '0', 'important');
    btn.style.setProperty('display', 'flex', 'important');
    btn.style.setProperty('visibility', 'visible', 'important');
    btn.style.setProperty('opacity', '1', 'important');
    btn.style.setProperty('z-index', '10000', 'important');
    btn.style.setProperty('transform', 'none', 'important');
    // 親がクリップしている場合だけ、メニュー内で見えるようにする。
    const ms = getComputedStyle(menu);
    if (ms.overflow === 'hidden' || ms.overflowY === 'hidden' || ms.overflowY === 'auto') {
      menu.style.setProperty('overflow', 'visible', 'important');
    }
  }
  [300, 800, 1500, 2500, 4000].forEach(ms => setTimeout(positionButton, ms));
  setInterval(positionButton, 1200);
  window.addEventListener('resize', positionButton, true);
})();
