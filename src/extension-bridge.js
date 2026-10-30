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
let lastHelloAt = 0;

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

  if (error || typeof data?.token !== 'string' || !data.token.includes('.')) return null;
  return data;
}

/**
 * Ask the server for a pass and hand it to the extension.
 *
 * A pass is sent when the page asked for a connection, when the extension says
 * its pass is missing or near expiry, or when the server plan differs from the
 * plan the extension is showing. That last case is what makes a payment,
 * cancellation or plan change converge without a reload.
 */
async function sendPass({ connect = false, force = false } = {}) {
  if (!extension || !INSTALL_ID.test(extension.iid) || inFlight) return;
  if (!force && Date.now() - lastAutoSend < AUTO_RESEND_MS) return;

  inFlight = true;
  lastAutoSend = Date.now();

  try {
    const data = await fetchPass(extension.iid);
    if (!data) return;

    const changed = data.plan !== extension.plan;
    if (!connect && !force && !extension.wantsPass && !changed) return;

    postToExtension({ type: 'pass', token: data.token, connect });
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
    lastHelloAt = Date.now();
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
    else sendPass();
    return;
  }

  if (data.type === 'pass-result') {
    lastResult = {
      ok: Boolean(data.ok),
      plan: typeof data.plan === 'string' ? data.plan : '',
      exp: Number(data.exp) || 0,
      error: typeof data.error === 'string' ? data.error : '',
    };

    document.dispatchEvent(
      new CustomEvent(RESULT_EVENT, {
        detail: lastResult,
      }),
    );
  }
});

/** True once the extension has said hello on this page. */
export function extensionReady() {
  return Boolean(extension);
}

/** The extension's last hello, or null before the first one. */
export function extensionInfo() {
  return extension ? { ...extension, helloAt: lastHelloAt } : null;
}

/** The most recent answer from the extension, or null before the first one. */
export function lastPassResult() {
  return lastResult;
}

/**
 * Ask the extension to say hello again. The page must call this only after its
 * own message listener is attached: the content script may load after the page
 * script, so a ping sent at module evaluation can be missed.
 */
export function pingExtension() {
  postToExtension({ type: 'ping' });
}

/** Re-send the current plan after a payment or plan change. */
export function requestPass(connect = false) {
  return sendPass({ connect, force: true });
}
