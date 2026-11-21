(() => {
  // BF6 Experiences list header visibility guard.
  // Only runs on the Experiences page and only touches the header containing
  // the Japanese title and its two category counters.
  if (window.top !== window) return;
  if (!/\/bf6\/[^/]+\/experiences\/?$/.test(location.pathname)) return;
  if (window.__bf6ExperienceHeaderGuardInstalled) return;
  window.__bf6ExperienceHeaderGuardInstalled = true;

  const TITLE = 'マイ・エクスペリエンス';
  const VERIFIED = '認証済み';
  const CUSTOM = 'カスタム';
  const normalize = value => String(value || '').replace(/[\s\u00a0]+/g, ' ').trim();
  let scheduled = false;

  function findHeader() {
    const candidates = Array.from(document.querySelectorAll('body *'))
      .filter(el => el.children.length < 30)
      .filter(el => {
        const text = normalize(el.innerText || el.textContent);
        return text.includes(TITLE) && text.includes(VERIFIED) && text.includes(CUSTOM);
      });
    // Prefer the smallest element that contains all three labels.
    candidates.sort((a, b) => {
      const at = normalize(a.innerText || a.textContent).length;
      const bt = normalize(b.innerText || b.textContent).length;
      return at - bt;
    });
    return candidates[0] || null;
  }

  function reveal(el) {
    if (!el || !el.isConnected) return;
    const chain = [];
    let node = el;
    for (let i = 0; node && node !== document.body && i < 7; i++, node = node.parentElement) {
      chain.push(node);
    }
    for (const item of chain) {
      const style = getComputedStyle(item);
      if (style.display === 'none') item.style.setProperty('display', 'revert', 'important');
      if (style.visibility === 'hidden' || style.visibility === 'collapse') {
        item.style.setProperty('visibility', 'visible', 'important');
      }
      if (Number(style.opacity) === 0) item.style.setProperty('opacity', '1', 'important');
      if (item.hasAttribute('hidden')) item.removeAttribute('hidden');
      if (item.getAttribute('aria-hidden') === 'true') item.setAttribute('aria-hidden', 'false');
    }
    // Guard the header itself against transient fade/collapse styles.
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('max-height', 'none', 'important');
    el.style.setProperty('height', 'auto', 'important');
    el.style.setProperty('clip', 'auto', 'important');
    el.style.setProperty('clip-path', 'none', 'important');
  }

  function scan() {
    scheduled = false;
    const header = findHeader();
    if (header) reveal(header);
  }

  function scheduleScan() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(scan);
  }

  const start = () => {
    scheduleScan();
    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-hidden']
    });
    // React route transitions sometimes update styles without a useful mutation.
    window.setInterval(scheduleScan, 1200);
  };

  if (document.documentElement) start();
  else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
