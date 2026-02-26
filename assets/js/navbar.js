(function () {
  'use strict';

  var backdrop   = document.getElementById('pkicMegaBackdrop');
  var overlay    = document.getElementById('pkicSearchOverlay');
  var sInput     = document.getElementById('pkicSearchInput');
  var sResults   = document.getElementById('pkicSearchResults');
  var openBtn    = document.getElementById('searchOpenBtn');
  var closeBtn   = document.getElementById('pkicSearchClose');

  if (!backdrop) return; // navbar not present on this page

  // ── Multi-panel Mega menu ─────────────────────────────────────────────

  var allTriggers = document.querySelectorAll('.pkic-mega-trigger');
  var allPanels   = document.querySelectorAll('.pkic-mega-panel');

  function getPanel(targetId) {
    return document.getElementById(targetId);
  }

  function openMega(triggerEl) {
    var targetId = triggerEl.querySelector('[data-mega-target]').getAttribute('data-mega-target');
    var panel    = getPanel(targetId);
    if (!panel) return;
    // Close all first
    allPanels.forEach(function (p) { p.classList.remove('is-open'); });
    document.querySelectorAll('.pkic-mega-chevron').forEach(function (c) {
      c.classList.remove('is-open'); c.setAttribute('aria-expanded', 'false');
    });
    allTriggers.forEach(function (t) {
      t.querySelectorAll('.nav-link').forEach(function (l) { l.classList.remove('is-active'); });
    });
    // Open this one
    panel.classList.add('is-open');
    backdrop.classList.add('is-open');
    var chevron = triggerEl.querySelector('.pkic-mega-chevron');
    if (chevron) { chevron.classList.add('is-open'); chevron.setAttribute('aria-expanded', 'true'); }
    triggerEl.querySelectorAll('.nav-link').forEach(function (l) { l.classList.add('is-active'); });
  }

  function closeMega() {
    allPanels.forEach(function (p) { p.classList.remove('is-open'); });
    backdrop.classList.remove('is-open');
    document.querySelectorAll('.pkic-mega-chevron').forEach(function (c) {
      c.classList.remove('is-open'); c.setAttribute('aria-expanded', 'false');
    });
    allTriggers.forEach(function (t) {
      t.querySelectorAll('.nav-link').forEach(function (l) { l.classList.remove('is-active'); });
    });
  }

  // ── Hover + click per trigger ─────────────────────────────────────────
  var megaHoverTimer = null;

  function megaClearTimer() {
    if (megaHoverTimer) { clearTimeout(megaHoverTimer); megaHoverTimer = null; }
  }

  function megaScheduleClose() {
    megaHoverTimer = setTimeout(closeMega, 150);
  }

  // Per-trigger "locked closed" flag — chevron click suppresses next mouseenter
  allTriggers.forEach(function (triggerEl) {
    triggerEl._megaLockedClosed = false;

    triggerEl.addEventListener('mouseenter', function () {
      if (triggerEl._megaLockedClosed) return;
      megaClearTimer();
      openMega(triggerEl);
    });
    triggerEl.addEventListener('mouseleave', function () {
      triggerEl._megaLockedClosed = false; // reset lock when mouse truly leaves
      megaScheduleClose();
    });
  });

  // Keep open while hovering over any panel
  allPanels.forEach(function (panel) {
    panel.addEventListener('mouseenter', megaClearTimer);
    panel.addEventListener('mouseleave', megaScheduleClose);
  });

  // Click on chevron button toggles panel (open/close) — nav-link always navigates
  document.querySelectorAll('[data-mega-target]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var targetId  = btn.getAttribute('data-mega-target');
      var panel     = getPanel(targetId);
      var triggerEl = btn.closest('.pkic-mega-trigger');
      if (panel && panel.classList.contains('is-open')) {
        triggerEl._megaLockedClosed = true; // prevent hover from immediately reopening
        closeMega();
      } else {
        if (triggerEl) {
          triggerEl._megaLockedClosed = false;
          openMega(triggerEl);
        }
      }
    });
  });

  backdrop.addEventListener('click', closeMega);

  // ── Search overlay ───────────────────────────────────────────────────

  var pf = null;

  function openSearch() {
    closeMega();
    overlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { sInput.focus(); }, 80);
    if (!pf) {
      import('/pagefind/pagefind.js').then(function (m) {
        pf = m;
        if (pf.init) pf.init();
      }).catch(function () {});
    }
  }

  function closeSearch() {
    overlay.classList.remove('is-open');
    document.body.style.overflow = '';
    sInput.value = '';
    sResults.innerHTML = '<p class="pkic-search-hint">Start typing to search across all content\u2026</p>';
  }

  if (openBtn)  openBtn.addEventListener('click', openSearch);
  if (closeBtn) closeBtn.addEventListener('click', closeSearch);

  overlay.addEventListener('click', function (e) { if (e.target === overlay) closeSearch(); });

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { closeMega(); closeSearch(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openSearch(); }
  });

  // ── Search handler ───────────────────────────────────────────────────

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var debounce;
  sInput.addEventListener('input', function () {
    clearTimeout(debounce);
    var q = this.value.trim();
    if (!q) { sResults.innerHTML = '<p class="pkic-search-hint">Start typing to search across all content\u2026</p>'; return; }
    debounce = setTimeout(function () { runSearch(q); }, 220);
  });

  async function runSearch(q) {
    if (!pf) {
      sResults.innerHTML = '<p class="pkic-search-hint">Search index not available \u2014 run <code>hugo build</code> first.</p>';
      return;
    }
    sResults.innerHTML = '<p class="pkic-search-hint">Searching\u2026</p>';
    try {
      var res = await pf.search(q);
      if (!res.results.length) {
        sResults.innerHTML = '<p class="pkic-search-hint">No results for <strong>' + esc(q) + '</strong></p>';
        return;
      }
      var top  = await Promise.all(res.results.slice(0, 8).map(function (r) { return r.data(); }));
      sResults.innerHTML = top.map(function (d) {
        var title   = esc(d.meta && d.meta.title ? d.meta.title : 'Untitled');
        var excerpt = d.excerpt || '';
        return '<a class="pkic-search-result-item" href="' + esc(d.url) + '">' +
          '<div class="pkic-sr-title">'   + title   + '</div>' +
          '<div class="pkic-sr-url">'     + esc(d.url) + '</div>' +
          (excerpt ? '<div class="pkic-sr-excerpt">' + excerpt + '</div>' : '') +
          '</a>';
      }).join('');
    } catch (err) {
      sResults.innerHTML = '<p class="pkic-search-hint">Search unavailable. <a href="/blog/" style="color:#7cf0be">Browse the blog \u2192</a></p>';
    }
  }

})();
