#!/usr/bin/env python3
"""
scripts/send_morning_brief.py
─────────────────────────────────────────────────────────────────
Generates the full daily briefing email + condensed SMS that
Sigurd manually forwards each morning.

Designed against the actual data/daily.json schema produced by
generate_daily.py v4.1. The briefing content blocks rendered:

  - Issue header + market mood badge
  - Headline + subheadline + lead paragraph
  - Overnight surprises banner (top movers for the day)
  - The Number (one_number) — the standout figure with context
  - Yesterday's Call — what was called yesterday + outcome
  - Prices grid — uses locked_prices (dollars) for consistency
                  with the briefing prose; enriches with change%
                  from surprises[] and prices.json when available
  - Briefing sections — title, icon, body, bottom_line,
                        conviction level, surprise/heat badges,
                        farmer action
  - Spread to Watch
  - Basis Pulse
  - The More You Know
  - Watch List (this week's events)
  - Weekly Thread (multi-day question + status)
  - Daily Quote
  - Footer with archive links + STOP

Reads:
  data/daily.json        — REQUIRED: full briefing content
  data/prices.json       — OPTIONAL: enriches change% on prices
                           grid for symbols not in surprises[]

Sends:
  One plain-text email to sig@farmers1st.com containing:
    1. EMAIL block (top)  — ready to forward to subscribers
    2. SMS block (bottom) — ready to copy into group text

Required GitHub secrets:
  GMAIL_USER      — sig@farmers1st.com
  GMAIL_APP_PASS  — Gmail app password (16 chars)
                    Generate at: myaccount.google.com/apppasswords

Optional env:
  FORCE_SEND=1    — bypass weekend skip (for manual triggers)
─────────────────────────────────────────────────────────────────
"""
import json
import os
import re
import smtplib
import ssl
import sys
from datetime import datetime
from email.message import EmailMessage
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent.parent
TZ = ZoneInfo("America/Chicago")
RECIPIENT = "sig@farmers1st.com"
SITE = "https://agsist.com"

# ── PRICE GRID — order + display labels ──
# Symbols match keys in daily.json.locked_prices.
# Script silently skips rows where the symbol isn't present.
PRICES = [
    ("corn",      "Corn (ZC)"),
    ("corn-dec",  "Corn Dec new crop"),
    ("beans",     "Beans (ZS)"),
    ("beans-nov", "Beans Nov new crop"),
    ("wheat",     "Wheat (ZW)"),
    ("oats",      "Oats (ZO)"),
    ("cattle",    "Live Cattle"),
    ("feeders",   "Feeder Cattle"),
    ("hogs",      "Lean Hogs"),
    ("crude",     "Crude (CL)"),
    ("natgas",    "Nat Gas (NG)"),
]

# Conviction badges for plain-text section headers
CONVICTION_BADGE = {
    "high":   "[HIGH CONVICTION]",
    "medium": "[MEDIUM CONVICTION]",
    "low":    "[LOW CONVICTION]",
}

# Market mood prefix for SMS + subject
MOOD_LABEL = {
    "bullish":  "Bullish",
    "bearish":  "Bearish",
    "mixed":    "Mixed",
    "quiet":    "Quiet",
    "neutral":  "Neutral",
    "volatile": "Volatile",
}


# ── HELPERS ───────────────────────────────────────────────────

def load_json(rel_path, optional=False):
    p = ROOT / rel_path
    if not p.exists():
        if not optional:
            print(f"Warn: {rel_path} not found", file=sys.stderr)
        return None
    try:
        return json.loads(p.read_text())
    except Exception as e:
        print(f"Warn: couldn't parse {rel_path}: {e}", file=sys.stderr)
        return None


def strip_html(s):
    """Remove HTML tags from briefing body text. Briefing uses
    <strong> for emphasis; for plain-text email we just drop tags."""
    if not s:
        return ""
    return re.sub(r"<[^>]+>", "", str(s)).strip()


def get_change_pct(symbol, prices_data, surprises):
    """Pct change priority: surprises[] (locked to briefing) →
    prices.json fallback → None."""
    # Try surprises first — these are the day's confirmed movers
    for s in surprises or []:
        if s.get("key") == symbol:
            v = s.get("pct_change")
            if isinstance(v, (int, float)):
                return v / 100  # surprises store as % (1.6743), we want decimal
    # Fall back to prices.json — fetch_prices.py writes pctChange (as %, not decimal)
    if prices_data:
        q = (prices_data.get("quotes") or {}).get(symbol)
        if isinstance(q, dict):
            v = q.get("pctChange")
            if isinstance(v, (int, float)):
                return v / 100  # script stores as 1.7 for 1.7%, normalize to decimal
    return None


def fmt_change(pct):
    """Decimal pct → '+1.7%' / '-2.0%' / '—'."""
    if pct is None:
        return "—"
    return f"{pct:+.1%}"


