#!/usr/bin/env python3
"""
AGSIST Daily — Critic Status Notifier (Phase 2, C7)
═══════════════════════════════════════════════════════════════════
Reads data/daily.json after the generate + critic steps. Emails Sig
a one-line health summary if anything is off. Quiet success: no email.

Triggers an alert when:
  - daily.json is missing or unreadable (generator failed silently)
  - critic_pass.final_scores is missing (critic failed silently)
  - The average score is under the threshold (7), or any rule scored 3 or less
    (since 2026-10-20; a passing issue with a few rules under 7 stays quiet)

Env vars: the same transport as every other sender (send_daily.py):
  SMTP_USER, SMTP_PASS   the login (legacy GMAIL_USER, GMAIL_APP_PASS still read)
  SMTP_HOST, SMTP_PORT   default smtp.gmail.com, 587 (STARTTLS)
  FROM_ADDR              defaults to the login; required when the login is not
                         an address (Amazon SES)

All are repo secrets, exposed via the workflow YAML.

Usage:
  python scripts/notify_critic_status.py

Exit codes:
  0 — success (alert sent OR quietly passed)
  1 — alert needed but email failed (workflow log will surface this)
"""

import json
import os
import smtplib
import ssl
import sys
from email.mime.text import MIMEText
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(Path(__file__).resolve().parent))
import email_links  # noqa: E402  (every send refuses a link to the worker host; scripts/email_links.py)
import log_safe  # noqa: E402  sender_addr (SES-safe From) and mask_text (no address in the log)

DAILY_PATH = REPO_ROOT / "data" / "daily.json"
ALERT_TO = "sig@agsist.com"


def send(subject: str, body: str) -> bool:
    """Send email over SMTP_HOST:SMTP_PORT with STARTTLS. Returns True on success."""
    user = (os.environ.get("SMTP_USER") or os.environ.get("GMAIL_USER") or "").strip()
    pwd = (os.environ.get("SMTP_PASS") or os.environ.get("GMAIL_APP_PASS") or "").strip()
    if not user or not pwd:
        print("[warn] SMTP_USER or SMTP_PASS not set; can't send alert",
              file=sys.stderr)
        # Still print the alert content to the workflow log so it's not lost.
        print(f"[ALERT-NOSEND] {subject}\n{body}", file=sys.stderr)
        return False
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["To"] = ALERT_TO
    try:
        msg["From"] = log_safe.sender_addr()
        host = (os.environ.get("SMTP_HOST") or "").strip() or "smtp.gmail.com"
        port = int((os.environ.get("SMTP_PORT") or "").strip() or 587)
        with smtplib.SMTP(host, port, timeout=30) as s:
            s.starttls(context=ssl.create_default_context())
            s.login(user, pwd)
            s.send_message(msg)
        print(f"  [ok] alert sent to Sig: {subject}")
        return True
    except Exception as e:
        print(f"[error] alert email failed: {type(e).__name__}: {log_safe.mask_text(e)}", file=sys.stderr)
        print(f"[ALERT-NOSEND] {subject}\n{body}", file=sys.stderr)
        return False


def format_scores_block(scores: dict, threshold: int = 7) -> str:
    """Pretty-format scores, flagging anything below the threshold."""
    lines = []
    for rule, score in sorted(scores.items()):
        try:
            score_num = float(score)
        except (TypeError, ValueError):
            score_num = 0.0
        flag = " ⚠" if score_num < threshold else ""
        lines.append(f"  {rule:<32} {score_num:>4.1f}/10{flag}")
    return "\n".join(lines)


SERIOUS = 3


def should_alert(scores: dict, threshold: float = 7) -> bool:
    """True when the issue needs Sig's eyes: average under the threshold or a rule at SERIOUS or below."""
    vals = [float(v) for v in scores.values() if isinstance(v, (int, float))]
    if not vals:
        return True
    return sum(vals) / len(vals) < threshold or min(vals) <= SERIOUS


def main() -> int:
    if not DAILY_PATH.exists():
        ok = send("⚠ AGSIST Daily — generator FAILED",
                  f"data/daily.json not found.\n"
                  f"The generate_daily.py step likely failed before "
                  f"writing output. Check the workflow logs.\n\n"
                  f"Path checked: {DAILY_PATH}\n")
        return 0 if ok else 1

    try:
        with open(DAILY_PATH) as f:
            briefing = json.load(f)
    except Exception as e:
        ok = send("⚠ AGSIST Daily — daily.json unreadable",
                  f"data/daily.json could not be parsed: {e}\n\n"
                  f"Generator may have written invalid JSON.\n"
                  f"Path: {DAILY_PATH}\n")
        return 0 if ok else 1

    issue = briefing.get("issue_number", "?")
    headline = (briefing.get("headline") or "")[:80]
    cp = briefing.get("critic_pass") or {}
    scores = cp.get("final_scores") or {}
    rewrites = cp.get("rewrites_applied") or []
    threshold = cp.get("threshold", 7)

    if not scores:
        ok = send(f"⚠ AGSIST Daily — critic pass skipped (issue #{issue})",
                  f"Headline: {headline}\n\n"
                  f"daily.json has no critic_pass.final_scores. The critic "
                  f"step ran with continue-on-error and likely failed silently.\n\n"
                  f"Briefing shipped without the quality gate. Check the "
                  f"workflow logs to see why the critic API call failed.\n")
        return 0 if ok else 1

    avg = sum(float(s) for s in scores.values() if isinstance(s, (int, float))) / max(len(scores), 1)
    flagged = {r: s for r, s in scores.items()
               if isinstance(s, (int, float)) and s < threshold}

    # Quiet unless the issue itself is weak (Sig, 2026-10-20: a rule or two
    # under 7 and an applied rewrite on an otherwise passing issue were a
    # near-daily email he did not need). Alert when the average is under the
    # threshold or any one rule is at SERIOUS or below.
    if not should_alert(scores, threshold):
        print(f"  Critic pass clean: issue #{issue}, avg {avg:.1f}/10. "
              f"No alert needed.")
        return 0

    # Build the alert
    parts = [f"Issue #{issue}: {headline}",
             "",
             f"Average score: {avg:.1f}/10 (threshold {threshold})",
             f"Rewrites applied: {len(rewrites)}",
             ""]

    if flagged:
        parts.append(f"Rules below {threshold}:")
        parts.append(format_scores_block(flagged, threshold))
        parts.append("")

    if rewrites:
        parts.append("Rewrites applied this pass:")
        for r in rewrites:
            target = r.get("target", "?")
            rule = r.get("rule", "?")
            parts.append(f"  - {target} (driven by {rule})")
        parts.append("")

    parts.append("Full scores:")
    parts.append(format_scores_block(scores, threshold))

    body = "\n".join(parts)

    if flagged:
        subject = f"AGSIST critic flagged {len(flagged)} rule(s), issue #{issue}"
    elif rewrites:
        subject = f"AGSIST critic applied {len(rewrites)} rewrite(s), issue #{issue}"
    else:
        # Avg below 8 but no individual flags
        subject = f"AGSIST critic: average score {avg:.1f}/10, issue #{issue}"

    ok = send(subject, body)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
