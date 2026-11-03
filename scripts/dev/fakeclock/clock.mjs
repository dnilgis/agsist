// Fake clock for node, used only by scripts/dev/future_dates.py (NODE_OPTIONS=--import this file).
// With AGSIST_FAKE_OFFSET=<seconds> set, Date (new Date(), Date.now(), Intl formatting of "now") runs that many
// seconds ahead and keeps moving; every Chromium page a test opens through Playwright gets the same shift.
// Without the variable it does nothing.
const OFF = Number(process.env.AGSIST_FAKE_OFFSET || 0) * 1000;
if (OFF) {
  const RealDate = globalThis.Date;
  const shift = (off) => {
    const RD = globalThis.Date;
    if (RD.agsistFake) return;
    // arity by hand, no rest array: a test that makes a million dates should not slow down here
    function FakeDate(a, b, c, d, e, f, g) {
      if (!new.target) return new RD(RD.now() + off).toString();
      switch (arguments.length) {
        case 0: return new RD(RD.now() + off);
        case 1: return new RD(a);
        case 2: return new RD(a, b);
        case 3: return new RD(a, b, c);
        default: return new RD(a, b, c, d === undefined ? 0 : d, e === undefined ? 0 : e, f === undefined ? 0 : f, g === undefined ? 0 : g);
      }
    }
    FakeDate.prototype = RD.prototype;
    Object.setPrototypeOf(FakeDate, RD);
    FakeDate.now = () => RD.now() + off;
    FakeDate.parse = RD.parse;
    FakeDate.UTC = RD.UTC;
    FakeDate.agsistFake = true;
    globalThis.Date = FakeDate;
    const DTF = Intl.DateTimeFormat.prototype;
    const fmt = Object.getOwnPropertyDescriptor(DTF, "format").get;
    Object.defineProperty(DTF, "format", { configurable: true, get() { const f = fmt.call(this); return (d) => f(d === undefined ? FakeDate.now() : d); } });
    const ftp = DTF.formatToParts;
    DTF.formatToParts = function (d) { return ftp.call(this, d === undefined ? FakeDate.now() : d); };
  };
  shift(OFF);
  void RealDate;
  // vm contexts get fresh built-ins (147 tests run components in one): shift those too, once per context
  const vm = (await import("node:vm")).default;
  const { syncBuiltinESMExports } = await import("node:module");
  const src = `(${shift.toString()})(${OFF});`;
  const done = new WeakSet();
  const create = vm.createContext, runIn = vm.runInContext;
  const prep = (c) => { if (!done.has(c)) { done.add(c); try { runIn(src, c); } catch { /* frozen context */ } } return c; };
  vm.createContext = function (o, opt) { return prep(create.call(this, o, opt)); };
  vm.runInNewContext = function (code, o, opt) { return runIn(code, vm.createContext(o ?? {}), opt); };
  const sRunNew = vm.Script.prototype.runInNewContext;
  vm.Script.prototype.runInNewContext = function (o, opt) { return this.runInContext(vm.createContext(o ?? {}), opt); };
  void sRunNew;
  syncBuiltinESMExports();
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
