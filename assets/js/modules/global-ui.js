var e = document.querySelectorAll('.nav-tabs .nav-link');
for (var i = 0; i < e.length; i++) {
  e[i].addEventListener('click', function (event) {
    location.hash = event.target.dataset.bsTarget;

    var se = document.getElementById(event.target.parentElement.dataset.scrollTarget);
    if (se) se.scrollIntoView();
  });
}

if (window.location.hash.indexOf('nav') == 1) {
  var tab = document.getElementById(window.location.hash.substr(1) + '-tab');
  if (tab) tab.click();
}

document.querySelectorAll('time[datetime]').forEach(function ($e) {
  var date = new Date($e.dateTime);
  $e.title = date.toString();

  if ($e.classList.contains('localTime')) {
    var options = { hour: 'numeric', minute: '2-digit', timeZoneName: 'short', hour12: false };
    $e.textContent = date.toLocaleTimeString([], options).replace(',', '');
  }
});

// WG Sidebar collapse toggle
(function () {
  var STORAGE_KEY = 'wg-sidebar-collapsed';
  var btn = document.getElementById('wg-sidebar-collapse-btn');
  var wrap = document.getElementById('wg-sidebar-wrap');

  if (!btn || !wrap) return;

  var applyState = function (collapsed) {
    wrap.classList.toggle('is-collapsed', collapsed);
    btn.setAttribute('aria-expanded', String(!collapsed));
    btn.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    try { localStorage.setItem(STORAGE_KEY, collapsed ? '1' : '0'); } catch (_) {}
  };

  var stored = false;
  try { stored = localStorage.getItem(STORAGE_KEY) === '1'; } catch (_) {}
  if (stored) applyState(true);

  btn.addEventListener('click', function () {
    applyState(!wrap.classList.contains('is-collapsed'));
  });
})();

// WG Nav tree panel interaction
(function () {
  document.querySelectorAll('.wg-nav-link-wrap').forEach(function (trigger) {
    var btn = trigger.querySelector('[data-wg-tree-btn]');
    var panelId = trigger.dataset.panel;
    var panel = panelId ? document.getElementById(panelId) : null;

    if (!btn || !panel) return;

    var closeTimer = null;

    var open = function () {
      clearTimeout(closeTimer);
      var r = trigger.getBoundingClientRect();
      panel.style.top = (r.bottom + 4) + 'px';
      panel.style.left = r.left + 'px';
      panel.removeAttribute('hidden');
      btn.setAttribute('aria-expanded', 'true');
    };

    var scheduleClose = function () {
      closeTimer = setTimeout(function () {
        panel.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
      }, 150);
    };

    var lockedClosed = false;

    trigger.addEventListener('mouseenter', function () {
      if (lockedClosed) return;
      open();
    });

    trigger.addEventListener('mouseleave', function () {
      lockedClosed = false;
      scheduleClose();
    });

    panel.addEventListener('mouseenter', function () { clearTimeout(closeTimer); });
    panel.addEventListener('mouseleave', scheduleClose);

    btn.addEventListener('click', function () {
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

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      document.querySelectorAll('.wg-nav-tree-panel:not([hidden])').forEach(function (p) {
        p.setAttribute('hidden', '');
      });
      document.querySelectorAll('[data-wg-tree-btn][aria-expanded="true"]').forEach(function (b) {
        b.setAttribute('aria-expanded', 'false');
      });
    }
  });
})();

// Prevent <summary> toggle when clicking WG sidebar links
(function () {
  document.querySelectorAll('.wg-sidebar-summary .wg-sidebar-link').forEach(function (link) {
    link.addEventListener('click', function (e) {
      e.stopPropagation();
    });
  });
})();
