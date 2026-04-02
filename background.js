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
