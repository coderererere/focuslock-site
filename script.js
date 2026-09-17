'use strict';
/* One job: warn visitors who are clearly on another OS before they download a
   Windows installer. Everything else on this page is plain HTML and CSS, so it
   works with JavaScript switched off.

   The test only fires on a platform that positively identifies as something
   other than Windows — an unfamiliar or empty string says nothing, and a wrong
   warning is worse than none. */
(() => {
  const platform = (
    (navigator.userAgentData && navigator.userAgentData.platform) ||
    navigator.platform ||
    ''
  ).toLowerCase();

  const clearlyNotWindows =
    /mac|iphone|ipad|ipod|android|linux|cros|chrome os|x11|bsd/.test(platform) &&
    !/win/.test(platform);

  if (clearlyNotWindows) {
    const note = document.querySelector('[data-platform-note]');
    if (note) note.hidden = false;
  }
})();
