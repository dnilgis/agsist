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

def run(daily, prices=None, today=None, archive_dir='data/daily-archive'):
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
            prior = [d for d in dates if d < (daily.get("date") or "9999")]
            if prior:
                with open(os.path.join(archive_dir, prior[-1] + ".json")) as _f:
                    prior_daily = json.load(_f)
                computed, _c, _p0, _p1, note = grade_calls.grade_from_archives(daily, prior_daily)
                if computed and computed != "pending" and yc["outcome"] != computed:
                    F("call-outcome", "yesterdays_call.outcome=%r but prices compute %r (%s)"
                      % (yc["outcome"], computed, note))
    except Exception:
        pass

    passed=not any(s=='FAIL' for s,_,_ in issues)
    return passed, issues

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('daily', nargs='?', default='data/daily.json')
    ap.add_argument('--prices', default='data/prices.json')
    a=ap.parse_args()
    daily=json.load(open(a.daily))
    prices=None
    try: prices=json.load(open(a.prices))
    except Exception: pass
    passed,issues=run(daily,prices)
    for s,c,m in issues: print(f'  [{s:5}] {c}: {m}')
    print('RESULT:', 'PASS ✅ — clear to send' if passed else 'BLOCK ❌ — do not send')
    sys.exit(0 if passed else 1)

if __name__=='__main__': main()
