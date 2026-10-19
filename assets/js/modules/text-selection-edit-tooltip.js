(function () {
  var editLink = document.querySelector('.edit-on-github');
  if (!editLink) return;

  // If the page body has a data-edit-url (for dynamically-generated pages),
  // use that as the default edit URL instead of the page's file path.
  var pageBody = document.querySelector('[data-pagefind-body]');
  var defaultEditUrl = editLink.href;
  if (pageBody && pageBody.dataset.editUrl) {
    defaultEditUrl = pageBody.dataset.editUrl;
    editLink.href = defaultEditUrl;
  }

  var tooltip = document.createElement('a');
  tooltip.className = 'selection-edit-tooltip';
  tooltip.href = defaultEditUrl;
  tooltip.target = '_blank';
  tooltip.rel = 'noopener';
  tooltip.setAttribute('aria-label', 'Edit this page on GitHub');
  tooltip.innerHTML =
    '<svg xmlns="http://www.w3.org/2000/svg" class="pk-icon" width="12" height="12" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 16 16" aria-hidden="true">'
    + '<path d="m3 11 8-8 2 2-8 8-3 1 1-3ZM10 4l2 2"/>'
    + '</svg><span>Edit on GitHub</span>';
  document.body.appendChild(tooltip);

  var hideTimer = null;

  var positionAndShow = function () {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) return;

    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    if (!rect.width && !rect.height) return;

    var dataEditUrl = null;
    var node = sel.anchorNode;
    while (node && node !== document.body) {
      if (node.nodeType === Node.ELEMENT_NODE && node.dataset && node.dataset.editUrl) {
        dataEditUrl = node.dataset.editUrl;
        break;
      }
      node = node.parentNode;
    }
    tooltip.href = dataEditUrl || defaultEditUrl;

    var tw = tooltip.offsetWidth || 160;
    var th = tooltip.offsetHeight || 32;
    var left = Math.min(Math.max(rect.left + rect.width / 2 - tw / 2, 8), window.innerWidth - tw - 8);
    var top = rect.top - th - 10;

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';

    clearTimeout(hideTimer);
    tooltip.classList.add('is-visible');
  };

  var hide = function (immediate) {
    clearTimeout(hideTimer);
    if (immediate) {
      tooltip.classList.remove('is-visible');
    } else {
      hideTimer = setTimeout(function () { tooltip.classList.remove('is-visible'); }, 200);
    }
  };

  document.addEventListener('mouseup', function () {
    requestAnimationFrame(positionAndShow);
  });

  document.addEventListener('selectionchange', function () {
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) hide(false);
  });

  tooltip.addEventListener('mousedown', function (e) { e.stopPropagation(); });
})();
