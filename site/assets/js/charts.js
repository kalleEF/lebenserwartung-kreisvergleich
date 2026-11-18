/* Chart components (D3 v7). Every chart re-renders from scratch into its container. */
(function () {
  "use strict";
  const { num } = LE.i18n;

  /* ---------- theme colours ---------- */
  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function colors() {
    return {
      a: css("--a"), b: css("--b"), ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"),
      hair: css("--hair"), axis: css("--axis"), ctx: css("--ctx"), ctxStrong: css("--ctx-strong"),
      bg: css("--bg"), aWash: css("--a-wash"), bWash: css("--b-wash"), field: css("--field"),
      mapLo: css("--map-lo"), mapHi: css("--map-hi")
    };
  }

  /* ---------- text measuring ---------- */
  const measureCtx = document.createElement("canvas").getContext("2d");
  function textWidth(s, size = 12, weight = 400) {
    measureCtx.font = `${weight} ${size}px "Libre Franklin", Arial, sans-serif`;
    return measureCtx.measureText(s).width;
  }

  /* ---------- tooltip ---------- */
  function tipEl() { return document.getElementById("tooltip"); }
  function fillTip(spec) {
    const el = tipEl();
    el.replaceChildren();
    if (spec.title) {
      const d = document.createElement("div"); d.className = "tt-title"; d.textContent = spec.title; el.append(d);
    }
    if (spec.sub) {
      const d = document.createElement("div"); d.className = "tt-sub"; d.textContent = spec.sub; el.append(d);
    }
    for (const r of spec.rows || []) {
      const row = document.createElement("div"); row.className = "tt-row";
      const k = document.createElement("span"); k.className = "tt-k";
      if (r.color) {
        const sw = document.createElement("span"); sw.className = "tt-line"; sw.style.background = r.color;
        if (r.dot) { sw.style.width = "8px"; sw.style.height = "8px"; sw.style.borderRadius = "50%"; }
        k.append(sw);
      }
      k.append(document.createTextNode(r.k));
      const v = document.createElement("span"); v.className = "tt-v"; v.textContent = r.v;
      row.append(k, v); el.append(row);
    }
    el.hidden = false;
    return el;
  }
  function placeTip(clientX, clientY) {
    const el = tipEl();
    const pad = 14, w = el.offsetWidth, h = el.offsetHeight;
    let x = clientX + pad, y = clientY + pad;
    if (x + w > window.innerWidth - 8) x = clientX - w - pad;
    if (y + h > window.innerHeight - 8) y = clientY - h - pad;
    el.style.left = Math.max(8, x) + "px";
    el.style.top = Math.max(8, y) + "px";
  }
  function showTip(evt, spec) { fillTip(spec); placeTip(evt.clientX, evt.clientY); }
  function showTipAt(node, spec) {
    fillTip(spec);
    const r = node.getBoundingClientRect();
    placeTip(r.left + r.width / 2, r.top + r.height / 2);
  }
  function hideTip() { const el = tipEl(); if (el) el.hidden = true; }
  window.addEventListener("scroll", hideTip, { passive: true });

  /* ---------- svg helpers ---------- */
  function svgIn(el, width, height, label) {
    let svg = d3.select(el).select("svg.svg-chart");
    if (svg.empty()) svg = d3.select(el).append("svg").attr("class", "svg-chart");
    svg.attr("viewBox", `0 0 ${width} ${height}`).attr("width", width).attr("height", height)
      .attr("role", "img").attr("aria-label", label || null);
    svg.selectAll("*").remove();
    svg.on(".tip", null);
    return svg;
  }
  function widthOf(el) { return Math.max(260, Math.floor(el.clientWidth || el.getBoundingClientRect().width || 600)); }

  // rectangle with rounded data end (r=4) and square baseline end
  function barPath(x, y0, w, y1, r = 4) {
    const up = y1 < y0;
    const h = Math.abs(y1 - y0);
    if (h < 0.5) return "";
    const rr = Math.min(r, h, w / 2);
    if (up) {
      return `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`;
    }
    return `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
  }

  // non-overlapping vertical label positions (keeps order, min gap)
  function spread(items, gap, lo, hi) {
    const s = items.slice().sort((a, b) => a.y - b.y);
    for (let i = 1; i < s.length; i++) if (s[i].y - s[i - 1].y < gap) s[i].y = s[i - 1].y + gap;
    const over = s.length ? s[s.length - 1].y - hi : 0;
    if (over > 0) for (const it of s) it.y -= over;
    for (let i = s.length - 2; i >= 0; i--) if (s[i + 1].y - s[i].y < gap) s[i].y = s[i + 1].y - gap;
    if (s.length && s[0].y < lo) { const d = lo - s[0].y; for (const it of s) it.y += d; }
    return items;
  }

  /* ---------- beeswarm (dodge) ---------- */
  function dodge(xs, r) {
    const n = xs.length;
    const order = d3.range(n).sort((i, j) => xs[i] - xs[j]);
    const ys = new Array(n).fill(0);
    const placed = [];
    const d = 2 * r, d2 = d * d;
    let head = 0;
    for (const i of order) {
      const x = xs[i];
      while (head < placed.length && x - xs[placed[head]] > d) head++;
      const near = placed.slice(head);
      const cands = [0];
      for (const j of near) {
        const dx = x - xs[j];
        const dy = Math.sqrt(Math.max(0, d2 - dx * dx)) + 0.05;
        cands.push(ys[j] + dy, ys[j] - dy);
      }
      cands.sort((a, b) => Math.abs(a) - Math.abs(b));
      let y = 0;
      for (const c of cands) {
        let ok = true;
        for (const j of near) {
          const dx = x - xs[j], dy = c - ys[j];
          if (dx * dx + dy * dy < d2 - 0.01) { ok = false; break; }
        }
        if (ok) { y = c; break; }
      }
      ys[i] = y;
      placed.push(i);
    }
    return ys;
  }

  /**
   * Beeswarm of all districts with A and B highlighted.
   * o: {items:[{id,v,name}], domain, a:{id,v,label}, b:{id,v,label}, refLine:{v,label}, bounds:[{v}],
   *     boundLabels:[{v,label}], tickFmt, valueFmt, ariaLabel, tipRows(item), lowLabel, highLabel}
   */
  function strip(el, o) {
    const C = colors();
    const W = widthOf(el);
    const r = W < 520 ? 2.4 : 3;
    const m = { l: 6, r: 6, t: 58, b: 34 };
    const x = d3.scaleLinear(o.domain, [m.l + 8, W - m.r - 8]).clamp(true);
    const items = o.items.filter((d) => d.v !== null && d.v !== undefined);
    const xs = items.map((d) => x(d.v));
    const ys = dodge(xs, r + 0.35);
    const maxY = d3.max(ys, (v) => Math.abs(v)) || 0;
    const swarmH = Math.max(40, 2 * maxY + 2 * r + 10);
    const H = m.t + swarmH + m.b;
    const cy = m.t + swarmH / 2;
    const svg = svgIn(el, W, H, o.ariaLabel);

    // quintile / boundary lines
    for (const bnd of o.bounds || []) {
      svg.append("line").attr("x1", x(bnd.v)).attr("x2", x(bnd.v)).attr("y1", m.t - 6).attr("y2", H - m.b + 4)
        .attr("stroke", C.hair).attr("stroke-width", 1);
    }
    for (const bl of o.boundLabels || []) {
      svg.append("text").attr("class", "lbl lbl-muted lbl-halo").attr("x", x(bl.v)).attr("y", m.t - 8)
        .attr("text-anchor", "middle").text(bl.label);
    }

    // axis
    const axisY = H - m.b + 6;
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", axisY).attr("y2", axisY).attr("stroke", C.axis);
    const ticks = o.ticks || x.ticks(W < 520 ? 5 : 8);
    const gT = svg.append("g").attr("class", "axis");
    for (const tv of ticks) {
      gT.append("line").attr("x1", x(tv)).attr("x2", x(tv)).attr("y1", axisY).attr("y2", axisY + 4).attr("stroke", C.axis);
      gT.append("text").attr("x", x(tv)).attr("y", axisY + 16).attr("text-anchor", "middle").text(o.tickFmt(tv));
    }
    if (o.lowLabel) svg.append("text").attr("class", "lbl lbl-muted").attr("x", m.l).attr("y", axisY + 30).text("← " + o.lowLabel);
    if (o.highLabel) svg.append("text").attr("class", "lbl lbl-muted").attr("x", W - m.r).attr("y", axisY + 30)
      .attr("text-anchor", "end").text(o.highLabel + " →");

    // reference line (median)
    if (o.refLine && o.refLine.v !== null) {
      const rx = x(o.refLine.v);
      svg.append("line").attr("x1", rx).attr("x2", rx).attr("y1", m.t - 4).attr("y2", axisY).attr("stroke", C.ink2)
        .attr("stroke-width", 1);
      const lbl = o.refLine.label;
      const tw = textWidth(lbl, 11);
      const left = rx + 4 + tw > W - m.r;
      svg.append("text").attr("class", "lbl lbl-muted lbl-halo").attr("x", left ? rx - 4 : rx + 4).attr("y", m.t - 6)
        .attr("text-anchor", left ? "end" : "start").text(lbl);
    }

    // context dots
    const gDots = svg.append("g");
    const selIds = new Set([o.a && o.a.id, o.b && o.b.id]);
    gDots.selectAll("circle").data(items).join("circle")
      .attr("cx", (d, i) => xs[i]).attr("cy", (d, i) => cy + ys[i]).attr("r", r)
      .attr("fill", (d) => (selIds.has(d.id) ? "none" : C.ctx));

    // highlighted A/B with labels
    const sel = [];
    for (const [key, s, color] of [["A", o.a, C.a], ["B", o.b, C.b]]) {
      if (!s || s.v === null || s.v === undefined) continue;
      const idx = items.findIndex((d) => d.id === s.id);
      if (idx < 0) continue;
      sel.push({ key, s, color, x: xs[idx], y: cy + ys[idx] });
    }
    // label rows: one row if far apart, else two
    const labelOf = (q) => `${q.s.label}  ${o.valueFmt(q.s.v)}`;
    sel.forEach((q) => { q.tw = textWidth(labelOf(q), 12, 600) + 16; });
    let rows = [16, 16];
    if (sel.length === 2) {
      const [p, q] = sel[0].x <= sel[1].x ? [sel[0], sel[1]] : [sel[1], sel[0]];
      const gapNeeded = p.tw / 2 + q.tw / 2 + 12;
      if (q.x - p.x < gapNeeded) rows = [16, 34];
      p.row = rows[0]; q.row = rows[1];
    } else if (sel.length === 1) sel[0].row = 16;
    const gSel = svg.append("g");
    for (const q of sel) {
      const lx = Math.max(m.l + q.tw / 2, Math.min(W - m.r - q.tw / 2, q.x));
      gSel.append("line").attr("x1", q.x).attr("x2", q.x).attr("y1", q.row + 5).attr("y2", q.y - 7)
        .attr("stroke", C.ink).attr("stroke-width", 1).attr("opacity", 0.55);
      const g = gSel.append("g").attr("transform", `translate(${lx - q.tw / 2},${q.row})`);
      g.append("circle").attr("cx", 5).attr("cy", -4).attr("r", 5).attr("fill", q.color);
      g.append("text").attr("class", "lbl lbl-strong lbl-halo").attr("x", 14).attr("y", 0).text(labelOf(q));
    }
    for (const q of sel) {
      gSel.append("circle").attr("cx", q.x).attr("cy", q.y).attr("r", 6.5).attr("fill", q.color)
        .attr("stroke", C.bg).attr("stroke-width", 2);
    }

    // hover via nearest point
    const hl = svg.append("circle").attr("r", r + 2.5).attr("fill", "none").attr("stroke", C.ink).attr("stroke-width", 1.5)
      .attr("pointer-events", "none").attr("visibility", "hidden");
    const delaunay = d3.Delaunay.from(items, (d, i) => xs[i], (d, i) => cy + ys[i]);
    svg.append("rect").attr("x", 0).attr("y", m.t - 10).attr("width", W).attr("height", swarmH + 20)
      .attr("fill", "transparent")
      .on("pointermove", (evt) => {
        const [px, py] = d3.pointer(evt);
        const i = delaunay.find(px, py);
        const dx = xs[i] - px, dy = cy + ys[i] - py;
        if (dx * dx + dy * dy > 26 * 26) { hl.attr("visibility", "hidden"); hideTip(); return; }
        hl.attr("cx", xs[i]).attr("cy", cy + ys[i]).attr("visibility", "visible");
        showTip(evt, o.tipSpec(items[i]));
      })
      .on("pointerleave", () => { hl.attr("visibility", "hidden"); hideTip(); });
  }

  /**
   * Line chart with optional bands, markers, end labels and a crosshair tooltip.
   * o: { xs:[numbers], xDomain, xTicks:[{v,label}], series:[{key,color,width,values,band,marker,endLabel}],
   *      yDomain, yTicks?, yFmt, height, tipSpec(i), ariaLabel, endFmt, title?,
   *      highlight?: {x0, x1, label} — shaded x-range drawn behind the grid and data }
   */
  function lineChart(el, o) {
    const C = colors();
    const W = o.width || widthOf(el);
    const H = o.height || 240;
    const endW = o.endLabels === false ? 10 : 56;
    const m = { l: 34, r: endW, t: o.title ? 30 : 12, b: 30 };
    const x = d3.scaleLinear(o.xDomain, [m.l + 6, W - m.r]);
    const y = d3.scaleLinear(o.yDomain, [H - m.b, m.t]).nice();
    const svg = o.svg || svgIn(el, W, H, o.ariaLabel);
    if (o.title) svg.append("text").attr("class", "lbl lbl-strong").attr("x", 0).attr("y", 14).text(o.title);

    // highlighted x-range, e.g. the years that are averaged elsewhere on the page
    if (o.highlight) {
      const [r0, r1] = x.range();
      const hx0 = Math.max(r0, x(o.highlight.x0)), hx1 = Math.min(r1, x(o.highlight.x1));
      svg.append("rect").attr("x", hx0).attr("y", y.range()[1]).attr("width", Math.max(2, hx1 - hx0))
        .attr("height", y.range()[0] - y.range()[1]).attr("fill", C.hair).attr("opacity", 0.6);
      if (o.highlight.label) {
        svg.append("text").attr("class", "lbl lbl-muted").attr("x", (hx0 + hx1) / 2).attr("y", y.range()[1] - 3)
          .attr("text-anchor", "middle").text(o.highlight.label);
      }
    }

    // grid + y labels
    const yt = o.yTicks || y.ticks(H < 200 ? 4 : 5);
    const gG = svg.append("g").attr("class", "grid");
    for (const tv of yt) {
      gG.append("line").attr("x1", m.l).attr("x2", W - m.r + 4).attr("y1", y(tv)).attr("y2", y(tv));
      svg.append("text").attr("class", "lbl lbl-muted").attr("x", m.l - 6).attr("y", y(tv)).attr("dy", "0.32em")
        .attr("text-anchor", "end").text(o.yFmt(tv));
    }
    // x axis
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r + 4).attr("y1", H - m.b).attr("y2", H - m.b).attr("stroke", C.axis);
    const xt = o.xTicks;
    for (const tk of xt) {
      svg.append("line").attr("x1", x(tk.v)).attr("x2", x(tk.v)).attr("y1", H - m.b).attr("y2", H - m.b + 4).attr("stroke", C.axis);
      svg.append("text").attr("class", "lbl lbl-muted").attr("x", x(tk.v)).attr("y", H - m.b + 16)
        .attr("text-anchor", tk.anchor || "middle").text(tk.label);
    }

    // period spans (which years a pooled value covers)
    for (const sp of o.spans || []) {
      svg.append("rect").attr("x", x(sp.x0) + 1).attr("y", H - m.b - 5).attr("width", Math.max(2, x(sp.x1) - x(sp.x0) - 2))
        .attr("height", 3).attr("rx", 1).attr("fill", C.axis);
    }
    // bands
    for (const s of o.series) {
      if (!s.band) continue;
      const area = d3.area().defined((d, i) => s.band[i] && s.band[i][0] !== null)
        .x((d, i) => x(o.xs[i])).y0((d, i) => y(s.band[i][0])).y1((d, i) => y(s.band[i][1]));
      svg.append("path").attr("d", area(o.xs)).attr("fill", s.bandColor).attr("stroke", "none");
    }
    // lines
    for (const s of o.series) {
      const line = d3.line().defined((d, i) => s.values[i] !== null && s.values[i] !== undefined)
        .x((d, i) => x(o.xs[i])).y((d, i) => y(s.values[i]));
      svg.append("path").attr("d", line(o.xs)).attr("fill", "none").attr("stroke", s.color)
        .attr("stroke-width", s.width || 2).attr("stroke-linejoin", "round").attr("stroke-linecap", "round");
    }
    // markers
    for (const s of o.series) {
      if (!s.marker) continue;
      o.xs.forEach((xv, i) => {
        const v = s.values[i];
        if (v === null || v === undefined) return;
        svg.append("circle").attr("cx", x(xv)).attr("cy", y(v)).attr("r", s.marker).attr("fill", s.color)
          .attr("stroke", C.bg).attr("stroke-width", 2);
      });
    }
    // end labels
    if (o.endLabels !== false) {
      const ends = [];
      for (const s of o.series) {
        if (!s.endLabel) continue;
        let i = s.values.length - 1;
        while (i >= 0 && (s.values[i] === null || s.values[i] === undefined)) i--;
        if (i < 0) continue;
        if (!s.marker) {
          svg.append("circle").attr("cx", x(o.xs[i])).attr("cy", y(s.values[i])).attr("r", 4).attr("fill", s.color)
            .attr("stroke", C.bg).attr("stroke-width", 2);
        }
        ends.push({ y: y(s.values[i]), y0: y(s.values[i]), x: x(o.xs[i]), text: s.endLabel(s.values[i]), color: s.color });
      }
      spread(ends, 14, m.t, H - m.b);
      for (const e of ends) {
        if (Math.abs(e.y - e.y0) > 3) {
          svg.append("path").attr("d", `M${e.x + 5},${e.y0}L${e.x + 12},${e.y}`).attr("stroke", C.axis).attr("fill", "none");
        }
        svg.append("text").attr("class", "lbl lbl-strong").attr("x", e.x + 14).attr("y", e.y).attr("dy", "0.32em").text(e.text);
      }
    }

    // crosshair
    if (o.tipSpec) {
      const cross = svg.append("line").attr("y1", m.t).attr("y2", H - m.b).attr("stroke", C.ink2).attr("stroke-width", 1)
        .attr("visibility", "hidden").attr("pointer-events", "none");
      const xsPx = o.xs.map((v) => x(v));
      svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r + 6).attr("height", H - m.t - m.b)
        .attr("fill", "transparent")
        .on("pointermove", (evt) => {
          const [px] = d3.pointer(evt);
          const i = d3.minIndex(xsPx, (v) => Math.abs(v - px));
          cross.attr("x1", xsPx[i]).attr("x2", xsPx[i]).attr("visibility", "visible");
          showTip(evt, o.tipSpec(i));
        })
        .on("pointerleave", () => { cross.attr("visibility", "hidden"); hideTip(); });
    }
    return { x, y, svg, m, W, H };
  }

  /**
   * Bars of the A−B difference by age group.
   * o: { cats, values, labelIdx:[i], posLabel, negLabel, fmt, tipSpec(i), ariaLabel }
   */
  function gapBars(el, o) {
    const C = colors();
    const W = widthOf(el);
    const H = 220;
    const m = { l: 36, r: 8, t: 18, b: 30 };
    const x = d3.scaleBand(o.cats.map(String), [m.l, W - m.r]).padding(0.28);
    const bw = Math.min(24, x.bandwidth());
    const off = (x.bandwidth() - bw) / 2;
    const vals = o.values.filter((v) => v !== null);
    const lo = Math.min(0, d3.min(vals)), hi = Math.max(0, d3.max(vals));
    const y = d3.scaleLinear([lo, hi], [H - m.b, m.t]).nice();
    const svg = svgIn(el, W, H, o.ariaLabel);
    for (const tv of y.ticks(4)) {
      svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(tv)).attr("y2", y(tv)).attr("stroke", tv === 0 ? C.ink2 : C.hair);
      svg.append("text").attr("class", "lbl lbl-muted").attr("x", m.l - 6).attr("y", y(tv)).attr("dy", "0.32em")
        .attr("text-anchor", "end").text(o.fmt(tv));
    }
    const step = W < 520 ? 2 : 1;
    const n = o.cats.length;
    o.cats.forEach((c, i) => {
      const show = i === n - 1 || (i % step === 0 && !(step > 1 && i === n - 2));
      if (!show) return;
      svg.append("text").attr("class", "lbl lbl-muted").attr("x", x(String(c)) + x.bandwidth() / 2).attr("y", H - m.b + 16)
        .attr("text-anchor", "middle").text(c);
    });
    svg.append("text").attr("class", "lbl lbl-muted").attr("x", W - m.r).attr("y", H - 2).attr("text-anchor", "end").text(o.ageAxis);
    const bars = svg.append("g");
    o.values.forEach((v, i) => {
      if (v === null) return;
      const bx = x(String(o.cats[i])) + off;
      bars.append("path").attr("d", barPath(bx, y(0), bw, y(v))).attr("fill", v >= 0 ? C.a : C.b)
        .attr("data-i", i);
    });
    for (const i of o.labelIdx || []) {
      const v = o.values[i];
      if (v === null) continue;
      const bx = x(String(o.cats[i])) + x.bandwidth() / 2;
      svg.append("text").attr("class", "lbl lbl-strong lbl-halo").attr("x", bx).attr("y", v >= 0 ? y(v) - 6 : y(v) + 14)
        .attr("text-anchor", "middle").text(o.fmt(v, true));
    }
    // hover per band
    o.cats.forEach((c, i) => {
      svg.append("rect").attr("x", x(String(c)) - x.step() * x.paddingInner() / 2).attr("y", m.t)
        .attr("width", x.step()).attr("height", H - m.t - m.b).attr("fill", "transparent")
        .on("pointermove", (evt) => showTip(evt, o.tipSpec(i)))
        .on("pointerleave", hideTip);
    });
  }

  /**
   * Scatter plot of all districts with A/B highlighted and a regression line.
   * o: {items:[{id,x,y,name}], a, b, xDomain, yDomain, fit:{slope,intercept}, xFmt, yFmt, xLabel, yLabel, tipSpec, ariaLabel}
   */
  function scatter(el, o) {
    const C = colors();
    const W = widthOf(el);
    const H = W < 520 ? 320 : 370;
    const m = { l: 38, r: 14, t: 34, b: 44 };
    const x = d3.scaleLinear(o.xDomain, [m.l + 4, W - m.r]);
    const y = d3.scaleLinear(o.yDomain, [H - m.b, m.t]).nice();
    const svg = svgIn(el, W, H, o.ariaLabel);
    for (const tv of y.ticks(5)) {
      svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", y(tv)).attr("y2", y(tv)).attr("stroke", C.hair);
      svg.append("text").attr("class", "lbl lbl-muted").attr("x", m.l - 6).attr("y", y(tv)).attr("dy", "0.32em")
        .attr("text-anchor", "end").text(o.yFmt(tv));
    }
    for (const tv of x.ticks(W < 520 ? 5 : 10)) {
      svg.append("line").attr("x1", x(tv)).attr("x2", x(tv)).attr("y1", m.t).attr("y2", H - m.b).attr("stroke", C.hair);
      svg.append("text").attr("class", "lbl lbl-muted").attr("x", x(tv)).attr("y", H - m.b + 16).attr("text-anchor", "middle")
        .text(o.xFmt(tv));
    }
    svg.append("line").attr("x1", m.l).attr("x2", W - m.r).attr("y1", H - m.b).attr("y2", H - m.b).attr("stroke", C.axis);
    svg.append("text").attr("class", "lbl lbl-muted").attr("x", W - m.r).attr("y", H - 6).attr("text-anchor", "end").text(o.xLabel);
    svg.append("text").attr("class", "lbl lbl-muted").attr("x", 0).attr("y", 12).text("↑ " + o.yLabel);

    const items = o.items.filter((d) => d.x !== null && d.y !== null);
    if (o.fit) {
      const [x0, x1] = d3.extent(items, (d) => d.x);
      svg.append("line").attr("x1", x(x0)).attr("x2", x(x1))
        .attr("y1", y(o.fit.intercept + o.fit.slope * x0)).attr("y2", y(o.fit.intercept + o.fit.slope * x1))
        .attr("stroke", C.ink2).attr("stroke-width", 1.5);
    }
    const selIds = new Set([o.a && o.a.id, o.b && o.b.id]);
    svg.append("g").selectAll("circle").data(items).join("circle")
      .attr("cx", (d) => x(d.x)).attr("cy", (d) => y(d.y)).attr("r", W < 520 ? 2.4 : 2.9)
      .attr("fill", (d) => (selIds.has(d.id) ? "none" : C.ctx));
    const sel = [];
    for (const [s, color] of [[o.a, C.a], [o.b, C.b]]) {
      if (!s) continue;
      const d = items.find((it) => it.id === s.id);
      if (!d) continue;
      sel.push({ d, color, label: s.label });
    }
    for (const q of sel) {
      const cx = x(q.d.x), cy = y(q.d.y);
      const tw = textWidth(q.label, 12, 650);
      const right = cx + 10 + tw < W - m.r;
      svg.append("text").attr("class", "lbl lbl-strong lbl-halo").attr("x", right ? cx + 10 : cx - 10).attr("y", cy)
        .attr("dy", "0.32em").attr("text-anchor", right ? "start" : "end").text(q.label);
    }
    for (const q of sel) {
      svg.append("circle").attr("cx", x(q.d.x)).attr("cy", y(q.d.y)).attr("r", 6.5).attr("fill", q.color)
        .attr("stroke", C.bg).attr("stroke-width", 2);
    }
    const hl = svg.append("circle").attr("r", 5).attr("fill", "none").attr("stroke", C.ink).attr("stroke-width", 1.5)
      .attr("pointer-events", "none").attr("visibility", "hidden");
    const del = d3.Delaunay.from(items, (d) => x(d.x), (d) => y(d.y));
    svg.append("rect").attr("x", m.l).attr("y", m.t).attr("width", W - m.l - m.r).attr("height", H - m.t - m.b)
      .attr("fill", "transparent")
      .on("pointermove", (evt) => {
        const [px, py] = d3.pointer(evt);
        const i = del.find(px, py);
        const d = items[i];
        const dx = x(d.x) - px, dy = y(d.y) - py;
        if (dx * dx + dy * dy > 24 * 24) { hl.attr("visibility", "hidden"); hideTip(); return; }
        hl.attr("cx", x(d.x)).attr("cy", y(d.y)).attr("visibility", "visible");
        showTip(evt, o.tipSpec(d));
      })
      .on("pointerleave", () => { hl.attr("visibility", "hidden"); hideTip(); });
  }

  /**
   * Compact distribution strip for one indicator (INKAR table).
   * o: {values:[...], de, a, b, width}
   */
  function miniStrip(svgNode, o) {
    const C = colors();
    const W = Math.max(120, Math.floor(svgNode.getBoundingClientRect().width || 180));
    const H = 30;
    const svg = d3.select(svgNode).attr("viewBox", `0 0 ${W} ${H}`).attr("preserveAspectRatio", "none");
    svg.selectAll("*").remove();
    const vals = o.values.filter((v) => v !== null && v !== undefined);
    if (!vals.length) return;
    const [lo, hi] = d3.extent(vals);
    const x = d3.scaleLinear([lo, hi], [6, W - 6]);
    svg.append("line").attr("x1", 0).attr("x2", W).attr("y1", 15).attr("y2", 15).attr("stroke", C.hair);
    svg.append("g").selectAll("line").data(vals).join("line")
      .attr("x1", (v) => x(v)).attr("x2", (v) => x(v)).attr("y1", 9).attr("y2", 21)
      .attr("stroke", C.ctx).attr("stroke-width", 1).attr("opacity", 0.75);
    if (o.de !== null && o.de !== undefined) {
      svg.append("line").attr("x1", x(o.de)).attr("x2", x(o.de)).attr("y1", 4).attr("y2", 26).attr("stroke", C.ink).attr("stroke-width", 2);
    }
    for (const [v, c] of [[o.a, C.a], [o.b, C.b]]) {
      if (v === null || v === undefined) continue;
      svg.append("circle").attr("cx", x(v)).attr("cy", 15).attr("r", 5).attr("fill", c).attr("stroke", C.bg).attr("stroke-width", 2);
    }
  }

  /**
   * Small locator map: district outline and the selected point.
   * o: {feature, point:[lon,lat], color, label}
   */
  function locator(container, o) {
    const C = colors();
    const W = Math.max(200, container.clientWidth), H = Math.max(150, container.clientHeight);
    const svg = d3.select(container).append("svg").attr("class", "locator").attr("viewBox", `0 0 ${W} ${H}`)
      .attr("role", "img").attr("aria-label", o.label);
    const proj = d3.geoTransverseMercator().rotate([-o.point[0], -o.point[1]])
      .fitExtent([[18, 18], [W - 18, H - 18]], o.feature);
    const path = d3.geoPath(proj);
    svg.append("path").attr("d", path(o.feature)).attr("fill", C.bg).attr("stroke", C.ctxStrong).attr("stroke-width", 1);
    const [px, py] = proj(o.point);
    svg.append("line").attr("x1", px).attr("x2", px).attr("y1", 0).attr("y2", H).attr("stroke", C.axis).attr("stroke-width", 0.75);
    svg.append("line").attr("x1", 0).attr("x2", W).attr("y1", py).attr("y2", py).attr("stroke", C.axis).attr("stroke-width", 0.75);
    svg.append("circle").attr("cx", px).attr("cy", py).attr("r", 7).attr("fill", o.color).attr("stroke", C.bg).attr("stroke-width", 2.5);
  }

  window.LE = window.LE || {};
  window.LE.charts = { colors, strip, lineChart, gapBars, scatter, miniStrip, locator, showTip, showTipAt, hideTip, textWidth, svgIn };
})();
