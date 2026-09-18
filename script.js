'use strict';

/* Motion is an enhancement, so the class that allows reveal states is added
   here rather than baked into the HTML. If JavaScript is off, every section is
   ordinary visible content. */
(() => {
  const root = document.documentElement;
  root.classList.add('js');

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) return;

  root.classList.add('motion-ok');

  const revealTargets = [
    ...document.querySelectorAll('.strip-item, .buy, .card, .gallery figure, .steps li, .honest p, details, .closer img'),
  ];

  revealTargets.forEach((node, index) => {
    node.classList.add('reveal');
    node.style.setProperty('--reveal-delay', Math.min(index % 6, 4) * 45 + 'ms');
  });

  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

    revealTargets.forEach((node) => observer.observe(node));
  } else {
    revealTargets.forEach((node) => node.classList.add('is-visible'));
  }

  const hero = document.querySelector('.hero');
  if (!hero) return;

  let ticking = false;
  const moveSky = () => {
    ticking = false;
    const rect = hero.getBoundingClientRect();
    const travel = Math.max(-1, Math.min(1, (window.innerHeight / 2 - rect.top) / Math.max(rect.height, 1) - 0.5));
    hero.style.setProperty('--hero-bg-x', (travel * 18).toFixed(2) + 'px');
    hero.style.setProperty('--hero-bg-y', (travel * 34).toFixed(2) + 'px');
    hero.style.setProperty('--hero-shot-y', (travel * -28).toFixed(2) + 'px');
  };

  const queueSky = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(moveSky);
  };

  moveSky();
  window.addEventListener('scroll', queueSky, { passive: true });
  window.addEventListener('resize', queueSky);
})();

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

