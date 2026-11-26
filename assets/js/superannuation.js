/* Salarist superannuation calculator. Runs entirely in the browser; nothing is stored or sent.
   Rules (Income-tax Act, 2025; verify notes in the page's Sources):
   - Leaving before retirement and taking the money: the trustees deduct tax on the employer's contributions and interest at the employee's
     average rate of tax for the previous three years (or the membership period if shorter): Schedule XI, Part B, para 7; section 392.
     "Average rate" = tax on total income / total income (section 2(16)).
   - Payments on retirement, death or incapacity, commutation of pension, and transfer to the employee's NPS account are exempt:
     Schedule II, Table, Sl. No. 8 (old section 10(13)). Fund rules commonly allow up to one-third of the balance to be commuted
     at retirement; the rest buys a pension (annuity), taxed every year as salary at slab rates.
   - NPS (non-government subscriber) at 60: up to 80% as a lump sum, 60% of the corpus tax-free (Schedule II), the rest buys a pension.
   - Tax slabs for tax year 2026-27: new regime (standard deduction ₹75,000, section 156 rebate to ₹12 lakh with marginal relief) and
     old regime (standard deduction ₹50,000, rebate to ₹5 lakh), 4% cess, surcharge 10% above ₹50 lakh and 15% above ₹1 crore
     (no marginal relief modelled). */
