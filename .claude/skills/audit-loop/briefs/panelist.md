# Panelist brief template (copy, fill the <> parts, launch in the background)

Read-only audit for agsist.com (repo /home/user/agsist; do NOT edit, commit or push). <bids repo too if relevant>
Artifact: <page / tool / data set>. Files: <html, components, builders, data files, workflows, tests>.
Sig's rules that apply: <from STANDING-DECISIONS: honest numbers, no em dashes, names never on indexed pages, PRF neutral
except the approved month picker, no name at the top of a page, ...>.
Your lens: <who you are, what you know, your situation (phone in the cab, 2 minutes, real money)>.

Do:
1. Recompute every displayed number you can from the RAW data (not the page's own JSON if a rawer source exists).
   Reproduce at least <N> exactly or show the difference.
2. Render it (python3 -m http.server in the background; Playwright from /home/user/node_modules, Chromium
   /opt/pw-browsers/chromium, TMPDIR=/tmp/x/<letter>) at 390x844 and 1280x900; save screenshots to the scratchpad.
3. Check against an INDEPENDENT source, not the one the code used (rules: cite the agency page; dates: the release
   calendar; prices: the exchange settle).
4. Note failure modes: data missing or stale, service down, holiday, JS off, odd input.

Return, in this order:
- WRONG: numbered; severity (blocker/high/medium/low); file:function or line; concrete example with real numbers;
  REACH (how many pages, readers or dollars); CONFIDENCE (high/medium/low) and HOW I COULD BE WRONG; minimal fix.
- CONFUSIONS: exact words that will not land, and better words.
- MISSING: what the reader needs before acting.
- INSIGHTS: up to 3 things this data shows that no reader knows yet (with the numbers).
- LIKES (short) and DISLIKES.
- SUGGESTIONS: ranked, each with why and effort (small / medium / large).
- CHECKED AND CORRECT: what you verified and found right (proves the work).
No praise padding. Under <900> words. No em dashes. Never paste a private person's name or email.
