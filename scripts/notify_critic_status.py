#!/usr/bin/env python3
"""
AGSIST Daily — Critic Status Notifier (Phase 2, C7)
═══════════════════════════════════════════════════════════════════
Reads data/daily.json after the generate + critic steps. Emails Sig
a one-line health summary if anything is off. Quiet success: no email.

Triggers an alert when:
  - daily.json is missing or unreadable (generator failed silently)
  - critic_pass.final_scores is missing (critic failed silently)
  - Any rule scored below 7
  - Any rewrite was applied (informational)

Env vars required:
  GMAIL_USER       — sender Gmail address
  GMAIL_APP_PASS   — Gmail app password (NOT the account password)

Both should be set as repo secrets and exposed via the workflow YAML.

Usage:
  python scripts/notify_critic_status.py

Exit codes:
  0 — success (alert sent OR quietly passed)
  1 — alert needed but email failed (workflow log will surface this)
"""

import json
import os
import smtplib
import sys
from email.mime.text import MIMEText
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DAILY_PATH = REPO_ROOT / "data" / "daily.json"
ALERT_TO = "sig@farmers1st.com"


def send(subject: str, body: str) -> bool:
    """Send email via Gmail SMTP. Returns True on success."""
    user = os.environ.get("GMAIL_USER")
    pwd = os.environ.get("GMAIL_APP_PASS")
    if not user or not pwd:
        print("[warn] GMAIL_USER or GMAIL_APP_PASS not set; can't send alert",
              file=sys.stderr)
        # Still print the alert content to the workflow log so it's not lost.
        print(f"[ALERT-NOSEND] {subject}\n{body}", file=sys.stderr)
        return False
    msg = MIMEText(body)
    msg["Subject"] = subject
    msg["From"] = user
    msg["To"] = ALERT_TO
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com", 465) as s:
            s.login(user, pwd)
            s.send_message(msg)
        print(f"  [ok] alert sent to {ALERT_TO}: {subject}")
        return True
    except Exception as e:
        print(f"[error] alert email failed: {e}", file=sys.stderr)
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

    # Quiet success — only alert on flagged rules or rewrites
    if not flagged and not rewrites and avg >= 8.0:
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
        subject = f"AGSIST critic flagged {len(flagged)} rule(s) — issue #{issue}"
    elif rewrites:
        subject = f"AGSIST critic applied {len(rewrites)} rewrite(s) — issue #{issue}"
    else:
        # Avg below 8 but no individual flags
        subject = f"AGSIST critic — average score {avg:.1f}/10 — issue #{issue}"

    ok = send(subject, body)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
