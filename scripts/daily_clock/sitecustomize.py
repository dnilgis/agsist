"""Tomorrow's clock for the Daily rehearsal (scripts/daily_rehearsal.py, Nov 3 2026).

Python loads this file at start-up when its folder is on PYTHONPATH. With
DAILY_FAKE_NOW set (an ISO time with its UTC offset, e.g.
2026-11-04T05:50:00-06:00) every clock the Daily's code reads starts there and
runs on: time.time, datetime.now/utcnow/today, date.today, time.localtime,
time.gmtime, time.strftime. Without DAILY_FAKE_NOW it does nothing at all.

Nov 3 2026 A test that is about to break on tomorrow's date breaks tonight, here,
instead of holding tomorrow's Daily.
"""
import os

_FAKE = os.environ.get("DAILY_FAKE_NOW", "").strip()

if _FAKE:
    import datetime as _dt
    import time as _time

    _real_datetime = _dt.datetime
    _real_date = _dt.date
    _real_time = _time.time
    _real_localtime = _time.localtime
    _real_gmtime = _time.gmtime
    _real_strftime = _time.strftime
    _target = _real_datetime.fromisoformat(_FAKE)
    if _target.tzinfo is None:
        raise SystemExit("DAILY_FAKE_NOW needs a UTC offset, e.g. 2026-11-04T05:50:00-06:00")
    _offset = _target.timestamp() - _real_time()

    def _now_ts():
        return _real_time() + _offset

    class _DateMeta(type):
        def __instancecheck__(cls, obj):
            return isinstance(obj, _real_date)

        def __subclasscheck__(cls, sub):
            return issubclass(sub, _real_date)

    class _DateTimeMeta(type):
        def __instancecheck__(cls, obj):
            return isinstance(obj, _real_datetime)

        def __subclasscheck__(cls, sub):
            return issubclass(sub, _real_datetime)

    class date(_real_date, metaclass=_DateMeta):
        @classmethod
        def today(cls):
            t = _real_datetime.fromtimestamp(_now_ts())
            return cls(t.year, t.month, t.day)

    class datetime(_real_datetime, metaclass=_DateTimeMeta):
        @classmethod
        def now(cls, tz=None):
            return cls.fromtimestamp(_now_ts(), tz)

        @classmethod
        def today(cls):
            return cls.fromtimestamp(_now_ts())

        @classmethod
        def utcnow(cls):
            return cls.fromtimestamp(_now_ts(), _dt.timezone.utc).replace(tzinfo=None)

    _dt.date = date
    _dt.datetime = datetime
    _time.time = _now_ts
    _time.localtime = lambda secs=None: _real_localtime(_now_ts() if secs is None else secs)
    _time.gmtime = lambda secs=None: _real_gmtime(_now_ts() if secs is None else secs)
    _time.strftime = lambda fmt, t=None: _real_strftime(fmt, _real_localtime(_now_ts()) if t is None else t)
