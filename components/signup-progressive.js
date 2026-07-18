/**
 * AGSIST Progressive Signup Disclosure
 * ─────────────────────────────────────
 * Drop this block into index.html's page <script> section.
 * Replace the existing signup show/hide logic.
 *
 * Behavior:
 *   Visits 1–3  → Full signup card (current design, high visibility)
 *   Visits 4–6  → Compact inline bar (email + submit, no headline/image)
 *   Visits 7+   → Hidden entirely
 *   Subscribed  → Always hidden (cookie agsist_subscribed=1)
 *
 * v2: SMS tab removed until SMS delivery pipeline is live.
 *     Phone numbers collected via Formspree were never delivered —
 *     tab is hidden to avoid misleading users. Re-enable by uncommenting
 *     the SMS_ENABLED block below once Resend/Twilio is wired up.
 *
 * Session tracking:
 *   localStorage 'agsist-vc'  = total visit count
 *   sessionStorage 'agsist-vs' = has this session been counted?
 */
(function initSignup() {
  var SIGNUP_EL = document.getElementById('signup-section');
  if (!SIGNUP_EL) return;

  // ── Hide SMS tab until delivery pipeline exists ──────────────
  // SMS signups collected via Formspree were emailed to admin but
  // never actually delivered as texts. Hide the tab until Resend/Twilio
  // is configured. To re-enable: remove this block.
  var smsTabs = SIGNUP_EL.querySelectorAll('[data-tab="sms"], .signup-tab[onclick*="sms"]');
  smsTabs.forEach(function(tab) { tab.style.display = 'none'; });
  var smsPanel = document.getElementById('sms-panel') || SIGNUP_EL.querySelector('[id*="sms"]');
  if (smsPanel) smsPanel.style.display = 'none';
  // ── End SMS block ────────────────────────────────────────────

  // Check subscribed cookie
  function getCookie(name) {
    var m = document.cookie.match('(?:^|;)\\s*' + name + '=([^;]*)');
    return m ? decodeURIComponent(m[1]) : null;
  }
  if (getCookie('agsist_subscribed') === '1') {
    SIGNUP_EL.classList.add('signup--hidden');
    return;
  }

  // Count visits (once per browser session)
  var visited = false;
  try { visited = !!sessionStorage.getItem('agsist-vs'); } catch(e) {}
  var count = 0;
  try { count = parseInt(localStorage.getItem('agsist-vc') || '0', 10) || 0; } catch(e) {}

  if (!visited) {
    count++;
    try { localStorage.setItem('agsist-vc', count); } catch(e) {}
    try { sessionStorage.setItem('agsist-vs', '1'); } catch(e) {}
  }

  // Apply display logic
  if (count >= 7) {
    SIGNUP_EL.classList.add('signup--hidden');
  } else if (count >= 4) {
    SIGNUP_EL.classList.add('signup--compact');
    var form = SIGNUP_EL.querySelector('.signup-form');
    if (form && !SIGNUP_EL.querySelector('.signup--compact-label')) {
      var lbl = document.createElement('span');
      lbl.className = 'signup--compact-label';
      lbl.textContent = '📬 Free Daily';
      form.parentNode.insertBefore(lbl, form);
    }
  }

  function markSubscribed() {
    var exp = new Date(Date.now() + 365*24*60*60*1000).toUTCString();
    document.cookie = 'agsist_subscribed=1;expires=' + exp + ';path=/;SameSite=Lax';
    try { localStorage.setItem('agsist-vc', '99'); } catch(e) {}
    setTimeout(function() {
      SIGNUP_EL.style.transition = 'max-height .5s, opacity .5s, padding .5s, margin .5s';
      SIGNUP_EL.style.maxHeight  = SIGNUP_EL.offsetHeight + 'px';
      SIGNUP_EL.offsetHeight;
      SIGNUP_EL.style.maxHeight  = '0';
      SIGNUP_EL.style.opacity    = '0';
      SIGNUP_EL.style.padding    = '0';
      SIGNUP_EL.style.marginBottom = '0';
      setTimeout(function() { SIGNUP_EL.classList.add('signup--hidden'); }, 520);
    }, 2200);
  }

  // Email form
  var emailForm = document.getElementById('email-form');
  var emailSucc = document.getElementById('email-success');

  if (emailForm) {
    emailForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var email = (emailForm.querySelector('input[type="email"]') || {}).value;
      if (!email) return;
      var btn = emailForm.querySelector('.signup-submit');
      if (btn) btn.textContent = 'Subscribing…';
      fetch('https://agsist-subs.dnilgis.workers.dev/subscribe', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email, _subject: 'AGSIST Daily Email Signup' })
      }).then(function() {
        if (emailSucc) { emailSucc.style.display = 'block'; emailForm.style.display = 'none'; }
        markSubscribed();
      }).catch(function() {
        if (btn) btn.textContent = 'Try Again';
      });
    });
  }

  // SMS form intentionally removed — no delivery pipeline yet.
  // Re-enable when Resend/Twilio is configured.

})();
