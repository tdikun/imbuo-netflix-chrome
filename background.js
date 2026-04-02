chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({
    imbuoConfig: { backendUrl: 'http://localhost:8001' },
    settings: {
      matchThreshold: 0.85,
      delayBetweenTitles: 750,
      includeImplied: true,
    },
  });
});

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Debugger-based trusted input
let debuggerAttachedTabId = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'debuggerTypeText') {
    handleDebuggerType(message.tabId, message.text)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === 'debuggerClear') {
    handleDebuggerClear(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === 'debuggerAttach') {
    attachDebugger(message.tabId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.action === 'debuggerDetach') {
    detachDebugger()
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

async function attachDebugger(tabId) {
  if (debuggerAttachedTabId === tabId) return;
  if (debuggerAttachedTabId !== null) {
    await chrome.debugger.detach({ tabId: debuggerAttachedTabId }).catch(() => {});
  }
  await chrome.debugger.attach({ tabId }, '1.3');
  debuggerAttachedTabId = tabId;
}

async function detachDebugger() {
  if (debuggerAttachedTabId !== null) {
    await chrome.debugger.detach({ tabId: debuggerAttachedTabId }).catch(() => {});
    debuggerAttachedTabId = null;
  }
}

async function handleDebuggerType(tabId, text) {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.insertText', { text });
}

async function handleDebuggerClear(tabId) {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyDown', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp', modifiers: 2, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65,
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
  });
  await chrome.debugger.sendCommand({ tabId }, 'Input.dispatchKeyEvent', {
    type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8,
  });
}

chrome.debugger.onDetach.addListener((source) => {
  if (source.tabId === debuggerAttachedTabId) {
    debuggerAttachedTabId = null;
  }
});
