(function () {
  'use strict';

  var backdrop = document.getElementById('pkicMegaBackdrop');
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

  // ── Inline search bar ────────────────────────────────────────────────

  // ── Search ────────────────────────────────────────────────────────────

  var searchNav    = document.getElementById('pkicMainNav');
  var searchToggle = document.getElementById('pkicSearchToggle');
  var sInput       = document.getElementById('pkicSearchInput');
  var sInputMobile = document.getElementById('pkicSearchInputMobile');
  var sClose       = document.getElementById('pkicSearchClose');
  var sPanel       = document.getElementById('pkicSearchPanel');
  var sResults   = document.getElementById('pkicSearchResults');
  var sFilters    = document.getElementById('pkicSearchFilters');
  var sSubfilters = document.getElementById('pkicSearchSubfilters');
  var sPanelClose = document.getElementById('pkicSearchPanelClose');
  var pf           = null;
  var currentQuery  = '';
  var currentType   = '';
  var currentTag    = '';
  var currentAuthor = '';
  var allResults    = [];
  var debounce;

  // Platform-appropriate shortcut label
  var sKbd = document.getElementById('pkicSearchKbd');
  if (sKbd) {
    sKbd.textContent = /Mac|iPhone|iPad/i.test(navigator.userAgent) ? '⌘K' : 'Ctrl K';
  }

  function loadPagefind() {
    if (pf) return;
    import('/pagefind/pagefind.js').then(function (m) {
      pf = m;
      if (pf.init) pf.init();
    }).catch(function () {});
  }

  function openSearch() {
    closeMega();
    if (!searchNav || !sPanel) return;
    searchNav.classList.add('pkic-search-active');
    var navSearch = document.getElementById('pkicNavSearch');
    if (navSearch) navSearch.classList.add('is-active');
    sPanel.hidden = false;
    document.body.classList.add('pkic-search-open');
    loadPagefind();
    if (sInput) { sInput.value = ''; sInput.focus(); }
    if (sInputMobile) {
      sInputMobile.value = '';
      // Only focus the mobile input on small screens (desktop uses the navbar input)
      if (window.innerWidth < 992) { sInputMobile.focus(); }
    }
    setResults('<p class="pkic-search-hint">Start typing to search across all content\u2026</p>');
  }

  function closeSearch() {
    if (!searchNav || !sPanel) return;
    searchNav.classList.remove('pkic-search-active');
    var navSearch = document.getElementById('pkicNavSearch');
    if (navSearch) navSearch.classList.remove('is-active');
    sPanel.hidden = true;
    document.body.classList.remove('pkic-search-open');
    if (sInput) sInput.value = '';
    if (sInputMobile) sInputMobile.value = '';
    currentQuery = '';
    allResults   = [];
    currentType  = '';
    clearTimeout(debounce);
    resetFilterPills();
    setResults('<p class="pkic-search-hint">Start typing to search across all content\u2026</p>');
  }

  function setResults(html) {
    if (sResults) sResults.innerHTML = html;
  }

  function resetFilterPills() {
    if (!sFilters) return;
    sFilters.querySelectorAll('.pkic-filter-pill').forEach(function (p) {
      var base = (p.dataset.label || p.textContent).replace(/\s*\(\d+\)$/, '').trim();
      if (!p.dataset.label) p.dataset.label = base;
      p.textContent = base;
      p.classList.toggle('is-active', (p.dataset.type || '') === '');
    });
    currentTag = '';
    currentAuthor = '';
    if (sSubfilters) sSubfilters.hidden = true;
  }

  if (searchToggle) searchToggle.addEventListener('click', openSearch);

  var searchToggleMobile = document.getElementById('pkicSearchToggleMobile');
  if (searchToggleMobile) searchToggleMobile.addEventListener('click', openSearch);

  if (sClose)       sClose.addEventListener('click', closeSearch);
  if (sPanelClose)  sPanelClose.addEventListener('click', closeSearch);

  var sBackdrop = document.getElementById('pkicSearchBackdrop');
  if (sBackdrop) sBackdrop.addEventListener('click', closeSearch);

  if (sFilters) {
    sFilters.addEventListener('click', function (e) {
      var pill = e.target.closest('.pkic-filter-pill');
      if (!pill) return;
      currentType = pill.dataset.type || '';
      // Reset secondary filters when section changes
      currentTag = ''; currentAuthor = '';
      sFilters.querySelectorAll('.pkic-filter-pill').forEach(function (p) {
        p.classList.toggle('is-active', p === pill);
      });
      renderSubfilters();
      renderResults();
    });
  }

  if (sSubfilters) {
    sSubfilters.addEventListener('click', function (e) {
      var item = e.target.closest('.pkic-facet-item');
      if (!item) return;
      var kind  = item.dataset.kind;
      var value = item.dataset.value;
      if (kind === 'tag') {
        currentTag    = (currentTag === value) ? '' : value;
        currentAuthor = '';
      } else {
        currentAuthor = (currentAuthor === value) ? '' : value;
        currentTag    = '';
      }
      // Update active states in sidebar
      sSubfilters.querySelectorAll('.pkic-facet-item').forEach(function (el) {
        var active = (el.dataset.kind === 'tag'    && el.dataset.value === currentTag) ||
                     (el.dataset.kind === 'author' && el.dataset.value === currentAuthor);
        el.classList.toggle('is-active', active);
      });
      renderResults();
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (sPanel && !sPanel.hidden) { closeSearch(); }
      else { closeMega(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      if (sPanel && !sPanel.hidden) { closeSearch(); }
      else { openSearch(); }
    }
  });

  function handleSearchInput(q) {
    clearTimeout(debounce);
    currentQuery = q;
    if (!q) {
      allResults = [];
      resetFilterPills();
      setResults('<p class="pkic-search-hint">Start typing to search across all content\u2026</p>');
      return;
    }
    setResults('<p class="pkic-search-hint">Searching\u2026</p>');
    debounce = setTimeout(function () { runSearch(q); }, 220);
  }

  if (sInput) {
    sInput.addEventListener('input', function () {
      handleSearchInput(this.value.trim());
      // Keep mobile input in sync
      if (sInputMobile) sInputMobile.value = this.value;
    });
  }

  if (sInputMobile) {
    sInputMobile.addEventListener('input', function () {
      handleSearchInput(this.value.trim());
      // Keep desktop input in sync
      if (sInput) sInput.value = this.value;
    });
  }

  // ── Result rendering ──────────────────────────────────────────────────

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var TYPE_CONFIG = {
    blog:    { label: 'Blog',          color: '#2563eb', icon: '✍️' },
    events:  { label: 'Events',        color: '#d97706', icon: '📅' },
    wg:      { label: 'Working Group', color: '#059669', icon: '⚙️' },
    members: { label: 'Members',       color: '#7c3aed', icon: '🏢' },
  };
  var DEFAULT_TYPE = { label: 'Page', color: '#6b7280', icon: '📄' };

  // Blog posts use date-based permalinks: /YYYY/MM/DD/slug/ — never /blog/
  function getTypeFromUrl(url) {
    if (!url) return '';
    if (/\/\d{4}\/\d{2}\/\d{2}\//.test(url)) return 'blog';
    if (/\/events\//.test(url))  return 'events';
    if (/\/wg\//.test(url))      return 'wg';
    if (/\/members\//.test(url)) return 'members';
    return '';
  }

  function renderResults() {
    if (!sResults) return;
    var filtered = allResults.filter(function (d) {
      if (currentType && getTypeFromUrl(d.url) !== currentType) return false;
      if (currentTag    && !(d.filters && d.filters.tag    && d.filters.tag.indexOf(currentTag) !== -1))       return false;
      if (currentAuthor && !(d.filters && d.filters.author && d.filters.author.indexOf(currentAuthor) !== -1)) return false;
      return true;
    });

    if (!filtered.length) {
      setResults('<p class="pkic-search-hint">No results' +
        (currentType || currentTag || currentAuthor ? ' matching these filters' : ' for <strong>' + esc(currentQuery) + '</strong>') + '</p>');
      return;
    }

    var cards = filtered.map(function (d) {
      var type    = getTypeFromUrl(d.url);
      var cfg     = TYPE_CONFIG[type] || DEFAULT_TYPE;
      var title   = esc(d.meta && d.meta.title ? d.meta.title : 'Untitled');
      var excerpt = d.excerpt ? '<p class="pkic-sr-excerpt">' + d.excerpt + '</p>' : '';
      var image   = d.meta && d.meta.image;
      var thumb   = image
        ? '<img class="pkic-sr-thumb" src="' + esc(image) + '" alt="" loading="lazy">'
        : '<div class="pkic-sr-thumb-placeholder" style="background:' + cfg.bg + '">' + cfg.icon + '</div>';
      var tags    = (d.filters && d.filters.tag)    ? d.filters.tag.slice(0, 3)    : [];
      var authors = (d.filters && d.filters.author) ? d.filters.author.slice(0, 2) : [];
      var meta    = authors.concat(tags);
      var metaHtml = meta.length
        ? '<div class="pkic-sr-meta">' +
          authors.map(function (a) { return '<span class="pkic-sr-tag pkic-sr-tag--author">' + esc(a) + '</span>'; }).join('') +
          tags.map(function (t)    { return '<span class="pkic-sr-tag">' + esc(t) + '</span>'; }).join('') +
          '</div>'
        : '';
      return '<a class="pkic-search-result-item" href="' + esc(d.url) + '">' +
        thumb +
        '<div class="pkic-sr-body">' +
          '<div class="pkic-sr-type" style="color:' + cfg.color + '">' + cfg.label + '</div>' +
          '<div class="pkic-sr-title">' + title + '</div>' +
          excerpt + metaHtml +
        '</div></a>';
    }).join('');

    setResults(
      '<p class="pkic-search-count">' + filtered.length + '\u00a0result' + (filtered.length !== 1 ? 's' : '') + '</p>' +
      '<div class="pkic-search-results-grid">' + cards + '</div>'
    );
  }

  function updateFilterCounts() {
    if (!sFilters) return;
    sFilters.querySelectorAll('.pkic-filter-pill').forEach(function (pill) {
      var type  = pill.dataset.type || '';
      var count = type
        ? allResults.filter(function (d) { return getTypeFromUrl(d.url) === type; }).length
        : allResults.length;
      var base  = (pill.dataset.label || pill.textContent).replace(/\s*\(\d+\)$/, '').trim();
      if (!pill.dataset.label) pill.dataset.label = base;
      pill.textContent = count ? base + ' (' + count + ')' : base;
    });
  }

  // Build sidebar facet groups (Author + Tag) for results matching current section
  function renderSubfilters() {
    if (!sSubfilters) return;
    var sectionResults = currentType
      ? allResults.filter(function (d) { return getTypeFromUrl(d.url) === currentType; })
      : allResults;

    var tagCounts = {}, authorCounts = {};
    sectionResults.forEach(function (d) {
      (d.filters && d.filters.tag    || []).forEach(function (t) { tagCounts[t]    = (tagCounts[t]    || 0) + 1; });
      (d.filters && d.filters.author || []).forEach(function (a) { authorCounts[a] = (authorCounts[a] || 0) + 1; });
    });

    var tags    = Object.keys(tagCounts)   .sort(function (a, b) { return tagCounts[b]    - tagCounts[a]; }).slice(0, 15);
    var authors = Object.keys(authorCounts).sort(function (a, b) { return authorCounts[b] - authorCounts[a]; }).slice(0, 10);

    if (!tags.length && !authors.length) { sSubfilters.hidden = true; return; }

    function facetGroup(heading, kind, items, counts, activeVal) {
      var rows = items.map(function (v) {
        var active = v === activeVal ? ' is-active' : '';
        return '<li>' +
          '<button class="pkic-facet-item' + active + '" type="button" data-kind="' + kind + '" data-value="' + esc(v) + '">' +
            '<span class="pkic-facet-check" aria-hidden="true"></span>' +
            '<span class="pkic-facet-name">' + esc(v) + '</span>' +
            '<span class="pkic-facet-count">' + counts[v] + '</span>' +
          '</button>' +
        '</li>';
      }).join('');
      return '<div class="pkic-facet-group">' +
        '<div class="pkic-facet-heading">' + heading + '</div>' +
        '<ul class="pkic-facet-list">' + rows + '</ul>' +
      '</div>';
    }

    var html = '';
    if (authors.length) html += facetGroup('Author', 'author', authors, authorCounts, currentAuthor);
    if (tags.length)    html += facetGroup('Tag',    'tag',    tags,    tagCounts,    currentTag);

    sSubfilters.innerHTML = html;
    sSubfilters.hidden = false;
  }

  async function runSearch(q) {
    if (!pf) {
      setResults('<p class="pkic-search-hint">Search index not available \u2014 build the site first.</p>');
      return;
    }
    try {
      var res = await pf.search(q);
      allResults = await Promise.all(res.results.slice(0, 24).map(function (r) { return r.data(); }));
      updateFilterCounts();
      renderSubfilters();
      renderResults();
    } catch (err) {
      setResults('<p class="pkic-search-hint">Search unavailable. <a href="/blog/" style="color:#7cf0be">Browse the blog \u2192</a></p>');
    }
  }

})();
