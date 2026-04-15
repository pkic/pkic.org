import 'js/bootstrap';
import './modules/global-ui.js';
import './modules/sponsor-banner-marquee.js';
import './modules/text-selection-edit-tooltip.js';
import { initLocalTime } from './modules/local-time.js';

initLocalTime();


if (document.querySelector('.members-overview .members')) {
  import('./modules/members-overview-effects.js');
}

// Scroll-reveal: add .is-visible when [data-reveal] elements enter viewport
document.querySelectorAll('[data-reveal]').forEach(function (el) {
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('is-visible');
        io.unobserve(entry.target);
      }
    });
  }, { threshold: 0.15 });
  io.observe(el);
});
