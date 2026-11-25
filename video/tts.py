#!/usr/bin/env python3
"""Narration with ElevenLabs, one MP3 per beat, with word timings for captions and for anchoring
on-screen actions (the /with-timestamps endpoint returns per-character alignment).

The API key is read from ~/.config/elevenlabs/env and never printed. A beat is only
re-synthesised when its text or the voice settings change, so edits cost credits for the
changed beats only.

Length rule: the whole video must stay under 3:00. If the planned total is over LIMIT_S at
speed 1.0, render again at 1.06; still over -> stop and shorten the script.

    python3 video/tts.py               # synthesise what changed, write out/audio/index.json
    python3 video/tts.py --timing-only # recompute segment lengths after a minVisualMs change
"""
import base64
import hashlib
import json
import os
import pathlib
import subprocess
import sys
import urllib.request

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out" / "audio"
VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2"  # "Alice", ElevenLabs premade: clear British educator
MODEL = "eleven_multilingual_v2"
SETTINGS = {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True}
GAP_S = 0.5
LIMIT_S = 176.0  # leaves room for holds the recorder adds while live translation finishes


def api_key():
    for line in (pathlib.Path.home() / ".config/elevenlabs/env").read_text().splitlines():
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("ELEVENLABS_API_KEY not found in ~/.config/elevenlabs/env")


def narration():
    raw = subprocess.check_output(["node", str(VIDEO / "script.cjs"), "--narration"], text=True)
    return json.loads(raw)


def duration_s(path):
    out = subprocess.check_output(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)], text=True
    )
    return float(out.strip())


def segment_seconds(audio_s, delay_ms, min_visual_ms):
    return max(audio_s + delay_ms / 1000 + GAP_S, min_visual_ms / 1000)


def words_from_alignment(al):
    """Group the per-character alignment into words (text keeps its punctuation)."""
    words, cur, start, end = [], "", None, None
    for ch, s, e in zip(al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]):
        if ch.isspace():
            if cur:
                words.append({"start": start, "end": end, "text": cur})
            cur, start = "", None
            continue
        if start is None:
            start = s
        cur += ch
        end = e
    if cur:
        words.append({"start": start, "end": end, "text": cur})
    return words


def synth(key, text, speed, prev_text, next_text):
    body = {
        "text": text,
        "model_id": MODEL,
        "voice_settings": {**SETTINGS, "speed": speed},
        # Context from the neighbouring beats keeps the intonation continuous across files.
        "previous_text": prev_text or None,
        "next_text": next_text or None,
    }
    req = urllib.request.Request(
        f"https://api.elevenlabs.io/v1/text-to-speech/{VOICE_ID}/with-timestamps?output_format=mp3_44100_128",
        data=json.dumps(body).encode(),
        headers={"xi-api-key": key, "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.load(r)
    return base64.b64decode(d["audio_base64"]), d["alignment"]


def render(speed):
    OUT.mkdir(parents=True, exist_ok=True)
    beats = narration()
    key = None
    index = []
    for i, beat in enumerate(beats):
        base = beat["id"]
        mp3, words_f, meta_f = OUT / f"{base}.mp3", OUT / f"{base}.words.json", OUT / f"{base}.meta.json"
        prev_text = beats[i - 1]["text"] if i else ""
        next_text = beats[i + 1]["text"] if i + 1 < len(beats) else ""
        h = hashlib.sha256(json.dumps([beat["text"], VOICE_ID, MODEL, SETTINGS, speed, prev_text, next_text]).encode()).hexdigest()[:16]
        cached = meta_f.exists() and json.loads(meta_f.read_text()).get("hash") == h and mp3.exists()
        if not cached:
            key = key or api_key()
            audio, al = synth(key, beat["text"], speed, prev_text, next_text)
            mp3.write_bytes(audio)
            words_f.write_text(json.dumps(words_from_alignment(al), indent=1, ensure_ascii=False))
            meta_f.write_text(json.dumps({"hash": h, "chars": len(beat["text"])}))
        audio_s = duration_s(mp3)
        seg = segment_seconds(audio_s, beat["delayMs"], beat["minVisualMs"])
        index.append({
            "id": base, "mp3": mp3.name, "words": words_f.name, "delayMs": beat["delayMs"],
            "minVisualMs": beat["minVisualMs"], "layout": beat["layout"],
            "audioS": round(audio_s, 3), "segmentS": round(seg, 3), "speed": speed,
        })
        print(f"  {base:12} {audio_s:6.2f}s speech -> {seg:6.2f}s segment{'' if not cached else '  (cached)'}")
    return index


def main():
    if "--timing-only" in sys.argv:
        index = json.loads((OUT / "index.json").read_text())
        by_id = {b["id"]: b for b in narration()}
        for row in index:
            b = by_id[row["id"]]
            row["delayMs"], row["minVisualMs"] = b["delayMs"], b["minVisualMs"]
            row["segmentS"] = round(segment_seconds(row["audioS"], b["delayMs"], b["minVisualMs"]), 3)
        (OUT / "index.json").write_text(json.dumps(index, indent=1))
        print(f"total {sum(r['segmentS'] for r in index):.1f}s")
        return
    speed = 1.0
    while True:
        print(f"rendering at speed {speed}")
        index = render(speed)
        total = sum(r["segmentS"] for r in index)
        print(f"total {total:.1f}s (limit {LIMIT_S:.0f}s)")
        if total <= LIMIT_S:
            break
        if speed == 1.0:
            speed = 1.06
            continue
        sys.exit("still over the limit at 1.06: shorten the narration in video/script.cjs")
    (OUT / "index.json").write_text(json.dumps(index, indent=1))
    print("wrote", OUT / "index.json")


if __name__ == "__main__":
    main()
