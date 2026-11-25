# Demo video pipeline

The [demo video](https://youtu.be/uLlINhcut5o) is produced by these scripts, not by a screen recorder.
It films the real extension in a real Chrome (Gemini Nano on the machine) on real pages, and it can be
re-shot in about 20 minutes.

The narration sets the timing. Each on-screen action waits for a phrase in the ElevenLabs word timings,
and each beat is held at least as long as its narration.

| Step | Script | What it does |
|---|---|---|
| 1 | `script.cjs` | Beats, layouts and narration text (the only copy of the words). |
| 2 | `tts.py` | ElevenLabs narration per beat with word timings (`out/audio/`). Fails if the total runs over 2:56. |
| 3 | `prep.cjs` | Checks that Gemini Nano is available and runs `npm run check:net` on a real Wikipedia page. Then resets the test profile to a fresh learner. |
| 4 | `record.cjs` | Drives Chrome over CDP and films each beat with `Page.startScreencast` (Wikipedia article, side panel, podcast, Japanese, ledger, hosted web demo in a browser without Nano). |
| 5 | `captions.py` | Writes captions from the spoken words (`.ass` burned in, `.srt` for upload). |
| 6 | `build.py` | Puts the segments together at 1080p30 with ffmpeg, mixes narration and podcast audio to -16 LUFS, and refuses anything over 3:00. |
| 7 | `verify.sh` | Checks what the narration claims against the take (0 network requests, 0 characters of page text, the podcast) and the UI strings against the source. |

`storage.cjs save|restore` keeps the test profile's own settings outside the take. Media goes to `out/` and `/var/tmp`, and is not committed.
