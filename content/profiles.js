// Profile extraction — runs on all Netflix pages.
// Delegates to background.js to execute in the MAIN world via chrome.scripting.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'extractProfiles') {
    // Ask background to run the extraction in the page's MAIN world
    chrome.runtime.sendMessage({ action: 'extractProfilesMain', tabId: message.tabId }, (response) => {
      sendResponse(response);
    });
    return true;
  }
});
