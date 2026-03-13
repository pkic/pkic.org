import 'js/bootstrap';
import './modules/global-ui.js';
import './modules/sponsor-banner-marquee.js';
import './modules/text-selection-edit-tooltip.js';
import { initLocalTime } from './modules/local-time.js';

initLocalTime();


if (document.querySelector('.members-overview .members')) {
  import('./modules/members-overview-effects.js');
}
