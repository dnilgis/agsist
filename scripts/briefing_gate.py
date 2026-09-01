#!/usr/bin/env python3
"""
briefing_gate.py — deterministic PRE-SEND gate for AGSIST Daily.
Runs AFTER generate_daily.py (+ LLM critic), BEFORE send_morning_brief.py.

Closes the gap the LLM critic structurally cannot: it checks the PROSE against the
locked numbers with arithmetic, and re-ties locked_prices back to the cleaned feed.
The LLM critic (Rule 14) scores prose vs locked_prices — but if locked_prices was
built from a contaminated feed, generator and critic agree on the same wrong number.
This gate verifies locked_prices STILL matches the repaired prices.json, so a bad
input can't hide behind a self-consistent briefing.

Operates on your real daily.json schema. Any FAIL blocks the send (exit 1).
"""
import json, re, sys, argparse, datetime as dt
import os
try:
    import preflight_prices            # defense-in-depth feed re-check
except Exception:
    preflight_prices=None

# commodity keyword -> (locked_prices key, prices.json key, grain?)
COMM = {
 'corn':('corn','corn',True),'soybean':('beans','beans',True),'soybeans':('beans','beans',True),
 'beans':('beans','beans',True),'wheat':('wheat','wheat',True),
 'live cattle':('cattle','cattle',False),'cattle':('cattle','cattle',False),
 'feeder':('feeders','feeders',False),'feeders':('feeders','feeders',False),
 'hog':('hogs','hogs',False),'crude':('crude','crude',False),'wti':('crude','crude',False),
 'natural gas':('natgas','natgas',False),'nat gas':('natgas','natgas',False),
 'soybean meal':('meal','meal',False),'soybean oil':('soyoil','soyoil',False),
}
BANNED=['crashed','surged','cratered','exploded','rout','spiked','collapse','collapsed',
        'tumble','tumbled','plunge','plunged','soar','soared','vaulted','leaped','slashed',
        'decisively below','decisively above','decisively through']
DRAMA=['reversal','snap back','snapped back','snaps back','biggest','worst','best day',
       'record','historic','massive','dramatic','meltdown']
SUPER=['of the summer','of the year','of the month','in months','in years','in weeks','all-time']
DROP_VERB=re.compile(r'\b(broke|below|under|fell through|lost|breaking)\b')
HOLD_VERB=re.compile(r'\b(above|held|reclaim\w*|broke above|back above|cleared)\b')
# spread/carry/structural sentences cite multiple contract prices; never level-check them
STRUCT_CTX=re.compile(r'\b(spread|carry|basis|curve|ratio|new-crop|old-crop|cents over|over nearby|invers\w+)\b')
DOLLAR=re.compile(r'\$\s?(\d{1,4}(?:\.\d{1,2})?)')
PCT=re.compile(r'([+\-]?\d+(?:\.\d+)?)\s?%')
WEEKDATE=re.compile(r'\b(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),?\s+'
                    r'(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})')
LEVEL_TOL=0.006

def prose_fields(d):
    out=[('headline',d.get('headline')),('subheadline',d.get('subheadline')),
         ('lead',d.get('lead')),('the_takeaway',d.get('the_takeaway')),
         ('subject_line',d.get('subject_line'))]
    for i,s in enumerate(d.get('sections') or []):
        for k in ('title','body','bottom_line','farmer_action'):
            out.append((f'sections[{i}].{k}', s.get(k)))
    for blk,keys in [('the_more_you_know',('title','body')),('spread_to_watch',('label','level','commentary')),
                     ('basis',('headline','body')),('yesterdays_call',('summary','note')),
                     ('one_number',('value','unit','context'))]:
        b=d.get(blk) or {}
        for k in keys: out.append((f'{blk}.{k}', b.get(k)))
    for i,w in enumerate(d.get('watch_list') or []):
        out.append((f'watch_list[{i}].desc', w.get('desc')))
        out.append((f'watch_list[{i}].time', w.get('time')))
    return [(loc,str(v)) for loc,v in out if v]



# ══ NUMBER BINDING ═════════════════════════════════════════════════════════
# Every price, percentage and direction word in the prose must agree with the
# board the same issue prints.
#
# WHY THIS EXISTS. Rule 14 already checked LEVELS -- "broke $6.20", "below
# $252" -- and nothing checked a percentage or a direction word. On 2026-08-26
# one issue shipped four figures, every one contradicted by its own price table
# eight lines below:
#
#   prose "Live cattle gave back 0.8%"        board  cattle  +0.09%
#   prose "feeders ... up a tenth of a percent" board feeders -0.37%
#   prose "WTI printed flat at $80.29"        board  crude   +2.04%
#   prose "Wheat ... adding 4.5 cents"        board  wheat   +37.0c, +5.34%
#
# Two of the four were wrong about DIRECTION, and 0.8% appears on no row of the
# board at all -- it is not a transposition to be swapped, it is a hand-typed
# number. That is the class this closes: a fact exists in a file and a second
# process states it independently without checking.
#
# IT BINDS ONLY WHAT IT CAN RESOLVE. A sentence naming two instruments, or
# carrying spread/basis/curve context, or quoting a percentage that is plainly
# not a price move (condition ratings, crop progress, moisture, an interest
# rate) is left alone. A guard that fires on good prose gets switched off.