# ── SECTION BUILDERS ──────────────────────────────────────────

def section_header(daily, today):
    issue = daily.get("issue_number")
    issue_str = f"  ·  ISSUE #{issue}" if issue else ""
    mood = (daily.get("meta") or {}).get("market_mood", "")
    mood_label = MOOD_LABEL.get(mood.lower(), mood.title()) if mood else ""
    mood_str = f"  ·  Mood: {mood_label}" if mood_label else ""
    date_line = today.strftime("%A, %B %-d, %Y")
    return f"AGSIST DAILY{issue_str}{mood_str}\n{date_line}"


def section_surprises(daily):
    surprises = daily.get("surprises", [])
    if not surprises:
        return None
    parts = []
    for s in surprises[:6]:  # cap at 6
        commodity = s.get("commodity") or s.get("key", "?").title()
        pct = s.get("pct_change")
        direction = s.get("direction", "")
        if isinstance(pct, (int, float)):
            arrow = "↑" if direction == "up" else "↓" if direction == "down" else "·"
            parts.append(f"{commodity} {arrow}{abs(pct):.1f}%")
        else:
            parts.append(commodity)
    return "⚡ OVERNIGHT SURPRISES\n" + " · ".join(parts)


def section_headline(daily):
    headline = (daily.get("headline") or "").strip()
    sub = (daily.get("subheadline") or "").strip()
    lead = strip_html(daily.get("lead", ""))
    parts = []
    if headline:
        parts.append(headline)
    if sub:
        parts.append(sub)
    if lead:
        parts.append("")  # blank line before lead
        parts.append(lead)
    return "\n".join(parts) if parts else None


def section_one_number(daily):
    one = daily.get("one_number")
    if not isinstance(one, dict):
        return None
    val = one.get("value", "")
    unit = one.get("unit", "")
    ctx = strip_html(one.get("context", ""))
    if not val:
        return None
    line1 = f"THE NUMBER: {val}" + (f"  ({unit})" if unit else "")
    return f"{line1}\n{ctx}" if ctx else line1


def section_yesterdays_call(daily):
    yc = daily.get("yesterdays_call")
    if not isinstance(yc, dict):
        return None
    summary = strip_html(yc.get("summary", ""))
    note = strip_html(yc.get("note", ""))
    outcome = (yc.get("outcome") or "").lower().replace("_", " ")
    if not summary:
        return None
    outcome_str = f"  [{outcome.upper()}]" if outcome else ""
    parts = [f"↺ YESTERDAY'S CALL{outcome_str}", summary]
    if note:
        parts.append(note)
    return "\n".join(parts)


def section_prices(daily, prices_data):
    locked = daily.get("locked_prices") or {}
    surprises = daily.get("surprises", [])
    if not locked:
        return None

    lines = ["PRICES"]
    rendered_any = False
    for symbol, label in PRICES:
        if symbol not in locked:
            continue
        try:
            price = float(locked[symbol])
        except (TypeError, ValueError):
            continue
        chg = get_change_pct(symbol, prices_data, surprises)
        chg_str = fmt_change(chg)
        price_str = f"${price:,.2f}"
        lines.append(f"  {label:<22} {price_str:<11} {chg_str}")
        rendered_any = True

    return "\n".join(lines) if rendered_any else None


def section_briefing_blocks(daily):
    sections = daily.get("sections", [])
    if not isinstance(sections, list) or not sections:
        return None

    heat_idx = (daily.get("meta") or {}).get("heat_section")
    rendered = []

    for i, sec in enumerate(sections):
        title = (sec.get("title") or "").strip()
        body = strip_html(sec.get("body", ""))
        bottom = strip_html(sec.get("bottom_line", ""))
        action = strip_html(sec.get("farmer_action", ""))
        conviction = (sec.get("conviction_level") or "").lower()
        is_surprise = sec.get("overnight_surprise") is True
        is_heat = (i == heat_idx)
        icon = sec.get("icon", "")

        if not title and not body:
            continue

        # Header line
        badges = []
        if is_heat:
            badges.append("TOP STORY")
        if is_surprise:
            badges.append("⚡ OVERNIGHT")
        conv_badge = CONVICTION_BADGE.get(conviction)
        if conv_badge:
            badges.append(conv_badge)
        badge_str = ("  " + "  ".join(badges)) if badges else ""

        header = f"{icon} {title.upper()}{badge_str}".strip()
        block = [header]
        if body:
            block.append(body)
        if bottom:
            block.append(f"> {bottom}")
        if action:
            block.append(f"ACTION: {action}")
        rendered.append("\n".join(block))

    return "\n\n".join(rendered) if rendered else None


