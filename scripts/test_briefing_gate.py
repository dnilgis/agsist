#!/usr/bin/env python3
"""
THE BRIEFING *SCHEDULE* GATE, DRIVEN THROUGH EVERY EVENT SHAPE IT CAN MEET.

NAME WARNING, AND IT IS MY FAULT. This file tests the SCHEDULE gate -- the shell
block inside daily.yml that decides whether a fire generates or stands down. It
has nothing to do with scripts/briefing_gate.py, which is a different thing
entirely: the 673-line checker that decides whether the finished briefing is fit
to send. That one is tested by scripts/test_briefing_binding.py.

  test_briefing_gate.py     -> daily.yml's gate:  should this run generate?
  test_briefing_binding.py  -> briefing_gate.py:  is this issue fit to send?
  test_daily_schedule.py    -> the shape of the crons around both.

Written 2026-09-01, after the third failure of this schedule in four days and
the second one that was my own fix.

WHY THIS EXISTS. The gate is thirty lines of shell inside a YAML string. It is
the single point that decides, every morning, whether Sig gets a briefing —
and until today nothing anywhere ran it. Both previous fixes were reasoned
about and shipped, and both were wrong in ways five minutes of execution would
have shown.

This extracts the gate's actual shell out of daily.yml, stubs the clock, the
calendar and the "is today already published" check, and runs it. It asserts on
the one output the gate produces: skip=0 (generate) or skip=1 (stand down).

THE PRE-FIX RUN IS THE POINT. Against origin/main as it stood this morning,
three of these thirteen FAIL — the three that arrive as a dispatch from the
price loop. Without the `heartbeat` input the gate reads that dispatch as a
person at a keyboard, and would have regenerated and re-emailed the briefing
every thirty minutes, all day, including at three in the afternoon. A test that
passes on the broken file proves nothing.

    python3 scripts/test_briefing_gate.py

No network, no runner, about a second.
"""

import yaml, subprocess, os, re, sys, tempfile

d = yaml.safe_load(open(os.path.join(os.path.dirname(__file__), '..', '.github', 'workflows', 'daily.yml')))
GATE = [s for s in d['jobs']['gate']['steps'] if s.get('id') == 'g'][0]['run']

def build(event, heartbeat, clock, dow, published):
    """clock = 'HH:MM'. dow = 1..7. published = True/False."""
    s = GATE
    s = s.replace("${{ github.event_name }}", event)
    s = s.replace("${{ github.event.repository.default_branch || 'main' }}", "main")
    s = s.replace("${{ github.event.inputs.heartbeat || 'false' }}", heartbeat)
    # swap the real published() for a stub
    s = re.sub(r'published\(\) \{.*?\n\}', 
               'published() { [ "$PUBLISHED" = "1" ]; }', s, flags=re.S)
    pre = f'''
FAKE_MIN=$(( {int(clock[:2])} * 60 + {int(clock[3:])} ))
FAKE_DOW={dow}
PUBLISHED={1 if published else 0}
STEPS=0
date() {{
  local h=$(( (FAKE_MIN / 60) % 24 )) m=$(( FAKE_MIN % 60 ))
  case "${{1:-}}" in
    +%s)   echo $(( 1788000000 + FAKE_MIN * 60 ));;
    +%F)   echo "2026-09-01";;
    +%H%M) printf "%02d%02d\\n" $h $m;;
    +%H)   printf "%02d\\n" $h;;
    +%u)   echo $FAKE_DOW;;
    +%H:%M) printf "%02d:%02d\\n" $h $m;;
    *)     printf "%02d:%02d\\n" $h $m;;
  esac
}}
sleep() {{ FAKE_MIN=$(( FAKE_MIN + $1 / 60 )); STEPS=$(( STEPS + 1 ));
           [ "$STEPS" -gt 40 ] && {{ echo "RUNAWAY LOOP"; exit 9; }}; }}
'''
    return pre + s

def run(name, expect, **kw):
    out = tempfile.NamedTemporaryFile(mode='w+', delete=False, suffix='.out'); out.close()
    sc  = tempfile.NamedTemporaryFile(mode='w', delete=False, suffix='.sh')
    sc.write(build(**kw)); sc.close()
    r = subprocess.run(['bash', sc.name], capture_output=True, text=True,
                       env={**os.environ, 'GITHUB_OUTPUT': out.name})
    got = open(out.name).read().strip()
    skip = got.split('=')[-1] if '=' in got else '(nothing)'
    ok = skip == expect
    log = [l for l in r.stdout.strip().split('\n') if l.strip()]
    print(f"  {'PASS' if ok else 'FAIL'}  skip={skip} (want {expect})  {name}")
    if not ok or os.environ.get('V'):
        for l in log[-3:]: print("           ", l)
    return ok

print("THE GATE, driven through every event shape it can meet")
print("(0 = generate the briefing, 1 = skip)\n")
cases = [
 ("heartbeat at 05:17, before the floor — the next one takes it", '1',
   dict(event='workflow_dispatch', heartbeat='true', clock='05:17', dow=2, published=False)),
 ("heartbeat at 05:47, past the floor, nothing published yet", '0',
   dict(event='workflow_dispatch', heartbeat='true', clock='05:47', dow=2, published=False)),
 ("heartbeat at 07:47, today already published", '1',
   dict(event='workflow_dispatch', heartbeat='true', clock='07:47', dow=2, published=True)),
 ("heartbeat at 15:00 — an afternoon price commit must never regenerate", '1',
   dict(event='workflow_dispatch', heartbeat='true', clock='15:00', dow=2, published=True)),
 ("a PERSON clicks Run workflow at 15:00 — they get a briefing", '0',
   dict(event='workflow_dispatch', heartbeat='false', clock='15:00', dow=2, published=True)),
 ("a PERSON clicks Run workflow at 04:00, before the floor", '0',
   dict(event='workflow_dispatch', heartbeat='false', clock='04:00', dow=2, published=False)),
 ("the 05:19 cron waits for the floor and then generates", '0',
   dict(event='schedule', heartbeat='false', clock='05:19', dow=2, published=False)),
 ("the 06:41 cron, nothing published", '0',
   dict(event='schedule', heartbeat='false', clock='06:41', dow=2, published=False)),
 ("the 08:23 backup cron, today already published", '1',
   dict(event='schedule', heartbeat='false', clock='08:23', dow=2, published=True)),
 ("a cron delivered ten hours late at 15:55 — NOT a regeneration", '1',
   dict(event='schedule', heartbeat='false', clock='15:55', dow=2, published=False)),
 ("Friday 15:00 post-close regeneration, over the published file", '0',
   dict(event='schedule', heartbeat='false', clock='15:00', dow=5, published=True)),
 ("Friday 21:00 — past the post-close window, must not republish", '1',
   dict(event='schedule', heartbeat='false', clock='21:00', dow=5, published=True)),
 ("Saturday: the briefing still runs, it is not a weekday-only product", '0',
   dict(event='schedule', heartbeat='false', clock='06:41', dow=6, published=False)),
]
ok = sum(run(n, e, **k) for n, e, k in cases)
print(f"\n{ok}/{len(cases)} pass")
sys.exit(0 if ok == len(cases) else 1)
