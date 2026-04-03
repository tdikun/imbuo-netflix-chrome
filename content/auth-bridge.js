// Runs in MAIN world on the Imbuo frontend.
// Intercepts login/register fetch responses and posts the token to the
// isolated-world companion script via window.postMessage.
(function () {
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
      if (/\/api\/v1\/(login|register)$/.test(url) && response.ok) {
        const clone = response.clone();
        const data = await clone.json();
        if (data.token) {
          window.postMessage({
            type: 'imbuo-auth-token',
            token: data.token,
            email: data.user?.email || '',
          }, '*');
        }
      }
    } catch {}

    return response;
  };
})();