def section_spread(daily):
    sp = daily.get("spread_to_watch")
    if not isinstance(sp, dict):
        return None
    label = (sp.get("label") or "").strip()
    level = (sp.get("level") or "").strip()
    body = strip_html(sp.get("commentary") or sp.get("body", ""))
    if not label and not body:
        return None
    parts = ["⇄ SPREAD TO WATCH"]
    if label:
        parts.append(label)
    if level:
        parts.append(level)
    if body:
        parts.append(body)
    return "\n".join(parts)


def section_basis(daily):
    b = daily.get("basis")
    if not isinstance(b, dict):
        return None
    headline = (b.get("headline") or "").strip()
    body = strip_html(b.get("body", ""))
    if not headline and not body:
        return None
    parts = ["BASIS PULSE"]
    if headline:
        parts.append(headline)
    if body:
        parts.append(body)
    return "\n".join(parts)


def section_tmyk(daily):
    t = daily.get("the_more_you_know")
    if not isinstance(t, dict):
        return None
    title = (t.get("title") or "").strip()
    body = strip_html(t.get("body", ""))
    if not body:
        return None
    parts = ["THE MORE YOU KNOW"]
    if title:
        parts.append(title)
    parts.append(body)
    return "\n".join(parts)


def section_watch_list(daily):
    wl = daily.get("watch_list", [])
    if not isinstance(wl, list) or not wl:
        return None
    parts = ["THIS WEEK'S WATCH LIST"]
    for item in wl:
        if not isinstance(item, dict):
            continue
        time_str = (item.get("time") or "").strip()
        desc = strip_html(item.get("desc", ""))
        if not desc:
            continue
        if time_str:
            parts.append(f"  {time_str:<22} {desc}")
        else:
            parts.append(f"  {desc}")
    return "\n".join(parts) if len(parts) > 1 else None


def section_weekly_thread(daily):
    wt = daily.get("weekly_thread")
    if not isinstance(wt, dict):
        return None
    q = (wt.get("question") or "").strip()
    day = wt.get("day")
    status = strip_html(wt.get("status_text", ""))
    if not q:
        return None
    day_str = f"  (Day {day})" if day else ""
    parts = [f"THIS WEEK'S THREAD{day_str}", q]
    if status:
        parts.append(status)
    return "\n".join(parts)


def section_quote(daily):
    q = daily.get("daily_quote")
    if not isinstance(q, dict):
        return None
    text = (q.get("text") or "").strip()
    attr = (q.get("attribution") or "").strip()
    if not text:
        return None
    parts = [f'"{text}"']
    if attr:
        parts.append(f"   — {attr}")
    return "\n".join(parts)


def section_footer(today):
    daily_url = f"{SITE}/daily/{today.isoformat()}"
    return (
        f"──────────────────────────────────────────\n"
        f"Today's brief → {daily_url}\n"
        f"Full archive  → {SITE}/daily\n"
        f"Live charts   → {SITE}\n"
        f"\n"
        f"Written by Sigurd Lindquist, founder.\n"
        f"Reply at sig@farmers1st.com — I read everything.\n"
        f"\n"
        f"Reply STOP to opt out."
    )


# ── ASSEMBLY ──────────────────────────────────────────────────

def build_email_body(daily, prices_data, today):
    parts = [
        section_header(daily, today),
        section_headline(daily),
        section_surprises(daily),
        section_one_number(daily),
        section_yesterdays_call(daily),
        section_prices(daily, prices_data),
        section_briefing_blocks(daily),
        section_spread(daily),
        section_basis(daily),
        section_tmyk(daily),
        section_watch_list(daily),
        section_weekly_thread(daily),
        section_quote(daily),
        section_footer(today),
    ]
    return "\n\n".join(p for p in parts if p)


