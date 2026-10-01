#!/usr/bin/env python3
"""
patch_index1_audit.py -- 2026-10-01 homepage audit fixes, carried into
index1.html (the homepage in progress) so the two pages agree before the
rename.

build/patch_index1.py replays every round from an original pristine
index1.html that is not in the repo, so this runs against the CURRENT
index1.html instead. Same contract: every anchor must match exactly once.

  python3 build/patch_index1_audit.py --src /path/to/live/index1.html --out index1.html

Shares its replacement strings with build/patch_index.py wherever the two
pages carry the same text, so a rule changed on one page is changed on the
other from one definition.

index1-specific pieces (not in patch_index.py):
  * The tile roll already existed here. Two bugs fixed: the first tile's
    chip was written back to its pre-load text ("Front Month") after geo.js
    had named the contract; and AGSIST_PRICE_DATA was set after the roll
    ran, so on some loads the roll found nothing and hid the tile.
  * The ticker item for the harvest month now rolls with the tile.
  * No "Loading forever" fix for Yield Nowcast: index1 already handles it.
  * homepage-extras.js is already loaded here; only the cache-bust changes.
"""
import argparse
import importlib.util
from pathlib import Path

HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location("patch_index", HERE / "patch_index.py")
P = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(P)


def apply(data, old, new, label):
    P.must_count(data, old, 1, label)
    return data.replace(old, new, 1)


OLD_FWD = '''  var FORWARD_YEAR={
    'corn-dec':{dataKey:'corn-dec27',rangeId:'corn-dec',label:"Dec '27"},
    'bean-nov':{dataKey:'beans-nov27',rangeId:'beans-nov',label:"Nov '27"}
  };'''
NEW_FWD = '''  var FORWARD_YEAR={
    'corn-dec':{dataKey:'corn-dec27',rangeId:'corn-dec',sym:'corn-dec',label:"Dec '27",tick:"Corn Dec '27"},
    'bean-nov':{dataKey:'beans-nov27',rangeId:'beans-nov',sym:'beans-nov',label:"Nov '27",tick:"Beans Nov '27"}
  };'''

OLD_FWD_RET = '''      if(elF)elF.style.width=pct.toFixed(1)+'%';
      if(elD)elD.style.left=pct.toFixed(1)+'%';
    }
    return true;
  }'''
NEW_FWD_RET = '''      if(elF)elF.style.width=pct.toFixed(1)+'%';
      if(elD)elD.style.left=pct.toFixed(1)+'%';
    }
    /* The ticker carries the same contract under the same key. Roll every
       copy (rebuildTickerLoop clones the strip) so the strip does not read
       "Corn Dec '26 $5.01" beside "Corn (front) $5.01". */
    if(typeof fmtTickerPrice==='function'&&typeof fmtTickerChange==='function'){
      var tp=fmtTickerPrice(fq.close,true,2), tc=fmtTickerChange(fq.close,fq.open,true,fq.netChange,fq.pctChange);
      document.querySelectorAll('[data-sym="'+fwd.sym+'"]').forEach(function(el){
        var le=el.querySelector('.t-label'), pe=el.querySelector('.t-price'), ce=el.querySelector('.t-chg');
        if(le)le.textContent=fwd.tick;
        if(pe)pe.textContent=tp;
        if(ce){ce.textContent=tc.text;ce.className='t-chg '+tc.cls;}
      });
    }
    return true;
  }'''

OLD_CHIP = '''      var lbl=keep&&keep.querySelector?keep.querySelector('.pc-contract'):null;
      if(lbl){
        var base=(lbl.getAttribute('data-base')||lbl.textContent||'').trim();
        lbl.setAttribute('data-base',base);
        lbl.textContent=(same&&!swapped)?(base+' + new crop'):base;
      }
      if(same&&swapped){
        var bLbl=card.querySelector&&card.querySelector('.pc-contract');
        if(bLbl)bLbl.textContent=fwd.label;
      }'''
