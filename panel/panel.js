(async function () {
  // Elements
  const states = {
    notReady: document.getElementById('state-not-ready'),
    ready: document.getElementById('state-ready'),
    settings: document.getElementById('state-settings'),
    loading: document.getElementById('state-loading'),
    error: document.getElementById('state-error'),
    list: document.getElementById('state-list'),
    batch: document.getElementById('state-batch'),
    complete: document.getElementById('state-complete'),
  };

  const el = {
    includeImplied: document.getElementById('include-implied'),
    btnFetch: document.getElementById('btn-fetch'),
    btnSettings: document.getElementById('btn-settings'),
    settingsUrl: document.getElementById('settings-url'),
    btnSaveSettings: document.getElementById('btn-save-settings'),
    btnBackSettings: document.getElementById('btn-back-settings'),
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

  // Check if current tab is on the Netflix restrictions page
  async function checkTabReady() {
    const tab = await getActiveTab();
    if (!tab) {
      showState('notReady');
      return;
    }

    activeTabId = tab.id;

    if (!tab.url || !tab.url.match(/netflix\.com\/settings\/restrictions\//)) {
      showState('notReady');
      return;
    }

    try {
      const response = await sendToContent({ action: 'checkReady' });
      if (response && response.ready) {
        showState('ready');
      } else {
        showState('notReady');
      }
    } catch {
      showState('notReady');
    }
  }

  // Fetch titles from Imbuo API
  async function fetchTitles() {
    showState('loading');

    try {
      const backendUrl = await getBackendUrl();
      const includeImplied = el.includeImplied.checked;
      const url = `${backendUrl}${CONFIG.ENDPOINT_PATH}?platform=netflix&include_implied=${includeImplied}`;

      const response = await fetch(url);
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
      const row = document.createElement('div');
      row.className = 'title-row';

      const badge = title.lgbtq_explicit ? 'explicit' : 'implied';
      const badgeClass = title.lgbtq_explicit ? 'badge-explicit' : 'badge-implied';

      row.innerHTML = `
        <input type="checkbox" checked data-index="${i}">
        <div class="title-info">
          <div class="title-name" title="${escapeHtml(title.title)}">${escapeHtml(title.title)}</div>
          <div class="title-year">${escapeHtml(title.year || '')} &middot; ${escapeHtml(title.content_type)}</div>
        </div>
        <span class="badge ${badgeClass}">${badge}</span>
      `;

      el.titleList.appendChild(row);
    });

    updateApplyButton();
  }

  function getSelectedTitles() {
    const checkboxes = el.titleList.querySelectorAll('input[type="checkbox"]');
    const selected = [];
    checkboxes.forEach((cb) => {
      if (cb.checked) {
        selected.push(currentTitles[parseInt(cb.dataset.index)]);
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

  // Re-check when the user switches tabs (sidebar stays open)
  chrome.tabs.onActivated.addListener(() => {
    const currentState = Object.entries(states).find(([, s]) => !s.classList.contains('hidden'));
    if (currentState && (currentState[0] === 'notReady' || currentState[0] === 'ready')) {
      checkTabReady();
    }
  });

  // Re-check when the active tab navigates
  chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'complete' && tabId === activeTabId) {
      const currentState = Object.entries(states).find(([, s]) => !s.classList.contains('hidden'));
      if (currentState && (currentState[0] === 'notReady' || currentState[0] === 'ready')) {
        checkTabReady();
      }
    }
  });

  // Event listeners
  document.getElementById('link-restrictions').addEventListener('click', async (e) => {
    e.preventDefault();
    const tab = await getActiveTab();
    if (tab) {
      chrome.tabs.update(tab.id, { url: 'https://www.netflix.com/settings/restrictions/' });
    } else {
      chrome.tabs.create({ url: 'https://www.netflix.com/settings/restrictions/' });
    }
  });

  el.btnFetch.addEventListener('click', fetchTitles);
  el.btnRetry.addEventListener('click', fetchTitles);

  el.btnSettings.addEventListener('click', () => showState('settings'));
  el.btnBackSettings.addEventListener('click', () => showState('ready'));

  el.btnSaveSettings.addEventListener('click', async () => {
    const url = el.settingsUrl.value.trim().replace(/\/+$/, '');
    await chrome.storage.local.set({ imbuoConfig: { backendUrl: url } });
    showState('ready');
  });

  el.btnSelectAll.addEventListener('click', () => {
    el.titleList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = true));
    updateApplyButton();
  });

  el.btnSelectNone.addEventListener('click', () => {
    el.titleList.querySelectorAll('input[type="checkbox"]').forEach((cb) => (cb.checked = false));
    updateApplyButton();
  });

  el.titleList.addEventListener('change', updateApplyButton);

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
  await checkTabReady();
})();
