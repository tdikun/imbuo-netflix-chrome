(async function () {
  const states = {
    authLoading: document.getElementById('state-auth-loading'),
    loggedOut: document.getElementById('state-logged-out'),
    noSub: document.getElementById('state-no-sub'),
    notNetflix: document.getElementById('state-not-netflix'),
    profiles: document.getElementById('state-profiles'),
    loading: document.getElementById('state-loading'),
    error: document.getElementById('state-error'),
    list: document.getElementById('state-list'),
    batch: document.getElementById('state-batch'),
    complete: document.getElementById('state-complete'),
  };

  const el = {
    profileList: document.getElementById('profile-list'),
    btnFilter: document.getElementById('btn-filter'),
    filterMenu: document.getElementById('filter-menu'),
    btnRefetch: document.getElementById('btn-refetch'),
    btnLogin: document.getElementById('btn-login'),
    btnRegister: document.getElementById('btn-register'),
    btnSubscribe: document.getElementById('btn-subscribe'),
    btnLogoutNosub: document.getElementById('btn-logout-nosub'),
    btnLogout: document.getElementById('btn-logout'),
    errorText: document.getElementById('error-text'),
    btnRetry: document.getElementById('btn-retry'),
    listCount: document.getElementById('list-count'),
    applyCount: document.getElementById('apply-count'),
    applyNote: document.getElementById('apply-note'),
    titleList: document.getElementById('title-list'),
    btnSelectAll: document.getElementById('btn-select-all'),
    btnSelectNone: document.getElementById('btn-select-none'),
    btnApply: document.getElementById('btn-apply'),
    progressText: document.getElementById('progress-text'),
    progressBar: document.getElementById('progress-bar'),
    batchLog: document.getElementById('batch-log'),
    btnAbort: document.getElementById('btn-abort'),
    completeSummary: document.getElementById('complete-summary'),
    btnSaveNetflix: document.getElementById('btn-save-netflix'),
    btnCancelNetflix: document.getElementById('btn-cancel-netflix'),
    toast: document.getElementById('toast'),
  };

  let currentTitles = [];
  let existingRestrictions = [];
  let activeTabId = null;
  let toastTimer = null;

  function showState(name) {
    Object.values(states).forEach((s) => s.classList.add('hidden'));
    states[name].classList.remove('hidden');
  }

  function getCurrentState() {
    return Object.entries(states).find(([, s]) => !s.classList.contains('hidden'))?.[0];
  }

  function showToast(message) {
    if (!el.toast) return;
    el.toast.textContent = message;
    el.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.toast.classList.remove('is-visible'), 1400);
  }

  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  function sendToContent(message) {
    return new Promise((resolve) => {
      chrome.tabs.sendMessage(activeTabId, message, (response) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(response);
      });
    });
  }

  async function getAuthToken() {
    const data = await chrome.storage.local.get('imbuoAuth');
    return data.imbuoAuth?.token || null;
  }

  async function checkAuth() {
    const token = await getAuthToken();
    if (!token) {
      showState('loggedOut');
      return;
    }

    showState('authLoading');

    try {
      const backendUrl = getBackendUrl();
      const resp = await fetch(`${backendUrl}${CONFIG.AUTH_ME_PATH}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'X-Brand': CONFIG.BRAND },
      });

      if (resp.status === 401) {
        await chrome.storage.local.remove('imbuoAuth');
        showState('loggedOut');
        return;
      }

      if (!resp.ok) throw new Error('Failed to check account');

      const user = await resp.json();

      if (!user.subscribed) {
        showState('noSub');
        return;
      }

      checkTabReady();
    } catch (err) {
      showState('error');
      el.errorText.textContent = 'Failed to connect to server.';
    }
  }

  function getBackendUrl() {
    return CONFIG.DEFAULT_BACKEND_URL;
  }

  // Filter state. Sets allow O(1) lookup; sections enumerated below.
  const FLAG_OPTIONS = ['Explicit', 'Implied'];
  const filters = {
    flags: new Set(FLAG_OPTIONS),
    types: new Set(),
    ratings: new Set(),
  };
  let availableTypes = [];
  let availableRatings = [];

  function normalizeType(raw) {
    if (!raw) return '';
    const v = String(raw).toLowerCase();
    if (v === 'movie') return 'Movie';
    if (v === 'tv' || v === 'series' || v === 'tv_show' || v === 'show') return 'TV';
    return String(raw);
  }

  function titleFlag(t) {
    return t.lgbtq_explicit ? 'Explicit' : 'Implied';
  }

  function titleType(t) {
    return normalizeType(t.content_type);
  }

  function titleRating(t) {
    return t.certification || t.rating || t.maturity_rating || '';
  }

  function matchesFilters(t) {
    if (!filters.flags.has(titleFlag(t))) return false;
    const type = titleType(t);
    if (type && filters.types.size && !filters.types.has(type)) return false;
    const rating = titleRating(t);
    if (rating && filters.ratings.size && !filters.ratings.has(rating)) return false;
    return true;
  }

  function isDefaultFilters() {
    return (
      filters.flags.size === FLAG_OPTIONS.length &&
      filters.types.size === availableTypes.length &&
      filters.ratings.size === availableRatings.length
    );
  }

  function rebuildAvailableOptions() {
    const typesSet = new Set();
    const ratingsSet = new Set();
    currentTitles.forEach((t) => {
      const ty = titleType(t);
      if (ty) typesSet.add(ty);
      const ra = titleRating(t);
      if (ra) ratingsSet.add(ra);
    });
    availableTypes = Array.from(typesSet).sort();
    // Order ratings by common MPAA/TV rating progression when possible.
    const ratingOrder = ['G', 'PG', 'PG-13', 'R', 'NC-17', 'TV-Y', 'TV-Y7', 'TV-G', 'TV-PG', 'TV-14', 'TV-MA'];
    availableRatings = Array.from(ratingsSet).sort((a, b) => {
      const ai = ratingOrder.indexOf(a);
      const bi = ratingOrder.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });
    // Reconcile filter state: keep only options that still exist, default new options to "on".
    filters.types = new Set(availableTypes.filter((t) => filters.types.size === 0 || filters.types.has(t)));
    if (filters.types.size === 0) availableTypes.forEach((t) => filters.types.add(t));
    filters.ratings = new Set(availableRatings.filter((r) => filters.ratings.size === 0 || filters.ratings.has(r)));
    if (filters.ratings.size === 0) availableRatings.forEach((r) => filters.ratings.add(r));
  }

  function countBy(getter, value) {
    return currentTitles.filter((t) => getter(t) === value).length;
  }

  async function checkTabReady() {
    const tab = await getActiveTab();
    if (!tab) {
      showState('notNetflix');
      return;
    }

    activeTabId = tab.id;

    if (!tab.url || !tab.url.match(/netflix\.com/)) {
      showState('notNetflix');
      return;
    }

    if (tab.url.match(/netflix\.com\/settings\/restrictions/)) {
      try {
        const response = await sendToContent({ action: 'checkReady' });
        if (response && response.ready) {
          fetchTitles();
          return;
        }
      } catch {}
    }

    try {
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { action: 'extractProfilesMain', tabId: activeTabId },
          (res) => {
            if (chrome.runtime.lastError) {
              resolve(null);
              return;
            }
            resolve(res);
          }
        );
      });
      if (response && response.profiles && response.profiles.length > 0) {
        renderProfiles(response.profiles);
        return;
      }
    } catch {}

    showState('notNetflix');
  }

  function renderProfiles(profiles) {
    showState('profiles');
    el.profileList.innerHTML = '';

    profiles.forEach((profile) => {
      const card = document.createElement('div');
      card.className = 'profile-card';

      const avatarHtml = profile.avatarUrl
        ? `<img class="profile-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="">`
        : `<div class="profile-avatar profile-avatar-blank"></div>`;

      const kidsLabel = profile.isKids ? '<span class="badge-kids">Kids</span>' : '<span></span>';

      card.innerHTML = `
        ${avatarHtml}
        <div class="profile-name">${escapeHtml(profile.name)}</div>
        ${kidsLabel}
      `;

      card.addEventListener('click', () => {
        chrome.tabs.update(activeTabId, { url: profile.restrictionsUrl });
      });

      el.profileList.appendChild(card);
    });
  }

  async function fetchTitles() {
    showState('loading');

    try {
      const backendUrl = getBackendUrl();
      const url = `${backendUrl}${CONFIG.ENDPOINT_PATH}?platform=netflix&include_implied=true`;

      const token = await getAuthToken();
      const headers = { 'Accept': 'application/json', 'X-Brand': CONFIG.BRAND };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(url, { headers });

      if (response.status === 401) {
        await chrome.storage.local.remove('imbuoAuth');
        showState('loggedOut');
        return;
      }

      if (response.status === 403) {
        const body = await response.json().catch(() => ({}));
        if (body.code === 'subscription_required') {
          showState('noSub');
          return;
        }
      }

      if (!response.ok) {
        throw new Error(`API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.titles || data.titles.length === 0) {
        if (data.total_with_lgbtq > 0 && data.total_on_platform === 0) {
          throw new Error(
            `${data.total_with_lgbtq} titles flagged but none matched to Netflix. Streaming data may need to be updated.`
          );
        }
        throw new Error(
          'No reports found. Content needs to be analyzed and published first.'
        );
      }

      const existing = await sendToContent({ action: 'readExisting' });
      existingRestrictions = (existing && existing.titles) || [];

      const newTitles = data.titles.filter(
        (t) => !isAlreadyRestricted(t.title, existingRestrictions)
      );

      currentTitles = newTitles.map((t) => ({ ...t, selected: true, expanded: false }));
      renderListState();
    } catch (err) {
      showState('error');
      el.errorText.textContent = err.message || 'Failed to connect to backend.';
    }
  }

  async function refetchTitles() {
    if (el.btnRefetch.classList.contains('is-spinning')) return;
    el.btnRefetch.classList.add('is-spinning');
    showToast('Refetching titles…');

    try {
      const backendUrl = getBackendUrl();
      const url = `${backendUrl}${CONFIG.ENDPOINT_PATH}?platform=netflix&include_implied=true`;

      const token = await getAuthToken();
      const headers = { 'Accept': 'application/json', 'X-Brand': CONFIG.BRAND };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const response = await fetch(url, { headers });
      if (!response.ok) throw new Error(`API returned ${response.status}`);
      const data = await response.json();

      const existing = await sendToContent({ action: 'readExisting' });
      existingRestrictions = (existing && existing.titles) || [];

      const newTitles = (data.titles || []).filter(
        (t) => !isAlreadyRestricted(t.title, existingRestrictions)
      );

      currentTitles = newTitles.map((t) => ({ ...t, selected: true, expanded: false }));
      renderListState();
      showToast('Titles updated');
    } catch (err) {
      showToast('Refetch failed');
    } finally {
      setTimeout(() => el.btnRefetch.classList.remove('is-spinning'), 720);
    }
  }

  function renderListState() {
    showState('list');
    rebuildAvailableOptions();
    renderFilterMenu();
    renderCards();
    updateApplyMeta();
  }

  function visibleIndexes() {
    return currentTitles
      .map((_, i) => i)
      .filter((i) => matchesFilters(currentTitles[i]));
  }

  function makeEl(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function renderCards() {
    while (el.titleList.firstChild) el.titleList.removeChild(el.titleList.firstChild);

    visibleIndexes().forEach((index) => {
      const item = currentTitles[index];
      const card = makeEl('article', 'title-card');
      if (item.selected) card.classList.add('is-selected');
      if (item.expanded) card.classList.add('is-expanded');

      const isImplied = !item.lgbtq_explicit;
      const flagText = isImplied ? 'Implied' : 'Explicit';

      // Poster with flag ribbon
      const posterClass = item.poster_url ? 'poster' : 'poster is-blank';
      const poster = makeEl('div', posterClass);
      const ribbon = makeEl('span', isImplied ? 'flag-ribbon is-implied' : 'flag-ribbon', flagText);
      poster.appendChild(ribbon);
      if (item.poster_url) {
        const img = document.createElement('img');
        img.src = item.poster_url;
        img.alt = '';
        poster.appendChild(img);
      }
      card.appendChild(poster);

      // Select control (top-right circle)
      const select = makeEl('button', 'select-control');
      select.type = 'button';
      select.setAttribute('aria-pressed', String(item.selected));
      select.setAttribute('aria-label', item.selected ? 'Selected' : 'Not selected');
      select.textContent = '✓';
      select.addEventListener('click', (e) => {
        e.stopPropagation();
        currentTitles[index].selected = !currentTitles[index].selected;
        renderCards();
        updateApplyMeta();
      });
      card.appendChild(select);

      // Title name
      card.appendChild(makeEl('h2', 'title-name', item.title));

      // Meta line
      const meta = makeEl('div', 'meta');
      if (item.year) meta.appendChild(makeEl('span', null, String(item.year)));
      if (item.year && item.content_type) meta.appendChild(makeEl('span', 'dot', '·'));
      if (item.content_type) meta.appendChild(makeEl('span', null, item.content_type));
      card.appendChild(meta);

      // Evidence body + toggle (inline expansion pattern from v7)
      const body = makeEl('div', 'evidence-body');
      const toggle = makeEl('button', 'evidence-toggle', item.expanded ? 'Show less' : 'Show more');
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', String(item.expanded));
      toggle.setAttribute('aria-label', (item.expanded ? 'Hide evidence for ' : 'Show evidence for ') + item.title);
      toggle.addEventListener('click', () => {
        currentTitles[index].expanded = !currentTitles[index].expanded;
        renderCards();
      });

      const evidenceText = item.evidence || 'No evidence provided.';
      if (item.expanded) {
        body.appendChild(document.createTextNode(evidenceText));
        card.appendChild(body);
        card.appendChild(toggle);
      } else {
        body.appendChild(toggle);
        body.appendChild(document.createTextNode(evidenceText));
        card.appendChild(body);
      }

      el.titleList.appendChild(card);
    });
  }

  function getSelectedTitles() {
    return visibleIndexes()
      .map((i) => currentTitles[i])
      .filter((t) => t.selected);
  }

  function updateApplyMeta() {
    const visible = visibleIndexes();
    const visibleSelected = visible.filter((i) => currentTitles[i].selected).length;
    el.listCount.textContent = `${visible.length} match${visible.length !== 1 ? 'es' : ''}`;
    el.applyCount.textContent = visibleSelected ? 'Ready to restrict' : 'Nothing selected';
    el.applyNote.textContent = visibleSelected
      ? `Applies ${visibleSelected} match${visibleSelected !== 1 ? 'es' : ''} to this profile.`
      : 'Choose at least one match.';
    el.btnApply.disabled = visibleSelected === 0;
    el.btnSelectAll.setAttribute('aria-pressed', String(visible.length > 0 && visibleSelected === visible.length));
    el.btnSelectNone.setAttribute('aria-pressed', String(visibleSelected === 0));
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
  }

  async function startBatch() {
    const selected = getSelectedTitles();
    if (selected.length === 0) return;

    showState('batch');
    el.batchLog.innerHTML = '';
    el.progressBar.style.width = '0%';
    el.progressText.textContent = `0 of ${selected.length}`;

    await sendToContent({ action: 'startBatch', titles: selected, tabId: activeTabId });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'authSuccess') {
      checkAuth();
      return;
    }

    if (message.action === 'authCleared') {
      showState('loggedOut');
      return;
    }

    if (message.status === 'progress') {
      const pct = Math.round((message.current / message.total) * 100);
      el.progressBar.style.width = pct + '%';
      el.progressText.textContent = `${message.current} of ${message.total}`;

      const logClass =
        message.result === 'added'
          ? 'log-success'
          : message.result === 'unmatched'
            ? 'log-unmatched'
            : 'log-duplicate';
      const icon =
        message.result === 'added' ? '+' : message.result === 'unmatched' ? '?' : '=';

      const entry = document.createElement('div');
      entry.className = logClass;
      entry.textContent = `${icon} ${message.title} — ${message.result}`;
      el.batchLog.appendChild(entry);
      el.batchLog.scrollTop = el.batchLog.scrollHeight;
    }

    if (message.status === 'complete') {
      showState('complete');
      const s = message.summary;
      el.completeSummary.innerHTML = `
        <p><strong>${s.added}</strong> title${s.added !== 1 ? 's' : ''} added</p>
        <p><strong>${s.unmatched}</strong> not found on Netflix</p>
        ${s.duplicate ? `<p><strong>${s.duplicate}</strong> already restricted</p>` : ''}
        ${s.errors ? `<p><strong>${s.errors}</strong> error${s.errors !== 1 ? 's' : ''}</p>` : ''}
      `;
    }

    if (message.status === 'error') {
      showState('error');
      el.errorText.textContent = message.message;
    }
  });

  chrome.tabs.onActivated.addListener(() => {
    const s = getCurrentState();
    if (s === 'notNetflix' || s === 'profiles') {
      checkTabReady();
    }
  });

  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' && tabId === activeTabId) {
      const s = getCurrentState();
      if (s === 'notNetflix' || s === 'profiles' || s === 'ready') {
        checkTabReady();
      }
    }
  });

  document.getElementById('link-netflix').addEventListener('click', async (e) => {
    e.preventDefault();
    const tab = await getActiveTab();
    if (tab) {
      chrome.tabs.update(tab.id, { url: 'https://www.netflix.com/browse' });
    } else {
      chrome.tabs.create({ url: 'https://www.netflix.com/browse' });
    }
  });

  el.btnRetry.addEventListener('click', fetchTitles);
  el.btnRefetch.addEventListener('click', refetchTitles);

  function renderFilterMenu() {
    while (el.filterMenu.firstChild) el.filterMenu.removeChild(el.filterMenu.firstChild);

    el.filterMenu.appendChild(buildFilterSection('Include', 'flags', FLAG_OPTIONS, titleFlag));
    if (availableTypes.length) {
      el.filterMenu.appendChild(buildFilterSection('Type', 'types', availableTypes, titleType));
    }
    if (availableRatings.length) {
      el.filterMenu.appendChild(buildFilterSection('Rating', 'ratings', availableRatings, titleRating));
    }

    const footer = makeEl('div', 'filter-footer');
    const reset = makeEl('button', 'filter-reset', 'Reset');
    reset.type = 'button';
    reset.disabled = isDefaultFilters();
    reset.addEventListener('click', () => {
      filters.flags = new Set(FLAG_OPTIONS);
      filters.types = new Set(availableTypes);
      filters.ratings = new Set(availableRatings);
      renderFilterMenu();
      renderCards();
      updateApplyMeta();
      showToast('Filters reset');
    });
    footer.appendChild(reset);
    el.filterMenu.appendChild(footer);

    el.btnFilter.classList.toggle('has-active-filters', !isDefaultFilters());
  }

  function buildFilterSection(title, key, options, getter) {
    const section = makeEl('div', 'filter-section');
    section.setAttribute('role', 'group');
    section.setAttribute('aria-label', title);
    section.appendChild(makeEl('p', 'filter-section-title', title));

    options.forEach((value) => {
      const checked = filters[key].has(value);
      const btn = makeEl('button', 'filter-option');
      btn.type = 'button';
      btn.setAttribute('role', 'menuitemcheckbox');
      btn.setAttribute('aria-checked', String(checked));

      const check = makeEl('span', 'filter-option-check');
      check.setAttribute('aria-hidden', 'true');
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      const path = document.createElementNS(svgNS, 'path');
      path.setAttribute('d', 'M3 8.5l3.2 3.2L13 5');
      svg.appendChild(path);
      check.appendChild(svg);
      btn.appendChild(check);

      btn.appendChild(makeEl('span', 'filter-option-label', value));

      const count = countBy(getter, value);
      btn.appendChild(makeEl('span', 'filter-option-count', String(count)));

      btn.addEventListener('click', () => {
        if (filters[key].has(value)) filters[key].delete(value);
        else filters[key].add(value);
        renderFilterMenu();
        renderCards();
        updateApplyMeta();
      });

      section.appendChild(btn);
    });
    return section;
  }

  function positionFilterMenu() {
    const listState = states.list;
    if (!listState) return;
    const topbar = listState.querySelector('.topbar');
    const panelBody = el.filterMenu.parentElement;
    if (!topbar || !panelBody) return;
    const topbarBottom = topbar.getBoundingClientRect().bottom;
    const panelTop = panelBody.getBoundingClientRect().top;
    el.filterMenu.style.insetBlockStart = (topbarBottom - panelTop + 6) + 'px';
  }

  function openFilterMenu() {
    positionFilterMenu();
    el.btnFilter.setAttribute('aria-expanded', 'true');
    el.filterMenu.classList.add('is-open');
  }

  function closeFilterMenu() {
    el.btnFilter.setAttribute('aria-expanded', 'false');
    el.filterMenu.classList.remove('is-open');
  }

  el.btnFilter.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = el.btnFilter.getAttribute('aria-expanded') === 'true';
    if (open) closeFilterMenu();
    else openFilterMenu();
  });

  el.filterMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', () => closeFilterMenu());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeFilterMenu();
  });

  el.btnSelectAll.addEventListener('click', () => {
    visibleIndexes().forEach((i) => (currentTitles[i].selected = true));
    renderCards();
    updateApplyMeta();
    showToast('All selected');
  });

  el.btnSelectNone.addEventListener('click', () => {
    visibleIndexes().forEach((i) => (currentTitles[i].selected = false));
    renderCards();
    updateApplyMeta();
    showToast('Selection cleared');
  });

  function frontendUrl(path) {
    return `${CONFIG.DEFAULT_FRONTEND_URL}${path}?brand=${encodeURIComponent(CONFIG.BRAND)}`;
  }

  el.btnLogin.addEventListener('click', () => {
    chrome.tabs.create({ url: frontendUrl(CONFIG.LOGIN_WEB_PATH) });
  });

  el.btnRegister.addEventListener('click', () => {
    chrome.tabs.create({ url: frontendUrl(CONFIG.REGISTER_WEB_PATH) });
  });

  el.btnSubscribe.addEventListener('click', async () => {
    const backendUrl = getBackendUrl();
    const token = await getAuthToken();
    try {
      const resp = await fetch(`${backendUrl}${CONFIG.BILLING_CHECKOUT_URL_PATH}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'X-Brand': CONFIG.BRAND },
      });
      const data = await resp.json();
      if (data.checkout_url) {
        chrome.tabs.create({ url: data.checkout_url });
      }
    } catch {
      showState('error');
      el.errorText.textContent = 'Failed to start checkout.';
    }
  });

  async function doLogout() {
    const token = await getAuthToken();
    const backendUrl = getBackendUrl();
    try {
      await fetch(`${backendUrl}/api/v1/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json', 'X-Brand': CONFIG.BRAND },
      });
    } catch {}
    await chrome.storage.local.remove('imbuoAuth');
    showState('loggedOut');
  }

  el.btnLogout.addEventListener('click', doLogout);
  el.btnLogoutNosub.addEventListener('click', doLogout);

  el.btnApply.addEventListener('click', startBatch);

  el.btnAbort.addEventListener('click', async () => {
    await sendToContent({ action: 'abortBatch' });
  });

  el.btnSaveNetflix.addEventListener('click', async () => {
    await sendToContent({ action: 'clickSave' });
    checkTabReady();
  });

  el.btnCancelNetflix.addEventListener('click', async () => {
    await sendToContent({ action: 'clickCancel' });
    checkTabReady();
  });

  await checkAuth();
})();
