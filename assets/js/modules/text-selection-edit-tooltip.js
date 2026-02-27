(function () {
  var editLink = document.querySelector('.edit-on-github');
  if (!editLink) return;

  var tooltip = document.createElement('a');
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
    tooltip.href = dataEditUrl || editLink.href;

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
