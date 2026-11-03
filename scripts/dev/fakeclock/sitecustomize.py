"""Fake clock for python, used only by scripts/dev/future_dates.sh (PYTHONPATH puts this folder first).

With AGSIST_FAKE_OFFSET=<seconds> set, time.time(), datetime.now()/utcnow()/today() and date.today() run that many
seconds ahead (the clock still moves). Without it this file does nothing but load the sandbox's own sitecustomize.
"""
import os
import sys


def _chain():
    # load the next sitecustomize on the path (the image's own one fixes zlib); this one shadows it
    here = os.path.dirname(os.path.abspath(__file__))
    import importlib.util
    for p in sys.path:
        if not p or os.path.abspath(p) == here:
            continue
        f = os.path.join(p, "sitecustomize.py")
        if os.path.isfile(f):
            spec = importlib.util.spec_from_file_location("_sitecustomize_next", f)
            mod = importlib.util.module_from_spec(spec)
            try:
                spec.loader.exec_module(mod)
            except Exception:
                pass
            return


_chain()

_off = os.environ.get("AGSIST_FAKE_OFFSET")
if _off:
    import time as _time
    import datetime as _dt

    _OFF = float(_off)
    _real_time, _real_time_ns = _time.time, _time.time_ns
    _real_localtime, _real_gmtime, _real_ctime, _real_strftime = _time.localtime, _time.gmtime, _time.ctime, _time.strftime
    _time.time = lambda: _real_time() + _OFF
    _time.time_ns = lambda: _real_time_ns() + int(_OFF * 1e9)
    _time.localtime = lambda secs=None: _real_localtime(_time.time() if secs is None else secs)
    _time.gmtime = lambda secs=None: _real_gmtime(_time.time() if secs is None else secs)
    _time.ctime = lambda secs=None: _real_ctime(_time.time() if secs is None else secs)
    _time.strftime = lambda fmt, t=None: _real_strftime(fmt, _time.localtime() if t is None else t)

    _RealDate, _RealDatetime = _dt.date, _dt.datetime

    class _DateMeta(type):
        def __instancecheck__(cls, obj):
            return isinstance(obj, _RealDate)

        def __subclasscheck__(cls, sub):
            return issubclass(sub, _RealDate)

    class _DatetimeMeta(_DateMeta):
        def __instancecheck__(cls, obj):
            return isinstance(obj, _RealDatetime)

        def __subclasscheck__(cls, sub):
            return issubclass(sub, _RealDatetime)

    class FakeDate(_RealDate, metaclass=_DateMeta):
        @classmethod
        def today(cls):
            t = _RealDate.fromtimestamp(_time.time())
            return _RealDate(t.year, t.month, t.day)

    class FakeDatetime(_RealDatetime, metaclass=_DatetimeMeta):
        @classmethod
        def now(cls, tz=None):
            return _RealDatetime.fromtimestamp(_time.time(), tz)

        @classmethod
        def utcnow(cls):
            return _RealDatetime.fromtimestamp(_time.time(), _dt.timezone.utc).replace(tzinfo=None)

        @classmethod
        def today(cls):
            return _RealDatetime.fromtimestamp(_time.time())

    _dt.date = FakeDate
    _dt.datetime = FakeDatetime
