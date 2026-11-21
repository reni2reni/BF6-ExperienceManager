(() => {
  'use strict';

  const STYLE_ID = 'bf6-toolbox-pinned-controls-style';
  const TAG = 'data-bf6-toolbox-pinned';
  let scheduled = false;

  function toolboxNow() {
    return document.querySelector('.blocklyToolboxDiv');
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .blocklyToolboxDiv [${TAG}="font"] {
        position: sticky !important;
        top: 0 !important;
        z-index: 40 !important;
        background: rgb(22, 29, 30) !important;
      }
      .blocklyToolboxDiv [${TAG}="search"] {
        position: sticky !important;
        z-index: 39 !important;
        background: rgb(22, 29, 30) !important;
      }
      .blocklyToolboxDiv [${TAG}="results-heading"] {
        position: sticky !important;
        z-index: 38 !important;
        background: rgb(22, 29, 30) !important;
      }
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function findSearchInput(toolbox) {
    const candidates = [...toolbox.querySelectorAll('input, [role="searchbox"], [contenteditable="true"]')];
    return candidates.find(el => {
      const attrs = [
        el.getAttribute('type') || '',
        el.getAttribute('placeholder') || '',
        el.getAttribute('aria-label') || '',
        el.getAttribute('title') || ''
      ].join(' ');
      return /search|検索/i.test(attrs) || el.getAttribute('type') === 'search';
    }) || null;
  }

  function chooseSearchContainer(input, toolbox) {
    if (!input) return null;
    let el = input;
    for (let i = 0; i < 4 && el.parentElement && el.parentElement !== toolbox; i++) {
      const parent = el.parentElement;
      const rect = parent.getBoundingClientRect();
      if (rect.height > 0 && rect.height <= 100 && parent.children.length <= 8) el = parent;
      else break;
    }
    return el;
  }

  function findResultsHeading(toolbox) {
    const nodes = [...toolbox.querySelectorAll('div, span, label, h1, h2, h3, p')];
    return nodes.find(el => {
      if (el.children.length > 2) return false;
      const t = (el.textContent || '').trim();
      return /^(検索結果|検索結果一覧|Search results?)$/i.test(t);
    }) || null;
  }

  function mark(toolbox) {
    const font = toolbox.querySelector('#bf6-toolbox-font-control-bar');
    if (font) font.setAttribute(TAG, 'font');

    const search = chooseSearchContainer(findSearchInput(toolbox), toolbox);
    if (search && search !== font && !search.contains(font)) {
      search.setAttribute(TAG, 'search');
    }

    const heading = findResultsHeading(toolbox);
    if (heading && heading !== font && heading !== search) {
      heading.setAttribute(TAG, 'results-heading');
    }

    const fontHeight = font?.getBoundingClientRect().height || 0;
    if (search) {
      search.style.setProperty('top', `${Math.ceil(fontHeight)}px`, 'important');
    }
    const searchHeight = search?.getBoundingClientRect().height || 0;
    if (heading) {
      heading.style.setProperty('top', `${Math.ceil(fontHeight + searchHeight)}px`, 'important');
    }
  }

  function run() {
    scheduled = false;
    const toolbox = toolboxNow();
    if (!toolbox) return;
    addStyle();
    mark(toolbox);
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(run);
  }

  addStyle();
  schedule();
  setInterval(schedule, 700);

  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('resize', schedule, { passive: true });
})();