# ── THE VOCABULARY WAS NARROWER THAN THE MARKET'S ────────────────────────────
# Probed 2026-09-01 against ordinary board prose. These all read as NO MOVE AT
# ALL and so could never disagree with anything:
#
#   down:  giving back · gives back · pared · paring · sliding · backed off
#          erased · trimmed · surrendered · softened
#   up:    tacked on · tacking on
#
# "gave back" was in the list and "giving back" was not, which is the shape of
# every gap here: one inflection of a phrase, and the guard goes quiet on the
# rest. Widened below. `pared` is spelled out rather than `par\w*` because that
# would swallow part, particular and parity.
_MOVE_UP = re.compile(r'\b(add\w*|gain\w*|firm\w*|rose|rise|rising|climb\w*|advanc\w*|'
                      r'higher|up|rall\w+|strengthen\w*|reclaim\w*|jump\w*|lift\w*|'
                      r'tack\w+ on)\b', re.I)
_MOVE_DN = re.compile(r'\b(g[aiu]v\w* back|give back|lost|los\w+|slid\w*|slide|slipp\w*|'
                      r'fell|fall\w*|drop\w*|declin\w*|weaken\w*|lower|down|sank|sink\w*|'
                      r'retreat\w*|eas\w+|shed|shav\w*|pared|paring|pares|back(?:ed)? off|'
                      r'eras\w*|trimm\w*|surrender\w*|soften\w*)\b', re.I)
_MOVE_FLAT = re.compile(r'\b(flat|unchanged|steady|little changed|barely (?:moved|budged))\b', re.I)
# A percentage that is not a price move. Ratings and crop progress are the ones
# that actually appear; the rest are cheap insurance.
# A percentage carrying any of these is not the session's close-to-close move.
# "down 1.4% on the day after giving back an early 4% gain" contains one figure
# that binds and one that must not; "sent Asian crude up 4% overnight" is
# another market and another window.
_PCT_PERIOD = re.compile(
    r'\b(overnight|early|intraday|at one point|off (?:its|the) (?:high|low)|from (?:its|the) (?:high|low)|'
    r'week\w*|month\w*|year\w*|ytd|year[- ]to[- ]date|session[- ]high|since|so far|'
    r'annualis\w+|annualiz\w+|52[- ]week|five[- ]year|average)\b', re.I)
_PCT_NOT_PRICE = re.compile(
    r'\b(good[- ]to[- ]excellent|condition\w*|rating\w*|progress|planted|emerged|harvest\w*|'
    r'dough|dent|silking|podd\w*|moisture|protein|test weight|share|of the crop|'
    r'unemploy\w*|inflation|interest rate|coverage level|probability|odds)\b', re.I)
_CENTS = re.compile(r'\b(\d+(?:[.\u00bd]\d+)?|\d+)\s?(?:cents|cent|\u00a2)\b', re.I)
_SENT_SPLIT = re.compile(r'(?<=[.!?])\s+|\n+')
_FLAT_BAND = 0.25   # |pct| under this may honestly be called flat
_PCT_TOL   = 0.15   # percentage points
_CENT_TOL  = 1.5    # cents


def _instruments_in(sentence):
    """locked_prices keys named in this sentence, longest keyword first so
    'live cattle' is not also counted as 'cattle'."""
    s = sentence.lower()
    found, spans = {}, []
    for kw in sorted(COMM, key=len, reverse=True):
        i = s.find(kw)
        while i >= 0:
            if not any(a <= i < b for a, b in spans):
                spans.append((i, i + len(kw)))
                found[COMM[kw][0]] = COMM[kw]
            i = s.find(kw, i + 1)
    return found


def _same_board(a, b):
    """Two issues carrying an identical board are the same session.

    THE ARCHIVE PUBLISHES ON WEEKENDS AND HOLIDAYS, and those issues carry the
    previous close forward unchanged. Taking the file immediately before today
    therefore compared Monday against Sunday -- both holding Friday's closes --
    and every change came out 0.00%, which failed every figure in the issue.
    Measured on 45 archived issues: it flagged 96% of them. A guard that blocks
    96% of sends is not a guard.

    A whole board identical to the cent is a non-trading day, not a
    coincidence, so walk back until the board actually moves.
    """
    shared = [k for k in a if k in b and isinstance(a[k], (int, float)) and isinstance(b[k], (int, float))]
    if len(shared) < 3:
        return False
    return all(abs(a[k] - b[k]) < 1e-9 for k in shared)


