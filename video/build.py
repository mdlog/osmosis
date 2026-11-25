#!/usr/bin/env python3
"""Assembles the video: each beat's screencast frames (held to their real timestamps) become a
30 fps segment at 1920×1080, with the cards laid over it, the narration and any sound the app
made (the podcast episode); then the segments are joined and the captions burned in.
Refuses to emit anything over 3:00."""
import json
import pathlib
import shutil
import subprocess
import sys

VIDEO = pathlib.Path(__file__).resolve().parent
OUT = VIDEO / "out"
SEG = pathlib.Path("/var/tmp/osmosis-video/seg")
FINAL = OUT / "osmosis-demo.mp4"
LIMIT_S = 180.0
CARDS = OUT / "cards"


def ff(*args, cwd=None):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True, cwd=cwd)


def probe(path, entries="format=duration"):
    return subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", entries, "-of", "csv=p=0", str(path)], text=True).strip()


def concat_list(beat_dir, frames, seg_s, name):
    """ffconcat list: every frame lasts until the next one; the first starts at 0."""
    frames = [f for f in frames if f["t"] < seg_s]
    if not frames:
        sys.exit(f"{beat_dir.name}: no {name} frames")
    lines = ["ffconcat version 1.0"]
    for i, fr in enumerate(frames):
        start = 0.0 if i == 0 else max(0.0, fr["t"])
        end = seg_s + 0.1 if i + 1 == len(frames) else max(frames[i + 1]["t"], start + 0.001)
        lines.append(f"file '{beat_dir / fr['f']}'")
        lines.append(f"duration {end - start:.4f}")
    lines.append(f"file '{beat_dir / frames[-1]['f']}'")
    p = SEG / f"{beat_dir.name}-{name}.ffconcat"
    p.write_text("\n".join(lines) + "\n")
    return p


SCALE = "scale={w}:{h}:flags=lanczos:in_range=pc:out_range=tv,setsar=1,fps=30"


