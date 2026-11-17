/* Application: state, data loading, pickers, rendering, URL and language. */
(function () {
  "use strict";
  const I = LE.i18n;
  const { t, num, signed, int } = I;
  const CFG = Object.assign({
    googleMapsEmbedApiKey: "", geocoderUrl: "https://nominatim.openstreetmap.org/search", geocoderEmail: "",
    defaultLanguage: "de", credit: "", imprintUrl: "", privacyUrl: "", example: { a: "09188139", b: "05513000" }
  }, window.LE_CONFIG || {});
  const SEX = ["both", "female", "male"];
  const D = { ready: false, classCache: {}, rankCache: {} };
  const state = { sex: "both", ageIdx: 0, periodIdx: 0, target: "A", slots: { A: null, B: null } };
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") e.className = v;
      else if (k === "text") e.textContent = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children) if (c !== null && c !== undefined) e.append(c);
    return e;
  }
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  async function fetchJSON(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(url + " " + r.status);
    return r.json();
  }
  function store(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* storage unavailable */ } }
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }

  /* ------------------------------------------------------------------------------------------
   * Data access
   * ------------------------------------------------------------------------------------------ */
  function le(id, p = state.periodIdx, s = state.sex, a = state.ageIdx) {
    const v = D.leVals[id];
    return v ? v[(p * 3 + SEX.indexOf(s)) * D.nAges + a] : null;
  }
  function lastP() { return D.periods.length - 1; }
  // differences are computed from the values as displayed (one decimal), so the arithmetic on screen adds up
  const r1 = (v) => (v === null || v === undefined ? null : Math.round(v * 10) / 10);
  function ranks() {
    const key = `${state.periodIdx}|${state.sex}|${state.ageIdx}`;
    if (!D.rankCache[key]) {
      const sorted = D.ids.slice().sort((x, y) => le(y) - le(x));
      D.rankCache[key] = new Map(sorted.map((id, i) => [id, i + 1]));
    }
    return D.rankCache[key];
  }
  function medianLE(p = state.periodIdx) { return d3.median(D.ids, (id) => le(id, p)); }
  function dname(id) { const d = D.dist.get(id); return d ? d.display : id; }
  function bezLabel(b) {
    if (I.getLang() === "de") return b;
    const k = "bez_" + b.replace(/\s+/g, "_");
    const v = t(k);
    return v === k ? b : v;
  }
  function dsub(id) { const d = D.dist.get(id); return d ? `${bezLabel(d.bez)}, ${d.land}` : ""; }
  function ageText() { return state.ageIdx === 0 ? t("ageText0") : t("ageTextN", { n: D.ages[state.ageIdx] }); }
  function sexText() { return t("sex_" + state.sex); }
  function periodText(p = state.periodIdx) { return D.periods[p]; }
  function periodYears(p) { const [a, b] = D.periods[p].split("–").map(Number); return d3.range(a, b + 1); }
  function gisdLatestIdx() { return D.gisd.years.length - 1; }
  function gisdOf(id, yi = gisdLatestIdx()) { const g = D.gisd.values[id]; return g ? g.s[yi] : null; }
  function gisdMean(id, years) {
    const g = D.gisd.values[id]; if (!g) return null;
    const vals = years.map((y) => g.s[D.gisd.years.indexOf(y)]).filter((v) => v !== null && v !== undefined);
    return vals.length ? d3.mean(vals) : null;
  }
  function digitsFor(step) { return step >= 1 ? 0 : step >= 0.5 || Math.abs(step * 10 - Math.round(step * 10)) < 1e-9 ? 1 : 2; }
  function euro(v, nd) {
    if (v === null || v === undefined) return "–";
    return I.getLang() === "de" ? `${num(v, nd)} €` : `€${num(v, nd)}`;
  }

  /* colour classes for the current age & sex, fixed across periods */
  function classes() {
    const theme = css("--map-hi");
    const key = `${state.sex}|${state.ageIdx}|${theme}`;
    if (D.classCache[key]) return D.classCache[key];
    const vals = [];
    for (const id of D.ids) for (let p = 0; p < D.periods.length; p++) vals.push(le(id, p));
    const [mn, mx] = d3.extent(vals);
    let best = null;
    for (const step of [0.1, 0.2, 0.25, 0.5, 1, 2, 2.5, 5]) {
      const lo = Math.floor(mn / step + 1e-9) * step, hi = Math.ceil(mx / step - 1e-9) * step;
      const n = Math.round((hi - lo) / step);
      if (n >= 4 && n <= 8) {
        const score = Math.abs(n - 6) + (step === 0.2 || step === 0.25 ? 0.5 : 0);
        if (!best || score < best.score) best = { step, lo, hi, n, score };
      }
    }
    if (!best) best = { step: (mx - mn) / 6, lo: mn, hi: mx, n: 6 };
    const breaks = d3.range(best.n + 1).map((i) => +(best.lo + i * best.step).toFixed(4));
    const C = LE.charts.colors();
    const colors = d3.quantize(d3.interpolateLab(C.mapLo, C.mapHi), best.n);
    const scale = d3.scaleThreshold(breaks.slice(1, -1), colors);
    D.classCache[key] = { breaks, colors, scale, domain: [best.lo, best.hi], step: best.step };
    return D.classCache[key];
  }

  /* ------------------------------------------------------------------------------------------
   * Place lookup
   * ------------------------------------------------------------------------------------------ */
  let gazPromise = null;
  function ensureGaz() {
    if (!gazPromise) {
      const districts = D.districts.map((d) => ({ id: d.id, display: d.display, name: d.name, pop: d.pop, land: d.land, bez: d.bez }));
      gazPromise = LE.search.load("data/places.json", districts).catch((e) => { gazPromise = null; throw e; });
    }
    return gazPromise;
  }

  let detail = null, detailPromise = null;
  async function districtAt(lon, lat) {
    if (!LE.search.inDE(lat, lon)) return null;
    if (!detail) {
      if (!detailPromise) {
        detailPromise = fetchJSON("data/geo_detail.json").then((topo) => {
          detail = topojson.feature(topo, topo.objects.kreise).features
            .map((f) => LE.map.rewind(f))
            .map((f) => ({ id: f.properties.id, f, b: d3.geoBounds(f) }));
        });
      }
      await detailPromise;
    }
    const p = [lon, lat];
    for (const d of detail) {
      const [[x0, y0], [x1, y1]] = d.b;
      if (lon < x0 || lon > x1 || lat < y0 || lat > y1) continue;
      if (d3.geoContains(d.f, p)) return d.id;
    }
    // points on lakes or the coastline: nearest district within ~3 km
    let best = null, bestD = Infinity;
    for (const d of detail) {
      const [[x0, y0], [x1, y1]] = d.b;
      if (lon < x0 - 0.05 || lon > x1 + 0.05 || lat < y0 - 0.04 || lat > y1 + 0.04) continue;
      const dist = d3.geoDistance(p, d3.geoCentroid(d.f));
      if (dist < bestD) { bestD = dist; best = d.id; }
    }
    return bestD * 6371 < 40 ? best : null;
  }

  /* ------------------------------------------------------------------------------------------
   * Pickers
   * ------------------------------------------------------------------------------------------ */
  const pickers = {};

  function setupPicker(slot) {
    const root = $(`.picker[data-slot="${slot}"]`);
    const P = { slot, root, input: $("input", root), list: $(".listbox", root), status: $("#status-" + slot),
      options: [], active: -1, seq: 0 };
    pickers[slot] = P;
    let timer = null;
    P.input.addEventListener("focus", () => { ensureGaz().catch(() => {}); setTarget(slot); });
    P.input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => suggestFor(P), 60); });
    P.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown") { e.preventDefault(); if (P.list.hidden) suggestFor(P); else moveActive(P, 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); moveActive(P, -1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (!P.list.hidden && P.active >= 0) chooseOption(P, P.options[P.active]); else submit(P);
      } else if (e.key === "Escape") closeList(P);
    });
    P.input.addEventListener("blur", () => setTimeout(() => closeList(P), 150));
    P.list.addEventListener("pointerdown", (e) => e.preventDefault());
    $('[data-act="search"]', root).addEventListener("click", () => submit(P));
    $('[data-act="locate"]', root).addEventListener("click", () => locateMe(P));
    $('[data-act="clear"]', root).addEventListener("click", () => { P.input.value = ""; closeList(P); setSlot(slot, null); P.input.focus(); });
  }

  async function suggestFor(P) {
    const q = P.input.value;
    try { await ensureGaz(); } catch (e) { return; }
    let opts = q.trim() ? LE.search.suggest(q, 7) : [];
    const looksAddress = /\d/.test(q) && /[a-zäöüß]/i.test(q) || /,/.test(q);
    if (CFG.geocoderUrl && q.trim().length >= 4 && !/^\d+$/.test(q.trim()) && !LE.search.parseCoordinates(q) &&
        (looksAddress || opts.length === 0)) {
      opts = opts.slice(0, 6);
      opts.push({ type: "online", query: q.trim() });
    }
    P.options = opts;
    P.active = -1;
    renderList(P);
  }

  function optionText(o) {
    if (o.type === "district") return [o.name, `${t("sugDistrict")} · ${o.sub.land}`];
    if (o.type === "place") return [o.name, `${t("sugPlace")} · ${dname(o.kreis)}`];
    if (o.type === "plz") return [`${o.id} ${o.place}`, `${t("sugPlz")} · ${dname(o.districts[0][0])}`];
    return [t("sugAddress", { q: o.query }), t("sugAddressSub")];
  }

  function renderList(P) {
    P.list.replaceChildren();
    if (!P.options.length) { closeList(P); return; }
    P.options.forEach((o, i) => {
      const [name, sub] = optionText(o);
      const li = el("li", { role: "option", id: `opt-${P.slot}-${i}`, "aria-selected": i === P.active ? "true" : "false",
        class: o.type === "online" ? "opt-online" : null },
      el("span", { class: "opt-name", text: name }), el("span", { class: "opt-sub", text: sub }));
      li.addEventListener("click", () => chooseOption(P, o));
      P.list.append(li);
    });
    P.list.hidden = false;
    P.input.setAttribute("aria-expanded", "true");
    if (P.active >= 0) P.input.setAttribute("aria-activedescendant", `opt-${P.slot}-${P.active}`);
    else P.input.removeAttribute("aria-activedescendant");
  }
  function moveActive(P, d) {
    if (!P.options.length) return;
    P.active = (P.active + d + P.options.length) % P.options.length;
    renderList(P);
    const li = $(`#opt-${P.slot}-${P.active}`);
    if (li) li.scrollIntoView({ block: "nearest" });
  }
  function closeList(P) {
    P.list.hidden = true;
    P.input.setAttribute("aria-expanded", "false");
    P.input.removeAttribute("aria-activedescendant");
  }

  function chooseOption(P, o) {
    closeList(P);
    if (o.type === "online") return runGeocode(P, o.query);
    applyResolution(P.slot, LE.search.entryToResolution(o));
  }

  async function submit(P) {
    const q = P.input.value.trim();
    if (!q) return;
    closeList(P);
    try { await ensureGaz(); } catch (e) { setStatus(P.slot, t("loadError"), true); return; }
    const r = LE.search.resolveLocal(q);
    if (r.type === "none") return;
    if (r.type === "choices") {
      return showChoices(P, r.items.map((e) => ({ label: optionText(e).join(" · "), res: LE.search.entryToResolution(e) })));
    }
    if (r.type === "online") {
      // a place name without exact match (e.g. "Neustadt"): offer the local candidates first
      const looksAddress = /\d/.test(q) && /[a-zäöüß]/i.test(q) || /,/.test(q);
      const local = looksAddress ? [] : LE.search.suggest(q, 7).filter((e) => e.cls <= 2);
      if (local.length) {
        const items = local.map((e) => ({ label: optionText(e).join(" · "), res: LE.search.entryToResolution(e) }));
        if (CFG.geocoderUrl) items.push({ label: t("sugAddress", { q }), online: q });
        return showChoices(P, items);
      }
      if (!CFG.geocoderUrl) return setStatus(P.slot, t("statusGeocoderOff"), true);
      return runGeocode(P, r.query);
    }
    applyResolution(P.slot, r);
  }

  function shortAddr(s) {
    const parts = s.split(", ").filter((x) => !/^(Deutschland|Germany)$/i.test(x));
    return parts.slice(0, 4).join(", ");
  }

  async function runGeocode(P, q) {
    if (!CFG.geocoderUrl) return setStatus(P.slot, t("statusGeocoderOff"), true);
    const seq = ++P.seq;
    setStatus(P.slot, t("statusSearching"));
    try {
      const res = await LE.search.geocode(q, { url: CFG.geocoderUrl, email: CFG.geocoderEmail, lang: I.getLang() });
      if (seq !== P.seq) return;
      if (!res.length) return setStatus(P.slot, t("statusNoResult"), true);
      // assign each hit to its district; only ask when the hits fall into different districts
      const ids = await Promise.all(res.map((x) => districtAt(x.lon, x.lat).catch(() => null)));
      if (seq !== P.seq) return;
      const hits = res.map((x, i) => ({ x, id: ids[i] })).filter((h) => h.id && D.dist.has(h.id));
      if (!hits.length) return setStatus(P.slot, t("statusOutside"), true);
      const mk = (h) => ({ type: "point", lat: h.x.lat, lon: h.x.lon, kreis: h.id, source: "address", label: shortAddr(h.x.label) });
      if (new Set(hits.map((h) => h.id)).size === 1) return applyResolution(P.slot, mk(hits[0]));
      showChoices(P, hits.map((h) => ({ label: `${shortAddr(h.x.label)} · ${dname(h.id)}`, res: mk(h) })));
    } catch (e) {
      if (seq === P.seq) setStatus(P.slot, t("statusGeocoderError"), true);
    }
  }

  function showChoices(P, items) {
    P.status.classList.remove("is-error");
    P.status.replaceChildren(el("span", { text: t("statusChoose") }));
    const ul = el("ul", { class: "choices" });
    for (const it of items) {
      const b = el("button", { type: "button", text: it.label });
      b.addEventListener("click", () => (it.online ? runGeocode(P, it.online) : applyResolution(P.slot, it.res)));
      ul.append(el("li", {}, b));
    }
    P.status.append(ul);
  }

  async function locateMe(P) {
    setStatus(P.slot, t("statusSearching"));
    try {
      const p = await LE.search.locate();
      applyResolution(P.slot, { type: "point", lat: p.lat, lon: p.lon, source: "geoloc", label: LE.search.fmtCoord(p.lat, p.lon) });
    } catch (e) {
      setStatus(P.slot, t(e && e.message === "insecure" ? "statusGeolocInsecure" : "statusGeolocDenied"), true);
    }
  }

  async function applyResolution(slot, res) {
    if (!res) return;
    if (res.type === "district") {
      return setSlot(slot, { id: res.id, point: null, label: dname(res.id), source: "district" });
    }
    if (res.type === "plz") {
      const ds = res.districts, main = ds[0];
      let note = "";
      if (ds.length > 1 && main[1] < 90) {
        note = t("statusPlzMulti", { plz: res.plz, main: dname(main[0]), share: main[1],
          others: ds.slice(1).map((d) => `${dname(d[0])} (${d[1]} %)`).join(", ") });
      }
      return setSlot(slot, { id: main[0], point: null, label: `${res.plz} ${res.place}`, source: "plz", note });
    }
    if (res.type === "point") {
      let id = res.kreis || null;
      if (!id) {
        setStatus(slot, t("statusSearching"));
        try { id = await districtAt(res.lon, res.lat); } catch (e) { setStatus(slot, t("loadError"), true); return; }
      }
      if (!id || !D.dist.has(id)) return setStatus(slot, t("statusOutside"), true);
      return setSlot(slot, { id, point: [res.lon, res.lat], label: res.label, source: res.source, approx: !!res.approx });
    }
  }

  function setStatus(slot, msg, isError) {
    const st = pickers[slot].status;
    st.classList.toggle("is-error", !!isError);
    st.replaceChildren(document.createTextNode(msg));
  }

  function renderStatus(slot) {
    const s = state.slots[slot];
    const st = pickers[slot].status;
    st.classList.remove("is-error");
    st.replaceChildren();
    if (!s) return;
    const src = t("src_" + s.source);
    if (s.source === "district" || s.source === "map") {
      st.append(el("span", { class: "resolved", text: `${src}: ${dname(s.id)}` }), document.createTextNode(`, ${D.dist.get(s.id).land}`));
    } else {
      st.append(el("span", { class: "resolved", text: `${src}: ${s.label}` }),
        document.createTextNode(` · ${t("inDistrict")} `), el("strong", { text: dname(s.id) }),
        document.createTextNode(`, ${D.dist.get(s.id).land}`));
    }
    if (s.note) st.append(el("div", { text: s.note }));
  }

  function setTarget(slot) {
    state.target = slot;
    const r = $("#target-" + slot);
    if (r) r.checked = true;
  }

  function setSlot(slot, v, opts = {}) {
    state.slots[slot] = v;
    const P = pickers[slot];
    if (document.activeElement !== P.input || v) P.input.value = v ? v.label : "";
    renderStatus(slot);
    $$("[data-example-chip]", P.root).forEach((c) => { c.hidden = !(v && v.source === "example"); });
    updateExampleNote();
    if (opts.silent) return;
    if (slot === "A" && !state.slots.B) setTarget("B");
    else if (slot === "B" && !state.slots.A) setTarget("A");
    render();
    updateURL();
  }

  function updateExampleNote() {
    const ex = ["A", "B"].some((k) => state.slots[k] && state.slots[k].source === "example");
    $("#example-note").hidden = !ex;
  }

  /* ------------------------------------------------------------------------------------------
   * Rendering
   * ------------------------------------------------------------------------------------------ */
  function safe(fn, name) { try { fn(); } catch (e) { console.error("render " + name, e); } }

  function render() {
    if (!D.ready) return;
    LE.charts.hideTip();
    safe(renderTexts, "texts");
    safe(renderMap, "map");
    safe(renderHero, "hero");
    safe(renderStreetView, "streetview");
    safe(renderDistribution, "distribution");
    safe(renderChange, "change");
    safe(renderAnnual, "annual");
    safe(renderGap, "gap");
    safe(renderGisd, "gisd");
    safe(renderInkar, "inkar");
    if ($("#t400").open) safe(renderT400, "t400");
  }

  function renderTexts() {
    $("#map-title").textContent = t("mapTitle", { ageText: ageText() });
    $("#map-sub").textContent = t("mapSub", { sexText: sexText(), period: periodText() });
    $("#dist-sub").textContent = t("distSub", { ageText: ageText(), sexText: sexText(), period: periodText() });
    $("#change-sub").textContent = t("changeSub", { ageText: ageText(), sexText: sexText(), first: periodText(0), last: periodText(lastP()) });
    const A = state.slots.A, B = state.slots.B;
    $("#gap-sub").textContent = t("gapSub", { A: A ? dname(A.id) : "A", B: B ? dname(B.id) : "B", sexText: sexText(), period: periodText() });
    $("#scatter-sub").textContent = t("scatterSub", { period: periodText(), ageText: ageText(), sexText: sexText() });
    $("#gisd-strip-sub").textContent = t("gisdStripSub", { year: D.gisd.years[gisdLatestIdx()] });
    $("#t400-intro").textContent = t("t400Intro", { ageText: ageText(), sexText: sexText() });
    $("#sv-intro").textContent = t(CFG.googleMapsEmbedApiKey ? "svIntro" : "svIntroNoKey");
  }

  function slotDatum(k) {
    const s = state.slots[k];
    return s ? { id: s.id, v: le(s.id), label: dname(s.id) } : null;
  }

  function renderMap() {
    const cl = classes();
    const C = LE.charts.colors();
    LE.map.setFill((id) => { const v = le(id); return v === null || v === undefined ? C.field : cl.scale(v); });
    const sel = {};
    for (const k of ["A", "B"]) {
      const s = state.slots[k];
      if (s) sel[k] = { id: s.id, point: s.point || s.pinPoint || null };
    }
    LE.map.setSelection(sel);
    LE.map.legend($("#map-legend"), { breaks: cl.breaks, colors: cl.colors, fmt: (v) => num(v, digitsFor(cl.step)),
      a: slotDatum("A"), b: slotDatum("B") });
  }

  function mapTip(id) {
    const v = le(id);
    return {
      title: dname(id), sub: dsub(id),
      rows: [
        { k: `${t("leShort")} ${ageText()}`, v: `${num(v, 1)} ${t("yearsShort")}` },
        { k: t("rankOf", { rank: ranks().get(id) }), v: "" },
        { k: t("mapClickHint", { slot: t("slot" + state.target) }), v: "" }
      ]
    };
  }

  function renderHero() {
    const A = state.slots.A, B = state.slots.B;
    $("#hero-eyebrow").textContent = [state.ageIdx === 0 ? t("heroBirth") : t("heroAge", { age: D.ages[state.ageIdx] }),
      sexText(), periodText()].join(" · ");
    for (const k of ["A", "B"]) {
      const s = state.slots[k];
      const box = $("#hero-" + k);
      box.replaceChildren();
      const key = el("span", { class: `key key-${k.toLowerCase()}`, "aria-hidden": "true", text: k });
      if (!s) {
        box.append(el("div", { class: "hero-name" }, key, el("span", { class: "hero-empty", text: t("emptySlot") })));
        continue;
      }
      box.append(
        el("div", { class: "hero-name" }, key, el("span", { text: dname(s.id) })),
        el("div", { class: "hero-meta", text: dsub(s.id) }),
        el("div", { class: "hero-num" }, document.createTextNode(num(le(s.id), 1)), el("span", { class: "unit", text: t("years") })),
        el("div", { class: "hero-rank", text: t("rankOf", { rank: ranks().get(s.id) }) })
      );
    }
    const dBox = $("#hero-diff");
    dBox.replaceChildren();
    const sent = $("#hero-sentence");
    if (A && B && A.id !== B.id) {
      const va = le(A.id), vb = le(B.id), diff = Math.abs(r1(va) - r1(vb));
      dBox.append(el("div", { class: "hero-diff-label", text: t("diffLabel") }),
        el("div", { class: "hero-diff-num" }, document.createTextNode(num(diff, 1)), el("span", { class: "unit", text: t("years") })));
      if (diff < 0.05) sent.textContent = t("heroEqual");
      else {
        sent.textContent = t((state.ageIdx === 0 ? "heroBirth_" : "heroAge_") + state.sex, {
          A: dname(A.id), B: dname(B.id), va: num(va, 1), vb: num(vb, 1), d: num(diff, 1), period: periodText(),
          age: D.ages[state.ageIdx], moreless: va > vb ? t("more") : t("less")
        });
      }
    } else if (A && B) sent.textContent = t("heroSame", { A: dname(A.id) });
    else if (A || B) sent.textContent = t("heroOnlyA");
    else sent.textContent = t("heroNone");
  }

  /* --- Street View --- */
  function svConsent() { try { return sessionStorage.getItem("le-sv-consent") === "1"; } catch (e) { return false; } }
  function setSvConsent() { try { sessionStorage.setItem("le-sv-consent", "1"); } catch (e) { /* ignore */ } }
  function extIcon() {
    const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    s.setAttribute("viewBox", "0 0 20 20"); s.setAttribute("aria-hidden", "true");
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", "M11 3h6v6M17 3l-8 8M15 12v4a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h4");
    p.setAttribute("fill", "none"); p.setAttribute("stroke", "currentColor"); p.setAttribute("stroke-width", "1.6");
    p.setAttribute("stroke-linecap", "round"); p.setAttribute("stroke-linejoin", "round");
    s.append(p);
    return s;
  }
  function svIframe(s) {
    const [lon, lat] = s.point;
    const src = "https://www.google.com/maps/embed/v1/streetview?key=" + encodeURIComponent(CFG.googleMapsEmbedApiKey) +
      `&location=${lat.toFixed(6)},${lon.toFixed(6)}&fov=80&language=${I.getLang()}`;
    return el("iframe", { src, title: t("svIframeTitle", { label: s.label }), loading: "lazy", allowfullscreen: true,
      referrerpolicy: "strict-origin-when-cross-origin" });
  }
  function svCard(k, s) {
    const card = el("div", { class: "sv-card" });
    card.append(el("div", { class: "sv-head" }, el("span", { class: `key key-${k.toLowerCase()}`, "aria-hidden": "true", text: k }),
      el("span", { text: s ? (s.point ? s.label : dname(s.id)) : t("emptySlot") })));
    const frame = el("div", { class: "sv-frame" });
    card.append(frame);
    if (!s || !s.point) {
      frame.append(el("div", { class: "sv-placeholder", text: s ? t("svNoPoint") : t("emptySlot") }));
      return card;
    }
    const [lon, lat] = s.point;
    const svUrl = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`;
    if (CFG.googleMapsEmbedApiKey) {
      if (svConsent()) frame.append(svIframe(s));
      else {
        const ph = el("div", { class: "sv-placeholder" });
        const btn = el("button", { type: "button", class: "btn", text: t("svLoad") });
        const rem = el("input", { type: "checkbox", id: "sv-rem-" + k });
        btn.addEventListener("click", () => {
          if (rem.checked) { setSvConsent(); $("#sv-grid").dataset.key = ""; renderStreetView(); }
          else frame.replaceChildren(svIframe(s));
        });
        ph.append(el("p", { class: "sv-consent", text: t("svConsent") }), btn,
          el("label", { class: "sv-remember", for: "sv-rem-" + k }, rem, document.createTextNode(t("svRemember"))));
        frame.append(ph);
      }
    } else {
      const ph = el("div", { class: "sv-placeholder" });
      frame.append(ph);
      card._post = () => {
        const f = LE.map.feature(s.id);
        if (f) LE.charts.locator(ph, { feature: f, point: s.point, color: css(k === "A" ? "--a" : "--b"), label: t("svLocatorAlt") });
      };
    }
    const a = el("a", { href: svUrl, target: "_blank", rel: "noopener noreferrer", class: "btn" }, extIcon(), document.createTextNode(t("svOpen")));
    const links = el("div", { class: "sv-links" }, a);
    if (s.approx) links.append(el("span", { class: "sv-approx", text: t("statusApprox") }));
    card.append(links);
    return card;
  }
  function renderStreetView() {
    const grid = $("#sv-grid");
    const slots = ["A", "B"].map((k) => [k, state.slots[k]]);
    const key = slots.map(([k, s]) => (s ? `${k}:${s.id}:${s.point ? s.point.join(",") : ""}:${s.label}` : `${k}:-`)).join("|") +
      "|" + I.getLang() + "|" + svConsent() + "|" + css("--bg");
    if (grid.dataset.key === key) return;
    grid.dataset.key = key;
    grid.replaceChildren();
    if (!slots.some(([, s]) => s && s.point)) {
      grid.append(el("p", { class: "sv-empty", style: "grid-column: 1 / -1", text: t("svNoPoint") }));
      return;
    }
    for (const [k, s] of slots) {
      const card = svCard(k, s);
      grid.append(card);
      if (card._post) card._post();
    }
  }

  /* --- distribution --- */
  function districtTip(d, extra = []) {
    return {
      title: dname(d.id), sub: dsub(d.id),
      rows: [{ k: t("leShort"), v: `${num(le(d.id), 1)} ${t("yearsShort")}` }, { k: t("rankOf", { rank: ranks().get(d.id) }), v: "" }, ...extra]
    };
  }
  function renderDistribution() {
    const cl = classes();
    const items = D.ids.map((id) => ({ id, v: le(id) }));
    const med = medianLE();
    LE.charts.strip($("#chart-dist"), {
      items, domain: cl.domain, a: slotDatum("A"), b: slotDatum("B"),
      refLine: { v: med, label: `${t("median")} ${num(med, 1)}` },
      tickFmt: (v) => num(v, digitsFor(cl.step) === 2 ? 1 : digitsFor(cl.step)), valueFmt: (v) => num(v, 1),
      tipSpec: (d) => districtTip(d), lowLabel: t("lowerEnd"), highLabel: t("higherEnd"),
      ariaLabel: t("distTitle")
    });
  }

  /* --- change over periods --- */
  function renderChange() {
    const C = LE.charts.colors();
    const tiles = $("#change-tiles");
    tiles.replaceChildren();
    const L = lastP();
    const mk = (cls, name, v0, v1, keyColor) => {
      const tile = el("div", { class: "tile " + cls });
      tile.append(el("div", { class: "tile-name", text: name }),
        el("div", { class: "tile-val" }, document.createTextNode(signed(r1(v1) - r1(v0), 1)), el("span", { class: "unit", text: t("years") })),
        el("div", { class: "tile-sub", text: t("changeFromTo", { a: num(v0, 1), b: num(v1, 1) }) }));
      if (keyColor) tile.style.borderTopColor = keyColor;
      return tile;
    };
    const ser = [];
    const xs = D.periods.map((p, i) => d3.mean(periodYears(i)));
    const medSeries = D.periods.map((p, i) => medianLE(i));
    ser.push({ key: "M", color: C.ctxStrong, width: 1.5, values: medSeries, marker: 3.5, endLabel: (v) => num(v, 1) });
    for (const k of ["A", "B"]) {
      const s = state.slots[k];
      if (!s) continue;
      if (k === "B" && state.slots.A && state.slots.A.id === s.id) continue;
      tiles.append(mk("tile-" + k.toLowerCase(), dname(s.id), le(s.id, 0), le(s.id, L)));
      ser.push({ key: k, color: k === "A" ? C.a : C.b, values: D.periods.map((p, i) => le(s.id, i)), marker: 4.5, endLabel: (v) => num(v, 1) });
    }
    tiles.append(mk("tile-m", t("medianAll"), medSeries[0], medSeries[L], C.ctxStrong));

    const lg = $("#change-legend");
    lg.replaceChildren();
    for (const k of ["A", "B"]) {
      const s = state.slots[k];
      if (s) lg.append(el("span", {}, el("i", { class: `lkey lkey-${k.toLowerCase()}` }), document.createTextNode(dname(s.id))));
    }
    lg.append(el("span", {}, el("i", { class: "lkey lkey-ctx", style: `background:${C.ctxStrong}` }), document.createTextNode(t("medianAll"))));

    const all = ser.flatMap((s) => s.values).filter((v) => v !== null);
    const [lo, hi] = d3.extent(all);
    const pad = Math.max(0.3, (hi - lo) * 0.12);
    const host = $("#chart-periods");
    LE.charts.lineChart(host, {
      xs, xDomain: [2003, 2021.4],
      xTicks: [2003, 2009, 2015, 2021].map((v) => ({ v, label: String(v) })),
      spans: D.periods.map((p, i) => { const ys = periodYears(i); return { x0: ys[0], x1: ys[ys.length - 1] + 1 }; }),
      series: ser, yDomain: [lo - pad, hi + pad], yFmt: (v) => num(v, Number.isInteger(v) ? 0 : 1), height: 240,
      ariaLabel: t("changeTitle"),
      tipSpec: (i) => ({
        title: D.periods[i], sub: `${t("leShort")} ${ageText()}, ${sexText()}`,
        rows: ser.slice().reverse().map((s) => ({
          color: s.color, k: s.key === "M" ? t("medianAll") : dname(state.slots[s.key].id), v: `${num(s.values[i], 1)} ${t("yearsShort")}`
        }))
      })
    });
  }

  /* --- annual values with CI --- */
  function renderAnnual() {
    const C = LE.charts.colors();
    const host = $("#chart-annual");
    host.replaceChildren();
    const years = D.annualYears;
    const sel = ["A", "B"].map((k) => [k, state.slots[k]]).filter(([k, s]) => s && !(k === "B" && state.slots.A && state.slots.A.id === s.id));
    const lg = $("#annual-legend");
    lg.replaceChildren();
    for (const [k, s] of sel) lg.append(el("span", {}, el("i", { class: `lkey lkey-${k.toLowerCase()}` }), document.createTextNode(dname(s.id))));
    lg.append(el("span", {}, el("i", { class: "lkey lkey-de", style: `background:${C.ctxStrong}` }), document.createTextNode(t("germany"))));
    lg.append(el("span", {}, el("i", { class: "lkey lkey-band-a", style: `background:${C.ctx};opacity:.45` }), document.createTextNode(t("ci"))));

    const vals = [];
    for (const sx of ["f", "m"]) {
      for (const d of D.annual.Germany[sx]) if (d) vals.push(d[0]);
      for (const [, s] of sel) for (const d of D.annual[s.id][sx]) if (d) vals.push(d[1], d[2]);
    }
    const [lo, hi] = d3.extent(vals);
    const W = host.clientWidth;
    const two = W >= 620;
    host.style.display = "grid";
    host.style.gridTemplateColumns = two ? "minmax(0,1fr) minmax(0,1fr)" : "minmax(0,1fr)";
    host.style.gap = two ? "24px" : "18px";
    for (const [sx, title] of [["f", t("sex_female")], ["m", t("sex_male")]]) {
      const div = el("div", { class: "chart" });
      host.append(div);
      const ser = [{ key: "DE", color: C.ctxStrong, width: 1.5, values: D.annual.Germany[sx].map((d) => (d ? d[0] : null)), endLabel: null }];
      for (const [k, s] of sel) {
        const arr = D.annual[s.id][sx];
        ser.push({ key: k, color: k === "A" ? C.a : C.b, values: arr.map((d) => (d ? d[0] : null)),
          band: arr.map((d) => (d ? [d[1], d[2]] : null)), bandColor: k === "A" ? C.aWash : C.bWash, endLabel: (v) => num(v, 1) });
      }
      LE.charts.lineChart(div, {
        xs: years, xDomain: [years[0], years[years.length - 1]],
        xTicks: [2003, 2009, 2015, 2021].map((v) => ({ v, label: String(v) })),
        series: ser, yDomain: [Math.floor(lo), Math.ceil(hi)], yFmt: (v) => num(v, 0), height: 236, title,
        ariaLabel: `${t("annualTitle")}: ${title}`,
        tipSpec: (i) => ({
          title: `${title} ${years[i]}`,
          rows: ser.slice().reverse().map((s) => {
            const d = s.key === "DE" ? D.annual.Germany[sx][i] : D.annual[state.slots[s.key].id][sx][i];
            const name = s.key === "DE" ? t("germany") : dname(state.slots[s.key].id);
            const v = d ? (s.key === "DE" ? num(d[0], 1) : `${num(d[0], 1)} (${num(d[1], 1)}–${num(d[2], 1)})`) : "–";
            return { color: s.color, k: name, v };
          })
        })
      });
    }
  }

  /* --- gap by age --- */
  function renderGap() {
    const host = $("#chart-gap");
    const lg = $("#gap-legend");
    lg.replaceChildren();
    const A = state.slots.A, B = state.slots.B;
    if (!A || !B || A.id === B.id) {
      host.replaceChildren(el("p", { class: "sv-empty", text: A && B ? t("heroSame", { A: dname(A.id) }) : t("heroOnlyA") }));
      return;
    }
    const C = LE.charts.colors();
    const p = state.periodIdx, s = state.sex;
    const va = D.ages.map((a, i) => le(A.id, p, s, i)), vb = D.ages.map((a, i) => le(B.id, p, s, i));
    const values = va.map((v, i) => Math.round((r1(v) - r1(vb[i])) * 10) / 10);
    const i65 = D.ages.indexOf(65);
    if (values.some((v) => v > 0.05)) lg.append(el("span", {}, el("i", { class: "lkey lkey-dot lkey-a", style: "border-radius:2px" }), document.createTextNode(t("gapPos", { A: dname(A.id) }))));
    if (values.some((v) => v < -0.05)) lg.append(el("span", {}, el("i", { class: "lkey lkey-dot lkey-b", style: "border-radius:2px" }), document.createTextNode(t("gapNeg", { B: dname(B.id) }))));
    LE.charts.gapBars(host, {
      cats: D.ages, values, labelIdx: [0, i65].filter((i) => i >= 0),
      fmt: (v, sgn) => (sgn ? signed(v, 1) : num(v, Number.isInteger(v) ? 0 : 1)), ageAxis: t("ageAxis"),
      ariaLabel: t("gapTitle"),
      tipSpec: (i) => ({
        title: i === 0 ? t("ageTip0") : t("ageTipN", { n: D.ages[i] }),
        rows: [
          { color: C.a, k: dname(A.id), v: `${num(va[i], 1)} ${t("yearsShort")}` },
          { color: C.b, k: dname(B.id), v: `${num(vb[i], 1)} ${t("yearsShort")}` },
          { k: t("diffShort"), v: `${signed(values[i], 1)} ${t("yearsShort")}` }
        ]
      })
    });
  }

  /* --- GISD --- */
  function quintileBounds(yi) {
    const groups = d3.groups(D.ids.filter((id) => D.gisd.values[id]), (id) => D.gisd.values[id].q5[yi]);
    const byQ = new Map(groups.map(([q, ids]) => [q, d3.extent(ids, (id) => D.gisd.values[id].s[yi])]));
    const bounds = [];
    for (let q = 1; q < 5; q++) {
      const a = byQ.get(q), b = byQ.get(q + 1);
      if (a && b) bounds.push((a[1] + b[0]) / 2);
    }
    return bounds;
  }
  function renderGisd() {
    const C = LE.charts.colors();
    const yi = gisdLatestIdx(), year = D.gisd.years[yi];
    const cards = $("#gisd-cards");
    cards.replaceChildren();
    for (const k of ["A", "B"]) {
      const s = state.slots[k];
      if (!s) continue;
      const g = D.gisd.values[s.id];
      const q = g.q5[yi];
      const qbar = el("div", { class: "qbar", "aria-hidden": "true" });
      for (let i = 1; i <= 5; i++) qbar.append(el("span", { class: i === q ? "on" : null }));
      cards.append(el("div", { class: "gisd-card " + k.toLowerCase() },
        el("div", { class: "tile-name", text: `${dname(s.id)} · ${t("gisdScore", { year })}` }),
        el("div", { class: "gisd-val", text: num(g.s[yi], 2) }),
        el("div", { class: "gisd-q", text: `${t("quintile", { q })}: ${t("q" + q)}` }),
        qbar));
    }

    // strip of all districts
    const bounds = quintileBounds(yi);
    const edges = [0, ...bounds, 1];
    LE.charts.strip($("#chart-gisd-strip"), {
      items: D.ids.map((id) => ({ id, v: gisdOf(id) })), domain: [0, 1],
      a: state.slots.A ? { id: state.slots.A.id, v: gisdOf(state.slots.A.id), label: dname(state.slots.A.id) } : null,
      b: state.slots.B ? { id: state.slots.B.id, v: gisdOf(state.slots.B.id), label: dname(state.slots.B.id) } : null,
      bounds: bounds.map((v) => ({ v })),
      boundLabels: d3.range(5).map((i) => ({ v: (edges[i] + edges[i + 1]) / 2, label: "Q" + (i + 1) })),
      ticks: [0, 0.2, 0.4, 0.6, 0.8, 1], tickFmt: (v) => num(v, 1), valueFmt: (v) => num(v, 2),
      lowLabel: t("gisdLess"), highLabel: t("gisdMore"), ariaLabel: t("gisdStripSub", { year }),
      tipSpec: (d) => ({ title: dname(d.id), sub: dsub(d.id), rows: [
        { k: t("gisdScore", { year }), v: num(d.v, 2) },
        { k: t("quintile", { q: D.gisd.values[d.id].q5[yi] }), v: t("q" + D.gisd.values[d.id].q5[yi]) }] })
    });

    // scatter GISD vs LE
    const yrs = periodYears(state.periodIdx);
    const items = D.ids.map((id) => ({ id, x: gisdMean(id, yrs), y: le(id) }));
    const ok = items.filter((d) => d.x !== null && d.y !== null);
    const mx = d3.mean(ok, (d) => d.x), my = d3.mean(ok, (d) => d.y);
    let sxy = 0, sxx = 0, syy = 0;
    for (const d of ok) { sxy += (d.x - mx) * (d.y - my); sxx += (d.x - mx) ** 2; syy += (d.y - my) ** 2; }
    const slope = sxy / sxx, intercept = my - slope * mx, r = sxy / Math.sqrt(sxx * syy);
    const cl = classes();
    LE.charts.scatter($("#chart-scatter"), {
      items, a: slotDatum("A"), b: slotDatum("B"), xDomain: [0, 1], yDomain: cl.domain, fit: { slope, intercept },
      xFmt: (v) => num(v, 1), yFmt: (v) => num(v, Number.isInteger(v) ? 0 : 1),
      xLabel: t("scatterX"), yLabel: `${t("leShort")} (${t("years")})`, ariaLabel: t("scatterTitle"),
      tipSpec: (d) => ({ title: dname(d.id), sub: dsub(d.id), rows: [
        { k: `GISD (${periodText()})`, v: num(d.x, 2) },
        { k: `${t("leShort")} ${ageText()}`, v: `${num(d.y, 1)} ${t("yearsShort")}` }] })
    });
    $("#scatter-stat").textContent = t("scatterStat", { r: num(r, 2), slope: signed(slope * 0.1, 2) });

    // GISD over time
    const host = $("#chart-gisd-trend");
    const sel = ["A", "B"].map((k) => [k, state.slots[k]]).filter(([k, s]) => s && !(k === "B" && state.slots.A && state.slots.A.id === s.id));
    if (!sel.length) { host.replaceChildren(); return; }
    const years = D.gisd.years;
    const ser = sel.map(([k, s]) => ({ key: k, color: k === "A" ? C.a : C.b, values: D.gisd.values[s.id].s, endLabel: (v) => num(v, 2) }));
    LE.charts.lineChart(host, {
      xs: years, xDomain: [years[0], years[years.length - 1]],
      xTicks: [1998, 2003, 2008, 2013, 2018, 2023].map((v) => ({ v, label: String(v) })),
      series: ser, yDomain: [0, 1], yTicks: [0, 0.2, 0.4, 0.6, 0.8, 1], yFmt: (v) => num(v, 1), height: 200,
      ariaLabel: t("gisdTrendTitle"),
      tipSpec: (i) => ({ title: String(years[i]), rows: sel.map(([k, s]) => ({
        color: k === "A" ? C.a : C.b, k: dname(s.id),
        v: `${num(D.gisd.values[s.id].s[i], 2)} (Q${D.gisd.values[s.id].q5[i]})` })) })
    });
  }

  /* --- INKAR table --- */
  const IND_META = {
    akad: { nd: 1, unit: "%" }, ohneab: { nd: 1, unit: "%" }, schulab: { nd: 1, unit: "%" },
    alo: { nd: 1, unit: "" }, beschq: { nd: 1, unit: "" }, brutto: { nd: 0, unit: "€" },
    est: { nd: 0, unit: "€" }, hhek: { nd: 0, unit: "€" }, schuldner: { nd: 1, unit: "%" }
  };
  function fmtInd(key, v) {
    if (v === null || v === undefined) return "–";
    const m = IND_META[key];
    if (m.unit === "€") return euro(v, m.nd);
    return num(v, m.nd) + (m.unit ? " " + m.unit : "");
  }
  function renderInkar() {
    const tbl = $("#ind-table");
    tbl.replaceChildren();
    const A = state.slots.A, B = state.slots.B;
    const head = el("tr", {},
      el("th", { scope: "col", text: t("colIndicator") }),
      el("th", { scope: "col", class: "num" }, el("span", { class: "th-key" }, el("span", { class: "key key-a key-sm", "aria-hidden": "true" }), el("span", { class: "th-name", text: A ? dname(A.id) : "A" }))),
      el("th", { scope: "col", class: "num" }, el("span", { class: "th-key" }, el("span", { class: "key key-b key-sm", "aria-hidden": "true" }), el("span", { class: "th-name", text: B ? dname(B.id) : "B" }))),
      el("th", { scope: "col", class: "num", text: t("colGermany") }),
      el("th", { scope: "col", class: "ind-strip", text: t("colDistribution") }));
    tbl.append(el("colgroup", {}, el("col", { class: "c-name" }), el("col", { class: "c-a" }), el("col", { class: "c-b" }),
      el("col", { class: "c-de" }), el("col", { class: "c-strip" })));
    tbl.append(el("thead", {}, head));
    const body = el("tbody");
    tbl.append(body);
    const lblA = A ? dname(A.id) : "A", lblB = B ? dname(B.id) : "B";
    const posts = [];
    const dimRow = (label) => body.append(el("tr", { class: "dim-row" }, el("th", { colspan: "5", scope: "colgroup", text: label })));
    const row = (nameCell, va, vb, vde, stripFn, isText) => {
      const cls = isText ? "num txt" : "num";
      const tr = el("tr", { class: "ind-row" },
        el("td", { class: "ind-cell" }, ...nameCell),
        el("td", { class: cls, "data-label": lblA, text: va }),
        el("td", { class: cls, "data-label": lblB, text: vb }),
        el("td", { class: cls, "data-label": t("colGermany"), text: vde }));
      const td = el("td", { class: "ind-strip" });
      if (stripFn) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("aria-hidden", "true");
        td.append(svg);
        posts.push(() => stripFn(svg));
      }
      tr.append(td);
      body.append(tr);
    };

    // context
    const popYi = D.inkar.years.length - 1;
    const pop = (id) => (D.inkar.population[id] ? D.inkar.population[id][popYi] : null);
    const area = (id) => D.dist.get(id).area;
    const areaDE = d3.sum(D.ids, area);
    dimRow(t("dim_ctx"));
    row([el("div", { class: "ind-name", text: t("ctx_land") })], A ? D.dist.get(A.id).land : "–", B ? D.dist.get(B.id).land : "–", "–", null, true);
    row([el("div", { class: "ind-name", text: t("ctx_pop") }), el("div", { class: "ind-dir", text: String(D.inkar.years[popYi]) })],
      A ? int(pop(A.id)) : "–", B ? int(pop(B.id)) : "–", int(pop("DE")), null);
    row([el("div", { class: "ind-name", text: t("ctx_density") }), el("div", { class: "ind-dir", text: String(D.inkar.years[popYi]) })],
      A ? int(pop(A.id) / area(A.id)) : "–", B ? int(pop(B.id) / area(B.id)) : "–", int(pop("DE") / areaDE), null);
    row([el("div", { class: "ind-name", text: t("ctx_type") })], A ? t("ktyp" + D.dist.get(A.id).ktyp) : "–",
      B ? t("ktyp" + D.dist.get(B.id).ktyp) : "–", "–", null, true);

    for (const dim of ["edu", "emp", "inc"]) {
      dimRow(t("dim_" + dim));
      for (const [key, ind] of Object.entries(D.inkar.indicators)) {
        if (ind.dim !== dim) continue;
        const year = D.inkar.coverage[key][1];
        const yi = D.inkar.years.indexOf(year);
        const v = (id) => (ind.values[id] ? ind.values[id][yi] : null);
        const all = D.ids.map(v);
        row([el("div", { class: "ind-name", text: t("ind_" + key) }),
          el("div", { class: "ind-def", text: t("ind_" + key + "_def") }),
          el("div", { class: "ind-dir", text: `${year} · ${ind.sign > 0 ? t("higherWorse") : t("higherBetter")}` })],
        A ? fmtInd(key, v(A.id)) : "–", B ? fmtInd(key, v(B.id)) : "–", fmtInd(key, v("DE")),
        (svg) => LE.charts.miniStrip(svg, { values: all, de: v("DE"), a: A ? v(A.id) : null, b: B ? v(B.id) : null }));
      }
    }
    for (const f of posts) f();
  }

  /* --- table of all districts --- */
  const t400Sort = { key: "le", dir: -1 };
  function renderT400() {
    const wrap = $("#t400-wrap");
    const L = lastP(), yi = gisdLatestIdx();
    const rows = D.ids.map((id) => ({ id, name: dname(id), land: D.dist.get(id).land, le: le(id), chg: r1(le(id, L)) - r1(le(id, 0)), gisd: gisdOf(id) }));
    const cols = [
      { key: "name", label: t("t400District") }, { key: "land", label: t("t400Land") },
      { key: "le", label: t("t400Le", { period: periodText() }), num: true },
      { key: "chg", label: t("t400Change", { first: periodText(0) }), num: true },
      { key: "gisd", label: t("t400Gisd", { year: D.gisd.years[yi] }), num: true }
    ];
    const { key, dir } = t400Sort;
    rows.sort((a, b) => (typeof a[key] === "string" ? a[key].localeCompare(b[key], I.getLang()) : a[key] - b[key]) * dir);
    const table = el("table", { class: "t400-table" });
    const htr = el("tr");
    for (const c of cols) {
      const th = el("th", { scope: "col", class: c.num ? "num" : null,
        "aria-sort": c.key === key ? (dir > 0 ? "ascending" : "descending") : "none" });
      const b = el("button", { type: "button", text: c.label });
      b.addEventListener("click", () => {
        if (t400Sort.key === c.key) t400Sort.dir *= -1; else { t400Sort.key = c.key; t400Sort.dir = c.num ? -1 : 1; }
        renderT400();
      });
      th.append(b);
      htr.append(th);
    }
    table.append(el("thead", {}, htr));
    const tb = el("tbody");
    const idA = state.slots.A && state.slots.A.id, idB = state.slots.B && state.slots.B.id;
    for (const r of rows) {
      const pa = el("button", { type: "button", class: "pa", text: "A", "aria-label": `${r.name}: ${t("t400Pick", { slot: "A" })}` });
      const pb = el("button", { type: "button", class: "pb", text: "B", "aria-label": `${r.name}: ${t("t400Pick", { slot: "B" })}` });
      pa.addEventListener("click", () => applyResolution("A", { type: "district", id: r.id }));
      pb.addEventListener("click", () => applyResolution("B", { type: "district", id: r.id }));
      tb.append(el("tr", { class: r.id === idA ? "is-a" : r.id === idB ? "is-b" : null },
        el("td", {}, document.createTextNode(r.name + " "), el("span", { class: "pick-btns" }, pa, pb)),
        el("td", { text: r.land }),
        el("td", { class: "num", text: num(r.le, 1) }),
        el("td", { class: "num", text: signed(r.chg, 1) }),
        el("td", { class: "num", text: num(r.gisd, 2) })));
    }
    table.append(tb);
    wrap.replaceChildren(table);
  }

  /* ------------------------------------------------------------------------------------------
   * Controls, URL, language
   * ------------------------------------------------------------------------------------------ */
  function buildAgeOptions() {
    const sel = $("#age-ctl");
    sel.replaceChildren();
    D.ages.forEach((a, i) => {
      const label = a === 0 ? t("ageBirth") : a === 1 ? t("ageOne") : t("ageN", { n: a });
      sel.append(el("option", { value: String(i), text: label }));
    });
    sel.value = String(state.ageIdx);
  }
  function buildPeriodControl() {
    const box = $("#period-ctl");
    box.replaceChildren();
    D.periods.forEach((p, i) => {
      const id = "period-" + i;
      const inp = el("input", { type: "radio", name: "period", id, value: String(i) });
      inp.checked = i === state.periodIdx;
      inp.addEventListener("change", () => { state.periodIdx = i; render(); updateURL(); });
      box.append(inp, el("label", { for: id, text: p }));
    });
  }
  function syncControls() {
    const sx = $(`#sex-${state.sex}`);
    if (sx) sx.checked = true;
    $("#age-ctl").value = String(state.ageIdx);
    const pr = $(`#period-${state.periodIdx}`);
    if (pr) pr.checked = true;
  }

  function updateURL() {
    const p = new URLSearchParams();
    for (const k of ["A", "B"]) {
      const s = state.slots[k];
      if (s && s.source !== "example") p.set(k.toLowerCase(), s.id);
    }
    if (state.sex !== "both") p.set("sex", state.sex);
    if (state.ageIdx) p.set("age", String(D.ages[state.ageIdx]));
    if (state.periodIdx !== lastP()) p.set("period", D.periods[state.periodIdx].replace("–", "-"));
    if (I.getLang() !== CFG.defaultLanguage) p.set("lang", I.getLang());
    const qs = p.toString();
    try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + location.hash); } catch (e) { /* ignore */ }
  }
  function shareURL() {
    const p = new URLSearchParams(location.search);
    for (const k of ["A", "B"]) { const s = state.slots[k]; if (s) p.set(k.toLowerCase(), s.id); }
    const qs = p.toString();
    return location.origin + location.pathname + (qs ? "?" + qs : "");
  }

  function applyLang(l) {
    I.setLang(l);
    document.documentElement.lang = l;
    document.title = t("pageTitle");
    const md = $('meta[name="description"]');
    if (md) md.setAttribute("content", t("metaDescription"));
    $$("[data-i18n]").forEach((n) => { n.textContent = t(n.dataset.i18n); });
    $$("[data-i18n-placeholder]").forEach((n) => { n.placeholder = t(n.dataset.i18nPlaceholder); });
    $$("[data-i18n-aria]").forEach((n) => { n.setAttribute("aria-label", t(n.dataset.i18nAria)); });
    $$("[data-lang-block]").forEach((n) => { n.hidden = n.dataset.langBlock !== l; });
    $$("[data-set-lang]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.setLang === l)));
    if (D.ready) {
      buildAgeOptions();
      for (const k of ["A", "B"]) {
        const s = state.slots[k];
        if (s && (s.source === "district" || s.source === "map")) { s.label = dname(s.id); pickers[k].input.value = s.label; }
        renderStatus(k);
      }
      footer();
    }
  }

  function footer() {
    const c = $("#foot-credit");
    c.replaceChildren();
    if (CFG.credit) c.append(document.createTextNode(CFG.credit));
    for (const [url, key] of [[CFG.imprintUrl, "imprint"], [CFG.privacyUrl, "privacy"]]) {
      if (!url) continue;
      if (c.childNodes.length) c.append(document.createTextNode(" · "));
      c.append(el("a", { href: url, text: t(key) }));
    }
    const dt = new Date(D.built + "T12:00:00");
    $("#foot-built").textContent = t("footerBuilt", {
      date: dt.toLocaleDateString(I.getLang() === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long", year: "numeric" })
    });
  }

  function readURL() {
    const p = new URLSearchParams(location.search);
    const out = {};
    if (p.get("sex") && SEX.includes(p.get("sex"))) out.sex = p.get("sex");
    if (p.get("age") !== null) { const i = D.ages.indexOf(Number(p.get("age"))); if (i >= 0) out.ageIdx = i; }
    if (p.get("period")) { const i = D.periods.findIndex((x) => x.replace("–", "-") === p.get("period")); if (i >= 0) out.periodIdx = i; }
    for (const k of ["a", "b"]) { const v = p.get(k); if (v && D.dist.has(v)) out[k] = v; }
    return out;
  }

  /* ------------------------------------------------------------------------------------------
   * Init
   * ------------------------------------------------------------------------------------------ */
  async function init() {
    const urlLang = new URLSearchParams(location.search).get("lang");
    const lang = ["de", "en"].includes(urlLang) ? urlLang : (load("le-lang") || CFG.defaultLanguage || "de");
    applyLang(lang);
    $$("[data-set-lang]").forEach((b) => b.addEventListener("click", () => {
      applyLang(b.dataset.setLang);
      store("le-lang", b.dataset.setLang);
      render();
      updateURL();
    }));

    const status = el("p", { class: "loading", text: t("loading") });
    $("#hero-sentence").replaceChildren(status);
    let data, topo;
    try {
      [data, topo] = await Promise.all([fetchJSON("data/data.json"), fetchJSON("data/geo.json")]);
    } catch (e) {
      console.error(e);
      $("#hero-sentence").replaceChildren(el("p", { class: "error-box", text: t("loadError") }));
      return;
    }
    D.built = data.built;
    D.periods = data.le.periods;
    D.ages = data.le.ages;
    D.nAges = D.ages.length;
    D.leVals = data.le.values;
    D.annual = data.leAnnual.values;
    D.annualYears = data.leAnnual.years;
    D.gisd = data.gisd;
    D.inkar = data.inkar;
    D.districts = data.districts;
    D.ids = D.districts.map((d) => d.id);
    D.dist = new Map(D.districts.map((d) => [d.id, d]));
    const nameCount = d3.rollup(D.districts, (v) => v.length, (d) => d.name);
    for (const d of D.districts) {
      const city = /Kreisfreie Stadt|Stadtkreis/.test(d.bez);
      d.display = nameCount.get(d.name) > 1 ? `${d.name} (${city ? t("bezCity") : t("bezDistrict")})` : d.name;
      const pop = D.inkar.population[d.id];
      d.pop = pop ? pop[pop.length - 1] : 0;
    }
    state.periodIdx = lastP();

    const u = readURL();
    Object.assign(state, { sex: u.sex || state.sex, ageIdx: u.ageIdx ?? state.ageIdx, periodIdx: u.periodIdx ?? state.periodIdx });

    // controls
    buildAgeOptions();
    buildPeriodControl();
    syncControls();
    $$('input[name="sex"]').forEach((r) => r.addEventListener("change", () => { state.sex = r.value; render(); updateURL(); }));
    $("#age-ctl").addEventListener("change", (e) => { state.ageIdx = Number(e.target.value); render(); updateURL(); });
    $$('input[name="target"]').forEach((r) => r.addEventListener("change", () => { state.target = r.value; }));
    $("#swap").addEventListener("click", () => {
      const a = state.slots.A, b = state.slots.B;
      setSlot("A", b, { silent: true });
      setSlot("B", a, { silent: true });
      render(); updateURL();
    });
    $("#share-btn").addEventListener("click", async () => {
      const url = shareURL();
      const st = $("#share-status");
      try { await navigator.clipboard.writeText(url); st.textContent = `${t("shareDone")}. ${t("shareNote")}`; }
      catch (e) { st.textContent = t("shareFail"); }
      setTimeout(() => { st.textContent = ""; }, 6000);
    });
    $("#t400").addEventListener("toggle", () => { if ($("#t400").open) renderT400(); });

    setupPicker("A");
    setupPicker("B");

    // map
    LE.map.init({
      svgEl: $("#map"), wrapEl: $("#map-wrap"), topo, cities: data.cities,
      pointOf: (id) => D.dist.get(id).pt,
      tipSpec: mapTip,
      onClick: (id, lonlat) => setSlot(state.target, { id, point: null, pinPoint: lonlat, label: dname(id), source: "map" })
    });
    $("#zoom-in").addEventListener("click", () => LE.map.zoomBy(1.6));
    $("#zoom-out").addEventListener("click", () => LE.map.zoomBy(1 / 1.6));
    $("#zoom-reset").addEventListener("click", () => LE.map.zoomReset());

    // initial selection: link or example
    D.ready = true;
    let exampleMode = false;
    if (u.a || u.b) {
      if (u.a) setSlot("A", { id: u.a, point: null, label: dname(u.a), source: "district" }, { silent: true });
      if (u.b) setSlot("B", { id: u.b, point: null, label: dname(u.b), source: "district" }, { silent: true });
      setTarget(u.a && !u.b ? "B" : "A");
    } else {
      exampleMode = true;
      for (const [k, code] of [["A", CFG.example.a], ["B", CFG.example.b]]) {
        if (!code) continue;
        const kreis = String(code).slice(0, 5);
        if (D.dist.has(kreis)) setSlot(k, { id: kreis, point: null, label: dname(kreis), source: "example" }, { silent: true });
      }
    }
    footer();
    render();
    updateURL();

    // upgrade example to town centre points once the gazetteer is in
    if (exampleMode) {
      ensureGaz().then(() => {
        let changed = false;
        for (const [k, code] of [["A", CFG.example.a], ["B", CFG.example.b]]) {
          const s = state.slots[k];
          if (!s || s.source !== "example" || String(code).length !== 8) continue;
          const pl = LE.search.place(String(code));
          if (pl) { s.point = [pl.lon, pl.lat]; s.label = pl.name; s.approx = true; pickers[k].input.value = pl.name; renderStatus(k); changed = true; }
        }
        if (changed) render();
      }).catch(() => {});
    }

    // re-render on resize (width changes only) and on theme change
    let lastW = 0, timer = null;
    new ResizeObserver((entries) => {
      const w = Math.round(entries[0].contentRect.width);
      if (w === lastW) return;
      lastW = w;
      clearTimeout(timer);
      timer = setTimeout(render, 120);
    }).observe($(".results-col"));
    const ctl = $("#controls");
    new ResizeObserver(() => document.documentElement.style.setProperty("--controls-h", ctl.offsetHeight + "px")).observe(ctl);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onTheme = () => { D.classCache = {}; $("#sv-grid").dataset.key = ""; LE.map.layout(); render(); };
    if (mq.addEventListener) mq.addEventListener("change", onTheme);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