/* ---------------------------------------------------------------------------
   The buy panel.

   Everything here is conditional on api/options.php answering with a payment
   method that is actually configured. Before that — and on any host serving
   this page as static files, like the GitHub Pages mirror — the fetch fails or
   comes back unusable, nothing is revealed, and the page is exactly what it
   was. No payment method is ever assumed into existence.

   A coin payment cannot redirect back the instant it settles, because
   confirmation takes anywhere from seconds to an hour. So the reference is
   kept in localStorage and the page asks the server about it, which also means
   closing the tab and coming back later still finds the licence.
--------------------------------------------------------------------------- */
(() => {
  const panel = document.querySelector('[data-buy]');
  if (!panel || !('fetch' in window)) return;

  const el = {
    price:     panel.querySelector('[data-buy-price]'),
    card:      panel.querySelector('[data-buy-card]'),
    crypto:    panel.querySelector('[data-buy-crypto]'),
    form:      panel.querySelector('[data-buy-form]'),
    email:     panel.querySelector('#buy-email'),
    providers: panel.querySelector('[data-buy-providers]'),
    status:    panel.querySelector('[data-buy-status]'),
    done:      panel.querySelector('[data-buy-done]'),
    key:       panel.querySelector('[data-buy-key]'),
    download:  panel.querySelector('[data-buy-download]'),
    methods:   panel.querySelector('[data-buy-methods]'),
    closed:    panel.querySelector('[data-buy-closed]'),
    home:      panel.querySelector('[data-buy-home]'),
    again:     panel.querySelector('[data-buy-again]'),
  };

  const STORE = 'focuslock.reference';
  const REFERENCE = /^[0-9a-f]{64}$/;

  /* localStorage throws in a private window with site data blocked, and the
     panel has to work anyway — the reference also arrives in the URL. */
  const remember = (ref) => { try { localStorage.setItem(STORE, ref); } catch (e) { /* fine */ } };
  const forget   = ()     => { try { localStorage.removeItem(STORE); } catch (e) { /* fine */ } };
  const recall   = ()     => { try { return localStorage.getItem(STORE) || ''; } catch (e) { return ''; } };

  function say(message, kind) {
    el.status.textContent = message;
    el.status.hidden = !message;
    el.status.dataset.kind = kind || '';
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    let data = null;
    try { data = await response.json(); } catch (e) { /* handled below */ }
    if (!data) throw new Error('the server did not answer with JSON');
    if (!response.ok) throw new Error(data.error || 'that did not work');
    return data;
  }

  function showLicence(data) {
    /* A key is read aloud and typed in by hand, so it must never break inside
       a group — "…LMNPQ-RST / UV" invites exactly the wrong guess. Built out of
       text nodes and <wbr>, so the only places it may wrap are after a dash,
       and never through innerHTML. */
    el.key.textContent = '';
    String(data.licence_key || '').split('-').forEach((group, i) => {
      if (i > 0) {
        el.key.appendChild(document.createTextNode('-'));
        el.key.appendChild(document.createElement('wbr'));
      }
      el.key.appendChild(document.createTextNode(group));
    });
    el.download.href = data.download_url;
    el.done.hidden = false;
    el.methods.hidden = true;
    el.crypto.hidden = true;
    if (el.card) el.card.hidden = true;
    say('', '');
    forget();
  }

  /* Coins settle on their own schedule, so this backs off rather than
     hammering: every 5s for the first minute, then 15s, then 30s, and it gives
     up after two hours rather than polling a dead reference forever. */
  function watch(reference) {
    const started = Date.now();
    let stopped = false;

    const delay = () => {
      const elapsed = Date.now() - started;
      if (elapsed < 60e3) return 5e3;
      if (elapsed < 10 * 60e3) return 15e3;
      return 30e3;
    };

    const tick = async () => {
      if (stopped) return;
      if (Date.now() - started > 2 * 3600e3) {
        say('Still nothing after two hours. If you did pay, email the address on your receipt and quote your reference.', 'warn');
        return;
      }
      try {
        const data = await postJson('api/order-status.php', { reference });
        if (data.status === 'paid') { stopped = true; showLicence(data); return; }
        if (data.status === 'refunded' || data.status === 'expired') {
          stopped = true;
          forget();
          say('That payment was ' + data.status + '.', 'warn');
          return;
        }
        if (data.pay_amount && data.pay_currency) {
          say('Seen ' + data.pay_amount + ' ' + data.pay_currency + ' — waiting for it to confirm. You can close this page; the licence will be here when you come back.', 'wait');
        } else {
          say('Waiting for your payment to confirm. You can close this page and come back to it.', 'wait');
        }
      } catch (e) {
        /* A failed poll is not a failed payment — the next one may well work. */
        say('Checking again shortly…', 'wait');
      }
      setTimeout(tick, delay());
    };

    tick();
  }

  function addProviders(providers) {
    providers.forEach((provider) => {
      const button = document.createElement('button');
      button.type = 'submit';
      button.className = 'btn';
      /* textContent, not innerHTML: the label comes from the server and is
         never treated as markup. */
      button.textContent = provider.label;
      button.value = provider.provider;
      button.name = 'provider';
      el.providers.appendChild(button);
    });
  }

  async function start(providerName) {
    const email = (el.email.value || '').trim();
    /* Deliberately loose. The server checks properly with filter_var; this is
       only here to catch a typo before a round trip. */
    if (!email || email.indexOf('@') < 1 || email.length > 191) {
      say('That email address does not look right.', 'warn');
      el.email.focus();
      return;
    }

    say('Opening a payment page…', 'wait');
    try {
      const data = await postJson('api/checkout.php', { provider: providerName, email });
      if (!data.pay_url || !REFERENCE.test(data.reference || '')) {
        throw new Error('the server did not return a payment page');
      }
      remember(data.reference);
      /* Same tab: the provider sends them back to /?ref=… when it is done, and
         a popup would likely be blocked after this await anyway. */
      window.location.href = data.pay_url;
    } catch (e) {
      say(e.message || 'Could not open a payment page.', 'warn');
    }
  }

  /* The static mirror on GitHub Pages has no PHP and can never take a
     payment, so every button there has to lead to the host that can. */
  function elsewhere() {
    const link = document.querySelector('link[rel="canonical"]');
    if (!link) return '';
    let home;
    try { home = new URL(link.href); } catch (e) { return ''; }
    return home.origin === window.location.origin ? '' : home.origin + '/#buy';
  }

  (async () => {
    let options = null;
    try {
      const response = await fetch('api/options.php', { headers: { Accept: 'application/json' } });
      if (response.ok) options = await response.json();
    } catch (e) {
      /* No API here — handled just below. */
    }

    const cryptoProviders = (options && Array.isArray(options.crypto)) ? options.crypto : [];
    const card = (options && options.card && options.card.checkout_url) ? options.card : null;

    /* A licence is what reaches the installer, so a buyer can always ask for
       it again — even if every payment method were switched off tomorrow. */
    if (options) el.again.hidden = false;

    if (!card && cryptoProviders.length === 0) {
      /* Nothing to sell. Say so rather than leaving four buttons pointing at
         an empty panel, and send a mirror visitor to the real shop. */
      el.closed.hidden = false;
      const shop = elsewhere();
      if (shop) {
        el.home.href = shop;
        el.home.hidden = false;
        document.querySelectorAll('[data-download]').forEach((button) => { button.href = shop; });
      }
      return;
    }

    el.methods.hidden = false;

    if (options.price) {
      el.price.textContent = options.price;
      document.querySelectorAll('[data-price]').forEach((node) => { node.textContent = options.price; });
    }

    if (card) {
      el.card.href = card.checkout_url;
      el.card.hidden = false;
    }
    if (cryptoProviders.length > 0) {
      addProviders(cryptoProviders);
      el.crypto.hidden = false;
    }

    el.form.addEventListener('submit', (event) => {
      event.preventDefault();
      /* submitter is undefined in older Safari; fall back to the only one. */
      const chosen = (event.submitter && event.submitter.value) ||
        (cryptoProviders.length === 1 ? cryptoProviders[0].provider : '');
      if (chosen) start(chosen);
    });

    /* Coming back from a hosted payment page, or reopening the tab later. */
    const fromUrl = new URLSearchParams(window.location.search).get('ref') || '';
    const reference = REFERENCE.test(fromUrl) ? fromUrl : recall();
    if (REFERENCE.test(reference)) {
      remember(reference);
      panel.scrollIntoView({ block: 'start' });
      say('Checking your payment…', 'wait');
      watch(reference);
    }
  })();
})();