def _prior_locked(archive_dir, today, cur=None):
    """The most recent archived issue's locked_prices before today."""
    try:
        import glob as _glob
        files = sorted(_glob.glob(os.path.join(archive_dir, '20*.json')))
        for f in reversed(files):
            stem = os.path.basename(f)[:10]
            if stem >= today.isoformat():
                continue
            lp = (json.load(open(f, encoding='utf-8')) or {}).get('locked_prices') or {}
            if lp and not _same_board(lp, cur or {}):
                return lp, stem
    except Exception as e:
        # NOT a bare pass. The first version swallowed a NameError from a
        # missing `import os` and reported "no earlier archived issue found",
        # which reads like a data condition and was a code fault. A guard that
        # hides its own breakage is worse than no guard.
        return {}, '!' + type(e).__name__ + ': ' + str(e)[:60]
    return {}, None


def _change_for(key, daily, prior, grain):
    """The session's move, LOCKED CLOSE TO LOCKED CLOSE.

    NOT from live prices.json, and this is the whole point. prices.json is
    rewritten every half hour all day; the issue locked its prices once, in the
    morning. Comparing prose written at 11:34 against a board read at 22:08 is
    comparing two different sessions, and it manufactures failures that are not
    there.

    It did exactly that on the first run of this guard: it flagged "Live cattle
    gave back 0.8%" and "feeders up a tenth of a percent" as contradictions.
    Locked to locked, cattle went 220.075 -> 218.25 = -0.83% and feeders
    333.575 -> 333.80 = +0.07%. BOTH SENTENCES WERE CORRECT. The board printed
    in the email beside them was the wrong number, because that table pairs a
    locked price with a live percentage.

    A guard that cries wolf gets turned off, and this one nearly shipped doing
    it. The archive is the only source that is self-consistent with the prose.
    """
    lp = daily.get('locked_prices') or {}
    a, b = prior.get(key), lp.get(key)
    if not isinstance(a, (int, float)) or not isinstance(b, (int, float)) or not a:
        return None, None
    pct = 100.0 * (b - a) / a
    net = (b - a) * 100 if grain else (b - a)
    return pct, net



def _near(sent, key, verb_re, window=35):
    """Is the direction verb actually next to the instrument it is credited to?"""
    low = sent.lower()
    m = verb_re.search(sent)
    if not m:
        return False
    for kw, (lpk, _p, _g) in COMM.items():
        if lpk != key:
            continue
        i = low.find(kw)
        while i >= 0:
            if min(abs(m.start() - (i + len(kw))), abs(i - m.end())) <= window:
                return True
            i = low.find(kw, i + 1)
    return False


def _quotes_price(sent, locked_val):
    """Does the sentence quote this instrument's own locked price?"""
    if not isinstance(locked_val, (int, float)) or not locked_val:
        return False
    for m in DOLLAR.finditer(sent):
        try:
            v = float(m.group(1))
        except ValueError:
            continue
        if abs(v - locked_val) <= max(0.02, abs(locked_val) * 0.005):
            return True
    return False


