(function () {
  'use strict';
  var BUILD = 'CC26_776_LOGO_NAV_ADMIN_UPLOAD_FIX';
  var BASIC_LINKS = [
    ['/candidates', 'Candidates'],
    ['/submissions', 'Submissions'],
    ['/interviews', 'Interviews'],
    ['/followups', 'Follow-ups'],
    ['/tasks', 'Tasks'],
    ['/live-dialing', 'Call Assistant'],
    ['/goal-post', 'Goal Post']
  ];
  var REVENUE_LINK = ['/revenue-hub', 'Revenue Hub'];
  var BUCKET_LINK = ['/bucket-out', 'Bucket'];
  var DUPLICATE_LINK = ['/duplicate-profiles', 'Duplicate Profiles'];
  var APPROVAL_LINK = ['/approvals', 'Approvals'];
  var ADMIN_LINKS = [
    ['/basic-admin.html', 'Admin Control']
  ];
  var ALLOWED_PREFIXES = [
    '/login','/candidates','/candidate/','/submissions','/interviews','/followups','/tasks',
    '/live-dialing','/auto-dialer','/goal-post','/revenue-hub','/bucket-out','/duplicate-profiles','/approvals','/basic-admin.html'
  ];
  var HIDDEN_TEXT = /^(attendance|break|join office|reports?|performance centre|performance center|mail centre|mail center|learning hub|securelink|notifications|aaria|bda|hr head|quality analyst|data extractor|flowchart|daily interview workflow|semi hourly report|mobile app)$/i;
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
    if (leadership()) links.push(REVENUE_LINK);
    if (adminControl()) { links.push(BUCKET_LINK); links.push(DUPLICATE_LINK); }
    if (leadership()) links.push(APPROVAL_LINK);
    if (adminControl()) links = links.concat(ADMIN_LINKS);
    return links;
  }

  function makeLink(href, label, index) {
    var a = document.createElement('a');
    a.className = 'nav-item bounceable basic-nav-item' + (location.pathname === href || (href === '/candidates' && location.pathname.indexOf('/candidate/') === 0) ? ' active' : '');
    a.href = href;
    a.setAttribute('data-basic-crm-link', '1');
    a.addEventListener('click', function (event) {
      if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      try {
        history.pushState(null, '', href);
        window.dispatchEvent(new PopStateEvent('popstate'));
        window.dispatchEvent(new Event('cc-route-change'));
      } catch (_) { location.href = href; }
    });
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
    if (nav.getAttribute('data-basic-signature') === signature && nav.querySelector('[data-basic-crm-link]')) {
      nav.querySelectorAll('[data-basic-crm-link]').forEach(function (link) {
        var href = link.getAttribute('href') || '';
        var active = location.pathname === href || (href === '/candidates' && location.pathname.indexOf('/candidate/') === 0);
        link.classList.toggle('active', active);
      });
      return;
    }
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

  function forceCareerCroxBrand() {
    try {
      document.querySelectorAll('.sidebar-brand-full-logo,.style15-logo img,.success-card img').forEach(function (img) {
        if (img.getAttribute('src') !== '/assets/img/career-crox-logo.svg?v=CC26_776_BRAND_FIX') img.setAttribute('src','/assets/img/career-crox-logo.svg?v=CC26_776_BRAND_FIX');
        img.style.setProperty('object-fit','contain','important');
      });
    } catch (_) {}
  }

  function hideRemovedSlices() {
    try {
      document.querySelectorAll('a[href="/quick-add"],a[href="/chat"],a[href="/recent-activity"]').forEach(function (el) { el.style.setProperty('display','none','important'); });
      document.querySelectorAll('button,a,[role="button"]').forEach(function (el) {
        var text=String(el.textContent||'').replace(/\s+/g,' ').trim();
        if (/^(Quick Add|Team Chat|CRM Team Chat|CRM Logs)$/i.test(text)) el.style.setProperty('display','none','important');
      });
    } catch (_) {}
  }

  function ensureQuickAddEntry() {
    try {
      var wrap = document.querySelector('.top-action-wrap');
      if (wrap) {
        wrap.style.setProperty('display', 'block', 'important');
        wrap.style.setProperty('visibility', 'visible', 'important');
        wrap.style.setProperty('opacity', '1', 'important');
      }
      var topbar = document.querySelector('.topbar-right');
      if (topbar && !topbar.querySelector('[data-cc768-quick-add="1"]') && !wrap) {
        var add = document.createElement('a');
        add.href = '/candidate/new';
        add.className = 'cc768-quick-add-top bounceable';
        add.setAttribute('data-cc768-quick-add', '1');
        add.textContent = '+ Add Profile';
        add.title = 'Add Candidate Profile';
        topbar.insertBefore(add, topbar.firstChild || null);
      }
      var existingButton = wrap && wrap.querySelector('button,a');
      if (existingButton) {
        existingButton.style.setProperty('display', 'inline-flex', 'important');
        existingButton.style.setProperty('visibility', 'visible', 'important');
        existingButton.style.setProperty('opacity', '1', 'important');
      }
    } catch (_) {}
  }

  function syncRecruiterDisplayName() {
    try {
      if (!/^\/candidate\/(?!new(?:\/|$))[^/?#]+/i.test(location.pathname || '')) return;
      var user = JSON.parse(localStorage.getItem('careerCroxCachedUser') || '{}');
      var fullName = String(user.full_name || user.name || user.username || '').trim();
      var code = String(user.recruiter_code || user.user_code || user.username || '').trim();
      if (!fullName) return;
      var card = document.querySelector('[data-field="recruiter_code"]');
      if (!card) return;
      var input = card.querySelector('input.recruiter-identity-input,input[readonly]');
      if (!input) return;
      var current = String(input.value || '').trim();
      // Only rewrite the logged-in owner's own recruiter identity; never rewrite a manager viewing another owner.
      if (code && current && current.toLowerCase().indexOf(code.toLowerCase()) === -1) return;
      var desired = fullName + (code ? ' - ' + code : '');
      if (input.value !== desired) input.value = desired;
      var helper = card.querySelector('.cc730-recruiter-meta,.helper-text');
      if (helper) helper.textContent = fullName + (code ? ' • ' + code : '');
    } catch (_) {}
  }

  function simplifyNotesComposer() {
    try {
      if (!/^\/candidate\//i.test(location.pathname || '')) return;
      document.querySelectorAll('.candidate-notes-chat-panel button,.candidate-notes-composer-grid button').forEach(function (btn) {
        var text = String(btn.textContent || '').replace(/\s+/g, ' ').trim();
        if (text === 'Add Note' || text === 'Reply Note') btn.style.setProperty('display', 'none', 'important');
      });
      var textarea = document.querySelector('.candidate-notes-main-textarea');
      if (textarea) textarea.setAttribute('placeholder', 'Type note here. Save or Submit will save it automatically.');
    } catch (_) {}
  }

  function enforce() {
    applyNav();
    forceCareerCroxBrand();
    hideRemovedSlices();
    ensureQuickAddEntry();
    removeBreakAndHeavyUi();
    syncRecruiterDisplayName();
    simplifyNotesComposer();
    document.documentElement.setAttribute('data-basic-crm', 'true');
  }

  function purgeBuildScopedCaches() {
    try {
      var marker = 'careerCroxBasicIsolationReset:CC26_776';
      if (localStorage.getItem(marker) === '1') return;
      var prefixes = [
        'careerCroxCandidatesFastCache:', 'careerCroxSubmissionsCache:', 'careerCroxInterviewsCache:',
        'careerCroxFollowUpsRows', 'careerCroxCandidateNav:', 'careerCroxPageCache:', 'cc_page_cache:',
        'careerCroxInstantCandidateProfile:', 'careerCroxRealtimeCandidatePatch:'
      ];
      [window.sessionStorage, window.localStorage].forEach(function (storage) {
        if (!storage) return;
        var keys = [];
        for (var i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
        keys.forEach(function (key) {
          if (key && prefixes.some(function (prefix) { return String(key).indexOf(prefix) === 0; })) {
            try { storage.removeItem(key); } catch (_) {}
          }
        });
      });
      localStorage.setItem(marker, '1');
    } catch (_) {}
  }

  function recruiterPayloadAllowed(item) {
    try {
      var user = JSON.parse(localStorage.getItem('careerCroxCachedUser') || '{}');
      var role = String(user.role || user.designation || '').trim().toLowerCase();
      if (role === 'admin' || role.indexOf('manager') !== -1 || role === 'tl' || role.indexOf('team lead') !== -1 || role.indexOf('teamlead') !== -1) return true;
      var code = String(user.recruiter_code || '').trim().toLowerCase();
      var name = String(user.full_name || '').trim().toLowerCase();
      var username = String(user.username || '').trim().toLowerCase();
      var userId = String(user.user_id || '').trim();
      var rowCode = String(item && item.recruiter_code || '').trim().toLowerCase();
      var rowName = String(item && item.recruiter_name || '').trim().toLowerCase();
      var rowId = String(item && (item.recruiter_user_id || item.user_id) || '').trim();
      if (rowCode) return !!code && rowCode === code && (!rowName || rowName === name || rowName === username);
      if (rowName) return rowName === name || rowName === username;
      if (rowId) return !!userId && rowId === userId;
      return false;
    } catch (_) { return false; }
  }

  function installRealtimeIsolationGuard() {
    try {
      ['career-crox-candidate-upserted','career-crox-candidate-submitted'].forEach(function (eventName) {
        window.addEventListener(eventName, function (event) {
          if (!recruiterPayloadAllowed(event && event.detail && event.detail.item)) {
            try { event.stopImmediatePropagation(); } catch (_) {}
          }
        }, true);
      });
      window.addEventListener('storage', function (event) {
        if (String(event && event.key || '') !== 'careerCroxRealtimeCandidatePatch:v2' || !event.newValue) return;
        try {
          var payload = JSON.parse(event.newValue);
          if (!recruiterPayloadAllowed(payload && payload.item)) event.stopImmediatePropagation();
        } catch (_) {}
      }, true);
    } catch (_) {}
  }

  function purgeRoleScopedCachesForUser(user) {
    try {
      var userId = String(user && (user.user_id || user.username || user.recruiter_code) || '').trim();
      if (!userId) return;
      var ownerMarker = 'careerCroxBasicCacheOwner:CC26_776';
      var expected = BUILD + ':' + userId;
      if (localStorage.getItem(ownerMarker) === expected) return;
      var prefixes = [
        'careerCroxCandidatesFastCache:', 'careerCroxSubmissionsCache:', 'careerCroxInterviewsCache:',
        'careerCroxFollowUpsRows', 'careerCroxCandidateNav:', 'careerCroxPageCache:', 'cc_page_cache:',
        'careerCroxInstantCandidateProfile:', 'careerCroxRealtimeCandidatePatch:'
      ];
      [window.sessionStorage, window.localStorage].forEach(function (storage) {
        if (!storage) return;
        var keys = [];
        for (var i = 0; i < storage.length; i += 1) keys.push(storage.key(i));
        keys.forEach(function (key) {
          if (!key) return;
          if (prefixes.some(function (prefix) { return String(key).indexOf(prefix) === 0; })) {
            try { storage.removeItem(key); } catch (_) {}
          }
        });
      });
      localStorage.setItem(ownerMarker, expected);
    } catch (_) {}
  }

  function loadUser() {
    fetch('/api/auth/me', { credentials: 'include', cache: 'no-store' })
      .then(function (r) { if (!r.ok) throw new Error('auth'); return r.json(); })
      .then(function (data) {
        state.role = String(data && data.user && data.user.role || '').toLowerCase();
        state.userLoaded = true;
        purgeRoleScopedCachesForUser(data.user || {});
        try { localStorage.setItem('careerCroxCachedUser', JSON.stringify(data.user || {})); } catch (_) {}
        if (['/quick-add','/chat','/recent-activity'].indexOf(location.pathname) !== -1) { location.replace('/candidates'); return; }
        if (!adminControl() && (location.pathname === '/basic-admin.html' || location.pathname === '/bucket-out' || location.pathname === '/duplicate-profiles')) { location.replace('/candidates'); return; }
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
    'html[data-basic-crm="true"] [href="/attendance"],html[data-basic-crm="true"] [href="/reports"],html[data-basic-crm="true"] [href="/client-pipeline"],html[data-basic-crm="true"] [href="/securelink"]{display:none!important}',
    'html[data-basic-crm="true"] .topbar-center{display:none!important}',
    'html[data-basic-crm="true"] .top-action-wrap{display:block!important;visibility:visible!important;opacity:1!important}',
    'html[data-basic-crm="true"] .cc768-quick-add-top{display:inline-flex!important;align-items:center!important;justify-content:center!important;min-height:38px!important;padding:0 14px!important;border:0!important;border-radius:13px!important;background:linear-gradient(135deg,#ff8a1f,#ff5f6d)!important;color:#fff!important;-webkit-text-fill-color:#fff!important;font-weight:900!important;text-decoration:none!important;white-space:nowrap!important;box-shadow:0 8px 20px rgba(255,95,109,.22)!important}',
    'html[data-basic-crm="true"] [href="/notifications"],html[data-basic-crm="true"] [href="/aaria"],html[data-basic-crm="true"] [href="/attendance"],html[data-basic-crm="true"] [href="/quick-add"],html[data-basic-crm="true"] [href="/chat"],html[data-basic-crm="true"] [href="/recent-activity"]{display:none!important}',
    'html[data-basic-crm="true"] #cc451-office-gate,html[data-basic-crm="true"] .cc724-office-overlay,html[data-basic-crm="true"] .attendance-gate,html[data-basic-crm="true"] .break-overdue-modal,html[data-basic-crm="true"] .crm-lock-backdrop{display:none!important}',
    'html[data-basic-crm="true"] body.cc451-await-join .cc391-reminder-deck,html[data-basic-crm="true"] body.cc451-await-join .cc730-reminder-popup,html[data-basic-crm="true"] body.cc451-await-join .cc763-manager-reminder-center{display:block!important;visibility:visible!important;pointer-events:auto!important}'
  ].join('');
  document.head.appendChild(style);

  purgeBuildScopedCaches();
  installRealtimeIsolationGuard();

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enforce, { once: true });
  else enforce();
  loadUser();
  var observer = new MutationObserver(function () { requestAnimationFrame(enforce); });
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
  window.__CAREER_CROX_BASIC_BUILD__ = BUILD;
})();
