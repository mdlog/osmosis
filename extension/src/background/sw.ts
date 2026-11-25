// Service worker: owns Firebase + Firebase AI Logic for the extension.
// Content scripts never talk to a model directly; they send sentences here.
import { firebase } from '../shared/ai';
import { getSettings } from '../shared/store';
import { createTranslator, ensureSeeded, onDeviceStatus } from '../shared/translate';
import type { TranslateRequest } from '../shared/types';

firebase('extension');

// Browsing text stays on this computer unless the learner explicitly allowed cloud fallback.
const { translate } = createTranslator(s => (s.cloudConsent ? 'prefer_on_device' : 'only_on_device'));

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  await chrome.storage.local.set({ settings: s });
  await ensureSeeded(s.lang, s.level);
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'osm:translate') {
    translate(msg as TranslateRequest).then(sendResponse);
    return true;
  }
  if (msg?.type === 'osm:status') {
    onDeviceStatus(msg.lang ?? 'es').then(sendResponse);
    return true;
  }
  return false;
});
