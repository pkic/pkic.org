import * as bootstrap from 'js/bootstrap';

var e = document.querySelectorAll('.nav-tabs .nav-link');
for (var i = 0; i < e.length; i++) {
    e[i].addEventListener("click", event => {
        location.hash = event.target.dataset.bsTarget;
    
        var se =  document.getElementById(event.target.parentElement.dataset.scrollTarget);
        se.scrollIntoView();
    })
}

if (window.location.hash.indexOf('nav') == 1) {
    document.getElementById(window.location.hash.substr(1) + '-tab').click();
}

document.querySelectorAll('time[datetime]').forEach($e => {
    const date = new Date($e.dateTime);
    $e.title = date.toString();
    const originalText = $e.textContent;

    if ($e.classList.contains('localTime')) {
        const options = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', hour12: false };
        $e.textContent = date.toLocaleTimeString([], options).replace(',', '');
    }
});

// WG Sidebar collapse toggle
(function () {
  const STORAGE_KEY = 'wg-sidebar-collapsed';
  const btn  = document.getElementById('wg-sidebar-collapse-btn');
  const wrap = document.getElementById('wg-sidebar-wrap');

  if (!btn || !wrap) return;

  const applyState = (collapsed) => {
    wrap.classList.toggle('is-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  };

  let stored = false;
  try { stored = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}
  if (stored) applyState(true);

  btn.addEventListener('click', () => applyState(!wrap.classList.contains('is-collapsed')));
})();

// WG Nav tree panel — opens on hover, positioned via getBoundingClientRect
// Each .wg-nav-link-wrap has a data-panel attribute pointing to its panel's id.
(function () {
  document.querySelectorAll('.wg-nav-link-wrap').forEach(function (trigger) {
    const btn     = trigger.querySelector('[data-wg-tree-btn]');
    const panelId = trigger.dataset.panel;
    const panel   = panelId ? document.getElementById(panelId) : null;

    if (!btn || !panel) return;

    let closeTimer = null;

    const open = () => {
      clearTimeout(closeTimer);
      const r = trigger.getBoundingClientRect();
      panel.style.top  = (r.bottom + 4) + 'px';
      panel.style.left = r.left + 'px';
      panel.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    };

    const scheduleClose = () => {
      closeTimer = setTimeout(() => {
        panel.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
      }, 150);
    };

    let lockedClosed = false;

    // Open on hover over the nav link wrap (link + button)
    trigger.addEventListener('mouseenter', () => {
      if (lockedClosed) return;
      open();
    });
    trigger.addEventListener('mouseleave', () => {
      lockedClosed = false;
      scheduleClose();
    });

    // Keep open while hovering the panel itself
    panel.addEventListener('mouseenter', () => clearTimeout(closeTimer));
    panel.addEventListener('mouseleave', scheduleClose);

    // Click chevron button to toggle open/close
    btn.addEventListener('click', () => {
      if (panel.hasAttribute('hidden')) {
        lockedClosed = false;
        open();
      } else {
        lockedClosed = true;
        clearTimeout(closeTimer);
        panel.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
      }
    });
  });

  // Close all open panels on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.wg-nav-tree-panel:not([hidden])').forEach(p => p.setAttribute('hidden', ''));
      document.querySelectorAll('[data-wg-tree-btn][aria-expanded="true"]').forEach(b => b.setAttribute('aria-expanded', 'false'));
    }
  });
})();

// WG Sidebar tree: clicking the link navigates, clicking the chevron/summary toggles details
// Without this, clicking the <a> inside <summary> both navigates AND toggles the <details>.
(function () {
  document.querySelectorAll('.wg-sidebar-summary .wg-sidebar-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.stopPropagation(); // prevent the parent <summary> from toggling <details>
    });
  });
})();

// ══════════════════════════════════════════════════════════════════════════
// Shared logo-shuffle utilities
// Used by both the footer marquee and the static logo wall.
// ══════════════════════════════════════════════════════════════════════════