(function () {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports;
  var L = 100000;
  var NEW = [[400000, 0], [800000, 0.05], [1200000, 0.10], [1600000, 0.15], [2000000, 0.20], [2400000, 0.25], [Infinity, 0.30]];
  var OLD = [[250000, 0], [500000, 0.05], [1000000, 0.20], [Infinity, 0.30]];
  function slabTax(ti, regime) {
    var S = regime === "old" ? OLD : NEW, t = 0, lo = 0;
    for (var i = 0; i < S.length; i++) { var hi = S[i][0]; if (ti > lo) t += (Math.min(ti, hi) - lo) * S[i][1]; lo = hi; }
    if (regime === "old") { if (ti <= 500000) t = 0; }
    else if (ti <= 1200000) t = 0; else t = Math.min(t, ti - 1200000);
    return t;
  }
  /* tax on salary-type income (standard deduction applies) */
  function taxOn(income, regime) {
    var ti = Math.max(0, income - (regime === "old" ? 50000 : 75000));
    var t = slabTax(ti, regime), sc = ti > 1e7 ? 0.15 : ti > 5e6 ? 0.10 : 0;
    return t * (1 + sc) * 1.04;
  }
  function marginal(income, regime) {
    var a = taxOn(income, regime), b = taxOn(income + 10000, regime);
    return Math.max(0, (b - a) / 10000);
  }
  function fv(p, r, y) { return p * Math.pow(1 + r / 100, y); }
  /* o: {sit: "resign"|"retire", bal, age, income (average taxable income of the last 3 years), regime ("new"|"old"),
         rNps (% a year), rFund (% a year), rCash (% a year, before tax), ann (annuity rate %), commute (share, e.g. 1/3), avgOverride (% or 0), infl (%)} */
  function calc(o) {
    var ti = Math.max(0, o.income - (o.regime === "old" ? 50000 : 75000));
    var avg = o.avgOverride > 0 ? o.avgOverride / 100 : (ti > 0 ? taxOn(o.income, o.regime) / ti : 0);   /* s.2(16): tax ÷ total income */
    var marg = marginal(o.income, o.regime);
    var exitAge = Math.max(60, o.age), yN = exitAge - o.age;
    var fundAge = o.sit === "retire" ? o.age : Math.max(60, o.age), yF = fundAge - o.age;
    var defl = function (v, y) { return v / Math.pow(1 + o.infl / 100, y); };
    /* 1. Take the cash now (resigning only) */
    var wTax = o.bal * avg, cash = o.bal - wTax;
    var rNet = o.rCash * (1 - marg);
    var cashAt = fv(cash, rNet, yN);
    /* 2. Move it to NPS: grows to exitAge, then up to 80% lump sum (60% of corpus tax-free), rest buys a pension */
    var nps = fv(o.bal, o.rNps, yN), npsFree = nps * 0.6, npsTaxable = nps * 0.2;
    var npsTaxOnLump = npsTaxable * marginal(npsTaxable, o.regime) ;
    var npsAnn = nps * 0.2, npsPen = npsAnn * o.ann / 100 / 12;
    /* 3. Keep it in the fund: grows to fundAge, then commute a share tax-free, rest buys a pension */
    var fund = fv(o.bal, o.rFund, yF), fundLump = fund * o.commute, fundPen = (fund - fundLump) * o.ann / 100 / 12;
    function penTax(pm) { return taxOn(pm * 12, o.regime) / 12; }
    var path = [];
    var H = Math.max(yN, yF, 1);
    for (var y = 0; y <= H; y++) path.push({ age: o.age + y, cash: o.sit === "resign" ? fv(cash, rNet, y) : null, nps: fv(o.bal, o.rNps, Math.min(y, yN)), fund: fv(o.bal, o.rFund, Math.min(y, yF)) });
    return { avg: avg, marg: marg, exitAge: exitAge, yN: yN, fundAge: fundAge, yF: yF, wTax: wTax, cash: cash, rNet: rNet, cashAt: cashAt, cashAtReal: defl(cashAt, yN),
      nps: nps, npsReal: defl(nps, yN), npsFree: npsFree, npsTaxable: npsTaxable, npsTaxOnLump: npsTaxOnLump, npsLump: npsFree + npsTaxable - npsTaxOnLump, npsAnn: npsAnn, npsPen: npsPen, npsPenNet: npsPen - penTax(npsPen),
      fund: fund, fundReal: defl(fund, yF), fundLump: fundLump, fundPen: fundPen, fundPenNet: fundPen - penTax(fundPen), path: path };
  }
  var API = { calc: calc, taxOn: taxOn, marginal: marginal };
  if (NODE) { module.exports = API; return; }
  window.SalaristSuper = API;
  if (!document.getElementById("saVerdict")) return;

  /* ---------- UI ---------- */
  var $ = function (id) { return document.getElementById(id); };
  var fmt = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 });
  function inr(v) { var r = Math.round(v); return (r < 0 ? "−" : "") + "₹" + fmt.format(Math.abs(r)); }
  function short(v) {
    var a = Math.abs(v), s = v < 0 ? "−" : "";
    if (a >= 1e7) return s + "₹" + (a / 1e7).toFixed(2).replace(/\.?0+$/, "") + " Cr";
    if (a >= 1e5) return s + "₹" + (a / 1e5).toFixed(2).replace(/\.?0+$/, "") + " L";
    return s + "₹" + fmt.format(Math.round(a));
  }
  function pct(x) { return (Math.round(x * 1000) / 10).toFixed(1).replace(/\.0$/, "") + "%"; }
  function words(v) { return v >= 1e5 ? short(v) : ""; }
  var S = { sit: "resign", bal: 12 * L, age: 42, income: 24 * L, regime: "new", rNps: 9, rFund: 7, rCash: 7, ann: 6.5, commute: 33.33, avgOverride: 0, infl: 6 };
  var LIM = { bal: [0, 1e9], age: [21, 75], income: [0, 1e9], rNps: [0, 15], rFund: [0, 12], rCash: [0, 15], ann: [3, 10], commute: [0, 50], avgOverride: [0, 45], infl: [0, 12] };
  var MONEY = { bal: 1, income: 1 };
  var NUM = ["bal", "age", "income", "rNps", "rFund", "rCash", "ann", "commute", "avgOverride", "infl"];
  (function fromUrl() {
    var q = new URLSearchParams(location.search);
    NUM.forEach(function (k) { var v = parseFloat(q.get(k)); if (isFinite(v) && v >= LIM[k][0] && v <= LIM[k][1]) S[k] = v; });
    if (q.get("sit") === "retire") S.sit = "retire"; if (q.get("regime") === "old") S.regime = "old";
  })();
  var shows = [];
  function bind(k) {
    var el = $("sa-" + k), note = $("sa-" + k + "-w"); if (!el) return;
    function show() { el.value = MONEY[k] ? fmt.format(S[k]) : String(S[k]); if (note) note.textContent = MONEY[k] ? words(S[k]) : ""; }
    el.addEventListener("input", function () {
      var raw = MONEY[k] ? this.value.replace(/[^0-9]/g, "") : this.value.replace(/[^0-9.]/g, "");
      if (MONEY[k]) this.value = raw ? fmt.format(+raw) : "";
      var v = parseFloat(raw); if (!isFinite(v)) { if (raw === "") { S[k] = 0; render(); } return; }
      if (v < LIM[k][0] || v > LIM[k][1]) return;
      S[k] = v; if (note) note.textContent = MONEY[k] ? words(v) : ""; render();
    });
    el.addEventListener("blur", show); shows.push(function () { if (document.activeElement !== el) show(); }); show();
  }
  NUM.forEach(bind);
  function segs(key) { document.querySelectorAll("[data-" + key + "]").forEach(function (b) { b.addEventListener("click", function () { S[key] = b.getAttribute("data-" + key);
    if (key === "sit" && S.sit === "retire" && S.age < 55) S.age = 58; if (key === "sit" && S.sit === "resign" && S.age >= 58) S.age = 42; render(); }); }); }
  segs("sit"); segs("regime");
  function press(key) { document.querySelectorAll("[data-" + key + "]").forEach(function (b) { b.setAttribute("aria-pressed", b.getAttribute("data-" + key) === String(S[key]) ? "true" : "false"); }); }
  function opts(ch) { var o = Object.assign({}, S); o.commute = S.commute / 100; if (ch) ch(o); return o; }
  var last = null;
  function chart(r) {
    var P = r.path, n = P.length - 1, W = 420, Hh = 230, pl = 54, pr = 12, pt = 16, pb = 26;
    var keys = S.sit === "resign" ? ["nps", "fund", "cash"] : ["nps", "fund"];
    var all = []; P.forEach(function (p) { keys.forEach(function (k) { if (p[k] != null) all.push(p[k]); }); });
    var mx = Math.max.apply(null, all) * 1.05, span = mx || 1;
    var st = Math.pow(10, Math.floor(Math.log10(span / 4))), qq = span / 4 / st; st *= qq <= 1 ? 1 : qq <= 2 ? 2 : qq <= 2.5 ? 2.5 : qq <= 5 ? 5 : 10;
    mx = st * Math.ceil(mx / st);
    function x(i) { return pl + (n ? i / n : 0) * (W - pl - pr); } function yy(v) { return pt + (mx - v) / mx * (Hh - pt - pb); }
    var g = ""; for (var v = 0; v <= mx + 1; v += st) { var gy = yy(v).toFixed(1); g += '<line x1="' + pl + '" x2="' + (W - pr) + '" y1="' + gy + '" y2="' + gy + '" class="gl"/><text x="' + (pl - 6) + '" y="' + (+gy + 3) + '" class="al" text-anchor="end">' + short(v).replace("₹", "") + "</text>"; }
    var xl = "", stp = n > 15 ? 5 : n > 6 ? 2 : 1; for (var i = 0; i <= n; i += stp) xl += '<text x="' + x(i).toFixed(1) + '" y="' + (Hh - 8) + '" class="al" text-anchor="middle">' + P[i].age + "</text>";
    var cls = { nps: "rent", fund: "buy", cash: "cash" }, out = "";
    keys.forEach(function (k) { out += '<path d="' + P.map(function (p, i) { return (i ? "L" : "M") + x(i).toFixed(1) + " " + yy(p[k]).toFixed(1); }).join("") + '" class="ln ' + cls[k] + '"/>'; });
    return '<svg viewBox="0 0 ' + W + " " + Hh + '" role="img" aria-label="Your superannuation by age under each choice">' + g + xl + out + "</svg>";
  }
  function render() {
    press("sit"); press("regime");
    var resign = S.sit === "resign";
    document.querySelectorAll(".sa-resign").forEach(function (e) { e.hidden = !resign; });
    $("sa-cashLeg").hidden = !resign;
    var r = calc(opts()); last = r;
    var v = $("saVerdict"); v.className = "verdict";
    if (resign) {
      v.innerHTML = '<p class="k">Leaving your job at ' + S.age + " with " + short(S.bal) + " in superannuation</p>" +
        '<p class="v">Withdrawing costs about <b>' + short(r.wTax) + "</b> in tax; moving it to NPS costs nothing</p>" +
        '<p class="k">Take it as cash and the fund deducts tax at your average rate of the last three years, about ' + pct(r.avg) + ", leaving " + short(r.cash) + " in hand. Move it to your NPS account instead and all " + short(S.bal) +
        " keeps working, tax-free: about " + short(r.nps) + " by " + r.exitAge + " (" + short(r.npsReal) + " in today's money), of which you can take up to 80% as a lump sum. Or leave it in the fund, if its rules allow, for about " + short(r.fund) +
        " at " + r.fundAge + ", one-third tax-free and the rest as a pension.</p>";
    } else {
      v.innerHTML = '<p class="k">Retiring at ' + S.age + " with " + short(S.bal) + " in superannuation</p>" +
        '<p class="v">Take <b>' + short(r.fundLump) + "</b> tax-free now and a pension of about <b>" + short(r.fundPen) + "</b> a month</p>" +
        '<p class="k">That\'s the usual route: commute ' + Math.round(S.commute) + "% of the balance (tax-free) and use the rest to buy a pension, taxed as salary each year. " +
        (r.yN > 0 ? "Or move it to NPS tax-free and let it grow to 60: about " + short(r.nps) + ", with up to 80% as a lump sum (60% tax-free) and the rest as a pension." : "Or move it to NPS tax-free and exit: up to 80% as a lump sum (60% tax-free) and the rest as a pension, about " + short(r.npsPen) + " a month.") + "</p>";
    }
    $("saS1").textContent = resign ? short(r.cash) : short(r.fundLump); $("saS1L").textContent = resign ? "Cash in hand if you withdraw" : "Tax-free lump sum now";
    $("saS1h").textContent = resign ? "After about " + short(r.wTax) + " tax at " + pct(r.avg) : Math.round(S.commute) + "% of the balance, commuted";
    if (resign) { $("saS2L").textContent = "Your average tax rate"; $("saS2").textContent = pct(r.avg); $("saS2h").textContent = S.avgOverride > 0 ? "As you entered" : "The share of your taxable income paid as tax"; }
    else { $("saS2L").textContent = "Pension after tax"; $("saS2").textContent = short(r.fundPenNet); $("saS2h").textContent = "A month, if it's your only income"; }
    $("saS3").textContent = short(r.nps); $("saS3L").textContent = "In NPS at " + r.exitAge; $("saS3h").textContent = r.yN > 0 ? short(r.npsReal) + " in today's money, at " + S.rNps + "% a year" : "Moved now, no growth before exit";
    $("saS4").textContent = short(resign ? r.fundPen : r.fundPen); $("saS4L").textContent = "Superannuation pension a month"; $("saS4h").textContent = "If kept in the superannuation fund, from " + r.fundAge + ", before tax";
    var notes = [];
    if (resign) notes.push("<b>Why cash costs tax:</b> superannuation taken before retirement is taxed. The fund deducts tax at your average rate over the last three years, which is why this calculator asks for your income: about " + pct(r.avg) + " on " + short(S.income) + ". The same money is tax-free if it moves to NPS, stays in the fund until you retire, or moves to your new employer's approved fund.");
    notes.push("<b>NPS:</b> the transfer is tax-free and needs no fresh contribution. At " + r.exitAge + " you can take up to 80% as a lump sum, of which 60% of the corpus is tax-free (here " + short(r.npsFree) + ") and the next 20% (" + short(r.npsTaxable) + ") is taxed; the rest (" + short(r.npsAnn) + ") buys a pension of about " + short(r.npsPen) + " a month.");
    notes.push("<b>Keeping it in the fund:</b> " + (resign ? "only if your fund's rules allow a member who has left to stay until retirement. " : "") + "At retirement, commuting up to one-third is tax-free; the pension from the rest is taxed as salary, about " + short(r.fundPenNet) + " a month after tax if it's your only income.");
    if (resign) notes.push("<b>If you take the cash and invest it:</b> " + short(r.cash) + " at " + S.rCash + "% before tax (about " + (Math.round(r.rNet * 10) / 10) + "% after tax at your slab) grows to about " + short(r.cashAt) + " by " + r.exitAge + ", against " + short(r.nps) + " in NPS. That's why moving it usually wins, unless you need the money now.");
    notes.push("<b>Age:</b> it sets how many years the money can grow before 60, when NPS lets you take most of it out. That's the only reason it's asked.");
    $("saRule").innerHTML = notes.join("<br><br>");
    r.notes = notes.map(function (n) { var m = /^<b>(.*?):<\/b>\s*([\s\S]*)$/.exec(n); return m ? [m[1], m[2].replace(/<[^>]+>/g, "")] : ["", n.replace(/<[^>]+>/g, "")]; });
    function alt(ch) { var x = calc(opts(ch)); return resign ? short(x.nps) + " in NPS · " + short(x.cash) + " cash" : short(x.fundLump) + " + " + short(x.fundPen) + "/month"; }
    r.what = resign ? [["NPS earns 7%", alt(function (o) { o.rNps = 7; })], ["NPS earns 11%", alt(function (o) { o.rNps = 11; })], ["Income ₹12 lakh", alt(function (o) { o.income = 12 * L; })], ["Income ₹50 lakh", alt(function (o) { o.income = 50 * L; })]]
      : [["Annuity rate 6%", alt(function (o) { o.ann = 6; })], ["Annuity rate 7.5%", alt(function (o) { o.ann = 7.5; })], ["Commute 0%", alt(function (o) { o.commute = 0; })], ["Fund earns 8%", alt(function (o) { o.rFund = 8; })]];
    $("saSens").innerHTML = r.what.map(function (w) { return '<div class="sv"><span class="l">' + w[0] + '</span><span class="n">' + w[1] + "</span></div>"; }).join("");
    $("saChart").innerHTML = chart(r);
    var rows = [], cards = [];
    if (resign) { rows.push(["Take the cash now", inr(r.cash), "After " + inr(r.wTax) + " tax (" + pct(r.avg) + " average rate)", short(r.cashAt) + " at " + r.exitAge + " if invested at " + S.rCash + "%"]);
      cards.push({ k: "cash", t: "Take the cash", tax: "Tax now: " + short(r.wTax), n: short(r.cash), nl: "in hand now", p: "Invested at " + S.rCash + "%, about " + short(r.cashAt) + " by " + r.exitAge + "." }); }
    rows.push(["Move it to NPS", inr(S.bal), "Tax-free transfer", short(r.nps) + " at " + r.exitAge + ": up to " + short(r.npsLump) + " lump sum after tax, " + short(r.npsPen) + "/month pension"]);
    cards.push({ k: "nps", t: "Move it to NPS", tax: "Tax now: nil", n: short(r.nps), nl: "at " + r.exitAge, p: "Up to " + short(r.npsLump) + " as a lump sum after tax, plus " + short(r.npsPen) + " a month." });
    rows.push([resign ? "Leave it in the fund" : "Take the fund's pension", inr(S.bal), resign ? "If your fund allows" : "The usual route", short(r.fund) + " at " + r.fundAge + ": " + short(r.fundLump) + " tax-free, " + short(r.fundPen) + "/month pension"]);
    cards.push({ k: "fund", t: resign ? "Keep it in the fund" : "Take the fund's pension", tax: resign ? "Tax now: nil, if your fund allows it" : "Tax now: nil on the lump sum", n: short(r.fund), nl: "at " + r.fundAge, p: short(r.fundLump) + " tax-free, plus " + short(r.fundPen) + " a month" + (r.fundPenNet < r.fundPen - 1 ? " (" + short(r.fundPenNet) + " after tax)." : ", no tax if it's your only income.") });
    $("saTbl").innerHTML = '<div class="sa-opts">' + cards.map(function (c) { return '<div class="sa-opt ' + c.k + '"><h3>' + c.t + '</h3><p class="tx">' + c.tax + '</p><p class="n">' + c.n + ' <span>' + c.nl + '</span></p><p class="d">' + c.p + "</p></div>"; }).join("") + "</div>";
    r.rows = rows;
    $("saBarT").textContent = resign ? "Withdrawing costs " + short(r.wTax) + " in tax" : short(r.fundLump) + " tax-free + " + short(r.fundPen) + "/month";
    shows.forEach(function (f) { f(); });
  }

  /* ---------- Reports ---------- */
  function say(m) { var s = $("saStatus"); s.textContent = m; clearTimeout(say.t); say.t = setTimeout(function () { s.textContent = ""; }, 4000); }
  function withReport(cb) {
    if (window.SalaristReportKit) return cb(window.SalaristReportKit);
    var sc = document.createElement("script"); sc.src = document.body.getAttribute("data-report-js") || "/assets/js/report-kit.js"; sc.async = true;
    sc.onload = function () { cb(window.SalaristReportKit); }; sc.onerror = function () { say("Couldn't load the report. Check your connection and try again."); };
    document.head.appendChild(sc);
  }
  function spec() {
    var r = last, resign = S.sit === "resign", P = r.path, yrs = P.length - 1;
    var nps = [], fund = [], cash = [];
    for (var m = 0; m <= yrs * 12; m++) { var y = m / 12; nps.push(S.bal * Math.pow(1 + S.rNps / 100, Math.min(y, r.yN))); fund.push(S.bal * Math.pow(1 + S.rFund / 100, Math.min(y, r.yF))); cash.push(resign ? r.cash * Math.pow(1 + r.rNet / 100, y) : 0); }
    var series = [{ name: "Moved to NPS", color: "blue", data: nps }, { name: "Kept in the fund", color: "amber", data: fund }];
    if (resign) series.push({ name: "Taken as cash and invested", color: "green", data: cash });
    var inputs = [["Situation", resign ? "Leaving the job before retirement" : "Retiring"], ["Superannuation balance", inr(S.bal)], ["Your age", String(S.age)],
      ["Yearly income, average of the last 3 years", inr(S.income)], ["Tax regime", S.regime === "old" ? "Old" : "New"], ["NPS return", S.rNps + "% a year"], ["Fund return", S.rFund + "% a year"],
      ].concat(resign ? [["Return on cash you invest", S.rCash + "% a year, before tax"]] : []).concat([["Annuity rate", S.ann + "%"], ["Commuted at retirement", Math.round(S.commute) + "%"], ["Inflation", S.infl + "%"]])
      .concat(S.avgOverride > 0 ? [["Average tax rate (entered)", S.avgOverride + "%"]] : []);
    return {
      title: "Superannuation", path: "salarist.in/superannuation-calculator", url: location.origin + location.pathname, file: "salarist-superannuation",
      question: resign ? "Withdraw my superannuation, move it to NPS or keep it?" : "How do I take my superannuation at retirement?",
      verdictLines: Array.prototype.map.call(document.querySelectorAll("#saVerdict p"), function (x) { return x.textContent; }),
      inputs: inputs,
      keyNums: [[resign ? "Cash if you withdraw" : "Tax-free now", short(resign ? r.cash : r.fundLump), 0], resign ? ["Average tax rate", pct(r.avg), 0] : ["Pension after tax", short(r.fundPenNet), 0], ["In NPS at " + r.exitAge, short(r.nps), 0], ["Superannuation pension a month", short(r.fundPen), 0]],
      sensTitle: "What changes the answer", sens: r.what.slice(0, 3), sensCurrent: -1,
      chartTitle: "Your superannuation by age", chartNote: "Blue: moved to NPS at " + S.rNps + "%. Amber: kept in the fund at " + S.rFund + "%." + (resign ? " Green: taken as cash after tax and invested at " + S.rCash + "% before tax." : ""),
      chart: { series: series, cross: null },
      chartYears: P.map(function (p) { return p.age; }), chartXLabel: "Your age", chartAge0: S.age,
      money: { title: "Your choices", cols: ["Tax now", "What it becomes"], rows: (resign ? [["Take the cash (" + short(r.cash) + " in hand)", short(r.wTax), short(r.cashAt) + " at " + r.exitAge + " if invested"]] : [])
        .concat([["Move it to NPS", "Nil", short(r.nps) + " at " + r.exitAge], [resign ? "Keep it in the superannuation fund" : "Take the fund's pension", "Nil", short(r.fund) + " at " + r.fundAge]]), note: r.notes, noteTitle: "What this means for you" },
      tables: [{ title: "By age", sheet: "By age", cols: ["Your age", "Moved to NPS", "Kept in the fund", resign ? "Cash invested" : "—"],
        yearly: P.map(function (p) { return [p.age, p.nps, p.fund, resign ? p.cash : 0]; }), monthly: null,
        noteTitle: "How this is worked out", note: ["Withdrawal tax = balance × your average rate of tax (tax ÷ total income) on your income, " + (S.regime === "old" ? "old" : "new") + " regime, tax year 2026-27 slabs.", "NPS at 60: up to 80% lump sum, 60% of the corpus tax-free, the rest buys a pension at the annuity rate.", "Fund at retirement: " + Math.round(S.commute) + "% commuted tax-free, the rest buys a pension taxed as salary."] }],
      notes: ["Your fund's own rules decide which choices you have when you leave; ask the trustees or HR for them in writing.", "Returns and annuity rates are assumptions; change them to your fund's declared rate and current annuity quotes.", "The fund may work out the average rate from your actual tax in the last three years; this calculator estimates it from your income."],
      taxRules: ["Income-tax Act, 2025: Schedule II, Table, Sl. No. 8 (exempt payments from an approved superannuation fund, including transfer to NPS); Schedule XI, Part B, para 7 (tax at the average rate of the previous three years when paid during service); section 392; section 2(16) (average rate)."],
      short: short, inr: inr
    };
  }
  function busy(b, on) { b.disabled = on; b.setAttribute("aria-busy", on ? "true" : "false"); }
  $("saPdf").addEventListener("click", function () { var b = this; busy(b, true); say("Making your PDF…"); withReport(function (Kt) { Kt.pdf(spec()).then(function () { busy(b, false); say("PDF report downloaded."); }, function () { busy(b, false); say("Couldn't make the PDF. Please try again."); }); }); });
  $("saXlsx").addEventListener("click", function () { var b = this; busy(b, true); withReport(function (Kt) { try { Kt.xlsx(spec()); say("Excel file downloaded."); } catch (e) { say("Couldn't make the Excel file. Please try again."); } busy(b, false); }); });
  $("saShare").addEventListener("click", function () {
    var q = new URLSearchParams(); NUM.concat(["sit", "regime"]).forEach(function (k) { q.set(k, S[k]); });
    var t = location.origin + location.pathname + "?" + q.toString();
    function ok() { say("Link copied. Anyone with it sees these numbers."); }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(ok, function () { say("Couldn't copy. Copy the address bar instead."); }); else say("Copy the address bar to share.");
  });
  (function bar() {
    var el = $("saBar"), seen = false, inForm = false; if (!("IntersectionObserver" in window)) return;
    function upd() { el.hidden = seen || !inForm; }
    new IntersectionObserver(function (e) { seen = e[0].isIntersecting; upd(); }).observe($("saVerdict"));
    new IntersectionObserver(function (e) { inForm = e[0].isIntersecting; upd(); }).observe(document.querySelector(".sax .lp-setup"));
    $("saBarBtn").addEventListener("click", function () { $("saVerdict").scrollIntoView({ behavior: "smooth", block: "start" }); });
  })();
  render();
})();
