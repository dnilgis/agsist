#!/usr/bin/env python3
"""
send_daily.py — render the PUBLISHED AGSIST Daily into a clean, reforwardable
HTML+text email and send it via Gmail SMTP. Drop-in for send_morning_brief.py.

Runs in GitHub Actions AFTER the gate passes, so the email is always in sync with
what published — zero manual content entry, nothing to fill in while you're away.

Reads
  data/daily.json            real schema (generated_at, headline, lead, the_takeaway,
                             yesterdays_call{summary,note,outcome,computed},
                             sections[]{title,body,bottom_line,conviction_level},
                             locked_prices{corn,corn-dec,beans,beans-nov,...},
                             spread_to_watch, one_number, watch_list, daily_quote, sponsor)
  data/prices.json           per-instrument pctChange for the "At the close" column
  data/scorecard.json        optional — hit rate / total for the track-record line
  data/email_recipients.json optional {"to":[...],"bcc":[...]}  (env overrides win)

Env (GitHub secrets, already present for notify_critic_status.py)
  GMAIL_USER  GMAIL_APP_PASS   EMAIL_TO (optional, defaults to GMAIL_USER)   EMAIL_BCC (optional)

Modes   (default)=send   --dry-run=write data/daily-email/<iso>.html+.txt, no send   --force=skip safety
Safety  refuses to send a brief whose generated_at is not today, or price_validation_clean=false.
"""
import json, os, sys, argparse, smtplib, datetime as dt
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from pathlib import Path

SITE="https://agsist.com/"; SUBSCRIBE="https://agsist.com/"; CONTACT="sig@farmers1st.com"

INK="#141414"; BODY="#2b2b2b"; DIM="#6f6f6f"; FAINT="#9a9a9a"
GOLD="#a8771a"; GREEN="#2e7d32"; HAIR="#e6e3dd"
UP="#1f7a4d"; DOWN="#b3402f"; FLAT="#8a8a8a"; CALLOUT_BG="#faf6ea"

# (label, locked_prices key, prices.json quotes key) — front-month, the standard "close" basis
PRICE_ROWS=[("Corn","corn","corn"),("Soybeans","beans","beans"),("Wheat","wheat","wheat"),
            ("Oats","oats","oats"),("Live Cattle","cattle","cattle"),("Feeder Cattle","feeders","feeders"),
            ("Lean Hogs","hogs","hogs"),("Class III Milk","milk","milk"),
            ("WTI Crude","crude","crude"),("Nat Gas","natgas","natgas")]
CONV={"high":(GOLD,"HIGH"),"medium":(GOLD,"MEDIUM"),"low":(FLAT,"LOW")}
_ACR={"USDA","US","U.S.","CT","ET","AM","PM","WTI","CME","CBOT","OPEC","EIA","WASDE","AI","SCOTUS",
      "FIFRA","MT","CFTC","COT","EU","UK","OOI","Q1","Q2","Q3","Q4","NOAA","FAS","NASS"}


def esc(s):
    return (str(s).replace("&","&amp;").replace("<","&lt;").replace(">","&gt;")) if s is not None else ""


def smart_title(s):
    """De-shout an ALL-CAPS headline to title case while keeping known acronyms."""
    s=(s or "").strip()
    if not s or not s.isupper():
        return s
    out=[]
    for w in s.split(" "):
        core=w.strip(",.;:()&")
        out.append(w if core.upper() in _ACR else w.capitalize())
    return " ".join(out)


def iso_of(daily):
    ga=daily.get("generated_at")
    if isinstance(ga,str) and len(ga)>=10:
        return ga[:10]
    try:
        return dt.datetime.strptime(daily.get("date",""),"%A, %B %d, %Y").strftime("%Y-%m-%d")
    except Exception:
        return dt.date.today().strftime("%Y-%m-%d")


def load_json(path):
    try:
        return json.loads(Path(path).read_text())
    except Exception:
        return {}


def scorecard_line():
    sc=load_json("data/scorecard.json")
    if not sc:
        return ""
    summ = sc.get("summary") if isinstance(sc.get("summary"),dict) else sc
    rate = summ.get("hit_rate") or summ.get("rate") or summ.get("accuracy")
    tot  = summ.get("total") or summ.get("graded") or summ.get("n") or summ.get("count")
    if rate is None:
        return ""
    try:
        rate = f"{float(rate):.0f}" if float(rate).is_integer() else f"{float(rate):.1f}"
    except Exception:
        rate = esc(rate)
    return f" &nbsp;&middot;&nbsp; track record {rate}%" + (f" of {esc(tot)} calls" if tot else "")


