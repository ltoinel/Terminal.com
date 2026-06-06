---
name: msg
desc: notify me — e.g. msg hi! (owner: msg --subscribe <key>)
man: |
  # MSG(1)

  ## NAME
  msg — send a notification to Me

  ## SYNOPSIS
  msg <message>
  msg --subscribe <key>

  ## DESCRIPTION
  Sends a short message delivered to me as a Web Push notification,
  wherever I am. No sign-up is needed to write; a rate limit applies to
  prevent abuse.

  The --subscribe option is owner-only: it registers the current
  browser as a recipient of the messages (requires the secret key and
  notification permission).

  ## OPTIONS
  --subscribe <key>   subscribe this browser (owner)

  ## EXAMPLES
  msg hi, I love your terminal!
  msg --subscribe ******

  ## SEE ALSO
  whoami, open
js: |
  // VAPID public key (safe to expose). Must match push.config.php on the server.
  const VAPID_PUBLIC_KEY = 'BPu1xBZG_NjxxEb6JkWsDw1x4V66tmECdwnW_akjAlCRsahtG0GXbTw1XHZA0Z8_mOLQhbpMeIOeufGd81du9Jk';
  const args = ctx.args.slice();

  // base64url VAPID key -> Uint8Array (applicationServerKey for PushManager).
  const keyToBytes = (b64) => {
    const pad = '='.repeat((4 - (b64.length % 4)) % 4);
    const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  };

  // ---- owner: register THIS browser as a recipient (msg --subscribe <key>) ----
  if (args[0] === '--subscribe' || args[0] === '--register') {
    const secret = (args[1] || '').trim();
    if (!secret) { ctx.error('usage: msg --subscribe <key>'); return; }
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      ctx.error('msg: Web Push not supported by this browser'); return;
    }
    try {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') { ctx.error('msg: notification permission denied'); return; }
      ctx.line('registering this browser …');
      const reg = await navigator.serviceWorker.register('/sw.js');
      await navigator.serviceWorker.ready;
      // Drop any stale subscription (e.g. left over from a previous VAPID key).
      const old = await reg.pushManager.getSubscription();
      if (old) await old.unsubscribe().catch(() => {});
      let sub;
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY),
        });
      } catch (err) {
        // The browser could not register with its push service (often Brave, or a
        // firewall / VPN blocking Google FCM). Surface actionable hints.
        ctx.error(`msg: subscription refused by the browser — ${err.message || err.name}`);
        ctx.line('Brave: brave://settings/privacy → enable "Use Google services for push messaging", then try again.');
        ctx.line('Otherwise, check that a firewall / VPN is not blocking the push service (FCM).');
        return;
      }
      const res = await fetch('/api/push.php?action=subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret, subscription: sub.toJSON() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        ctx.append('<div class="ln"><span class="accent text-glow">✓ this browser will now receive messages</span></div>');
      } else {
        ctx.error(`msg: registration refused — ${data.error || 'HTTP ' + res.status}`);
      }
    } catch (e) {
      ctx.error(`msg: ${e.message || e.name}`);
    }
    return;
  }

  // ---- anyone: send a message, delivered to Ludovic's browser via Web Push ----
  const text = args.join(' ').trim();
  if (!text) { ctx.error('usage: msg <message>'); return; }
  ctx.line('sending message …');
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    if (ctx.signal) ctx.signal.addEventListener('abort', () => ctrl.abort()); // Ctrl+C
    const res = await fetch('/api/push.php?action=send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'msg=' + encodeURIComponent(text),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      const note = data.sent > 0 ? '✓ message delivered to Ludovic' : '✓ message sent';
      ctx.append(`<div class="ln"><span class="accent text-glow">${note}</span></div>`);
    } else if (res.status === 429) {
      ctx.error(`msg: slow down — try again in ${data.retry_after || 10} s`);
    } else {
      ctx.error(`msg: failed — ${data.error || 'HTTP ' + res.status}`);
    }
  } catch (e) {
    ctx.error(`msg: service unavailable (${e.message || e.name})`);
  }
---
