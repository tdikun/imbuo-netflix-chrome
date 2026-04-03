(async function () {
  // Elements
  const states = {
    authLoading: document.getElementById('state-auth-loading'),
    loggedOut: document.getElementById('state-logged-out'),
    noSub: document.getElementById('state-no-sub'),
    notNetflix: document.getElementById('state-not-netflix'),
    profiles: document.getElementById('state-profiles'),
    ready: document.getElementById('state-ready'),
    settings: document.getElementById('state-settings'),
    loading: document.getElementById('state-loading'),
    error: document.getElementById('state-error'),
    list: document.getElementById('state-list'),
    batch: document.getElementById('state-batch'),
    complete: document.getElementById('state-complete'),
  };

  const el = {
    profileList: document.getElementById('profile-list'),
    includeImplied: document.getElementById('include-implied'),
    btnFetch: document.getElementById('btn-fetch'),
    btnSettings: document.getElementById('btn-settings'),
    settingsUrl: document.getElementById('settings-url'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnBackSettings: document.getElementById('btn-back-settings'),
    btnLogin: document.getElementById('btn-login'),
    btnRegister: document.getElementById('btn-register'),
    btnSubscribe: document.getElementById('btn-subscribe'),
    btnLogoutNosub: document.getElementById('btn-logout-nosub'),
    btnLogout: document.getElementById('btn-logout'),
    errorText: document.getElementById('error-text'),
    btnRetry: document.getElementById('btn-retry'),
    listSummary: document.getElementById('list-summary'),
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
  };

  let currentTitles = [];
  let existingRestrictions = [];
  let activeTabId = null;

  // State management
  function showState(name) {
    Object.values(states).forEach((s) => s.classList.add('hidden'));
    states[name].classList.remove('hidden');
  }

  function getCurrentState() {
    return Object.entries(states).find(([, s]) => !s.classList.contains('hidden'))?.[0];
  }

  // Get active tab
  async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    return tab;
  }

  // Send message to content script
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

  // Auth helpers
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
      const backendUrl = await getBackendUrl();
      const resp = await fetch(`${backendUrl}${CONFIG.AUTH_ME_PATH}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
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

  // Load settings
  async function loadSettings() {
    const data = await chrome.storage.local.get(['imbuoConfig', 'settings']);
    const config = data.imbuoConfig || { backendUrl: CONFIG.DEFAULT_BACKEND_URL };
    const settings = data.settings || { includeImplied: true };
    el.settingsUrl.value = config.backendUrl;
    el.includeImplied.checked = settings.includeImplied !== false;
    return config;
  }

  // Get backend URL
  async function getBackendUrl() {
    const data = await chrome.storage.local.get('imbuoConfig');
    return (data.imbuoConfig || {}).backendUrl || CONFIG.DEFAULT_BACKEND_URL;
  }

  // Determine state based on current tab
  async function checkTabReady() {
    const tab = await getActiveTab();
    if (!tab) {
      showState('notNetflix');
      return;
    }

    activeTabId = tab.id;

    // Not on Netflix at all
    if (!tab.url || !tab.url.match(/netflix\.com/)) {
      showState('notNetflix');
      return;
    }

    // On a restrictions page — check if the search input is ready
    if (tab.url.match(/netflix\.com\/settings\/restrictions/)) {
      try {
        const response = await sendToContent({ action: 'checkReady' });
        if (response && response.ready) {
          showState('ready');
          return;
        }
      } catch {}
    }

    // On Netflix but not on a ready restrictions page — extract profiles via background
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

    // On Netflix but couldn't extract profiles
    showState('notNetflix');
  }

  // Render profile picker
  function renderProfiles(profiles) {
    showState('profiles');
    el.profileList.innerHTML = '';

    profiles.forEach((profile) => {
      const card = document.createElement('div');
      card.className = 'profile-card';

      const avatarHtml = profile.avatarUrl
        ? `<img class="profile-avatar" src="${escapeHtml(profile.avatarUrl)}" alt="">`
        : `<div class="profile-avatar profile-avatar-blank"></div>`;

      const kidsLabel = profile.isKids ? '<span class="badge badge-kids">Kids</span>' : '';

      card.innerHTML = `
        ${avatarHtml}
        <div class="profile-info">
          <div class="profile-name">${escapeHtml(profile.name)}</div>
          ${kidsLabel}
        </div>
      `;

      card.addEventListener('click', () => {
        chrome.tabs.update(activeTabId, { url: profile.restrictionsUrl });
      });

      el.profileList.appendChild(card);
    });
  }

  // Fetch titles from API
  async function fetchTitles() {
    showState('loading');

    try {
      const backendUrl = await getBackendUrl();
      const includeImplied = el.includeImplied.checked;
      const url = `${backendUrl}${CONFIG.ENDPOINT_PATH}?platform=netflix&include_implied=${includeImplied}`;

      const token = await getAuthToken();
      const headers = { 'Accept': 'application/json' };
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

      // Read existing restrictions from Netflix DOM
      const existing = await sendToContent({ action: 'readExisting' });
      existingRestrictions = (existing && existing.titles) || [];

      // Filter to only new titles
      const newTitles = data.titles.filter(
        (t) => !isAlreadyRestricted(t.title, existingRestrictions)
      );

      currentTitles = newTitles;
      renderTitleList(newTitles, existingRestrictions.length, data);
    } catch (err) {
      showState('error');
      el.errorText.textContent = err.message || 'Failed to connect to backend.';
    }
  }

  // Render title list
  function renderTitleList(titles, alreadyRestrictedCount, apiData) {
    showState('list');

    el.listSummary.textContent = `${titles.length} new title${titles.length !== 1 ? 's' : ''} to restrict (${alreadyRestrictedCount} already restricted, ${apiData.total_with_lgbtq} total flagged)`;

    el.titleList.innerHTML = '';

    titles.forEach((title, i) => {
      const card = document.createElement('div');
      card.className = 'title-card selected';
      card.dataset.index = i;

      const badge = title.lgbtq_explicit ? 'explicit' : 'implied';
      const badgeClass = title.lgbtq_explicit ? 'badge-explicit' : 'badge-implied';
      const posterSrc = title.poster_url
        ? escapeHtml(title.poster_url)
        : '';
      const posterHtml = posterSrc
        ? `<img class="title-poster" src="${posterSrc}" alt="">`
        : `<div class="title-poster title-poster-blank"></div>`;

      card.innerHTML = `
        <div class="title-card-main">
          ${posterHtml}
          <div class="title-info">
            <div class="title-name" title="${escapeHtml(title.title)}">${escapeHtml(title.title)}</div>
            <div class="title-meta">
              <span>${escapeHtml(title.year || '')}</span>
              <span class="meta-dot">&middot;</span>
              <span>${escapeHtml(title.content_type)}</span>
              <span class="badge ${badgeClass}">${badge}</span>
            </div>
          </div>
          <button class="btn-expand" title="Show evidence">&rsaquo;</button>
        </div>
        <div class="title-evidence hidden">
          <p>${escapeHtml(title.evidence || 'No evidence provided.')}</p>
        </div>
      `;

      card.querySelector('.title-card-main').addEventListener('click', (e) => {
        if (e.target.closest('.btn-expand')) return;
        card.classList.toggle('selected');
        updateApplyButton();
      });

      card.querySelector('.btn-expand').addEventListener('click', (e) => {
        e.stopPropagation();
        const evidence = card.querySelector('.title-evidence');
        const btn = card.querySelector('.btn-expand');
        evidence.classList.toggle('hidden');
        btn.classList.toggle('expanded');
      });

      el.titleList.appendChild(card);
    });

    updateApplyButton();
  }

  function getSelectedTitles() {
    const cards = el.titleList.querySelectorAll('.title-card');
    const selected = [];
    cards.forEach((card) => {
      if (card.classList.contains('selected')) {
        selected.push(currentTitles[parseInt(card.dataset.index)]);
      }
    });
    return selected;
  }

  function updateApplyButton() {
    const count = getSelectedTitles().length;
    el.btnApply.textContent = `Apply Selected (${count})`;
    el.btnApply.disabled = count === 0;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Batch apply
  async function startBatch() {
    const selected = getSelectedTitles();
    if (selected.length === 0) return;

    showState('batch');
    el.batchLog.innerHTML = '';
    el.progressBar.style.width = '0%';
    el.progressText.textContent = `0 of ${selected.length}`;

    await sendToContent({ action: 'startBatch', titles: selected, tabId: activeTabId });
  }

  // Listen for progress updates from content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'authSuccess') {
      checkAuth();
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

  // Re-check when the user switches tabs
  chrome.tabs.onActivated.addListener(() => {
    const s = getCurrentState();
    if (s === 'notNetflix' || s === 'profiles' || s === 'ready') {
      checkTabReady();
    }
  });

  // Re-check when the active tab navigates
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' && tabId === activeTabId) {
      const s = getCurrentState();
      if (s === 'notNetflix' || s === 'profiles' || s === 'ready') {
        checkTabReady();
      }
    }
  });

  // Event listeners
  document.getElementById('link-netflix').addEventListener('click', async (e) => {
    e.preventDefault();
    const tab = await getActiveTab();
    if (tab) {
      chrome.tabs.update(tab.id, { url: 'https://www.netflix.com/browse' });
    } else {
      chrome.tabs.create({ url: 'https://www.netflix.com/browse' });
    }
  });

  el.btnFetch.addEventListener('click', fetchTitles);
  el.btnRetry.addEventListener('click', fetchTitles);

  el.btnSettings.addEventListener('click', () => showState('settings'));
  el.btnBackSettings.addEventListener('click', () => showState('ready'));

  el.btnSaveSettings.addEventListener('click', async () => {
    const url = el.settingsUrl.value.trim().replace(/\/+$/, '');
    await chrome.storage.local.set({ imbuoConfig: { backendUrl: url } });
    checkAuth();
  });

  el.btnSelectAll.addEventListener('click', () => {
    el.titleList.querySelectorAll('.title-card').forEach((c) => c.classList.add('selected'));
    updateApplyButton();
  });

  el.btnSelectNone.addEventListener('click', () => {
    el.titleList.querySelectorAll('.title-card').forEach((c) => c.classList.remove('selected'));
    updateApplyButton();
  });

  // Auth button handlers
  el.btnLogin.addEventListener('click', () => {
    chrome.tabs.create({ url: `${CONFIG.DEFAULT_FRONTEND_URL}${CONFIG.LOGIN_WEB_PATH}` });
  });

  el.btnRegister.addEventListener('click', () => {
    chrome.tabs.create({ url: `${CONFIG.DEFAULT_FRONTEND_URL}${CONFIG.REGISTER_WEB_PATH}` });
  });

  el.btnSubscribe.addEventListener('click', async () => {
    const backendUrl = await getBackendUrl();
    const token = await getAuthToken();
    try {
      const resp = await fetch(`${backendUrl}${CONFIG.BILLING_CHECKOUT_URL_PATH}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
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
    const backendUrl = await getBackendUrl();
    try {
      await fetch(`${backendUrl}/api/v1/logout`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' },
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
    showState('ready');
  });

  el.btnCancelNetflix.addEventListener('click', async () => {
    await sendToContent({ action: 'clickCancel' });
    showState('ready');
  });

  // Initialize
  await loadSettings();
  await checkAuth();
})();