def _pct(prices, pk):
    q=(prices.get("quotes") or {}).get(pk) if prices else None
    if not q:
        return None
    try:
        return float(q.get("pctChange"))
    except (TypeError,ValueError):
        return None


def _change(pct):
    if pct is None:
        return FLAT,""
    if abs(pct)<0.05:
        return FLAT,"flat"
    return (UP if pct>0 else DOWN), f"{'+' if pct>0 else '-'}{abs(pct):.1f}%"


def subject_line(daily):
    hl=smart_title(daily.get("headline") or "AGSIST Daily")
    try:
        short=dt.datetime.strptime(daily.get("date",""),"%A, %B %d, %Y").strftime("%b %-d")
    except Exception:
        short=dt.date.today().strftime("%b %-d")
    return f"AGSIST Daily \u00b7 {short} \u2014 {hl}"


def render_html(daily, prices):
    P=[]; a=P.append
    a('<body style="margin:0;padding:24px 14px;background:#ffffff;font-family:Arial,Helvetica,sans-serif;">')
    a('<div style="max-width:600px;margin:0 auto;">')

    mood=esc((daily.get("meta") or {}).get("market_mood") or "")
    a(f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
      f'<td style="font-size:18px;font-weight:800;letter-spacing:2px;color:{GREEN};">AGSIST&nbsp;DAILY</td>'
      f'<td align="right" style="font-size:11px;letter-spacing:1px;text-transform:uppercase;color:{DIM};'
      f'font-family:monospace;">{mood}</td></tr></table>')
    a(f'<div style="height:2px;background:{GOLD};margin:8px 0 4px;"></div>')
    a(f'<div style="font-size:12px;color:{DIM};font-family:monospace;">{esc(daily.get("date",""))}</div>')

    a(f'<h1 style="margin:16px 0 8px;color:{INK};font-size:21px;line-height:1.3;font-weight:800;">'
      f'{esc(smart_title(daily.get("headline","")))}</h1>')
    if daily.get("lead"):
        a(f'<p style="margin:0 0 14px;color:{BODY};font-size:15px;line-height:1.7;">{esc(daily.get("lead"))}</p>')

    if daily.get("the_takeaway"):
        a(f'<div style="margin:18px 0;background:{CALLOUT_BG};border-left:4px solid {GOLD};border-radius:3px;'
          f'padding:13px 16px;"><div style="font-size:10px;letter-spacing:1.5px;text-transform:uppercase;'
          f'font-family:monospace;color:{GOLD};font-weight:700;padding-bottom:3px;">The Takeaway</div>'
          f'<div style="font-size:14px;line-height:1.5;color:{INK};font-weight:600;">{esc(daily["the_takeaway"])}</div></div>')

    yc=daily.get("yesterdays_call") or {}
    if yc.get("summary") or yc.get("note"):
        outc=(yc.get("outcome") or "").lower()
        badge={"played_out":(UP,"&#10003; Played out"),"didnt":(DOWN,"&#10007; Didn&rsquo;t"),
               "pending":(FLAT,"&middot; Pending")}.get(outc,(FLAT,"&middot; "+esc(outc)))
        text=" ".join(x for x in (yc.get("summary"),yc.get("note")) if x)
        a(f'<div style="margin:20px 0 0;"><div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;'
          f'font-family:monospace;color:{DIM};padding-bottom:6px;">Yesterday&rsquo;s Call &nbsp;&middot;&nbsp; '
          f'<span style="color:{badge[0]};font-weight:700;">{badge[1]}</span>{scorecard_line()}</div>'
          f'<p style="margin:0;color:{BODY};font-size:14px;line-height:1.6;">{esc(text)}</p></div>')

    lp=daily.get("locked_prices") or {}
    rows=[]
    for label,lk,pk in PRICE_ROWS:
        if lk not in lp or lp[lk] in (None,""):
            continue
        try: lvl=float(lp[lk])
        except (TypeError,ValueError): continue
        color,txt=_change(_pct(prices,pk))
        rows.append((label,f"${lvl:,.2f}",color,txt))
    if rows:
        a(f'<div style="margin:24px 0 0;"><div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;'
          f'font-family:monospace;color:{DIM};padding-bottom:8px;">At the Close</div>'
          f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
          f'style="font-family:monospace;font-size:13px;border-top:2px solid {GREEN};">')
        for i,(label,price,color,txt) in enumerate(rows):
            bb="" if i==len(rows)-1 else "border-bottom:1px solid #efefef;"
            a(f'<tr><td style="padding:9px 0;{bb}color:{BODY};">{esc(label)}</td>'
              f'<td align="right" style="padding:9px 8px;{bb}color:{INK};">{price}</td>'
              f'<td align="right" style="padding:9px 0;{bb}color:{color};width:74px;">{esc(txt)}</td></tr>')
        a('</table></div>')

    for s in (daily.get("sections") or []):
        title=s.get("title") or ""; body=s.get("body") or ""
        if not (title or body):
            continue
        ck,cl=CONV.get((s.get("conviction_level") or "").lower(),(FLAT,""))
        tag=(f'<td align="right" style="color:{ck};font-size:11px;font-family:monospace;font-weight:700;'
             f'white-space:nowrap;padding-left:10px;">{cl}</td>') if cl else '<td></td>'
        a(f'<div style="margin:22px 0 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">'
          f'<tr><td style="color:{INK};font-size:15px;font-weight:800;">{esc(smart_title(title))}</td>{tag}</tr></table>'
          f'<p style="margin:6px 0 0;color:{BODY};font-size:14px;line-height:1.6;">{esc(body)}</p>')
        action=s.get("bottom_line") or s.get("farmer_action")
        if action:
            a(f'<p style="margin:6px 0 0;color:{GOLD};font-size:13px;line-height:1.5;font-weight:600;">'
              f'&rarr; {esc(action)}</p>')
        a('</div>')

    sp=daily.get("spread_to_watch") or {}
    if sp.get("label") or sp.get("commentary"):
        lvl=f' <span style="color:{INK};font-weight:700;">{esc(sp.get("level"))}</span>' if sp.get("level") else ""
        a(f'<div style="margin:22px 0 0;border-top:1px solid {HAIR};padding-top:14px;">'
          f'<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-family:monospace;'
          f'color:{GREEN};padding-bottom:3px;">Spread to Watch &middot; {esc(sp.get("label"))}</div>'
          f'<div style="font-size:14px;line-height:1.55;color:{BODY};">{lvl} {esc(sp.get("commentary"))}</div></div>')

    one=daily.get("one_number") or {}
    if one.get("value"):
        unit=f' <span style="font-size:14px;color:{DIM};">{esc(one.get("unit"))}</span>' if one.get("unit") else ""
        a(f'<div style="margin:22px 0 0;border-top:1px solid {HAIR};padding-top:14px;">'
          f'<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-family:monospace;'
          f'color:{DIM};padding-bottom:2px;">The Number</div>'
          f'<div style="font-size:24px;font-weight:800;color:{INK};line-height:1.25;">{esc(one.get("value"))}{unit}</div>'
          f'<div style="font-size:14px;line-height:1.55;color:{BODY};padding-top:5px;">{esc(one.get("context"))}</div></div>')

    wl=daily.get("watch_list") or []
    if wl:
        a(f'<div style="margin:22px 0 0;border-top:1px solid {HAIR};padding-top:14px;">'
          f'<div style="font-size:11px;letter-spacing:1.2px;text-transform:uppercase;font-family:monospace;'
          f'color:{DIM};padding-bottom:8px;">This Week&rsquo;s Watch List</div>'
          f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;line-height:1.5;">')
        for w in wl:
            t=w.get("time") or ""; d=w.get("desc") or ""
            if not d: continue
            a(f'<tr><td style="padding:6px 0;color:{BODY};"><span style="font-family:monospace;color:{GOLD};'
              f'font-size:12px;">{esc(t)}</span>{"<br>" if t else ""}{esc(d)}</td></tr>')
        a('</table></div>')

    a(f'<div style="margin:22px 0 0;text-align:center;"><a href="{SITE}" style="display:inline-block;'
      f'border:1.5px solid {GREEN};color:{GREEN};text-decoration:none;font-weight:700;font-size:13px;'
      f'padding:11px 26px;border-radius:5px;">Read the full briefing on AGSIST &rarr;</a></div>')

    q=daily.get("daily_quote") or {}
    if q.get("text"):
        attr=f' <span style="font-style:normal;font-family:monospace;font-size:12px;color:{FAINT};">&mdash; {esc(q.get("attribution"))}</span>' if q.get("attribution") else ""
        a(f'<div style="margin:20px 0 0;border-top:1px solid {HAIR};padding-top:14px;font-style:italic;'
          f'font-size:14px;line-height:1.5;color:{DIM};">&ldquo;{esc(q.get("text"))}&rdquo;{attr}</div>')

    # sponsor — render the briefing's own sponsor block (auto-shows a paid advertiser when sold)
    sponsor=daily.get("sponsor") or {}
    sp_label=sponsor.get("label") or "Founding Sponsor \u00b7 1 Slot Open"
    sp_head=sponsor.get("headline") or "Sponsor the AGSIST Daily Briefing \u2014 $150/week."
    sp_body=sponsor.get("body") or ("One ag company per issue, reaching working US producers before the open. "
                                    "First 2 weeks at no charge, then $150/week, no minimum, cancel anytime.")
    paid=bool(sponsor.get("active")) and (sponsor.get("advertiser") or "").upper() not in ("","AGSIST")
    head_html=f'<div style="font-size:14px;font-weight:700;color:{INK};padding-bottom:3px;">{esc(sp_head)}</div>' if paid else ""
    a(f'<div style="margin:18px 0 0;border:1px solid {HAIR};border-radius:4px;padding:13px 15px;">'
      f'<div style="font-size:10px;letter-spacing:1px;text-transform:uppercase;font-family:monospace;color:{GOLD};'
      f'font-weight:700;padding-bottom:3px;">{esc(sp_label)}</div>{head_html}'
      f'<div style="font-size:13px;line-height:1.5;color:{BODY};">{esc(sp_body)} '
      f'<a href="mailto:{CONTACT}" style="color:{GOLD};text-decoration:none;font-weight:600;">{CONTACT}</a>.</div></div>')

    a(f'<div style="margin:16px 0 0;text-align:center;font-size:13px;color:{DIM};">Someone forward you this? '
      f'<a href="{SUBSCRIBE}" style="color:{GREEN};text-decoration:none;font-weight:700;">Get it yourself every morning &rarr;</a></div>')

    a(f'<div style="margin:20px 0 0;border-top:1px solid {HAIR};padding-top:14px;color:{FAINT};font-size:12px;'
      f'line-height:1.6;">Written by Sigurd Lindquist, founder &middot; '
      f'<a href="mailto:{CONTACT}" style="color:{DIM};text-decoration:none;">{CONTACT}</a> &middot; 715-797-2428<br>'
      f'AGSIST &middot; PO Box 243, Chetek, WI 54728 &middot; a national agricultural intelligence briefing for US producers.<br>'
      f'Not market advice. Sources include CME settlements, USDA, and the trade press.</div>')

    a('</div></body>')
    return "\n".join(P)


def render_text(daily, prices):
    L=[]; a=L.append
    a("AGSIST DAILY"); a(daily.get("date","")); a("")
    a(smart_title(daily.get("headline","")))
    if daily.get("lead"): a("\n"+daily["lead"])
    if daily.get("the_takeaway"): a("\nTHE TAKEAWAY: "+daily["the_takeaway"])
    yc=daily.get("yesterdays_call") or {}
    if yc.get("summary") or yc.get("note"):
        a(f"\nYESTERDAY'S CALL [{(yc.get('outcome') or '').upper()}]: "+" ".join(x for x in (yc.get('summary'),yc.get('note')) if x))
    lp=daily.get("locked_prices") or {}
    rows=[]
    for label,lk,pk in PRICE_ROWS:
        if lk in lp and lp[lk] not in (None,""):
            try: lvl=float(lp[lk])
            except (TypeError,ValueError): continue
            pct=_pct(prices,pk)
            chg="" if pct is None else (" flat" if abs(pct)<0.05 else f"  {'+' if pct>0 else '-'}{abs(pct):.1f}%")
            rows.append(f"  {label:<16} ${lvl:>9,.2f}{chg}")
    if rows: a("\nAT THE CLOSE"); a("\n".join(rows))
    for s in (daily.get("sections") or []):
        if s.get("title") or s.get("body"):
            a("\n"+(s.get("title") or "").upper()); a(s.get("body") or "")
            act=s.get("bottom_line") or s.get("farmer_action")
            if act: a("-> "+act)
    sp=daily.get("spread_to_watch") or {}
    if sp.get("commentary"): a("\nSPREAD TO WATCH: "+(sp.get("level") or "")+" — "+sp["commentary"])
    one=daily.get("one_number") or {}
    if one.get("value"): a(f"\nTHE NUMBER: {one.get('value')} {one.get('unit','')}\n{one.get('context','')}")
    wl=daily.get("watch_list") or []
    if wl:
        a("\nWATCH LIST")
        for w in wl:
            if w.get("desc"): a(f"  {w.get('time','')}: {w.get('desc')}".strip())
    q=daily.get("daily_quote") or {}
    if q.get("text"): a(f'\n"{q["text"]}"'+(f' -- {q["attribution"]}' if q.get("attribution") else ""))
    a("\nRead the full briefing: "+SITE)
    a("Forwarded this? Subscribe: "+SUBSCRIBE)
    a("\nWritten by Sigurd Lindquist -- "+CONTACT+" -- 715-797-2428")
    a("AGSIST -- PO Box 243, Chetek, WI 54728 -- national ag intelligence for US producers.")
    a("Not market advice. Sources: CME settlements, USDA, trade press.")
    return "\n".join(L)


def recipients():
    rec=load_json("data/email_recipients.json")
    to=[x.strip() for x in (os.environ.get("EMAIL_TO") or "").split(",") if x.strip()] or rec.get("to") or []
    bcc=[x.strip() for x in (os.environ.get("EMAIL_BCC") or "").split(",") if x.strip()] or rec.get("bcc") or []
    if not to:
        gu=os.environ.get("GMAIL_USER","").strip()
        if gu: to=[gu]            # default: send to yourself, then reforward
    return to,bcc


def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--daily",default="data/daily.json")
    ap.add_argument("--prices",default="data/prices.json")
    ap.add_argument("--dry-run",action="store_true")
    ap.add_argument("--force",action="store_true")
    args=ap.parse_args()

    daily=load_json(args.daily)
    if not daily:
        print("[send] no daily.json — nothing to send"); sys.exit(0 if args.dry_run else 1)
    prices=load_json(args.prices)

    today_iso=dt.date.today().strftime("%Y-%m-%d")
    if not args.force:
        if iso_of(daily)!=today_iso:
            print(f"[send] daily.json is dated {iso_of(daily)} not {today_iso} — not sending stale brief")
            if not args.dry_run: sys.exit(0)
        if daily.get("price_validation_clean") is False:
            print("[send] price_validation_clean=false — refusing to forward a flagged briefing")
            if not args.dry_run: sys.exit(0)

    subject=subject_line(daily)
    html=render_html(daily,prices)
    text=render_text(daily,prices)

    if args.dry_run:
        out=Path("data/daily-email"); out.mkdir(parents=True,exist_ok=True)
        stamp=iso_of(daily)
        (out/f"{stamp}.html").write_text("<!DOCTYPE html><html><head><meta charset='utf-8'>"
                                         f"<title>{esc(subject)}</title></head>"+html+"</html>")
        (out/f"{stamp}.txt").write_text(text)
        print(f"[send] DRY RUN — wrote data/daily-email/{stamp}.html (+ .txt)")
        print(f"[send] subject: {subject}")
        return

    user=os.environ.get("GMAIL_USER","").strip(); pw=os.environ.get("GMAIL_APP_PASS","").strip()
    if not user or not pw:
        print("[send] GMAIL_USER / GMAIL_APP_PASS not set"); sys.exit(1)
    to,bcc=recipients()
    if not to and not bcc:
        print("[send] no recipients (set EMAIL_TO or data/email_recipients.json)"); sys.exit(1)

    msg=MIMEMultipart("alternative")
    msg["Subject"]=subject; msg["From"]=f"AGSIST Daily <{user}>"; msg["To"]=", ".join(to)
    msg.attach(MIMEText(text,"plain","utf-8"))
    msg.attach(MIMEText("<!DOCTYPE html><html><head><meta charset='utf-8'></head>"+html+"</html>","html","utf-8"))
    try:
        with smtplib.SMTP_SSL("smtp.gmail.com",465,timeout=30) as smtp:
            smtp.login(user,pw)
            smtp.sendmail(user,to+bcc,msg.as_string())
    except Exception as e:
        print(f"[send] SMTP error: {e}"); sys.exit(1)
    print(f"[send] sent '{subject}' to {len(to)} to / {len(bcc)} bcc")


if __name__=="__main__":
    main()
