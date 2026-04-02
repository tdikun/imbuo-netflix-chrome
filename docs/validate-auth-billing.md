# PRD: Chrome Extension Auth & Subscription Gating

Updates the chrome extension to authenticate against the Imbuo API and handle subscription requirements. Users who aren't logged in or subscribed see appropriate states instead of data. Depends on PRD 1 (auth) and PRD 2 (RevenueCat billing).

---

## Overview

The extension gains four new states layered before the existing flow:

1. **Logged out** → show login/register buttons (open website in new tab)
2. **Logged in, no subscription** → show "subscribe" button (opens RevenueCat checkout in new tab)
3. **Logged in, subscribed** → existing flow (fetch titles, apply restrictions)
4. **Token expired/invalid** → clear token, fall back to logged-out state

---

## Token Storage

Store the API token in `chrome.storage.local` alongside existing config:

```js
// After user pastes token from website
chrome.storage.local.set({
    imbuoAuth: {
        token: "1|abc123...",
        email: "user@example.com",
    }
});
```

All API requests include the token as a Bearer header:

```js
const headers = { 'Authorization': `Bearer ${token}`, 'Accept': 'application/json' };
```

---

## Config Changes

### File: `config.js`

Add auth-related endpoints:

```js
const CONFIG = {
    // ... existing config ...

    // Auth endpoints
    AUTH_ME_PATH: '/api/v1/me',
    BILLING_CHECKOUT_URL_PATH: '/api/v1/billing/checkout-url',

    // Web pages (opened in browser tab)
    LOGIN_WEB_PATH: '/login',
    REGISTER_WEB_PATH: '/register',
};
```

---

## Manifest Changes

### File: `manifest.json`

Add the production backend domain to `host_permissions` (when known). For now, `http://localhost:8001/*` is sufficient. No new permissions needed — `storage` is already declared.

---

## Panel UI Changes

### File: `panel/panel.html`

Add three new state divs before the existing `state-not-ready`:

```html
<!-- State: Logged out -->
<div id="state-logged-out" class="state hidden">
    <p class="message">Sign in to access content filtering.</p>
    <button id="btn-login" class="btn-primary">Log In</button>
    <button id="btn-register" class="btn-secondary">Create Account</button>
</div>

<!-- State: No subscription -->
<div id="state-no-sub" class="state hidden">
    <p class="message">Your account doesn't have an active subscription.</p>
    <button id="btn-subscribe" class="btn-primary">Subscribe</button>
    <button id="btn-logout-nosub" class="btn-link">Log out</button>
</div>

<!-- State: Checking auth -->
<div id="state-auth-loading" class="state hidden">
    <div class="spinner"></div>
    <p>Checking account...</p>
</div>
```

Add a logout link to the `state-ready` div (inside the controls area):

```html
<button id="btn-logout" class="btn-link">Log out</button>
```

---

## Panel JS Changes

### File: `panel/panel.js`

**New state references:**

Add to the `states` object:
```js
loggedOut: document.getElementById('state-logged-out'),
noSub: document.getElementById('state-no-sub'),
authLoading: document.getElementById('state-auth-loading'),
```

Add to the `el` object:
```js
btnLogin: document.getElementById('btn-login'),
btnRegister: document.getElementById('btn-register'),
btnSubscribe: document.getElementById('btn-subscribe'),
btnLogoutNosub: document.getElementById('btn-logout-nosub'),
btnLogout: document.getElementById('btn-logout'),
```

**New: `getAuthToken()` helper:**

```js
async function getAuthToken() {
    const data = await chrome.storage.local.get('imbuoAuth');
    return data.imbuoAuth?.token || null;
}
```

**New: `checkAuth()` — runs on panel open, before `checkTabReady()`:**

```js
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
            // Token expired or invalid
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

        // Authenticated and subscribed — proceed to existing flow
        checkTabReady();
    } catch (err) {
        showState('error');
        el.errorText.textContent = 'Failed to connect to server.';
    }
}
```

**Update `fetchTitles()` — add auth header to API call:**

