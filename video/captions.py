#!/usr/bin/env python3
"""Burned-in captions (ASS) and the upload SRT from the ElevenLabs word timings, plus a small
chip naming the real page on screen. Uses each beat's filmed length from out/clips.json (the
recorder can hold a beat past its narration while live translation finishes), and writes
out/timeline.json for build.py and the YouTube chapters."""
import json
import pathlib

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out"

CHAPTERS = {
    "01-intro": "A live Wikipedia article, translated on this computer",
    "02-hover": "Hover, peek, mark a word as known",
    "03-dial": "The dial: how much of the page is Spanish",
    "04-panel": "Side panel: your words become a podcast",
    "05-listen": "Today's episode (Gemini + Gemini TTS)",
    "06-japanese": "Same page in Japanese, still on-device",
    "07-privacy": "Privacy ledger and the network check",
    "08-hybrid": "No Gemini Nano: cloud fallback on the demo article",
    "09-end": "What runs where",
}


def cues(words, offset_s, max_chars=44, max_lines=2, min_s=1.2):
    """Fill a line to max_chars and a cue to max_lines; always end a cue at . ? ! or :"""
    out, lines, cur, start, prev_end = [], [], "", None, 0.0

    def flush(end):
        nonlocal lines, start
        if lines:
            out.append({"start": start, "end": end, "text": "\\N".join(lines)})
        lines, start = [], None

    for w in words:
        t = w["text"]
        if start is None:
            start = offset_s + w["start"]
        if cur and len(cur) + 1 + len(t) > max_chars:
            lines.append(cur)
            cur = ""
            if len(lines) == max_lines:
                flush(offset_s + prev_end)
                start = offset_s + w["start"]
        cur = (cur + " " + t).strip()
        prev_end = w["end"]
        if t.endswith((".", "?", "!", ":")):
            lines.append(cur)
            cur = ""
            flush(offset_s + prev_end)
    if cur:
        lines.append(cur)
    flush(offset_s + prev_end)
    for i, c in enumerate(out):
        nxt = out[i + 1]["start"] if i + 1 < len(out) else float("inf")
        c["end"] = max(c["end"], min(c["start"] + min_s, nxt))
    return out


def ass_time(s):
    h, rem = divmod(max(s, 0), 3600)
    m, sec = divmod(rem, 60)
    return f"{int(h)}:{int(m):02d}:{sec:05.2f}"


def srt_time(s):
    ms = int(round(max(s, 0) * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    sec, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{sec:02d},{ms:03d}"


# libass draws the BorderStyle 3 box in OutlineColour, padded by Outline px.
HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1920
PlayResY: 1080
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,Inter,40,&H00FFFFFF,&H00FFFFFF,&H33182310,&H00000000,0,0,0,0,100,100,0,0,3,14,0,2,260,260,58,1
Style: Chip,DejaVu Sans Mono,23,&H00EAF5EF,&H00FFFFFF,&H40182310,&H00000000,0,0,0,0,100,100,0,0,3,9,0,7,30,0,26,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def main():
    audio = {a["id"]: a for a in json.loads((OUT / "audio" / "index.json").read_text())}
    clips = json.loads((OUT / "clips.json").read_text())
    timeline, events, srt, t = [], [], [], 0.0
    for clip in clips:
        row = audio[clip["id"]]
        seg = clip["segmentS"]
        words = json.loads((OUT / "audio" / row["words"]).read_text())
        for c in cues(words, t + row["delayMs"] / 1000):
            # In the split layout the dial pill sits under the centre line: lift the caption above it.
            mv = 150 if clip.get("layout") == "split" else 0
            events.append(f"Dialogue: 0,{ass_time(c['start'])},{ass_time(c['end'])},Cap,,0,0,{mv},,{c['text']}")
            srt.append((c["start"], c["end"], c["text"].replace("\\N", "\n")))
        # Page chip: not while a full-frame card (title, terminal) covers the page.
        covered = [(o["from"], o["to"]) for o in clip.get("overlays", [])]
        routes = clip.get("routes", [])
        for i, r in enumerate(routes):
            a = r["t"]
            b = routes[i + 1]["t"] if i + 1 < len(routes) else seg
            for f, to in covered:
                if f <= a < to:
                    a = to
                if a < f < b:
                    b = f
            if b - a > 0.5:
                events.append(f"Dialogue: 1,{ass_time(t + a)},{ass_time(t + b)},Chip,,0,0,0,,{r['label']}")
        timeline.append({"id": clip["id"], "startS": round(t, 3), "segmentS": seg, "chapter": CHAPTERS.get(clip["id"], clip["id"])})
        t += seg
    (OUT / "captions.ass").write_text(HEADER + "\n".join(events) + "\n")
    (OUT / "captions.srt").write_text("".join(f"{i}\n{srt_time(a)} --> {srt_time(b)}\n{x}\n\n" for i, (a, b, x) in enumerate(srt, 1)))
    (OUT / "timeline.json").write_text(json.dumps(timeline, indent=1))
    print(f"{len(srt)} cues, total {t:.1f}s -> captions.ass / captions.srt / timeline.json")


if __name__ == "__main__":
    main()