def build_segment(clip, audio_row):
    beat_dir = pathlib.Path(clip["dir"])
    rec = json.loads((beat_dir / "beat.json").read_text())
    seg_s = rec["segmentS"]
    layout = rec["layout"]
    inputs, filters = [], []

    def add_input(*a):
        inputs.extend(a)
        return sum(1 for x in inputs if x == "-i") - 1

    if layout == "card":
        k = add_input("-loop", "1", "-framerate", "30", "-t", f"{seg_s + 0.2}", "-i", str(CARDS / "end.png"))
        filters.append(f"[{k}:v]scale=1920:1080,setsar=1,format=yuv420p[base]")
    elif layout in ("full", "web"):
        k = add_input("-f", "concat", "-safe", "0", "-i", str(concat_list(beat_dir, rec["frames"]["main"], seg_s, "main")))
        filters.append(f"[{k}:v]{SCALE.format(w=1920, h=1080)}[base]")
    elif layout == "split":
        m = add_input("-f", "concat", "-safe", "0", "-i", str(concat_list(beat_dir, rec["frames"]["main"], seg_s, "main")))
        p = add_input("-f", "concat", "-safe", "0", "-i", str(concat_list(beat_dir, rec["frames"]["panel"], seg_s, "panel")))
        filters.append(f"[{m}:v]{SCALE.format(w=1440, h=1080)}[m]")
        filters.append(f"[{p}:v]{SCALE.format(w=480, h=1080)}[p]")
        # A hairline between the page and the side panel, as in Chrome.
        filters.append("[m][p]hstack=inputs=2,drawbox=x=1439:y=0:w=2:h=1080:color=0xd8d2c2:t=fill[base]")
    else:
        sys.exit(f"unknown layout {layout}")

    last = "base"
    for n, o in enumerate(rec.get("overlays", [])):
        k = add_input("-loop", "1", "-framerate", "30", "-t", f"{seg_s + 0.2}", "-i", str(CARDS / f"{o['name']}.png"))
        fade = o["fade"]
        chain = f"[{k}:v]format=rgba"
        if o["from"] > 0.05:
            chain += f",fade=t=in:st={o['from']}:d={fade}:alpha=1"
        if o["to"] < seg_s - 0.05:
            chain += f",fade=t=out:st={max(o['to'] - fade, 0)}:d={fade}:alpha=1"
        filters.append(chain + f"[o{n}]")
        filters.append(f"[{last}][o{n}]overlay=0:0:enable='between(t,{o['from']},{o['to']})'[v{n}]")
        last = f"v{n}"
    filters.append(f"[{last}]trim=duration={seg_s},setpts=PTS-STARTPTS,format=yuv420p[vout]")

    # Narration, plus sounds the app made during the beat (the podcast episode).
    d = audio_row["delayMs"]
    k = add_input("-i", str(OUT / "audio" / audio_row["mp3"]))
    filters.append(f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,adelay={d}|{d},apad,atrim=duration={seg_s}[nar]")
    mix = ["[nar]"]
    for n, s in enumerate(rec.get("sounds", [])):
        k = add_input("-i", s["file"])
        ms = int(s["t"] * 1000)
        length = seg_s - s["t"]
        filters.append(
            f"[{k}:a]aresample=48000,aformat=channel_layouts=stereo,loudnorm=I=-23:TP=-2,aresample=48000,atrim=duration={length:.3f},"
            f"afade=t=out:st={max(length - 0.8, 0):.3f}:d=0.8,volume=0.9,adelay={ms}|{ms},apad,atrim=duration={seg_s}[s{n}]"
        )
        mix.append(f"[s{n}]")
    if len(mix) > 1:
        filters.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first[aout]")
    else:
        filters.append("[nar]anull[aout]")

    out = SEG / f"{clip['id']}.mp4"
    ff(*inputs, "-filter_complex", ";".join(filters), "-map", "[vout]", "-map", "[aout]",
       "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", "30",
       "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-t", f"{seg_s}", str(out))
    got = float(probe(out))
    print(f"  {clip['id']:12} {layout:5} {seg_s:6.2f}s -> {got:6.2f}s")
    return out


def main():
    SEG.mkdir(parents=True, exist_ok=True)
    audio = {a["id"]: a for a in json.loads((OUT / "audio" / "index.json").read_text())}
    clips = json.loads((OUT / "clips.json").read_text())
    only = next((a.split("=", 1)[1] for a in sys.argv if a.startswith("--only=")), None)
    parts = []
    for clip in clips:
        out = SEG / f"{clip['id']}.mp4"
        if not only or only == clip["id"] or not out.exists():
            out = build_segment(clip, audio[clip["id"]])
        parts.append(out)
    lst = SEG / "list.txt"
    lst.write_text("".join(f"file '{p}'\n" for p in parts))
    concat = SEG / "concat.mp4"
    ff("-f", "concat", "-safe", "0", "-i", str(lst), "-c", "copy", str(concat))
    # Burn the captions from OUT, so the ass filter gets a plain relative path.
    shutil.copy(OUT / "captions.ass", SEG / "captions.ass")
    # Narration comes out of ElevenLabs near -22 LUFS; bring the mix to -16 LUFS for YouTube.
    ff("-i", "concat.mp4", "-vf", "ass=captions.ass", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
       "-c:v", "libx264", "-preset", "slow", "-crf", "18", "-pix_fmt", "yuv420p",
       "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-movflags", "+faststart", str(FINAL), cwd=SEG)
    shutil.copy(OUT / "captions.srt", FINAL.with_suffix(".srt"))
    total = float(probe(FINAL))
    ff("-i", str(FINAL), "-vf", "fps=1/5,scale=480:-1,tile=6x6", "-frames:v", "1", str(OUT / "contact.png"))
    size_mb = FINAL.stat().st_size / 1e6
    print(f"\n{FINAL}: {total:.1f}s, {probe(FINAL, 'stream=width,height,r_frame_rate').splitlines()[0]}, {size_mb:.1f} MB")
    if total > LIMIT_S:
        sys.exit(f"over 3:00 by {total - LIMIT_S:.1f}s: shorten the narration")
    print("ok: under 3:00. Contact sheet:", OUT / "contact.png")


if __name__ == "__main__":
    main()