NEW_CHIP = '''      var lbl=keep&&keep.querySelector?keep.querySelector('.pc-contract'):null;
      if(lbl){
        /* geo.js names the contract on this chip ("Dec '26 - nearby") after
           prices load. The old code cached the chip's FIRST text ("Front
           Month") and wrote it back on every re-run, so the contract name
           never survived. Only the suffix is ours; the base is whatever is
           on the chip right now. */
        var NEW_CROP_SUFFIX=' + new crop';
        var cur=(lbl.textContent||'').trim();
        var base=cur.slice(-NEW_CROP_SUFFIX.length)===NEW_CROP_SUFFIX?cur.slice(0,-NEW_CROP_SUFFIX.length):cur;
        var want=(same&&!swapped)?(base+NEW_CROP_SUFFIX):base;
        if(cur!==want)lbl.textContent=want;
      }
      if(same&&swapped){
        var bLbl=card.querySelector&&card.querySelector('.pc-contract');
        if(bLbl&&bLbl.textContent!==fwd.label)bLbl.textContent=fwd.label;
      }'''

# The frame-line function from patch_index.py, lifted out of its collapse block.
_FRAME_START = P.NEW_COLLAPSE.index('  /* THE ACTION names a price.')
FRAME_FN = P.NEW_COLLAPSE[_FRAME_START:]

OLD_SCRIPTS1 = '<script src="/components/geo.js?v=17" defer></script>\n<script src="/components/bids-homepage.js?v=14" defer></script>\n<script src="/components/homepage-extras.js?v=1" defer></script>'
NEW_SCRIPTS1 = '<script src="/components/geo.js?v=18" defer></script>\n<script src="/components/bids-homepage.js?v=15" defer></script>\n<script src="/components/homepage-extras.js?v=1" defer></script>'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--src', required=True)
    ap.add_argument('--out', required=True)
    a = ap.parse_args()
    data = Path(a.src).read_text(encoding='utf-8')

    # index1-only: the roll's two bugs, plus the ticker roll
    data = apply(data, OLD_FWD, NEW_FWD, 'forward-year map')
    data = apply(data, OLD_FWD_RET, NEW_FWD_RET, 'ticker roll')
    data = apply(data, OLD_CHIP, NEW_CHIP, 'chip label race')
    # frame function goes right before watchSameContract's comment block
    anchor = "  /* Run it again whenever any of the four values it reads changes."
    data = apply(data, anchor, FRAME_FN + anchor, 'frame function')

    # shared with index.html
    data = apply(data, P.OLD_PRICE_SET, P.NEW_PRICE_SET, 'price data before collapse')
    data = apply(data, P.OLD_PRICE_SET2, P.NEW_PRICE_SET2, 'remove later price data set')
    data = apply(data, P.OLD_TAKEAWAY, P.NEW_TAKEAWAY, 'frame the action')
    data = apply(data, P.OLD_MAJORS, P.NEW_MAJORS, 'USDA calendar times')
    data = apply(data, P.OLD_EXP_DATE, P.NEW_EXP_DATE, 'week ending')
    data = apply(data, P.OLD_EXP_COPY, P.NEW_EXP_COPY, 'export copy')
    data = apply(data, P.OLD_EXP_TITLE, P.NEW_EXP_TITLE, 'export title')
    data = apply(data, P.OLD_READ_PRICE, P.NEW_READ_PRICE, 'read price line')
    data = apply(data, P.OLD_READ_JOIN, P.NEW_READ_JOIN, 'read join')
    data = apply(data, P.OLD_READ_RET, P.NEW_READ_RET, 'read cached')
    data = apply(data, P.OLD_CATTLE_READ, P.NEW_CATTLE_READ, 'cattle read')
    data = apply(data, P.OLD_CATTLE_IF, P.NEW_CATTLE_IF, 'cattle unavailable')
    data = apply(data, P.OLD_DAILY_CATCH, P.NEW_DAILY_CATCH, 'watch list unavailable')
    data = apply(data, P.OLD_DISMISS, P.NEW_DISMISS, 'dismiss focus')
    data = apply(data, P.OLD_EXPAND, P.NEW_EXPAND, 'expand focus')
    data = apply(data, P.OLD_MORE, P.NEW_MORE, 'more focus')
    data = apply(data, P.OLD_COMPACT_DISMISS, P.NEW_COMPACT_DISMISS, 'compact dismiss focus')
    data = apply(data, P.OLD_SEC_ALL_CSS, P.NEW_SEC_ALL_CSS, 'sec-all tap height')
    data = apply(data, OLD_SCRIPTS1, NEW_SCRIPTS1, 'scripts')

    Path(a.out).write_text(data, encoding='utf-8')
    print(f"wrote {a.out} ({len(data)} bytes)")


if __name__ == '__main__':
    main()
