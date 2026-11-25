#!/usr/bin/env python3
"""Writes out/youtube.md: title, description and chapters (from out/timeline.json)."""
import json
import pathlib

OUT = pathlib.Path(__file__).resolve().parent / "out"
timeline = json.loads((OUT / "timeline.json").read_text())


def stamp(s):
    s = int(s)
    return f"{s // 60}:{s % 60:02d}"


chapters = "\n".join(f"{stamp(0 if i == 0 else row['startS'])} {row['chapter']}" for i, row in enumerate(timeline))
md = f"""# YouTube upload

**Title** (≤ 80 chars)

Osmosis: learn a language from the web you already read (Gemini Nano + Firebase AI Logic)

**Visibility:** Public. **Captions:** upload `osmosis-demo.srt` (English).

**Description**

Osmosis is a Chrome extension that turns the English pages you already read into a graded reader in Spanish, French, German or Japanese, at your CEFR level (A1 to B2).

Page text is rewritten on your computer by Gemini Nano through Firebase AI Logic (hybrid inference, ONLY_ON_DEVICE). The cloud (Gemini, Gemini TTS) is used only for jobs that need no page text: level word lists and a short podcast made from the words you peeked at. On our hosted demo article, browsers without Gemini Nano fall back to Gemini in the cloud (PREFER_ON_DEVICE).

Everything in this video is filmed live on real pages: a Wikipedia article translated on-device, the side panel, a podcast episode generated during the take, and the network check that records the extension's traffic while it translates.

Try the web demo: https://osmosis-hybrid.web.app
Code (Apache-2.0): https://github.com/mdlog/osmosis

Built for #BuildHybridAI 2026.

**Chapters**

{chapters}
"""
(OUT / "youtube.md").write_text(md)
print(md)
