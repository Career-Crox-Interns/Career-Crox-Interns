(function () {
  'use strict';
  var BUILD = 'CC26_766_INTERN_NOTES_REMINDER_TIME_FIX';
  var BASIC_LINKS = [
    ['/candidates', 'Candidates'],
    ['/submissions', 'Submissions'],
    ['/interviews', 'Interviews'],
    ['/followups', 'Follow-ups'],
    ['/tasks', 'Tasks'],
    ['/live-dialing', 'Call Assistant'],
    ['/goal-post', 'Goal Post']
  ];
  var APPROVAL_LINK = ['/approvals', 'Approvals'];
  var ADMIN_LINKS = [
    ['/recent-activity', 'CRM Logs'],
    ['/basic-admin.html', 'Admin Control']
  ];
  var ALLOWED_PREFIXES = [
    '/login','/candidates','/candidate/','/submissions','/interviews','/followups','/tasks',
    '/live-dialing','/auto-dialer','/goal-post','/approvals','/recent-activity','/basic-admin.html'
  ];
  var HIDDEN_TEXT = /^(attendance|break|join office|team chat|reports?|pipeline hub|revenue hub|performance centre|performance center|mail centre|mail center|learning hub|securelink|notifications|team chat|aaria|bda|hr head|quality analyst|data extractor|flowchart|duplicate profiles|daily interview workflow|semi hourly report|mobile app)$/i;
  var state = { role: '', userLoaded: false, applying: false };

  function pathAllowed(path) {
    path = String(path || '/').split('?')[0].split('#')[0];
    if (path === '/' || path === '') return true;
    return ALLOWED_PREFIXES.some(function (prefix) {
      return prefix.endsWith('/') ? path.indexOf(prefix) === 0 : (path === prefix || path.indexOf(prefix + '/') === 0);
    });
  }

  function leadership() {
    return ['admin','manager','tl'].indexOf(String(state.role || '').toLowerCase()) !== -1;
  }
  function adminControl() {
    return ['admin','manager'].indexOf(String(state.role || '').toLowerCase()) !== -1;
  }

  function navLinks() {
    var links = BASIC_LINKS.slice();
    if (leadership()) links.push(APPROVAL_LINK);
    if (adminControl()) links = links.concat(ADMIN_LINKS);
    return links;
  }

  function makeLink(href, label, index) {
    var a = document.createElement('a');
    a.className = 'nav-item bounceable basic-nav-item' + (location.pathname === href || (href === '/candidates' && location.pathname.indexOf('/candidate/') === 0) ? ' active' : '');
    a.href = href;
    a.setAttribute('data-basic-crm-link', '1');
    var serial = document.createElement('span');
    serial.className = 'nav-serial';
    serial.textContent = String(index + 1).padStart(2, '0');
    var text = document.createElement('span');
    text.textContent = label;
    a.appendChild(serial); a.appendChild(text);
    return a;
  }

  function applyNav() {
    if (state.applying) return;
    var nav = document.querySelector('.sidebar-nav');
    if (!nav) return;
    var signature = navLinks().map(function(x){return x[0] + ':' + x[1];}).join('|');
    if (nav.getAttribute('data-basic-signature') === signature && nav.querySelector('[data-basic-crm-link]')) return;
    state.applying = true;
    try {
      nav.innerHTML = '';
      nav.setAttribute('data-basic-signature', signature);
      navLinks().forEach(function (item, idx) { nav.appendChild(makeLink(item[0], item[1], idx)); });
    } finally { state.applying = false; }
  }

  function removeBreakAndHeavyUi() {
    if (document.body) document.body.classList.remove('cc451-await-join');
    var selectors = [
      '#cc451-office-gate','.cc724-office-overlay','.cc722-office-overlay','.attendance-gate','.break-overdue-modal',
      '.crm-lock-backdrop','.break-modal','.theme-panel','.global-search-overlay'
    ];
    selectors.forEach(function (selector) {
      document.querySelectorAll(selector).forEach(function (el) { el.style.display = 'none'; });
    });
    document.querySelectorAll('.premium-join-office-v2,.break-overdue-modal').forEach(function (el) {
      var backdrop = el.closest && el.closest('.crm-modal-backdrop');
      (backdrop || el).style.display = 'none';
    });
    document.querySelectorAll('[data-cc726-join-hidden="1"]').forEach(function (el) {
      var prev = el.dataset.cc726PrevDisplay || '';
      el.style.removeProperty('display');
      if (prev) el.style.display = prev;
      delete el.dataset.cc726JoinHidden;
      delete el.dataset.cc726PrevDisplay;
    });
    document.querySelectorAll('button,a,[role="button"]').forEach(function (el) {
      var text = String(el.textContent || '').replace(/\s+/g,' ').trim();
      if (HIDDEN_TEXT.test(text)) el.style.display = 'none';
    });
  }

  function enforce() {
    applyNav();
    removeBreakAndHeavyUi();
    document.documentElement.setAttribute('data-basic-crm', 'true');
  }

  function loadUser() {
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(function (data) {
        state.role = String(data && data.user && data.user.role || '').toLowerCase();
        state.userLoaded = true;
        try { localStorage.setItem('careerCroxCachedUser', JSON.stringify(data.user || {})); } catch (_) {}
        if (!adminControl() && (location.pathname === '/recent-activity' || location.pathname === '/basic-admin.html')) { location.replace('/candidates'); return; }
        if (!leadership() && location.pathname === '/approvals') { location.replace('/candidates'); return; }
        enforce();
      })
      .catch(function () { state.userLoaded = true; enforce(); });
  }

  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
    if (!link) return;
    var href = link.getAttribute('href') || '';
    if (/^https?:/i.test(href) || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;
    var url;
    try { url = new URL(href, location.origin); } catch (_) { return; }
    if (url.pathname === '/basic-admin.html') {
      event.preventDefault(); event.stopPropagation(); location.assign('/basic-admin.html'); return;
    }
    if (!pathAllowed(url.pathname)) {
      event.preventDefault(); event.stopPropagation(); location.assign('/candidates');
    }
  }, true);

  if (!pathAllowed(location.pathname)) {
    location.replace('/candidates');
    return;
  }

  var style = document.createElement('style');
  style.id = 'basic-crm-runtime-style';
  style.textContent = [
    'html[data-basic-crm="true"] .sidebar-nav{gap:6px!important}',
    'html[data-basic-crm="true"] .basic-nav-item{min-height:42px!important}',
    'html[data-basic-crm="true"] [href="/attendance"],html[data-basic-crm="true"] [href="/chat"],html[data-basic-crm="true"] [href="/reports"],html[data-basic-crm="true"] [href="/revenue-hub"],html[data-basic-crm="true"] [href="/client-pipeline"],html[data-basic-crm="true"] [href="/securelink"]{display:none!important}',
    'html[data-basic-crm="true"] .topbar-center,html[data-basic-crm="true"] .top-action-wrap{display:none!important}',
    'html[data-basic-crm="true"] [href="/notifications"],html[data-basic-crm="true"] [href="/chat"],html[data-basic-crm="true"] [href="/aaria"],html[data-basic-crm="true"] [href="/attendance"]{display:none!important}',
    'html[data-basic-crm="true"] #cc451-office-gate,html[data-basic-crm="true"] .cc724-office-overlay,html[data-basic-crm="true"] .attendance-gate,html[data-basic-crm="true"] .break-overdue-modal,html[data-basic-crm="true"] .crm-lock-backdrop{display:none!important}',
    'html[data-basic-crm="true"] body.cc451-await-join .cc391-reminder-deck,html[data-basic-crm="true"] body.cc451-await-join .cc730-reminder-popup,html[data-basic-crm="true"] body.cc451-await-join .cc763-manager-reminder-center{display:block!important;visibility:visible!important;pointer-events:auto!important}'
  ].join('');
  document.head.appendChild(style);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enforce, { once: true });
  else enforce();
  loadUser();
  var observer = new MutationObserver(function () { requestAnimationFrame(enforce); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.__CAREER_CROX_BASIC_BUILD__ = BUILD;
})();
