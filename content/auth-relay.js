// Runs in the isolated world on the Imbuo frontend.
// Listens for token messages from the MAIN-world auth-bridge script
// and syncs chrome.storage.local, then notifies the panel.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  const type = event.data?.type;

  if (type === 'imbuo-auth-token' && event.data.token) {
    chrome.storage.local.set({
      imbuoAuth: { token: event.data.token, email: event.data.email },
    });
    chrome.runtime.sendMessage({ action: 'authSuccess' }, () => void chrome.runtime.lastError);
    return;
  }

  if (type === 'imbuo-auth-cleared') {
    chrome.storage.local.remove('imbuoAuth');
    chrome.runtime.sendMessage({ action: 'authCleared' }, () => void chrome.runtime.lastError);
  }
});
