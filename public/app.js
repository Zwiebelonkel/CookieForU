(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const apiBase = new URL(document.querySelector('meta[name="cookie-api"]').content.trim() || location.origin).origin;
  const output = $('cookie-id');
  const status = $('status');
  const eat = $('eat');
  const share = $('share');
  const certificate = $('certificate');
  const retry = $('retry');
  let cookie = null;
  let ownerToken = null;
  let pendingToken = null;
  let busy = false;
  let generation = 0;

  function readToken(id) { try { return localStorage.getItem('cookie-owner:' + id); } catch { return null; } }
  function rememberToken(id, token) { try { localStorage.setItem('cookie-owner:' + id, token); } catch { /* Ownership works in this tab until closed. */ } }
  function rarityFor(streak) { return streak >= 7 ? 'mythic' : streak === 6 ? 'legendary' : streak === 5 ? 'epic' : streak === 4 ? 'rare' : streak === 3 ? 'uncommon' : 'common'; }

  async function request(path, options = {}) {
    const response = await fetch(apiBase + path, {
      ...options,
      cache: 'no-store',
      signal: AbortSignal.timeout(60_000),
      headers: { ...options.headers, ...(options.body ? { 'Content-Type': 'application/json' } : {}) }
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Please try again.');
      error.status = response.status;
      throw error;
    }
    return data.cookie;
  }

  function render() {
    eat.disabled = busy || !cookie || !ownerToken || cookie.bites === 3;
    share.disabled = busy || !cookie || cookie.bites === 3;
    certificate.hidden = !cookie;
    if (!cookie) return;
    const fragment = document.createDocumentFragment();
    for (const run of cookie.remainingHash.match(/(.)\1*/g) || []) {
      if (run.length >= 2) {
        const mark = document.createElement('mark');
        mark.textContent = run;
        mark.dataset.level = rarityFor(run.length);
        mark.title = `${run.length} identical characters in a row`;
        fragment.append(mark);
      } else fragment.append(document.createTextNode(run));
    }
    output.replaceChildren(fragment);
    const gone = cookie.bites === 3;
    $('cookie-face').dataset.bites = String(cookie.bites);
    $('cookie').classList.toggle('eaten', gone);
    $('cookie').setAttribute('aria-label', gone ? 'Cookie eaten' : `Cookie, ${cookie.bitesRemaining} bites remaining`);
    $('rarity').textContent = gone ? '' : cookie.rarity;
    $('rarity').dataset.level = gone ? '' : cookie.rarity;
    $('rarity').title = `${cookie.rarityProbabilityPercent}% · longest original run: ${cookie.maxStreak}`;
    $('message').textContent = gone ? 'This cookie is gone. You ate it.' : 'This cookie is only supposed to be for you.';
    eat.textContent = gone ? 'Gone' : cookie.bites ? 'Take another bite' : 'Eat cookie';
    eat.title = ownerToken ? '' : 'Only the original owner can eat this cookie.';
    certificate.href = cookie.certificateUrl;
    try {
      document.cookie = `your_cookie=${gone ? '' : cookie.remainingHash}; Path=/; Max-Age=${gone ? 0 : 31536000}; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch { /* The official state is stored by the server. */ }
  }

  async function initialize() {
    const current = ++generation;
    cookie = null;
    ownerToken = null;
    busy = true;
    output.textContent = '';
    $('rarity').textContent = '';
    $('cookie-face').dataset.bites = '0';
    $('cookie').classList.remove('eaten');
    retry.hidden = true;
    status.textContent = 'Baking your cookie…';
    render();
    try {
      const sharedId = new URL(location.href).searchParams.get('cookie');
      let result;
      if (sharedId !== null) {
        if (!/^[0-9a-f]{64}$/i.test(sharedId)) throw new Error('This cookie link is invalid.');
        result = await request('/api/cookies/' + sharedId.toLowerCase());
        if (current !== generation) return;
        ownerToken = readToken(result.id);
      } else {
        // Keep the same pending secret when retrying a timed-out issuance.
        if (!pendingToken) {
          pendingToken = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
        }
        const token = pendingToken;
        result = await request('/api/cookies', { method: 'POST', body: JSON.stringify({ ownerToken: token }) });
        if (current !== generation) return;
        ownerToken = token;
        rememberToken(result.id, token);
        pendingToken = null;
      }
      cookie = result;
      status.textContent = cookie.bites === 3 ? 'Only crumbs remain.' : ownerToken ? '' : 'A shared cookie. Only its owner can take a bite.';
    } catch (error) {
      if (current !== generation) return;
      status.textContent = error.name === 'TimeoutError' ? 'The oven is still warming up. Please try again.' : error.message;
      retry.hidden = false;
    } finally {
      if (current === generation) { busy = false; render(); }
    }
  }

  async function refresh() {
    if (!cookie || busy || document.hidden) return;
    const id = cookie.id;
    const current = generation;
    try {
      const latest = await request('/api/cookies/' + id);
      if (cookie?.id === id && generation === current && !busy && latest.bites >= cookie.bites) {
        cookie = latest;
        render();
        if (cookie.bites === 3) status.textContent = 'Only crumbs remain.';
      }
    } catch { /* The next action will check the server again. */ }
  }

  eat.addEventListener('click', async () => {
    if (!cookie || !ownerToken || busy || cookie.bites === 3) return;
    const current = generation;
    const id = cookie.id;
    busy = true;
    status.textContent = '';
    render();
    try {
      const result = await request(`/api/cookies/${id}/bite`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + ownerToken },
        body: JSON.stringify({ expectedBites: cookie.bites })
      });
      if (current !== generation) return;
      cookie = result;
      status.textContent = cookie.bites === 3 ? 'Only crumbs remain.' : `${cookie.bitesRemaining} ${cookie.bitesRemaining === 1 ? 'bite' : 'bites'} left.`;
    } catch (error) {
      if (current !== generation) return;
      // A lost response is not a reason to take another bite automatically.
      try { cookie = await request('/api/cookies/' + id); } catch { /* Keep last known state. */ }
      if (current !== generation) return;
      status.textContent = error.status === 409 ? 'Cookie refreshed. A bite was already applied, or this browser is not the owner.' : 'Connection interrupted. Check the current cookie before trying again.';
    } finally {
      if (current === generation) { busy = false; render(); }
    }
  });

  share.addEventListener('click', async () => {
    if (!cookie || busy || cookie.bites === 3) return;
    const current = generation;
    const url = cookie.shareUrl;
    busy = true;
    render();
    const copy = async () => {
      try { await navigator.clipboard.writeText(url); if (current === generation) status.textContent = 'Link copied.'; }
      catch { window.prompt('Copy your cookie link:', url); }
    };
    try {
      if (navigator.share) {
        try { await navigator.share({ title: 'A cookie for you 🍪', text: 'This cookie is only supposed to be for you.', url }); }
        catch (error) { if (error.name !== 'AbortError') await copy(); }
      } else await copy();
    } finally { if (current === generation) { busy = false; render(); } }
  });

  retry.addEventListener('click', initialize);
  window.addEventListener('pageshow', event => { if (event.persisted) { pendingToken = null; initialize(); } });
  document.addEventListener('visibilitychange', refresh);
  setInterval(refresh, 15_000);
  initialize();
})();