/** Fisher-Yates in-place shuffle — returns the same array. */
function logoShuffle(arr) {
  for (var i = arr.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

/**
 * Interleave sponsors (S) and non-sponsors (NS) so that there are always
 * ≥2 non-sponsors between consecutive sponsors.  Returns a flat array of
 * { el, level } objects in the desired display order.
 */
function logoBuildSequence(S, NS) {
  if (!S.length) return NS.slice();
  if (!NS.length) return S.slice();

  var ns = NS.slice();
  // Pad pool when there aren't enough non-sponsors to fill all gaps
  while (ns.length < 2 * S.length) {
    ns = ns.concat(logoShuffle(NS.slice()));
  }

  var perSlot   = Math.max(2, Math.floor(ns.length / S.length));
  var remainder = ns.length - perSlot * S.length;
  var result    = [];
  var nsIdx     = 0;

  for (var i = 0; i < S.length; i++) {
    var count = Math.max(2, perSlot + (i < remainder ? 1 : 0));
    for (var j = 0; j < count; j++) {
      result.push(ns[nsIdx % ns.length]);
      nsIdx++;
    }
    result.push(S[i]);
  }
  return result;
}

/** Split an array of anchor elements into { sponsors, nonSponsors } buckets. */
function logoBuckets(links) {
  var sponsors = [], nonSponsors = [];
  links.forEach(function (el) {
    var lvl = parseInt(el.dataset.sponsorLevel, 10) || 0;
    (lvl > 0 ? sponsors : nonSponsors).push({ el: el, level: lvl });
  });
  logoShuffle(sponsors);
  logoShuffle(nonSponsors);
  return { sponsors: sponsors, nonSponsors: nonSponsors };
}

// ── Footer marquee ─────────────────────────────────────────────────────────
// Shuffles logos with sponsor-balance rule and drives a seamless CSS loop.
// Animation speed adapts to actual content width (~80 px/s).
(function () {
  var banner = document.querySelector('.members .banner');
  if (!banner) return;

  var links = Array.from(banner.querySelectorAll('a[data-sponsor-level]'));
  if (links.length < 2) return;

  var b        = logoBuckets(links);
  var sequence = logoBuildSequence(b.sponsors, b.nonSponsors);

  function makeCopy(items, hidden) {
    var span = document.createElement('span');
    span.className = 'banner-copy';
    if (hidden) span.setAttribute('aria-hidden', 'true');
    items.forEach(function (item) { span.appendChild(item.el.cloneNode(true)); });
    return span;
  }

  var track = document.createElement('div');
  track.className = 'banner-track';
  var copy1 = makeCopy(sequence, false);
  var copy2 = makeCopy(sequence, true);
  track.appendChild(copy1);
  track.appendChild(copy2);
  banner.innerHTML = '';
  banner.appendChild(track);

  requestAnimationFrame(function () {
    var w = copy1.scrollWidth;
    if (w > 0) track.style.animationDuration = Math.max(20, Math.round(w / 80)) + 's';
  });

  banner.addEventListener('mouseenter', function () { track.style.animationPlayState = 'paused'; });
  banner.addEventListener('mouseleave', function () { track.style.animationPlayState = 'running'; });
})();

// ── Logo wall — vertical infinite scroll ───────────────────────────────
// Same mechanic as the footer strip but vertical: a fixed-height viewport
// clips a track of two identical copies that scroll upward endlessly.
// All sponsors are always shown; non-sponsors are capped at WALL_NS_LIMIT so
// the loop stays readable regardless of how many members join.
// Speed scales with copy height (~30 px/s) and pauses on hover.
(function () {
  var WALL_NS_LIMIT = 84; // max non-sponsor logos per loop

  document.querySelectorAll('.members-overview .members').forEach(function (grid) {
    var links = Array.from(grid.querySelectorAll('a[data-sponsor-level]'));
    if (links.length < 2) return;

    var b           = logoBuckets(links);
    var nonSponsors = b.nonSponsors.slice(0, Math.max(WALL_NS_LIMIT, b.sponsors.length * 2));
    var sequence    = logoBuildSequence(b.sponsors, nonSponsors);

    function makeCopy(items, hidden) {
      var div = document.createElement('div');
      div.className = 'logo-wall-copy';
      if (hidden) div.setAttribute('aria-hidden', 'true');
      items.forEach(function (item) { div.appendChild(item.el.cloneNode(true)); });
      return div;
    }

    var track = document.createElement('div');
    track.className = 'logo-wall-track';
    var copy1 = makeCopy(sequence, false);
    var copy2 = makeCopy(sequence, true);
    track.appendChild(copy1);
    track.appendChild(copy2);

    grid.innerHTML = '';
    grid.appendChild(track);

    // Set duration after layout so we know the real copy height
    requestAnimationFrame(function () {
      var h = copy1.scrollHeight;
      if (h > 0) track.style.animationDuration = Math.max(30, Math.round(h / 8)) + 's';
    });

    grid.addEventListener('mouseenter', function () { track.style.animationPlayState = 'paused'; });
    grid.addEventListener('mouseleave', function () { track.style.animationPlayState = 'running'; });
  });
})();

// ── Member hover card ──────────────────────────────────────────────────────
// A single floating card is shared across the whole page and repositioned
// on each hover.  Using position:fixed avoids being clipped by the
// overflow:hidden containers used by both the footer scroller and the logo
// wall.
(function () {
  var tip = document.createElement('div');
  tip.className = 'member-hovercard';
  tip.innerHTML =
    '<div class="member-hovercard-body">' +
      '<strong class="member-hovercard-name"></strong>' +
      '<span class="member-hovercard-slogan"></span>' +
    '</div>' +
    '<div class="member-hovercard-footer"></div>';
  document.body.appendChild(tip);

  var tipName   = tip.querySelector('.member-hovercard-name');
  var tipSlogan = tip.querySelector('.member-hovercard-slogan');
  var tipFooter = tip.querySelector('.member-hovercard-footer');

  var currentAnchor = null;

  function position(anchor) {
    var rect = anchor.getBoundingClientRect();
    var tw   = tip.offsetWidth;
    var th   = tip.offsetHeight;
    // Prefer above the logo; fall back below if not enough room.
    var top = rect.top - th - 10;
    if (top < 6) top = rect.bottom + 10;
    var left = rect.left + rect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    tip.style.top  = top  + 'px';
    tip.style.left = left + 'px';
  }

  function show(anchor) {
    var name      = anchor.getAttribute('data-member-name') || '';
    var slogan    = anchor.getAttribute('data-member-slogan') || '';
    var levelName = anchor.getAttribute('data-sponsor-level-name') || '';
    var level     = parseInt(anchor.getAttribute('data-sponsor-level') || '0', 10);

    tipName.textContent = name;
    tipSlogan.textContent = slogan;
    tipSlogan.style.display = slogan ? '' : 'none';

    if (level > 0 && levelName) {
      tipFooter.textContent = levelName + ' Sponsor';
      tipFooter.className   = 'member-hovercard-footer sponsor-tier-' + level;
      tipFooter.style.display = '';
    } else {
      tipFooter.style.display = 'none';
    }

    currentAnchor = anchor;
    tip.classList.add('member-hovercard--visible');
    position(anchor);
  }

  function hide() {
    currentAnchor = null;
    tip.classList.remove('member-hovercard--visible');
  }

  document.addEventListener('mouseover', function (e) {
    var a = e.target.closest('a[data-member-name]');
    if (a) { show(a); } else { hide(); }
  });

  // Reposition on scroll / resize so the card tracks the anchor.
  window.addEventListener('scroll', function () {
    if (currentAnchor) position(currentAnchor);
  }, { passive: true });

  // Custom events let the logo-wall spotlight loop drive the card without
  // needing access to the closure's private show/hide functions.
  document.addEventListener('member:spotlight', function (e) { show(e.detail.anchor); });
  document.addEventListener('member:spotlight-hide', function () { hide(); });
})();

// ── Logo wall – auto-spotlight loop ───────────────────────────────────────
// Every GAP_AFTER ms (while the grid is on-screen) the loop picks the
// highest-tier visible sponsor and spotlights it:
//   • Tier 5-6 (Titanium / Diamond): full-bleed zoom overlay inside the
//     grid – logo large, name, slogan, coloured badge.  Scroll stays paused
//     for ZOOM_MS / ZOOM_MS_DIA ms so the moment really lands.
//   • Tier 3-4 (Gold / Platinum): floating hovercard for SHOW_MS ms.
//   • Tier 1-2 (Bronze / Silver): skipped entirely.
// Manual hover cancels the loop until the cursor leaves.
(function () {
  var SHOW_MS       = 2200;  // hovercard visible duration (tier 3-4)
  var ZOOM_MS       = 3800;  // zoom overlay visible duration for Titanium (tier 5)
  var ZOOM_MS_DIA   = 7600;  // zoom overlay visible duration for Diamond (tier 6) — 2×
  var ZOOM_FADE_MS  = 650;   // must match CSS fade-out transition on .member-zoom-overlay
  var GAP_AFTER     = 4300;  // pause between spotlights
  var INITIAL_DELAY = 2500;  // first spotlight: short so Diamond shows quickly on load
  var ZOOM_MIN_TIER = 5;     // tiers >= this get the full-bleed zoom
  var CARD_MIN_TIER = 3;     // tiers below this are skipped entirely (Bronze=1, Silver=2)

  document.querySelectorAll('.members-overview .members').forEach(function (grid) {

    // ── Zoom overlay (created once per grid) ──────────────────────────────
    var overlay = document.createElement('div');
    overlay.className = 'member-zoom-overlay';
    overlay.innerHTML =
      '<img class="member-zoom-logo" alt="" />' +
      '<div class="member-zoom-info">' +
        '<strong class="member-zoom-name"></strong>' +
        '<span class="member-zoom-slogan"></span>' +
      '</div>' +
      '<div class="member-zoom-badge"></div>';
    grid.appendChild(overlay);

    var ovLogo   = overlay.querySelector('.member-zoom-logo');
    var ovName   = overlay.querySelector('.member-zoom-name');
    var ovSlogan = overlay.querySelector('.member-zoom-slogan');
    var ovBadge  = overlay.querySelector('.member-zoom-badge');

    // ── State ─────────────────────────────────────────────────────────────
    var track         = null;
    var timer         = null;
    var active        = false;
    var manualHover   = false;
    var recentlyShown = [];
    var spotlit       = null;

    // Instant cancel — used when hover or IO interrupts a cycle.
    function clearSpotlight() {
      if (spotlit) { spotlit.classList.remove('member-logo--spotlight'); spotlit = null; }
      overlay.classList.remove('member-zoom-overlay--visible');
      grid.classList.remove('members--zooming');
      document.dispatchEvent(new CustomEvent('member:spotlight-hide'));
    }

    // Two-phase teardown for zoom: start CSS fade-out, then after the
    // transition completes resume the scroll and schedule the next beat.
    function endZoom() {
      if (spotlit) { spotlit.classList.remove('member-logo--spotlight'); spotlit = null; }
      overlay.classList.remove('member-zoom-overlay--visible');
      document.dispatchEvent(new CustomEvent('member:spotlight-hide'));
      timer = setTimeout(function () {
        grid.classList.remove('members--zooming');
        if (track) track.style.animationPlayState = 'running';
        timer = setTimeout(spotlight, GAP_AFTER);
      }, ZOOM_FADE_MS);
    }

    // ── Helpers ───────────────────────────────────────────────────────────
    function getTrack() {
      if (!track) track = grid.querySelector('.logo-wall-track');
      return track;
    }

    function allAnchors() {
      // Search the non-aria-hidden copy for all qualifying anchors.
      var copy = grid.querySelector('.logo-wall-copy:not([aria-hidden])');
      if (!copy) return [];
      return Array.from(copy.querySelectorAll('a[data-member-name]'));
    }

    // High-tier (Titanium/Diamond) candidates — whole copy, not just visible band.
    function highTierCandidates() {
      return allAnchors().filter(function (a) {
        return parseInt(a.getAttribute('data-sponsor-level') || '0', 10) >= ZOOM_MIN_TIER;
      }).sort(function (a, b) {
        return parseInt(b.getAttribute('data-sponsor-level') || '0', 10) -
               parseInt(a.getAttribute('data-sponsor-level') || '0', 10);
      });
    }

    // Mid-tier (Gold/Platinum) candidates — only from the visible band.
    function midTierCandidates() {
      getTrack();
      var copy = grid.querySelector('.logo-wall-copy:not([aria-hidden])');
      if (!copy) return [];
      var cr  = grid.getBoundingClientRect();
      var top = cr.top    + cr.height * 0.15;
      var bot = cr.bottom - cr.height * 0.15;
      return Array.from(copy.querySelectorAll('a[data-member-name]')).filter(function (a) {
        var r   = a.getBoundingClientRect();
        var mid = r.top + r.height / 2;
        return mid >= top && mid <= bot && r.width > 0 &&
               parseInt(a.getAttribute('data-sponsor-level') || '0', 10) >= CARD_MIN_TIER &&
               parseInt(a.getAttribute('data-sponsor-level') || '0', 10) < ZOOM_MIN_TIER;
      }).sort(function (a, b) {
        return parseInt(b.getAttribute('data-sponsor-level') || '0', 10) -
               parseInt(a.getAttribute('data-sponsor-level') || '0', 10);
      });
    }

    // ── Spotlight dispatcher ──────────────────────────────────────────────
    function spotlight() {
      if (!active || manualHover) return;

      // 1. Prefer Diamond/Titanium from anywhere in the copy.
      var highAll = highTierCandidates();
      var highFresh = highAll.filter(function (a) {
        return recentlyShown.indexOf(a.getAttribute('data-member-name')) === -1;
      });
      if (!highFresh.length && highAll.length) { recentlyShown = []; highFresh = highAll; }

      // 2. Fall back to Gold/Platinum from the visible band.
      var midAll = highFresh.length ? [] : midTierCandidates();
      var midFresh = midAll.filter(function (a) {
        return recentlyShown.indexOf(a.getAttribute('data-member-name')) === -1;
      });
      if (!midFresh.length && midAll.length) { midFresh = midAll; }

      var candidates = highFresh.length ? highFresh : midFresh;
      if (!candidates.length) { timer = setTimeout(spotlight, GAP_AFTER); return; }

      var pick  = candidates[0];
      var level = parseInt(pick.getAttribute('data-sponsor-level') || '0', 10);
      recentlyShown.push(pick.getAttribute('data-member-name'));

      getTrack();
      if (track) track.style.animationPlayState = 'paused';
      spotlit = pick;
      pick.classList.add('member-logo--spotlight');

      if (level >= ZOOM_MIN_TIER) {
        // ── Full-bleed zoom for Titanium / Diamond ────────────────────────
        var img       = pick.querySelector('img');
        var name      = pick.getAttribute('data-member-name') || '';
        var slogan    = pick.getAttribute('data-member-slogan') || '';
        var levelName = pick.getAttribute('data-sponsor-level-name') || '';

        ovLogo.src             = img ? img.src : '';
        ovLogo.alt             = name;
        ovName.textContent     = name;
        ovSlogan.textContent   = slogan;
        ovSlogan.style.display = slogan ? '' : 'none';
        ovBadge.textContent    = levelName + ' Sponsor';
        ovBadge.className      = 'member-zoom-badge sponsor-tier-' + level;

        grid.classList.add('members--zooming');
        overlay.classList.add('member-zoom-overlay--visible');

        var holdMs = level >= 6 ? ZOOM_MS_DIA : ZOOM_MS;
        timer = setTimeout(endZoom, holdMs);

      } else {
        // ── Floating hovercard for Gold / Platinum ────────────────────────
        document.dispatchEvent(new CustomEvent('member:spotlight', { detail: { anchor: pick } }));

        timer = setTimeout(function () {
          clearSpotlight();
          if (track) track.style.animationPlayState = 'running';
          timer = setTimeout(spotlight, GAP_AFTER);
        }, SHOW_MS);
      }
    }

    // ── IntersectionObserver: only run while on-screen ────────────────────
    if ('IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !active) {
            active = true;
            timer  = setTimeout(spotlight, INITIAL_DELAY);
          } else if (!entry.isIntersecting && active) {
            active = false;
            clearTimeout(timer);
            clearSpotlight();
            if (track) track.style.animationPlayState = 'running';
          }
        });
      }, { threshold: 0.3 });
      io.observe(grid);
    }

    // ── Pause on manual hover ─────────────────────────────────────────────
    grid.addEventListener('mouseenter', function () {
      manualHover = true;
      clearTimeout(timer);
      clearSpotlight();
      if (track) track.style.animationPlayState = 'paused';
    });
    grid.addEventListener('mouseleave', function () {
      manualHover = false;
      if (track) track.style.animationPlayState = 'running';
      if (active) timer = setTimeout(spotlight, GAP_AFTER);
    });
  });
})();