def check_number_binding(daily, F, W, archive_dir='data/daily-archive', today=None, strict=False):
    """WARN, NEVER BLOCK, and here is the measurement that decided that.

    Run over the last 60 archived issues, this flags:

        all four rules   56 of 60 issues (93%)   320 failures
        flat + dir only  28 of 60 (47%)           54
        flat only        12 of 60 (20%)           17

    A gate that blocks 93% of sends is not a gate. The magnitude rules are the
    noisy ones: free prose legitimately rounds ("ran 6.9%" for +7.19%), quotes
    a different window ("up 4% overnight"), and discusses nearby and new-crop
    in one sentence while locked_prices has one key for each. I could not
    adjudicate all 17 flat hits against the real market, and several are
    plainly genuine -- natural gas "barely moved" on -3.90%, wheat "effectively
    unchanged" on +2.93% -- so the rule is earning its keep as a prompt for a
    human, not as an authority.

    What IS proven: on 2026-08-26 it caught wheat "adding 4.5 cents" against a
    25.75-cent session and crude "printed flat" against -2.81%, and it did NOT
    fire on cattle "gave back 0.8%" or feeders "up a tenth", both of which are
    correct. Precision on that issue was 100%.

    Promote to strict only after re-running the archive sweep and getting a
    number you would stand behind. --bind-strict exists for that experiment.
    """
    # ── ONE OF THESE RULES IS SHARP ENOUGH TO BLOCK, AND HERE IS THE SWEEP ──
    #
    # The docstring above measured the four rules together and found them too
    # noisy to block on: 93% of issues. That is still true of magnitude. It is
    # NOT true of DIRECTION AT SIZE, and the difference is measurable.
    #
    # Swept 2026-09-01 over 173 archived issues, counting direction
    # disagreements by the size of the move the board actually printed:
    #
    #     |move| >= 0.0%   76 hits   48 issues   27.7%
    #     |move| >= 1.0%   36 hits   28 issues   16.2%
    #     |move| >= 2.0%   20 hits   17 issues    9.8%   <- this line
    #     |move| >= 3.0%   12 hits   10 issues    5.8%
    #
    # AND EVERY ONE OF THE NINETEEN AT 2% IS INDEFENSIBLE. Read them: hogs
    # "give back" on a +15.71% session, twice in one issue; hogs "added" on
    # -14.16%; cattle "up" on -3.01% (2026-09-01, the issue that prompted this);
    # natgas "dropped" on +3.92%; cattle "erasing" on +4.05%. There is no window,
    # no nearby-versus-new-crop
    # confusion and no rounding that produces those sentences. The honest
    # ambiguity the docstring describes -- "ran 6.9%" for +7.19%, "up 4%
    # overnight" -- all lives BELOW one percent, and stays a warning.
    #
    # So: a direction word against a two-percent move BLOCKS THE SEND, in every
    # mode, and everything else keeps behaving exactly as it did. Roughly one
    # blocked send a fortnight, each one naming the sentence and the number, and
    # a manual re-run fixes it in two minutes.
    #
    # This is the house rule everywhere else in these repositories: the applier
    # refuses rather than filing a wrong number, the price panel withdraws
    # rather than picking a winner between two towns. A briefing that tells a
    # grower cattle went up on a day they fell three percent is the same defect,
    # and it has been going out.
    HARD = F
    DIR_BLOCK_PCT = 2.0

    if not strict:
        F = W
    # THE BRIEFING'S OWN DATE, not the calendar's. The archive contains today's
    # issue too, so anchoring on dt.date.today() picked the issue under test as
    # its own predecessor and every change came out as exactly zero -- which
    # then failed every figure in the file for disagreeing with nothing.
    ref = None
    for cand in (daily.get('date'), str(daily.get('generated_at') or '')[:10]):
        try:
            ref = dt.date.fromisoformat(str(cand)[:10]); break
        except Exception:
            continue
    ref = ref or today or dt.date.today()
    prior, prior_day = _prior_locked(archive_dir, ref, daily.get('locked_prices') or {})
    if not prior:
        if prior_day and prior_day.startswith('!'):
            F('bind:broken', 'number binding could not read the archive (%s)' % prior_day[1:])
        else:
            W('bind:no-prior', 'no earlier archived issue found; number binding skipped')
        return
    for loc, text in prose_fields(daily):
        for sent in _SENT_SPLIT.split(text):
            if not sent.strip():
                continue
            if STRUCT_CTX.search(sent):
                continue                      # spreads and basis cite several contracts
            inst = _instruments_in(sent)
            if len(inst) != 1:
                continue                      # ambiguous, or nothing to bind to
            key, (lpk, _pk, grain) = next(iter(inst.items()))
            pct, net = _change_for(key, daily, prior, grain)
            lp_val = (daily.get('locked_prices') or {}).get(key)
            if pct is None:
                continue

            # --- percentages -------------------------------------------------
            if not _PCT_NOT_PRICE.search(sent):
                for m in PCT.finditer(sent):
                    lo_i, hi_i = max(0, m.start() - 45), min(len(sent), m.end() + 45)
                    if _PCT_PERIOD.search(sent[lo_i:hi_i]):
                        continue
                    claim = float(m.group(1))
                    if abs(abs(claim) - abs(pct)) > _PCT_TOL:
                        F('bind:pct',
                          '%s says %s%% for %s but the board says %+.2f%% -- "%s"'
                          % (loc, m.group(1), key, pct, sent.strip()[:110]))
                    elif m.group(1)[0] in '+-' and claim * pct < 0:
                        # ONLY WHEN THE WRITER SIGNED IT. "gave back 0.8%" is
                        # correct English for a -0.83% session; the sign lives
                        # in the verb, and the direction check below owns that.
                        # Flagging unsigned magnitudes made the guard call a
                        # true sentence false on its first run.
                        F('bind:pct-sign',
                          '%s says %s%% for %s and the board moved %+.2f%% -- "%s"'
                          % (loc, m.group(1), key, pct, sent.strip()[:110]))

            # --- cents, grains only ------------------------------------------
            if grain and net is not None:
                for m in _CENTS.finditer(sent):
                    try:
                        claim = float(str(m.group(1)).replace('\u00bd', '.5'))
                    except ValueError:
                        continue
                    if abs(claim - abs(net)) > _CENT_TOL:
                        F('bind:cents',
                          '%s says %s cents for %s but the board moved %+.1f cents -- "%s"'
                          % (loc, m.group(1), key, net, sent.strip()[:110]))

            # --- direction words ---------------------------------------------
            # BOUND ONLY WHEN THE SENTENCE IS PLAINLY ABOUT THIS PRICE: the verb
            # sits within 35 characters of the instrument, and the sentence
            # quotes that instrument's own locked price. Both guards were added
            # after false positives on the first run:
            #   "offset any LIFT from the Iran-Oman talks"  -- a negated verb
            #      ninety characters away, read as "crude went up"
            #   "barrels ADDED to US crude stocks last week" -- a quantity, not
            #      a price, and there is no dollar figure in the sentence at all
            if not _quotes_price(sent, lp_val):
                continue
            if _MOVE_FLAT.search(sent) and _near(sent, key, _MOVE_FLAT) and abs(pct) >= _FLAT_BAND:
                F('bind:flat',
                  '%s calls %s flat but the board moved %+.2f%% -- "%s"'
                  % (loc, key, pct, sent.strip()[:110]))
            up, dn = _MOVE_UP.search(sent), _MOVE_DN.search(sent)
            wrong = ((up, not dn, _MOVE_UP, 'UP',   pct < -_FLAT_BAND),
                     (dn, not up, _MOVE_DN, 'DOWN', pct > _FLAT_BAND))
            for hit, alone, rx, word, contradicts in wrong:
                if not (hit and alone and _near(sent, key, rx) and contradicts):
                    continue
                big = abs(pct) >= DIR_BLOCK_PCT
                (HARD if big else F)(
                    'bind:dir',
                    '%s has %s moving %s ("%s") but the board says %+.2f%%%s -- "%s"'
                    % (loc, key, word, hit.group(0), pct,
                       '  [BLOCKING: past the %.1f%% line]' % DIR_BLOCK_PCT if big else '',
                       sent.strip()[:110]))


