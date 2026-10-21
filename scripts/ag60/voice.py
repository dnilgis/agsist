#!/usr/bin/env python3
"""Ag in 60: read the script aloud and put the plan on the voice's clock.

    python3 scripts/ag60/voice.py --out DIR [--voice af_heart] [--model M.onnx --voices V.bin]

Reads DIR/plan.json (build_plan.py). Speaks each line on its own with the
open Kokoro-82M model (Apache 2.0 weights, kokoro-onnx package, runs on the
CPU of a GitHub runner, no key, no per-use cost), trims the silence at both
ends, and if the whole read would run past 59.5 seconds reads it again a
little faster (never past 1.3x). Then it re-times the scenes and captions to
the real audio and writes DIR/voice.wav, DIR/plan.json (timed_by: voice),
DIR/captions.srt and DIR/captions.vtt.

No model files or package: it writes a silent track on the estimated clock
and marks the plan timed_by: estimate, so the rest of the pipeline still runs.
"""
import argparse
import json
import os
import sys
import types
import wave

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_plan  # noqa: E402

LIMIT = 59.5
SR_OUT = 24000


def trim(samples, sr, thresh=0.01, pad=0.04):
    import numpy as np
    a = np.abs(samples)
    idx = np.where(a > thresh)[0]
    if not len(idx):
        return samples
    lo = max(0, idx[0] - int(pad * sr))
    hi = min(len(samples), idx[-1] + int(pad * sr))
    return samples[lo:hi]


def speak_all(kokoro, beats, voice, speed):
    out = {}
    for b in beats:
        s, sr = kokoro.create(b["say"], voice=voice, speed=speed, lang="en-us")
        out[b["id"]] = (trim(s, sr), sr)
    return out


def total_for(plan, durs):
    beats = plan["beats"]
    return sum(durs[b["id"]] + build_plan.GAP for b in beats) + build_plan.END_CARD


def write_wav(path, plan, audio):
    import numpy as np
    sr = next(iter(audio.values()))[1]
    parts = []
    for b in plan["beats"]:
        s, _ = audio[b["id"]]
        start = int(round(b["voice_start"] * sr))
        cur = sum(len(x) for x in parts)
        if start > cur:
            parts.append(np.zeros(start - cur, dtype=np.float32))
        parts.append(s.astype(np.float32))
    end = int(round(plan["total"] * sr))
    cur = sum(len(x) for x in parts)
    if end > cur:
        parts.append(np.zeros(end - cur, dtype=np.float32))
    pcm = np.concatenate(parts)
    peak = float(np.max(np.abs(pcm))) or 1.0
    pcm = (pcm / peak * 0.89 * 32767).astype(np.int16)        # about -1 dBFS peak
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm.tobytes())


def write_silence(path, seconds, sr=SR_OUT):
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(b"\0\0" * int(seconds * sr))


def vtt(caps):
    def ts(x):
        ms = int(round(x * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d}.{ms % 1000:03d}"
    return "WEBVTT\n\n" + "\n".join(f"{ts(c['start'])} --> {ts(c['end'])}\n{c['text']}\n" for c in caps)


def retime(plan, durs, timed_by):
    ns = types.SimpleNamespace(beats=plan["beats"])
    scenes, caps, total = build_plan.time_plan(ns, durs)
    plan.update({"scenes": scenes, "captions": caps, "total": total, "timed_by": timed_by})
    return plan


def main(argv=None):
    ap = argparse.ArgumentParser(description="Ag in 60 voice")
    ap.add_argument("--out", required=True)
    ap.add_argument("--voice", default=os.environ.get("AG60_VOICE", "af_heart"))
    ap.add_argument("--speed", type=float, default=1.05)
    ap.add_argument("--model", default=os.environ.get("AG60_MODEL", "models/kokoro-v1.0.int8.onnx"))
    ap.add_argument("--voices", default=os.environ.get("AG60_VOICES", "models/voices-v1.0.bin"))
    a = ap.parse_args(argv)
    pp = os.path.join(a.out, "plan.json")
    with open(pp, encoding="utf-8") as f:
        plan = json.load(f)
    wav = os.path.join(a.out, "voice.wav")
    try:
        from kokoro_onnx import Kokoro
        kokoro = Kokoro(a.model, a.voices)
    except Exception as e:  # no package or no model: keep going on the estimate
        print(f"voice: none ({type(e).__name__}: {e}); silent track on the estimated clock")
        retime(plan, None, "estimate")
        write_silence(wav, plan["total"])
        plan["voice"] = None
    else:
        speed = a.speed
        audio = speak_all(kokoro, plan["beats"], a.voice, speed)
        durs = {k: len(s) / sr for k, (s, sr) in audio.items()}
        t = total_for(plan, durs)
        if t > LIMIT:
            speed = min(1.3, speed * (t - build_plan.END_CARD) / (LIMIT - build_plan.END_CARD - 0.3))
            print(f"voice: {t:.1f} s at {a.speed}x, reading again at {speed:.2f}x")
            audio = speak_all(kokoro, plan["beats"], a.voice, speed)
            durs = {k: len(s) / sr for k, (s, sr) in audio.items()}
        retime(plan, durs, "voice")
        write_wav(wav, plan, audio)
        plan["voice"] = {"model": "Kokoro-82M v1.0 (int8 ONNX)", "voice": a.voice, "speed": round(speed, 3)}
    with open(pp, "w", encoding="utf-8") as f:
        json.dump(plan, f, ensure_ascii=False, indent=1)
    with open(os.path.join(a.out, "captions.srt"), "w", encoding="utf-8") as f:
        f.write(build_plan.srt(plan["captions"]))
    with open(os.path.join(a.out, "captions.vtt"), "w", encoding="utf-8") as f:
        f.write(vtt(plan["captions"]))
    print(f"voice: {plan['total']:.2f} s total, timed by {plan['timed_by']} -> {wav}")


if __name__ == "__main__":
    main()
