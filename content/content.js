let batchAborted = false;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'checkReady') {
    const ready = !!document.querySelector(CONFIG.SELECTORS.SEARCH_INPUT);
    sendResponse({ ready });
  }

  if (message.action === 'readExisting') {
    const items = document.querySelectorAll(CONFIG.SELECTORS.PROTECTED_VIDEO_ITEM);
    const titles = Array.from(items).map((el) => el.textContent.trim());
    sendResponse({ titles });
  }

  if (message.action === 'startBatch') {
    batchAborted = false;
    processBatch(message.titles, message.tabId).then((summary) => {
      chrome.runtime.sendMessage({ status: 'complete', summary });
    });
  }

  if (message.action === 'abortBatch') {
    batchAborted = true;
  }

  if (message.action === 'clickSave') {
    document.querySelector(CONFIG.SELECTORS.SAVE_BUTTON)?.click();
    sendResponse({ ok: true });
  }

  if (message.action === 'clickCancel') {
    document.querySelector(CONFIG.SELECTORS.CANCEL_BUTTON)?.click();
    sendResponse({ ok: true });
  }

  return true;
});

function sendToBackground(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      resolve(response);
    });
  });
}

async function processBatch(titles, tabId) {
  const summary = { added: 0, unmatched: 0, duplicate: 0, errors: 0 };
  const total = titles.length;

  // Attach debugger for the batch
  await sendToBackground({ action: 'debuggerAttach', tabId });

  for (let i = 0; i < total; i++) {
    if (batchAborted) break;

    const title = titles[i];

    if (!document.querySelector(CONFIG.SELECTORS.SEARCH_INPUT)) {
      chrome.runtime.sendMessage({
        status: 'error',
        message: 'Netflix session may have expired. Search input not found.',
      });
      break;
    }

    const existingItems = document.querySelectorAll(CONFIG.SELECTORS.PROTECTED_VIDEO_ITEM);
    const existingTitles = Array.from(existingItems).map((el) => el.textContent.trim());
    if (isAlreadyRestricted(title.title, existingTitles)) {
      summary.duplicate++;
      sendProgress(i + 1, total, title.title, 'duplicate');
      continue;
    }

    const result = await restrictTitle(title.title, tabId);
    summary[result]++;
    sendProgress(i + 1, total, title.title, result);

    const delay = randomDelay(
      CONFIG.DELAY_BETWEEN_TITLES_MIN_MS,
      CONFIG.DELAY_BETWEEN_TITLES_MAX_MS
    );
    await sleep(delay);
  }

  // Detach debugger when done
  await sendToBackground({ action: 'debuggerDetach' });

  return summary;
}

async function restrictTitle(titleName, tabId) {
  try {
    // Step 1: Clear input
    await clearSearchInput(tabId);

    // Step 2: Blur+focus cycle to reset React's isFocused state
    // (selectTitle sets isFocused:false without blurring the DOM input,
    //  so focus() alone is a no-op on 2nd+ titles)
    const input = document.querySelector(CONFIG.SELECTORS.SEARCH_INPUT);
    if (!input) return 'errors';

    input.blur();
    await sleep(50);
    input.focus();
    await sleep(50);

    // Step 3: Type via CDP (trusted input)
    await sendToBackground({ action: 'debuggerTypeText', tabId, text: titleName });

    // Step 4: Wait for autocomplete results
    const results = await waitForAutocomplete();
    if (!results || results.length === 0) {
      await clearSearchInput(tabId);
      return 'unmatched';
    }

    // Step 5: Find best match
    const candidates = results.map((el) => ({
      text: el.textContent.trim(),
      element: el,
    }));

    const match = findBestMatch(titleName, candidates, CONFIG.MATCH_THRESHOLD);
    if (!match) {
      await clearSearchInput(tabId);
      return 'unmatched';
    }

    // Step 6: Click the match
    const countBefore = document.querySelectorAll(CONFIG.SELECTORS.PROTECTED_VIDEO_ITEM).length;
    match.match.element.click();

    // Step 7: Verify addition
    await sleep(300);
    const countAfter = document.querySelectorAll(CONFIG.SELECTORS.PROTECTED_VIDEO_ITEM).length;

    if (countAfter > countBefore) {
      return 'added';
    }

    return 'unmatched';
  } catch (err) {
    console.error('[MNSA] Error restricting title:', titleName, err);
    return 'errors';
  }
}

async function clearSearchInput(tabId) {
  const clearBtn = document.querySelector(CONFIG.SELECTORS.CLEAR_INPUT_BUTTON);
  if (clearBtn) {
    clearBtn.click();
    await sleep(100);
  }

  const input = document.querySelector(CONFIG.SELECTORS.SEARCH_INPUT);
  if (input && input.value) {
    input.focus();
    await sleep(50);
    await sendToBackground({ action: 'debuggerClear', tabId });
    await sleep(100);
  }
}

async function waitForAutocomplete(retries = 1) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const result = await pollForResults();
    if (result) return result;

    if (attempt < retries) {
      await sleep(500);
    }
  }
  return null;
}

function pollForResults() {
  return new Promise((resolve) => {
    const start = Date.now();
    const interval = setInterval(() => {
      const container = document.querySelector(CONFIG.SELECTORS.SEARCH_RESULTS_CONTAINER);
      if (container) {
        const items = container.querySelectorAll(CONFIG.SELECTORS.SEARCH_RESULT_ITEM);
        if (items.length > 0) {
          clearInterval(interval);
          resolve(Array.from(items));
          return;
        }
      }

      if (Date.now() - start > CONFIG.AUTOCOMPLETE_TIMEOUT_MS) {
        clearInterval(interval);
        resolve(null);
      }
    }, CONFIG.AUTOCOMPLETE_POLL_INTERVAL_MS);
  });
}

function sendProgress(current, total, title, result) {
  chrome.runtime.sendMessage({
    status: 'progress',
    current,
    total,
    title,
    result,
  });
}

function randomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
