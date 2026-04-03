// Runs in the isolated world on the Imbuo frontend.
// Listens for token messages from the MAIN-world auth-bridge script
// and stores the token in chrome.storage.local, then notifies the panel.
window.addEventListener('message', (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== 'imbuo-auth-token') return;

  chrome.storage.local.set({
    imbuoAuth: { token: event.data.token, email: event.data.email },
  });
  chrome.runtime.sendMessage({ action: 'authSuccess' });
});
