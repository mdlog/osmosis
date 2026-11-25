// Web demo reader: the same Osmosis content script, running in the page itself.
// If the extension is installed it takes the page (private, on-device) and this script stays off.
import { prepare } from './host';
import { onDeviceStatus } from '../../extension/src/shared/translate';

(globalThis as { __OSM_WEB__?: boolean }).__OSM_WEB__ = true;

function note(onDevice: boolean) {
  const el = document.createElement('aside');
  el.className = 'osm-webnote';
  el.innerHTML = onDevice
    ? '<b>Osmosis web demo.</b> Your browser has an on-device model, so this article is translated on your computer.'
    : '<b>Osmosis web demo.</b> This browser has no on-device model, so this demo article (ours, not your browsing) is translated by Gemini in the cloud. The extension keeps your own reading on your device.';
  // The reCAPTCHA badge sits under the Osmosis dial, so the required notice is shown in text instead.
  el.insertAdjacentHTML('beforeend', ' <span class="osm-rc">Protected by reCAPTCHA: the Google <a href="https://policies.google.com/privacy">Privacy Policy</a> and <a href="https://policies.google.com/terms">Terms of Service</a> apply.</span>');
  document.body.prepend(el);
}

async function start() {
  if (document.documentElement.dataset.osmosis === 'ext') {
    console.log('[osmosis] extension present; the web reader stays off');
    return;
  }
  const s = await prepare();
  const status = await onDeviceStatus(s.lang);
  note(status === 'available');
  await import('../../extension/src/content/index');
}

// The extension's content script runs at document_idle (shortly after load); give it time to claim the page.
const later = () => setTimeout(start, 800);
if (document.readyState === 'complete') later();
else addEventListener('load', later);