def wasde_fabrication_hits(daily, today=None):
    """THE fabricated-WASDE scan, single definition (the usda_dates/iso_date
    pattern). Returns (hits, next_wasde_date) where hits is a list of
    (field_path, matched_text) for past-tense WASDE-result claims made while
    the next report's results are not yet public; ([], nw) means clean or the
    window doesn't apply. Raises on internal error — the caller decides
    whether that's a WARN (the gate) or a skip (the generator's self-heal).

    Used by run() below AND by generate_daily's self-heal retry: on
    2026-08-12 (WASDE morning) the model fabricated the report in two
    independent generations; the gate blocked both sends, but a blocked
    morning is still no briefing. The generator now runs THIS scan on its own
    draft and regenerates once with the offending lines quoted back, so the
    gate goes back to being the backstop instead of the only working layer."""
    import usda_dates, grade_calls, datetime as _dtmod
    _today = today or grade_calls.iso_date(daily)
    _tdate = _dtmod.date.fromisoformat(_today) if isinstance(_today, str) else _today
    _gen = None
    try:
        _gen = _dtmod.datetime.fromisoformat((daily.get("generated_at") or "").replace("Z", "+00:00"))
    except ValueError:
        pass
    _nw = usda_dates.next_wasde(_tdate) if _tdate else None
    if not _tdate or usda_dates.wasde_results_are_public(_tdate, _gen):
        return [], _nw
    _verbs = r"(?:landed|printed|delivered|dropped|confirmed|showed|came\s+in|is\s+in|absorbed?)"
    _pat = re.compile(r"WASDE\b[^.!?\n]{0,60}?\b" + _verbs, re.I)
    _months = ("january","february","march","april","may","june","july","august",
               "september","october","november","december")
    _this_month = _months[_nw.month - 1] if _nw else None
    _fields = prose_fields(daily)
    _wt = (daily.get("weekly_thread") or {})
    if _wt.get("status_text"): _fields.append(("weekly_thread.status_text", str(_wt["status_text"])))
    hits = []
    for _loc, _txt in _fields:
        for _m in _pat.finditer(_txt):
            _back = _txt[max(0, _m.start() - 30):_m.start()].lower()
            _named = [mo for mo in _months if mo in _back]
            if _named and _this_month not in _named:
                continue   # talking about a previous month's report — history
            hits.append((_loc, _m.group(0)[:80]))
    return hits, _nw