// ── Text-selection "Edit on GitHub" tooltip ───────────────────────────────
// Shows a small pill above selected text on pages that have the edit button.
(function () {
  const editLink = document.querySelector('.edit-on-github');
  if (!editLink) return;

  // Build the tooltip element
  const tooltip = document.createElement('a');
  tooltip.className = 'selection-edit-tooltip';
  tooltip.href = editLink.href;
  tooltip.target = '_blank';
  tooltip.rel = 'noopener';
  tooltip.setAttribute('aria-label', 'Edit this page on GitHub');
  tooltip.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z"/>'
    + '<path fill-rule="evenodd" d="M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5v11z"/>'
    + '</svg><span>Edit on GitHub</span>';
  document.body.appendChild(tooltip);

  let hideTimer = null;

  const positionAndShow = () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    const range = sel.getRangeAt(0);
    const rect  = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    // Walk up from the anchor node to find a data-driven edit URL override
    let dataEditUrl = null;
    let node = sel.anchorNode;
    while (node && node !== document.body) {
      if (node.nodeType === Node.ELEMENT_NODE && node.dataset && node.dataset.editUrl) {
        dataEditUrl = node.dataset.editUrl;
        break;
      }
      node = node.parentNode;
    }
    tooltip.href = dataEditUrl || editLink.href;

    // Measure tooltip (opacity-0 but still in layout flow)
    const tw = tooltip.offsetWidth  || 160;
    const th = tooltip.offsetHeight || 32;

    // Centre horizontally over the selection; keep within viewport
    const left = Math.min(
      Math.max(rect.left + rect.width / 2 - tw / 2, 8),
      window.innerWidth - tw - 8
    );
    const top = rect.top - th - 10;

    tooltip.style.left = left + 'px';
    tooltip.style.top  = top  + 'px';

    clearTimeout(hideTimer);
    tooltip.classList.add('is-visible');
  };

  const hide = (immediate) => {
    clearTimeout(hideTimer);
    if (immediate) {
      tooltip.classList.remove('is-visible');
    } else {
      hideTimer = setTimeout(() => tooltip.classList.remove('is-visible'), 200);
    }
  };

  // Show after mouse release if text is selected
  document.addEventListener('mouseup', () => {
    requestAnimationFrame(positionAndShow);
  });

  // Hide when selection is collapsed
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) hide(false);
  });

  // Clicking the tooltip navigates to GitHub — prevent selection collapse first
  tooltip.addEventListener('mousedown', (e) => e.stopPropagation());
})();
