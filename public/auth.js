/**
 * Shared sign-in for Fuel field app + audit dashboard.
 * Persists to localStorage key d6fuel_user (same across all routes).
 */
window.D6Auth = (function () {
  const USER_KEY = 'd6fuel_user';
  let onSuccessCallback = null;

  function getUser() {
    try {
      const raw = localStorage.getItem(USER_KEY);
      if (!raw) return null;
      const u = JSON.parse(raw);
      if (!u || typeof u !== 'object') return null;
      const name = String(u.name || '').trim();
      const email = String(u.email || '').trim();
      if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
      return { name, email };
    } catch (e) {
      return null;
    }
  }

  function saveUser(name, email) {
    const user = {
      name: String(name || '').trim(),
      email: String(email || '').trim(),
    };
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  }

  function clearUser() {
    localStorage.removeItem(USER_KEY);
  }

  function isLoggedIn() {
    return getUser() !== null;
  }

  function hideLogin() {
    const overlay = document.getElementById('d6-login-overlay');
    if (overlay) overlay.style.display = 'none';
  }

  function showLogin(options) {
    if (typeof options === 'function') {
      options = { onSuccess: options };
    }
    const opts = options || {};
    onSuccessCallback = opts.onSuccess || null;

    let overlay = document.getElementById('d6-login-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'd6-login-overlay';
      overlay.className = 'login-overlay';
      document.body.appendChild(overlay);
    }

    const existing = getUser();
    const title = opts.title || 'Welcome';
    const subtitle = opts.subtitle
      || 'Enter your name and email once — it stays signed in as you move between the field app and the progress dashboard.';

    overlay.style.display = 'flex';
    overlay.innerHTML = `
      <div class="login-card">
        <div class="badge">Fuel Cooler Project</div>
        <h1>${escapeHtml(title)}</h1>
        <p class="login-sub">${escapeHtml(subtitle)}</p>
        <label for="d6-login-name">Full name</label>
        <input type="text" id="d6-login-name" placeholder="Jane Smith" autocomplete="name"
          value="${existing ? escapeAttr(existing.name) : ''}" />
        <label for="d6-login-email">Email address</label>
        <input type="email" id="d6-login-email" placeholder="jane.smith@retailodyssey.com" autocomplete="email"
          value="${existing ? escapeAttr(existing.email) : ''}" />
        <button type="button" class="login-submit" id="d6-login-btn" disabled>Continue</button>
      </div>
    `;

    const nameInput = document.getElementById('d6-login-name');
    const emailInput = document.getElementById('d6-login-email');
    const btn = document.getElementById('d6-login-btn');

    function validate() {
      const nameOk = nameInput.value.trim().length >= 2;
      const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput.value.trim());
      btn.disabled = !(nameOk && emailOk);
    }

    function submit() {
      if (btn.disabled) return;
      saveUser(nameInput.value, emailInput.value);
      hideLogin();
      if (onSuccessCallback) onSuccessCallback(getUser());
    }

    nameInput.addEventListener('input', validate);
    emailInput.addEventListener('input', validate);
    btn.addEventListener('click', submit);
    emailInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !btn.disabled) submit(); });
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') emailInput.focus(); });
    validate();
    setTimeout(() => nameInput.focus(), 100);
  }

  function requireLogin(options) {
    if (isLoggedIn()) {
      if (options && options.onSuccess) options.onSuccess(getUser());
      return true;
    }
    showLogin(options);
    return false;
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeAttr(s) {
    return escapeHtml(s);
  }

  function getInitials(name) {
    return String(name || '')
      .split(/\s+/)
      .map(w => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }

  return {
    USER_KEY,
    getUser,
    saveUser,
    clearUser,
    isLoggedIn,
    showLogin,
    hideLogin,
    requireLogin,
    getInitials,
  };
})();
