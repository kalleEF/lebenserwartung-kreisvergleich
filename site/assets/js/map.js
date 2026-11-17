/* District map: choropleth, state borders, city labels, zoom, A/B pins, legend. */
(function () {
  "use strict";
  const S = {};

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // Safety net for the winding order d3-geo expects: a polygon part that covers more than a
  // hemisphere was wound the wrong way round and is reversed.
  function rewind(f) {
    const g = f.geometry;
    if (!g) return f;
    const fix = (poly) => (d3.geoArea({ type: "Polygon", coordinates: poly }) > 2 * Math.PI ? poly.map((r) => r.slice().reverse()) : poly);
    if (g.type === "Polygon") g.coordinates = fix(g.coordinates);
    else if (g.type === "MultiPolygon") g.coordinates = g.coordinates.map(fix);
    return f;
  }

  function init(o) {
    // o: {svgEl, wrapEl, legendEl, topo, cities, pointOf(id), onClick(id,[lon,lat]), tipSpec(id)}
    S.o = o;
    S.features = topojson.feature(o.topo, o.topo.objects.kreise).features.map(rewind);
    S.byId = new Map(S.features.map((f) => [f.properties.id, f]));
    const obj = o.topo.objects.kreise;
    S.landMesh = topojson.mesh(o.topo, obj, (a, b) => a !== b && a.properties.id.slice(0, 2) !== b.properties.id.slice(0, 2));
    S.outline = topojson.mesh(o.topo, obj, (a, b) => a === b);
    S.svg = d3.select(o.svgEl);
    S.gRoot = S.svg.append("g");
    S.gDist = S.gRoot.append("g");
    S.pLand = S.gRoot.append("path").attr("class", "land-border");
    S.pOutline = S.gRoot.append("path").attr("class", "country-border");
    S.gSel = S.gRoot.append("g");
    S.gCities = S.svg.append("g").attr("aria-hidden", "true");
    S.gPins = S.svg.append("g").attr("aria-hidden", "true");
    S.fill = () => css("--map-lo");
    S.sel = {};
    S.zoom = d3.zoom().scaleExtent([1, 16]).on("zoom", (evt) => {
      S.gRoot.attr("transform", evt.transform);
      placeOverlays();
    });
    S.svg.call(S.zoom).on("dblclick.zoom", null);
    layout();
    let last = 0;
    new ResizeObserver(() => {
      const w = Math.floor(o.wrapEl.clientWidth);
      if (w !== last) { last = w; layout(); }
    }).observe(o.wrapEl);
  }

  function layout() {
    const W = Math.max(280, Math.floor(S.o.wrapEl.clientWidth));
    const twoCol = window.matchMedia("(min-width: 1080px)").matches;
    const maxH = twoCol ? Math.max(380, window.innerHeight - 300) : Math.max(360, window.innerHeight * 0.72);
    const H = Math.round(Math.min(W * 1.22, maxH));
    S.W = W; S.H = H;
    S.svg.attr("viewBox", `0 0 ${W} ${H}`).attr("width", W).attr("height", H);
    S.projection = d3.geoTransverseMercator().rotate([-10.45, -51.16])
      .fitExtent([[6, 6], [W - 6, H - 6]], { type: "FeatureCollection", features: S.features });
    S.path = d3.geoPath(S.projection);
    S.zoom.extent([[0, 0], [W, H]]).translateExtent([[-W * 0.15, -H * 0.15], [W * 1.15, H * 1.15]]);
    drawBase();
    S.svg.call(S.zoom.transform, d3.zoomIdentity);
  }

  function drawBase() {
    S.gDist.selectAll("path.district").data(S.features, (f) => f.properties.id).join("path")
      .attr("class", "district")
      .attr("d", S.path)
      .attr("fill", (f) => S.fill(f.properties.id))
      .on("pointermove", (evt, f) => LE.charts.showTip(evt, S.o.tipSpec(f.properties.id)))
      .on("pointerleave", () => LE.charts.hideTip())
      .on("click", (evt, f) => {
        const [mx, my] = d3.pointer(evt, S.svg.node());
        const tr = d3.zoomTransform(S.svg.node());
        const lonlat = S.projection.invert(tr.invert([mx, my]));
        LE.charts.hideTip();
        S.o.onClick(f.properties.id, lonlat);
      });
    S.pLand.attr("d", S.path(S.landMesh));
    S.pOutline.attr("d", S.path(S.outline));
    drawSelection();
    drawCities();
    placeOverlays();
  }

  function setFill(fn) {
    S.fill = fn;
    S.gDist.selectAll("path.district").attr("fill", (f) => fn(f.properties.id));
  }

  function setSelection(sel) {
    S.sel = sel;
    drawSelection();
    placeOverlays();
  }

  function selItems() {
    return ["A", "B"].filter((k) => S.sel[k] && S.sel[k].id && S.byId.has(S.sel[k].id))
      .map((k) => ({ k, id: S.sel[k].id, point: S.sel[k].point || S.o.pointOf(S.sel[k].id) }));
  }

  function drawSelection() {
    const items = selItems();
    S.gSel.selectAll("path.sel-outline").data(items, (d) => d.k).join("path")
      .attr("class", "sel-outline")
      .attr("d", (d) => S.path(S.byId.get(d.id)))
      .attr("stroke", (d) => css(d.k === "A" ? "--a" : "--b"));
    S.gPins.selectAll("g.pin").data(items, (d) => d.k).join((enter) => {
      const g = enter.append("g").attr("class", "pin");
      g.append("path").attr("d", "M0,0C-3,-7 -10,-10.5 -10,-19A10,10 0 1 1 10,-19C10,-10.5 3,-7 0,0Z");
      g.append("text").attr("x", 0).attr("y", -15.5).attr("text-anchor", "middle");
      return g;
    })
      .each(function (d) {
        const g = d3.select(this);
        g.select("path").attr("fill", css(d.k === "A" ? "--a" : "--b")).attr("stroke", css("--bg")).attr("stroke-width", 2);
        g.select("text").text(d.k);
      });
  }

  function drawCities() {
    const cities = S.o.cities || [];
    S.gCities.selectAll("g.city").data(cities, (d) => d.name).join((enter) => {
      const g = enter.append("g").attr("class", "city");
      g.append("circle").attr("class", "city-dot").attr("r", 2.2);
      g.append("text").attr("class", "city-label").attr("x", 5).attr("dy", "0.32em");
      return g;
    }).each(function (d) { d3.select(this).select("text").text(d.name); });
  }

  function placeOverlays() {
    if (!S.projection) return;
    const tr = d3.zoomTransform(S.svg.node());
    const k = tr.k;
    const narrow = S.W < 520;
    const nCities = k >= 2.2 ? 99 : narrow ? 6 : 11;
    S.gCities.selectAll("g.city")
      .attr("display", (d, i) => (i < nCities ? null : "none"))
      .attr("transform", (d) => {
        const p = tr.apply(S.projection([d.lon, d.lat]));
        return `translate(${p[0]},${p[1]})`;
      });
    const pins = selItems();
    const pos = pins.map((d) => tr.apply(S.projection(d.point)));
    if (pos.length === 2 && Math.hypot(pos[0][0] - pos[1][0], pos[0][1] - pos[1][1]) < 16) pos[1][0] += 16;
    S.gPins.selectAll("g.pin").data(pins, (d) => d.k)
      .attr("transform", (d, i) => `translate(${pos[i][0]},${pos[i][1]})`);
  }

  function zoomBy(f) { S.svg.transition().duration(250).call(S.zoom.scaleBy, f); }
  function zoomReset() { S.svg.transition().duration(300).call(S.zoom.transform, d3.zoomIdentity); }
  function feature(id) { return S.byId.get(id); }

  /* Legend: equal-width classes with threshold labels; markers for A and B. */
  function legend(el, o) {
    // o: {breaks:[lo,...,hi], colors:[...], fmt, a, b}
    const C = LE.charts.colors();
    const n = o.colors.length;
    const W = Math.min(el.clientWidth || 360, 420);
    const sw = Math.floor((W - 16) / n);
    const H = 44;
    el.replaceChildren();
    const svg = d3.select(el).append("svg").attr("width", sw * n + 16).attr("height", H).attr("viewBox", `0 0 ${sw * n + 16} ${H}`)
      .attr("aria-hidden", "true");
    const lo = o.breaks[0], hi = o.breaks[o.breaks.length - 1];
    const x = d3.scaleLinear([lo, hi], [8, 8 + sw * n]).clamp(true);
    o.colors.forEach((c, i) => {
      svg.append("rect").attr("x", 8 + i * sw).attr("y", 16).attr("width", sw - 1).attr("height", 10).attr("fill", c);
    });
    o.breaks.forEach((b, i) => {
      if (i === 0 || i === o.breaks.length - 1) {
        // ends: show as "<" / "≥" range hints only when width allows
      }
      svg.append("text").attr("class", "lbl lbl-muted").attr("x", x(b)).attr("y", 40).attr("text-anchor", "middle").text(o.fmt(b));
    });
    for (const [s, col] of [[o.a, C.a], [o.b, C.b]]) {
      if (!s || s.v === null || s.v === undefined) continue;
      const px = x(s.v);
      svg.append("path").attr("d", `M${px - 5},4L${px + 5},4L${px},12Z`).attr("fill", col).attr("stroke", C.bg).attr("stroke-width", 1);
    }
  }

  window.LE = window.LE || {};
  window.LE.map = { init, setFill, setSelection, zoomBy, zoomReset, feature, legend, layout, rewind };
})();