def build_sms(daily, today):
    """Multi-line SMS using actual surprises + teaser if available."""
    locked = daily.get("locked_prices") or {}
    surprises = daily.get("surprises", []) or []
    teaser = (daily.get("teaser") or "").strip()
    mood = (daily.get("meta") or {}).get("market_mood", "")
    mood_label = MOOD_LABEL.get(mood.lower(), mood.title()) if mood else ""

    # Pick prices to feature: up to 3 from surprises (any in locked_prices),
    # fallback to grain trio
    picks = []
    for s in surprises:
        if len(picks) >= 3:
            break
        key = s.get("key")
        if not key or key not in locked:
            continue
        commodity = s.get("commodity") or key.title()
        commodity = (commodity
                     .replace("WTI Crude Oil", "Crude")
                     .replace("Feeder Cattle", "Feeders")
                     .replace("Live Cattle", "Cattle"))
        try:
            price = float(locked[key])
        except (TypeError, ValueError):
            continue
        pct = s.get("pct_change")
        if isinstance(pct, (int, float)):
            sign = "+" if pct > 0 else ""
            picks.append(f"{commodity} ${price:,.2f} ({sign}{pct:.1f}%)")
        else:
            picks.append(f"{commodity} ${price:,.2f}")
    if not picks:
        for key, label in [("corn", "Corn"), ("beans", "Beans"), ("wheat", "Wheat")]:
            p = locked.get(key)
            if isinstance(p, (int, float)):
                picks.append(f"{label} ${p:,.2f}")

    # First watch_list item, time + short desc
    watch_line = ""
    wl = daily.get("watch_list", [])
    if isinstance(wl, list) and wl:
        first = wl[0] or {}
        time_str = (first.get("time") or "").strip()
        desc = strip_html(first.get("desc", ""))
        # Trim desc to first sentence or em-dash
        for sep in [" — ", " - ", ". "]:
            if sep in desc:
                desc = desc.split(sep)[0]
                break
        if desc:
            watch_line = f"Watch: {time_str + ' ' if time_str else ''}{desc}".strip()

    daily_url = f"{SITE}/daily/{today.isoformat()}"
    date_str = today.strftime("%b %-d")

    lines = [f"AGSIST {date_str}" + (f" · {mood_label}" if mood_label else "")]
    if teaser:
        lines.append(teaser)
    if picks:
        lines.append(", ".join(picks))
    if watch_line:
        lines.append(watch_line)
    lines.append(daily_url)
    lines.append("STOP=opt out")
    return "\n".join(lines)


# ── SEND ──────────────────────────────────────────────────────

def send(subject, email_body, sms_body):
    user = os.environ["GMAIL_USER"]
    pwd = os.environ["GMAIL_APP_PASS"].replace(" ", "")

    full = (
        f"{email_body}\n"
        f"\n"
        f"════════════════ SMS VERSION ({len(sms_body)} chars) ════════════════\n"
        f"\n"
        f"{sms_body}\n"
        f"\n"
        f"══════════════════════════════════════════════════════════════\n"
        f"\n"
        f"(Forward the email block above to your subscriber list.\n"
        f" Copy the SMS block to send via group text.)\n"
    )

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = RECIPIENT
    msg.set_content(full)

    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx) as s:
        s.login(user, pwd)
        s.send_message(msg)


def main():
    today = datetime.now(TZ).date()

    if today.weekday() >= 5 and not os.environ.get("FORCE_SEND"):
        print(f"Skip {today} (weekend; set FORCE_SEND=1 to override)")
        return 0

    daily = load_json("data/daily.json")
    prices = load_json("data/prices.json", optional=True)

    if not daily:
        print("data/daily.json missing — cannot generate brief", file=sys.stderr)
        return 1

    # ── SEND GUARD (added 2026-06-23) ────────────────────────────────────────
    # Last line of defense before subscribers. Refuse to send a briefing that
    # didn't pass validation. Runs the deterministic briefing_gate if available
    # (prose vs locked prices vs clean feed); falls back to the generator's own
    # price_validation_clean flag. Set FORCE_SEND=1 to override for a known-good
    # manual run.
    if not os.environ.get("FORCE_SEND"):
        gate_ok, gate_reason = True, ""
        # staleness: never send a briefing that is not for today (a blocked
        # generation leaves yesterday's daily.json committed; without this the
        # separate send workflow would mail stale content under today's subject).
        _stamp = str(daily.get("generated_at") or daily.get("date") or "")
        if today.isoformat() not in _stamp and today.strftime("%Y-%m-%d") not in _stamp:
            print(f"BLOCKED — daily.json is not dated today ({_stamp!r} vs {today}); not sending stale brief.",
                  file=sys.stderr)
            return 1
        try:
            import briefing_gate
            gate_ok, issues = briefing_gate.run(daily, prices, today)
            if not gate_ok:
                gate_reason = "; ".join(f"{c}: {m}" for s, c, m in issues if s == "FAIL")
        except ImportError:
            # briefing_gate not importable — fall back to the generator's flag
            if daily.get("price_validation_clean") is False:
                gate_ok, gate_reason = False, "price_validation_clean is False"
        except Exception as e:
            gate_ok, gate_reason = False, f"briefing_gate raised: {e}"
        if not gate_ok:
            print(f"BLOCKED — briefing failed validation, not sending:\n  {gate_reason}",
                  file=sys.stderr)
            print("  (set FORCE_SEND=1 only if you have manually verified the briefing)",
                  file=sys.stderr)
            return 1

    email_body = build_email_body(daily, prices, today)
    sms_body = build_sms(daily, today)

    headline = (daily.get("headline") or "Daily Brief").strip()
    issue = daily.get("issue_number")
    issue_str = f"#{issue} " if issue else ""
    subject = f"AGSIST {issue_str}{today.strftime('%b %-d')} — {headline}"

    send(subject, email_body, sms_body)
    print(f"Sent {today}: {len(email_body)} char email, {len(sms_body)} char SMS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
