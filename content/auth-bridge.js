// Runs in MAIN world on the Imbuo frontend.
// Picks up an existing auth token from localStorage and also intercepts
// login/register fetches, forwarding the token to the isolated-world
// companion script via window.postMessage.
(function () {
  const TOKEN_KEY = 'auth_token';
  const USER_KEY = 'auth_user';

  function readEmail() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return '';
      return JSON.parse(raw).email || '';
    } catch {
      return '';
    }
  }

  function postToken(token, email) {
    if (!token) return;
    window.postMessage({
      type: 'imbuo-auth-token',
      token,
      email: email || '',
    }, '*');
  }

  // 1) On load, surface any token already in localStorage.
  try {
    const existing = localStorage.getItem(TOKEN_KEY);
    if (existing) postToken(existing, readEmail());
  } catch {}

  // 2) Watch for login/register responses on this tab.
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (/\/api\/v1\/(login|register)$/.test(url) && response.ok) {
        const clone = response.clone();
        const data = await clone.json();
        if (data.token) postToken(data.token, data.user?.email || '');
      }
    } catch {}
    return response;
  };

  // 3) Watch for logins/logouts that happen in other tabs of the same origin.
  window.addEventListener('storage', (e) => {
    if (e.key === TOKEN_KEY) {
      if (e.newValue) postToken(e.newValue, readEmail());
      else window.postMessage({ type: 'imbuo-auth-cleared' }, '*');
    }
  });
})();