```js
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
```

**Button handlers:**

```js
// Login — open website login page in new tab
el.btnLogin.addEventListener('click', async () => {
    const backendUrl = await getBackendUrl();
    chrome.tabs.create({ url: `${backendUrl}${CONFIG.LOGIN_WEB_PATH}` });
});

// Register — open website register page in new tab
el.btnRegister.addEventListener('click', async () => {
    const backendUrl = await getBackendUrl();
    chrome.tabs.create({ url: `${backendUrl}${CONFIG.REGISTER_WEB_PATH}` });
});

// Subscribe — call checkout-url endpoint, open RevenueCat Purchase Link
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

// Logout
async function doLogout() {
    const token = await getAuthToken();
    const backendUrl = await getBackendUrl();
    // Best-effort server logout
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
```

**Update initialization — replace `checkTabReady()` with `checkAuth()`:**

The panel's IIFE currently calls `checkTabReady()` and `loadSettings()` at the bottom. Change to:

```js
loadSettings();
checkAuth();   // was: checkTabReady()
```

`checkAuth()` calls `checkTabReady()` internally once auth + subscription is confirmed.

---

## Login Flow (Web Pages)

The extension opens login/register pages on the website. These need to exist as minimal web pages in the Laravel app.

### File: `routes/web.php`

Add:

```php
Route::get('/login', function () { return view('auth.login'); });
Route::get('/register', function () { return view('auth.register'); });
```

### Files: `resources/views/auth/login.blade.php`, `resources/views/auth/register.blade.php`

Minimal HTML forms that:

1. POST to `/api/v1/login` or `/api/v1/register` via `fetch()`
2. On success, display the token with a "Copy token" button and instructions: "Paste this token in the extension's settings to log in."

### Extension Settings Update

Add to the Settings state in `panel/panel.html`:

```html
<label class="field">
    <span>API Token</span>
    <input type="password" id="settings-token" placeholder="Paste token from website">
</label>
```

Add to the settings save handler in `panel/panel.js` — when saved, store in `chrome.storage.local` as `imbuoAuth.token`. The `checkAuth()` flow picks it up on next panel open.

---

## Panel CSS

### File: `panel/panel.css`

No structural changes needed — the new states reuse existing `.state`, `.message`, `.btn-primary`, `.btn-secondary`, `.btn-link`, `.spinner` classes.

---

## State Flow Diagram

```
Panel opens
    → checkAuth()
        → No token? → [logged-out]
        → Token exists? → GET /me
            → 401? → clear token → [logged-out]
            → subscribed: false? → [no-sub]
            → subscribed: true? → checkTabReady() → existing flow
```

---

## File Changes Summary

### Chrome Extension (`imbuo-netflix-chrome/`)

| File | Change |
|---|---|
| `config.js` | Add auth/billing endpoint paths |
| `panel/panel.html` | Add logged-out, no-sub, auth-loading states; logout button; token field in settings |
| `panel/panel.js` | Add `checkAuth()`, `getAuthToken()`, auth headers on API calls, handle 401/403, button handlers |
| `manifest.json` | Add production backend domain to `host_permissions` when known |

### Laravel App (`imbuo-parent/`)

| File | Change |
|---|---|
| `routes/web.php` | Add `/login`, `/register` web routes |
| `resources/views/auth/login.blade.php` | New — minimal login form, displays token on success |
| `resources/views/auth/register.blade.php` | New — minimal register form, displays token on success |

---

## Execution Order

1. Add web routes and blade views for login/register in Laravel app
2. Update `config.js` with auth/billing endpoint paths
3. Add new HTML states to `panel/panel.html`
4. Add token field to settings
5. Implement `checkAuth()`, `getAuthToken()`, auth headers, and button handlers in `panel/panel.js`
6. Update initialization to call `checkAuth()` instead of `checkTabReady()`
7. Test full flow: open extension → logged out → open login page → log in → copy token → paste in settings → reopen panel → no subscription → subscribe → pay on RevenueCat → reopen panel → existing flow works