def run(daily, prices=None, today=None, archive_dir='data/daily-archive', bind_strict=False):
    today=today or dt.date.today()
    issues=[]; F=lambda c,m:issues.append(('FAIL',c,m)); W=lambda c,m:issues.append(('WARN',c,m))
    lp=daily.get('locked_prices') or {}
    quotes=(prices or {}).get('quotes',{}) if prices else {}

    # 0) feed defense-in-depth: re-run contamination check on the prices the briefing used
    if prices and preflight_prices:
        ok,fi,_=preflight_prices.run(prices, repair=False)
        for s,c,m in fi:
            if s=='FAIL': F('feed:'+c, m)

    # 1) locked_prices MUST still match the (clean) feed  -- the June-23 killer
    for comm,(lpk,pk,grain) in {v[0]:v for v in [(x[1][0],x[1]) for x in COMM.items()]}.items() if False else \
         {lk:(lk,pk,gr) for (_,(lk,pk,gr)) in COMM.items()}.items():
        if lpk in lp and pk in quotes and quotes[pk].get('close') is not None:
            feed=float(quotes[pk]['close'])/(100 if grain else 1)
            if abs(float(lp[lpk])-feed)>max(0.02,abs(feed)*0.002):
                F('locked-drift','locked_prices.%s=%s but clean feed says %.4f (locked built from bad data?)'
                  %(lpk,lp[lpk],feed))

    fields=prose_fields(daily)
    blob=' '.join(v for _,v in fields).lower()

    # 2) max real move (for drama-evidence) from the feed
    max_pct=0.0
    for pk in {v[1] for v in COMM.values()}:
        q=quotes.get(pk)
        if q and q.get('pctChange') is not None: max_pct=max(max_pct,abs(float(q['pctChange'])))

    # 3) banned verbs (always block) + drama/superlative ONLY when dramatizing a
    # small PRICE move. A drama word in a news/weather sentence ("worst drought")
    # is legitimate; the gate only fires when the sentence is about a commodity's
    # price AND the actual move is small. Prevents false blocks on ag-news prose.
    # Banned drama verbs are handled inside the context-aware loop below, with the
    # SAME guards as the drama-evidence check: only flagged in a real price sentence,
    # skipped in news/educational blocks and structural (carry/spread) sentences, and
    # logged as a WARN — not a hard FAIL. So "the carry could collapse", "demand
    # collapse", or a news headline never blocks the send. The critic's voice pass
    # (Rule 9) is the primary editor for drama verbs; the gate is a visibility backstop.
    _PRICECTX = re.compile(r'\$\d|\d+(?:\.\d+)?\s?%|\bclos|\bsettl|\blevel\b|\bcontract\b|\bfutures\b')
    for loc, text in fields:
        if loc.startswith('outside_the_pit') or loc.startswith('the_more_you_know'):
            continue  # news + educational blocks legitimately use strong adjectives
        for sent in re.split(r'(?<=[.!?])\s+', text):
            sl = sent.lower()
            price_ctx = any(k in sl for k in COMM) and bool(_PRICECTX.search(sl))
            if not price_ctx:
                continue
            if STRUCT_CTX.search(sl):
                continue  # "biggest carry" / "dramatic curve" describe structure, not a move
            _dsnip=(sent[:130]+'…') if len(sent)>130 else sent
            bh = [w for w in BANNED if w in sl]
            if bh:
                W('banned-verb', '%s: drama verb %s in a price sentence | "%s"' % (loc, bh, _dsnip))
            dh = [w for w in DRAMA if w in sl]
            if dh and max_pct < 3.0:
                W('drama-evidence', '%s: drama %s but largest real move is %.2f%% | "%s"'
                  % (loc, dh, max_pct, _dsnip))
            sh = [w for w in SUPER if w in sl]
            if sh and not daily.get('superlative_evidence'):
                W('superlative', '%s: superlative %s on a price claim (verify it is backed)' % (loc, sh))

    # 4) level coherence (deterministic Rule 14) — per sentence, per commodity.
    # Band-guard: only compare a $level to a commodity if the level is plausibly
    # THAT commodity's own price (so a $73 crude level is never matched to $3 natgas).
    # Skip forward-looking watch_list / spread_to_watch (those are predictions,
    # not assertions about today's close).
    LEVEL_BAND = {'corn':(2,9),'beans':(7,20),'wheat':(3,15),'cattle':(90,360),
                  'feeders':(180,460),'hogs':(40,160),'crude':(20,160),'natgas':(1,30)}
    for loc,text in fields:
        if loc.startswith('watch_list') or loc.startswith('spread_to_watch'):
            continue
        for sent in re.split(r'(?<=[.!?])\s+', text):
            sl=sent.lower()
            if STRUCT_CTX.search(sl):
                continue  # spread/carry sentence cites multiple contracts; nearby-price check is invalid
            kw_pos=[]
            for kw,(lpk,pk,grain) in COMM.items():
                i=sl.find(kw)
                if i>=0 and lpk in lp and lpk in LEVEL_BAND:
                    kw_pos.append((i,kw,lpk))
            if not kw_pos:
                continue
            for m in DOLLAR.finditer(sent):
                level=float(m.group(1))
                # tie this $ to the NEAREST commodity word, not every one in the sentence
                # (so "wheat settled at $5.88" is never checked against corn)
                kpos,kw,lpk=min(kw_pos, key=lambda t: abs(t[0]-m.start()))
                blo,bhi=LEVEL_BAND[lpk]
                if not (blo <= level <= bhi):
                    continue  # this $ is not THIS commodity's price line
                lv=float(lp[lpk])
                _snip=(sent[:140]+'…') if len(sent)>140 else sent
                if DROP_VERB.search(sl) and lv> level*(1+LEVEL_TOL):
                    W('level','%s: %s close $%.4f did not break below $%s | "%s"'%(loc,lpk,lv,level,_snip))
                if HOLD_VERB.search(sl) and lv< level*(1-LEVEL_TOL):
                    W('level','%s: %s close $%.4f did not hold above $%s | "%s"'%(loc,lpk,lv,level,_snip))

    # 5) %-move claims near a commodity reconcile to feed pct
    for loc,text in fields:
        for sent in re.split(r'(?<=[.!?])\s+', text):
            sl=sent.lower()
            for kw,(lpk,pk,grain) in COMM.items():
                if kw in sl:
                    q=quotes.get(pk)
                    if not q or q.get('pctChange') is None: continue
                    real=abs(float(q['pctChange']))
                    for m in PCT.finditer(sent):
                        v=abs(float(m.group(1)))
                        tail=sent[m.end():m.end()+18].lower()
                        if any(x in tail for x in ['above','below','year','inventory','of ']): continue
                        if v>0.05 and abs(v-real)>0.2:
                            W('pct','%s: %s%% near "%s" vs feed %.2f%%'%(loc,m.group(1),kw,float(q['pctChange'])))

    # 6) calendar weekday vs date — watch_list only. Prose/section bodies may cite
    # historical dates whose weekday is correct for a prior year; assuming today's
    # year there causes false positives. The forward report calendar is what matters.
    for loc,text in fields:
        if not loc.startswith('watch_list'):
            continue
        for m in WEEKDATE.finditer(text):
            wd,mon,day=m.group(1),m.group(2),int(m.group(3))
            try:
                d=dt.date(today.year, dt.datetime.strptime(mon,'%B').month, day)
                if d.strftime('%A')!=wd: F('calendar','%s: "%s %s %d" is a %s'%(loc,wd,mon,day,d.strftime('%A')))
            except ValueError: F('calendar','%s: invalid date %s %d'%(loc,mon,day))

    # 6b) News-base coverage floor.
    #
    # The briefing LEADS on news. Until now the only record of how much news it
    # actually had was a stderr line: the 2026-07-15 run pulled 9 of 22 feeds and
    # shipped anyway, because nothing checked. That is a silent quality collapse
    # -- no error, just thinner prose leaning on whichever feeds still answer,
    # under a source_summary the model wrote itself.
    #
    # Deliberately a WARNING, not a hard block, at the soft floor: feeds break for
    # reasons outside our control (WAFs, datacenter-IP blocks, holidays), and per
    # doctrine only deterministic data-integrity checks earn a hard block. But at
    # the hard floor the briefing has essentially no news base, and a news-led
    # product with no news should not go out under a confident source list.
    # Floors retuned 2026-07-18 for the post-probe 17-feed list (was 12/4 of 22:
    # the probe found 5 feeds permanently dead from Azure and they were dropped,
    # so 22-era floors would be measuring against feeds that no longer exist).
    # Same proportions: warn below ~54% of the base, block at/below ~18%.
    NEWS_WARN_AT = 9       # of 17 — below this, coverage is degraded
    NEWS_BLOCK_AT = 3      # at or below this, there is no news base at all
    cov = (daily.get('meta') or {}).get('news_coverage') or {}
    if not cov or not cov.get('total'):
        W('news-coverage', 'no meta.news_coverage recorded — generator too old to measure it')
    else:
        ok, tot, items = cov.get('ok', 0), cov.get('total', 0), cov.get('items', 0)
        if ok <= NEWS_BLOCK_AT:
            F('news-coverage', 'only %d/%d feeds returned content (%d items) — no news base'
              % (ok, tot, items))
        elif ok < NEWS_WARN_AT:
            W('news-coverage', '%d/%d feeds returned content (%d items); dark: %s'
              % (ok, tot, items, ', '.join(cov.get('dark', [])[:6])))

    # 7) HTML in body (Rule 16) + emoji + email + scope + honest-copy
    for loc,text in fields:
        if re.search(r'</?(strong|em|b|i)>', text): F('html','%s contains raw HTML tag (use markdown)'%loc)
    if re.search(r'[\U0001F300-\U0001FAFF]', blob): F('emoji','emoji-as-UI in prose')
    for e in set(re.findall(r'[\w.\-]+@[\w.\-]+', blob)):
        if e!='sig@farmers1st.com': F('contact','non-canonical email: %s'%e)
    if re.search(r'\b(wisconsin|minnesota)\b[^.]{0,30}\bfarmers\b', blob): F('scope','regional restriction in copy')
    for bad in ['free forever','no ads ever','no paywalls ever','never any ads']:
        if bad in blob: F('honest-copy','prohibited claim: "%s"'%bad)

    # 8) unbacked section (names a market with no locked price AND no quote)
    for i,s in enumerate(daily.get('sections') or []):
        t=(s.get('title') or '').lower()
        for kw,(lpk,pk,grain) in COMM.items():
            if kw in t and lpk not in lp and pk not in quotes:
                if re.search(re.escape(kw)+r'[^.]{0,40}(\$|\d+(?:\.\d+)?\s?%|settl|clos)', (s.get('body') or '').lower()):
                    F('unbacked','sections[%d] "%s" discusses %s with no price data'%(i,s.get('title'),kw))

    # 9) self-reported clean flags
    if daily.get('price_validation_clean') is False: F('selfflag','generator set price_validation_clean=false')
    if not (daily.get('critic_pass') or {}).get('final_scores'): W('critic','no critic_pass.final_scores present')

    # call-outcome honesty: recompute yesterday's call from prices (direction AND
    # level); the published outcome must match. Blocks a miss scored as a win.
    try:
        import os, grade_calls
        yc = daily.get("yesterdays_call") or {}
        if yc.get("outcome") and archive_dir and os.path.isdir(archive_dir):
            dates = sorted(p[:-5] for p in os.listdir(archive_dir)
                           if p.endswith(".json") and p != "index.json")
            # Was: d < daily["date"] — an ISO name compared against a DISPLAY date
            # ("2026-08-10" < "Monday, August 10, 2026" is always true), so prior[-1]
            # was TODAY'S OWN archive: this gate re-graded today's call against
            # today's close and disagreed with the (correct) grader, blocking the
            # 2026-08-10 send. Same definition as grade_calls now — one source.
            today_iso = grade_calls.iso_date(daily)
            if today_iso is None:
                W("call-outcome", "cannot parse briefing date %r to ISO — outcome not verified"
                  % (daily.get("date"),))
                prior = []
            else:
                prior = [d for d in dates if d < today_iso]
            if prior:
                with open(os.path.join(archive_dir, prior[-1] + ".json")) as _f:
                    prior_daily = json.load(_f)
                computed, _c, _p0, _p1, note = grade_calls.grade_from_archives(daily, prior_daily)
                if computed and computed != "pending" and yc["outcome"] != computed:
                    F("call-outcome", "yesterdays_call.outcome=%r but prices compute %r (%s)"
                      % (yc["outcome"], computed, note))
    except Exception as _e:
        # A silent pass here means the honesty check quietly did nothing and the
        # log looks identical to a clean verify. Say so instead.
        W("call-outcome", "outcome verification could not run (%s: %s)"
          % (type(_e).__name__, _e))

    # ── call-design v2: level-band advisory (2026-08-13) ──────────────────
    # WARN, never FAIL: a level outside the one-session band is a design
    # smell, not a falsehood — the gate blocks lies, not ambition. The band
    # is the same computation the generator saw (call_calibration, single
    # definition), so a WARN here means the model ignored its own brief.
    try:
        tc = daily.get("todays_call")
        if isinstance(tc, dict) and tc.get("instrument") and tc.get("level") is not None:
            import call_calibration
            _key = grade_calls.locked_key(tc.get("instrument"))
            _close = (daily.get("locked_prices") or {}).get(_key) if _key else None
            if _close is not None:
                status, detail = call_calibration.band_check(tc, _close, archive_dir)
                if status in ("too_far", "too_near"):
                    W("call-band", detail)
    except Exception as _e:
        W("call-band", "band check could not run (%s: %s)" % (type(_e).__name__, _e))

    # ── fabricated-release check (2026-08-11 incident) ────────────────────
    # Tuesday Aug 11's briefing shipped "WASDE DELIVERS" / "The WASDE landed"
    # a full day before the report existed — Monday's weekly thread misdated
    # the release and Tuesday's model resolved the thread against an event
    # that had not happened. Prices were clean, so no gate fired. This one
    # does: past-tense claims about WASDE results are a hard FAIL until the
    # print is actually public (a prior day, or 16:00Z on release day —
    # `weekly_thread.status_text` included). A month word other than the
    # upcoming report's month exempts a match ("the July WASDE printed ..."
    # is history, not fabrication).
    try:
        _hits, _nw = wasde_fabrication_hits(daily, today)
        for _loc, _snip in _hits:
            F("wasde-fabricated",
              "%s describes WASDE results before the release exists (next WASDE %s): %r"
              % (_loc, _nw.isoformat() if _nw else "?", _snip))
    except Exception as _e:
        W("wasde-fabricated", "release check could not run (%s: %s)" % (type(_e).__name__, _e))

    # Prose figures must agree with the board this same issue prints.
    try:
        check_number_binding(daily, F, W, archive_dir, today, bind_strict)
    except Exception as _e:
        W('bind:error', 'number binding could not run (%s: %s)' % (type(_e).__name__, _e))

    passed=not any(s=='FAIL' for s,_,_ in issues)
    return passed, issues

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('daily', nargs='?', default='data/daily.json')
    ap.add_argument('--prices', default='data/prices.json')
    ap.add_argument('--bind-strict', action='store_true',
                    help='make number-binding contradictions BLOCK (measured 93%% flag rate; see check_number_binding)')
    a=ap.parse_args()
    daily=json.load(open(a.daily))
    prices=None
    try: prices=json.load(open(a.prices))
    except Exception: pass
    passed,issues=run(daily,prices,bind_strict=a.bind_strict)
    for s,c,m in issues: print(f'  [{s:5}] {c}: {m}')
    print('RESULT:', 'PASS ✅ — clear to send' if passed else 'BLOCK ❌ — do not send')
    sys.exit(0 if passed else 1)

if __name__=='__main__': main()
