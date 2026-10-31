/**
 * Plan-pass handoff between the site and the SnapX extension.
 *
 * The extension injects a content script that speaks window.postMessage:
 *   extension -> site: { snapx: 'ext', type: 'hello', iid, version, plan, exp, wantsPass }
 *   extension -> site: { snapx: 'ext', type: 'pass-result', ok, plan?, error? }
 *   site -> extension: { snapx: 'site', type: 'pass', token, connect }
 *   site -> extension: { snapx: 'site', type: 'ping' }
 *
 * Contract: docs/PLAN_PASS_CONTRACT.md §4.
 *
 * The Supabase client is imported lazily: the bridge runs on every page, but
 * the ~60 KB client must stay off the marketing critical path.
 */

const ORIGIN = window.location.origin;
const INSTALL_ID = /^[0-9a-f]{32}$/;
const HELLO_EVENT = 'snapx-connect-hello';
const RESULT_EVENT = 'snapx-connect-result';
const AUTO_RESEND_MS = 5000;

let extension = null;
let inFlight = false;
let lastAutoSend = 0;
let lastResult = null;
let forceNextSend = false;

function isFromExtension(event) {
  return (
    event.source === window &&
    event.origin === ORIGIN &&
    Boolean(event.data) &&
    typeof event.data === 'object' &&
    event.data.snapx === 'ext'
  );
}

function postToExtension(message) {
  window.postMessage({ snapx: 'site', ...message }, ORIGIN);
}

function connectRequested() {
  return new URLSearchParams(window.location.search).get('connect') === 'extension';
}

async function fetchPass(iid) {
  const { supabase } = await import('./lib/supabase.js');
  if (!supabase) return null;

  const { data: session } = await supabase.auth.getSession();
  if (!session?.session) return null;

  const { data, error } = await supabase.functions.invoke('entitlement', {
    body: { iid },
  });

  if (error) {
    if (Number(error?.context?.status) === 401) {
      const { hardSignOut } = await import('./lib/auth.js');
      await hardSignOut('ended');
    }
    return null;
  }

  if (typeof data?.token !== 'string' || !data.token.includes('.')) return null;
  return data;
}

function publishResult(result) {
  lastResult = result;
  document.dispatchEvent(new CustomEvent(RESULT_EVENT, { detail: result }));
}

/**
 * Ask the server for a pass and hand it to the extension.
 *
 * A pass is sent when the page asked for a connection, when the extension says
 * its pass is missing or near expiry, when the plan differs, or when the
 * server's expiry differs by more than a minute. The last case is what makes a
 * payment or a cancellation converge without a reload: cancelling removes the
 * renewal grace, so the expiry moves even when the plan name does not.
 *
 * When nothing needs sending the page still gets a result built from the
 * extension's hello. Silence used to look like a failed check and showed a red
 * error on the account page.
 */
async function sendPass({ connect = false, force = false } = {}) {
  if (!extension || !INSTALL_ID.test(extension.iid) || inFlight) return;
  if (!force && Date.now() - lastAutoSend < AUTO_RESEND_MS) return;

  inFlight = true;
  lastAutoSend = Date.now();

  try {
    const data = await fetchPass(extension.iid);
    if (!data) return;

    const serverExp = Number(data.exp) || 0;
    const planChanged = data.plan !== extension.plan;
    const expiryDrift =
      extension.exp > 0 && serverExp > 0 && Math.abs(serverExp - extension.exp) > 60;
    const mustSend = connect || force || extension.wantsPass || planChanged || expiryDrift;

    if (mustSend) {
      postToExtension({ type: 'pass', token: data.token, connect });
      return;
    }

    publishResult({
      ok: true,
      plan: extension.plan || data.plan,
      exp: extension.exp || serverExp,
      error: '',
    });
  } catch {
    // Network or session failure: the extension keeps its last pass, and the
    // next hello tries again. Never log the token or the error payload.
  } finally {
    inFlight = false;
  }
}

window.addEventListener('message', (event) => {
  if (!isFromExtension(event)) return;

  const data = event.data;

  if (data.type === 'hello') {
    extension = {
      iid: typeof data.iid === 'string' ? data.iid : '',
      version: data.version,
      plan: data.plan,
      exp: Number(data.exp) || 0,
      wantsPass: Boolean(data.wantsPass),
    };

    document.dispatchEvent(
      new CustomEvent(HELLO_EVENT, {
        detail: { ...extension },
      }),
    );

    if (connectRequested()) sendPass({ connect: true, force: true });
    else sendPass({ force: forceNextSend });
    forceNextSend = false;
    return;
  }

  if (data.type === 'pass-result') {
    publishResult({
      ok: Boolean(data.ok),
      plan: typeof data.plan === 'string' ? data.plan : '',
      exp: Number(data.exp) || 0,
      error: typeof data.error === 'string' ? data.error : '',
    });
  }
});

/**
 * Tell the extension to drop the plan on this computer and wait for its
 * acknowledgement. No extension means no reply, so the wait is always bounded.
 */
export function signOutExtension(timeout = 1500) {
  return new Promise((resolve) => {
    let settled = false;

    const finish = (ok) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve(ok);
    };

    const onMessage = (event) => {
      if (!isFromExtension(event)) return;
      if (event.data.type !== 'signout-result') return;
      finish(Boolean(event.data.ok));
    };

    const timer = window.setTimeout(() => finish(false), timeout);
    window.addEventListener('message', onMessage);
    postToExtension({ type: 'signout' });
  });
}

/** Drop per-page bridge state after a sign-out so a public page cannot reuse it. */
export function clearBridgeState() {
  extension = null;
  inFlight = false;
  lastAutoSend = 0;
  lastResult = null;
  forceNextSend = false;
}

/** True once the extension has said hello on this page. */
export function extensionReady() {
  return Boolean(extension);
}

/** The most recent answer from the extension, or null before the first one. */
export function lastPassResult() {
  return lastResult;
}

/**
 * Ask the extension to say hello again. The page must call this only after its
 * own message listener is attached: the content script may load after the page
 * script, so a ping sent at module evaluation can be missed.
 *
 * `force` is for a user-initiated retry: it bypasses the 5-second auto-send
 * throttle, so pressing "Check again" straight after a failed check asks for a
 * fresh pass instead of silently reusing the throttled one.
 */
export function pingExtension({ force = false } = {}) {
  if (force) forceNextSend = true;
  postToExtension({ type: 'ping' });
}

/** Re-send the current plan after a payment or plan change. */
export function requestPass(connect = false) {
  return sendPass({ connect, force: true });
}
