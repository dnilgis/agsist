// Fake clock for node, used only by scripts/dev/future_dates.sh (NODE_OPTIONS=--import this file).
// With AGSIST_FAKE_OFFSET=<seconds> set, Date (new Date(), Date.now(), Intl formatting of "now") runs that many
// seconds ahead and keeps moving; every Chromium page a test opens through Playwright gets the same shift.
// Without the variable it does nothing.
const OFF = Number(process.env.AGSIST_FAKE_OFFSET || 0) * 1000;
if (OFF) {
  const RealDate = globalThis.Date;
  const shift = (off) => {
    const RD = globalThis.Date;
    function FakeDate(...a) {
      if (!new.target) return new RD(RD.now() + off).toString();
      return a.length === 0 ? new RD(RD.now() + off) : new RD(...a);
    }
    FakeDate.prototype = RD.prototype;
    Object.setPrototypeOf(FakeDate, RD);
    FakeDate.now = () => RD.now() + off;
    FakeDate.parse = RD.parse;
    FakeDate.UTC = RD.UTC;
    globalThis.Date = FakeDate;
    const DTF = Intl.DateTimeFormat.prototype;
    const fmt = Object.getOwnPropertyDescriptor(DTF, "format").get;
    Object.defineProperty(DTF, "format", { configurable: true, get() { const f = fmt.call(this); return (d) => f(d === undefined ? FakeDate.now() : d); } });
    const ftp = DTF.formatToParts;
    DTF.formatToParts = function (d) { return ftp.call(this, d === undefined ? FakeDate.now() : d); };
  };
  shift(OFF);
  void RealDate;
  // pages opened through Playwright: the same shift, in the page, before any of its scripts
  if (process.env.PLAYWRIGHT_PATH) {
    try {
      const pw = await import(process.env.PLAYWRIGHT_PATH);
      const script = `(${shift.toString()})(${OFF});`;
      const proto = Object.getPrototypeOf(pw.chromium || pw.default?.chromium);
      const wrapCtx = async (ctx) => { await ctx.addInitScript({ content: script }); return ctx; };
      const launch = proto.launch;
      proto.launch = async function (...a) {
        const b = await launch.apply(this, a);
        const nc = b.newContext.bind(b);
        b.newContext = async (...o) => wrapCtx(await nc(...o));
        return b;
      };
      const lpc = proto.launchPersistentContext;
      if (lpc) proto.launchPersistentContext = async function (...a) { return wrapCtx(await lpc.apply(this, a)); };
    } catch { /* no playwright: node-only fake clock */ }
  }
}
