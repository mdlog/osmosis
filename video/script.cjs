// The single source of truth for the demo video's narration and beat timing. Nothing else under
// video/ contains narration. record.cjs holds the on-screen directions for each beat and anchors
// them to phrases in this text (checked against the TTS word timings).
//
// Every UI string the narration names was checked against extension/ and web/ (grep -rF):
// "Make today's episode", "Page text sent to the cloud", "in the cloud", "on this device".
const path = require('path');

const VIDEO_DIR = __dirname;
// Raw frames are large: they live on the big disk, the finished files in video/out.
const RAW_DIR = '/var/tmp/osmosis-video';
const OUT_DIR = path.join(VIDEO_DIR, 'out');

const ARTICLE = 'https://en.wikipedia.org/wiki/Coffee';
const NETCHECK_PAGE = 'https://en.wikipedia.org/wiki/Bicycle';
const WEB_DEMO = 'https://osmosis-hybrid.web.app/read/night-train';

/**
 * layout: 'full'  = the article tab fills the frame (1920×1080)
 *         'split' = article 1440 px + the Osmosis side panel 480 px on the right
 *         'web'   = a second browser with no on-device model (1920×1080)
 *         'card'  = a still card rendered from cards.html
 */
const BEATS = [
  {
    id: '01-intro',
    layout: 'full',
    minVisualMs: 30000,
    narrationDelayMs: 600,
    narration:
      "Osmosis is for people learning a language who already read the web in English. Apps teach words, but real reading stays out of reach: a page is either all English, or far too hard. Osmosis turns the page you are reading into a graded reader. This is a live Wikipedia article. Gemini Nano runs on this computer through Firebase AI Logic, and rewrites a share of the sentences into Spanish at my level, each one bringing in about one new word.",
  },
  {
    id: '02-hover',
    layout: 'full',
    minVisualMs: 17000,
    narrationDelayMs: 200,
    narration:
      'Hover a green sentence to see the original English, and what the new words mean. Lingering counts as a peek: a sign that this word is hard for you. Once you know a word, click it, and it stops counting as new.',
  },
  {
    id: '03-dial',
    layout: 'full',
    minVisualMs: 15000,
    narrationDelayMs: 200,
    narration:
      'One dial sets how much of the page is in Spanish. Turn it up, and sentences with more new words are let in. The model only translates; which sentences you see is decided in code, so nothing you are reading flips back to English.',
  },
  {
    id: '04-panel',
    layout: 'split',
    minVisualMs: 15000,
    narrationDelayMs: 200,
    narration:
      'The side panel keeps your words. The ones you peeked at become a podcast: Gemini in the cloud writes a short story at your level around them, and Gemini text-to-speech reads it aloud. Only the word list leaves the device.',
  },
  {
    id: '05-listen',
    layout: 'split',
    // The episode itself plays after this line (its audio is mixed in by build.py).
    minVisualMs: 11500,
    narrationDelayMs: 200,
    narration: "Here is today's episode.",
  },
  {
    id: '06-japanese',
    layout: 'split',
    minVisualMs: 20000,
    narrationDelayMs: 300,
    narration:
      'Switch to Japanese, and the same page comes back in Japanese, still on this device. Each level has its own word list, which Gemini builds in the cloud from just the language and the level. Your browsing never goes with it.',
  },
  {
    id: '07-privacy',
    layout: 'split',
    minVisualMs: 18000,
    narrationDelayMs: 200,
    narration:
      'What leaves the device is counted. The privacy ledger shows zero characters of page text sent to the cloud. And it is tested: our check translates a real page from an empty cache while it records the extension’s network traffic. Zero requests.',
  },
  {
    id: '08-hybrid',
    layout: 'web',
    minVisualMs: 15000,
    narrationDelayMs: 200,
    narration:
      'No Gemini Nano in your browser? On our hosted demo article, the same code runs in prefer on-device mode, and Firebase AI Logic falls back to Gemini in the cloud. In the extension, your own reading only does that if you switch it on.',
  },
  {
    id: '09-end',
    layout: 'card',
    minVisualMs: 11000,
    narrationDelayMs: 300,
    narration:
      'Osmosis. Gemini Nano on your device for everything you read, and Gemini in the cloud only for what never needed your pages. The links are in the description.',
  },
];

function narration() {
  return BEATS.map(b => ({ id: b.id, text: b.narration, delayMs: b.narrationDelayMs, minVisualMs: b.minVisualMs, layout: b.layout }));
}

module.exports = { BEATS, narration, VIDEO_DIR, RAW_DIR, OUT_DIR, ARTICLE, NETCHECK_PAGE, WEB_DEMO };

if (require.main === module && process.argv.includes('--narration')) {
  process.stdout.write(JSON.stringify(narration(), null, 2) + '\n');
}
if (require.main === module && process.argv.includes('--words')) {
  let n = 0;
  for (const b of BEATS) {
    const w = b.narration.split(/\s+/).length;
    n += w;
    console.log(`${b.id.padEnd(12)} ${String(w).padStart(3)} words`);
  }
  console.log(`total ${n} words`);
}
