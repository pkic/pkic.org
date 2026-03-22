/**
 * Event countdown timer.
 * Finds every [data-countdown] element, parses its ISO date value, and ticks
 * the child [data-unit] spans every second.  Removes the closest
 * .event-countdown ancestor once the target time is reached.
 */
document.querySelectorAll('[data-countdown]').forEach(function (el) {
  var target = new Date(el.getAttribute('data-countdown'));

  function tick() {
    var diff = target - Date.now();
    if (diff <= 0) {
      var wrap = el.closest('.event-countdown');
      if (wrap) wrap.remove();
      return;
    }
    var d = Math.floor(diff / 86400000);
    var h = Math.floor((diff % 86400000) / 3600000);
    var m = Math.floor((diff % 3600000) / 60000);
    var s = Math.floor((diff % 60000) / 1000);

    var unitMap = { days: d, hours: h, minutes: m, seconds: s };
    Object.entries(unitMap).forEach(function (entry) {
      var span = el.querySelector('[data-unit="' + entry[0] + '"]');
      if (span) span.textContent = entry[0] === 'days' ? entry[1] : String(entry[1]).padStart(2, '0');
    });
  }

  tick();
  setInterval(tick, 1000);
});
