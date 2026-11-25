#!/usr/bin/env bash
# Checks before the video is sent anywhere. Exits non-zero on the first failure.
set -euo pipefail
cd "$(dirname "$0")"
MP4=out/osmosis-demo.mp4
echo "1. streams + duration (≤ 3:00, 1080p30, audio)"
ffprobe -v error -show_entries stream=codec_type,codec_name,width,height,r_frame_rate:format=duration -of csv=p=0 "$MP4"
dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$MP4")
python3 -c "import sys; d=float('$dur'); print(f'   {d:.1f}s'); sys.exit(0 if d <= 180 else 1)"
echo "2. caption cues (ass == srt)"
python3 - <<'PY'
import sys
a = open("out/captions.ass").read().count(",Cap,")
b = open("out/osmosis-demo.srt").read().count("-->")
print(f"   ass={a} srt={b}"); sys.exit(0 if a == b and a > 0 else 1)
PY
echo "3. what the narration claims, against the take"
python3 - <<'PY'
import json, subprocess, sys
t = json.load(open("out/take.json"))
n = {b["id"]: b["text"] for b in json.loads(subprocess.check_output(["node", "script.cjs", "--narration"], text=True))}
ok = True
def check(cond, msg):
    global ok
    print("   ", "ok  " if cond else "FAIL", msg); ok &= bool(cond)
check(t["netcheck"]["key"] == "service-worker network requests during translation: 0" and "Zero requests" in n["07-privacy"], "network check: 0 service-worker requests")
check("capture working (control seen): true" in t["netcheck"]["lines"], "network check positive control seen")
check(t["ledger"][0] == "0 characters" and "zero characters of page text" in n["07-privacy"], f"ledger page text: {t['ledger'][0]}")
check(len(t.get("peeks", [])) >= 3, f"peeked words before the podcast: {', '.join(t.get('peeks', []))}")
check(t.get("podcast", {}).get("title"), f"podcast episode: {t.get('podcast', {}).get('title')}")
print("     info hybrid-beat browser: typeof LanguageModel =", t.get("webLanguageModel"))
sys.exit(0 if ok else 1)
PY
echo "4. every UI string the narration leans on exists in the source"
for s in "Make today's episode" "Page text sent to the cloud" "in the cloud" "on this device" "Your reading, as a podcast"; do
  grep -rqF -- "$s" ../extension ../web/src && echo "   ok   $s" || { echo "   FAIL $s"; exit 1; }
done
echo "5. the Chrome profile was given back"
if [ -f /var/tmp/osmosis-storage.before-video.json ]; then echo "   not yet: node video/storage.cjs restore"; exit 1; else echo "   ok (restored)"; fi
echo "6. nothing large staged in git"
if git -C .. status --short | grep -E "\.(mp4|webm|mp3|wav|jpg)$"; then echo "   media staged!"; exit 1; else echo "   ok"; fi
echo "all checks passed"
