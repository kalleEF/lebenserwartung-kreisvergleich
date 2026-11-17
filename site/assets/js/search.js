/* Place search: coordinates, Plus Codes, offline gazetteer (municipalities, postcodes, districts),
   online address search (OpenStreetMap Nominatim) and browser geolocation.
   Exposes window.LE.search. */
(function () {
  "use strict";

  const inDE = (lat, lon) => lat >= 47.2 && lat <= 55.2 && lon >= 5.8 && lon <= 15.1;

  /* ------------------------------------------------------------------------------------------
   * Plus Codes (Open Location Code), https://github.com/google/open-location-code
   * ------------------------------------------------------------------------------------------ */
  const OLC = "23456789CFGHJMPQRVWX";
  const PAIR_RES = [20, 1, 0.05, 0.0025, 0.000125];
  const RE_FULL = /^[23456789CFGHJMPQRVWX]{8}\+(?:[23456789CFGHJMPQRVWX]{2,7})?$/i;
  const RE_PADDED = /^(?:[23456789CFGHJMPQRVWX]{2}){1,3}0{2,6}\+$/i;
  const RE_SHORT = /^([23456789CFGHJMPQRVWX]{2,6}\+[23456789CFGHJMPQRVWX]{2,7})(?:[\s,]+(.+))?$/i;

  function olcDecode(code) {
    let c = code.toUpperCase().replace("+", "").replace(/0+$/, "");
    let lat = -90, lng = -180, latRes = 20, lngRes = 20;
    const pairs = Math.min(c.length, 10);
    for (let i = 0; i + 1 < pairs; i += 2) {
      const res = PAIR_RES[i / 2];
      lat += OLC.indexOf(c[i]) * res;
      lng += OLC.indexOf(c[i + 1]) * res;
      latRes = lngRes = res;
    }
    for (let i = 10; i < Math.min(c.length, 15); i++) {
      latRes /= 5; lngRes /= 4;
      const d = OLC.indexOf(c[i]);
      lat += Math.floor(d / 4) * latRes;
      lng += (d % 4) * lngRes;
    }
    return { lat: lat + latRes / 2, lon: lng + lngRes / 2 };
  }

  function olcEncode(lat, lng) {
    lat = Math.min(89.999999, Math.max(-90, lat));
    lng = ((lng + 180) % 360 + 360) % 360 - 180;
    let la = lat + 90, lo = lng + 180, code = "";
    for (let i = 0; i < 5; i++) {
      const res = PAIR_RES[i];
      const dLa = Math.min(19, Math.floor(la / res));
      const dLo = Math.min(19, Math.floor(lo / res));
      la -= dLa * res; lo -= dLo * res;
      code += OLC[dLa] + OLC[dLo];
      if (i === 3) code += "+";
    }
    return code;
  }

  function olcRecover(short, refLat, refLng) {
    const s = short.toUpperCase();
    const sep = s.indexOf("+");
    const pad = 8 - sep;
    const resolution = Math.pow(20, 2 - pad / 2);
    const half = resolution / 2;
    const ref = olcEncode(refLat, refLng).replace("+", "");
    const joined = ref.slice(0, pad) + s.replace("+", "");
    let { lat, lon } = olcDecode(joined.slice(0, 8) + "+" + joined.slice(8));
    if (refLat + half < lat && lat - resolution >= -90) lat -= resolution;
    else if (refLat - half > lat && lat + resolution <= 90) lat += resolution;
    if (refLng + half < lon) lon -= resolution;
    else if (refLng - half > lon) lon += resolution;
    return { lat, lon };
  }

  /* ------------------------------------------------------------------------------------------
   * Coordinates in many spellings
   * ------------------------------------------------------------------------------------------ */
  const num = (s) => parseFloat(String(s).replace(",", "."));

  function fromPair(lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    // tolerate swapped order (lon, lat) when only the swapped reading lies in Germany
    if (!inDE(lat, lon) && inDE(lon, lat)) [lat, lon] = [lon, lat];
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  function parseUrl(s) {
    let m;
    if ((m = s.match(/!3d(-?\d{1,2}\.\d+)!4d(-?\d{1,3}\.\d+)/))) return fromPair(+m[1], +m[2]);
    if ((m = s.match(/@(-?\d{1,2}\.\d+),\s*(-?\d{1,3}\.\d+)/))) return fromPair(+m[1], +m[2]);
    if ((m = s.match(/[?&](?:q|query|ll|sll|viewpoint|cbll|center|destination|daddr)=(-?\d{1,2}\.\d+)(?:,|%2C)\s*(-?\d{1,3}\.\d+)/i)))
      return fromPair(+m[1], +m[2]);
    if ((m = s.match(/#map=\d+(?:\.\d+)?\/(-?\d{1,2}\.\d+)\/(-?\d{1,3}\.\d+)/))) return fromPair(+m[1], +m[2]);
    if ((m = s.match(/mlat=(-?\d{1,2}\.\d+).*?mlon=(-?\d{1,3}\.\d+)/))) return fromPair(+m[1], +m[2]);
    if ((m = s.match(/^geo:(-?\d{1,2}(?:\.\d+)?),\s*(-?\d{1,3}(?:\.\d+)?)/i))) return fromPair(+m[1], +m[2]);
    return null;
  }

  // one coordinate: optional hemisphere letter before/after, degrees [minutes [seconds]]
  function parseComponent(part) {
    const p = part.trim();
    if (!p) return null;
    let hemi = null;
    let m = p.match(/^([NSEWO])\s*/i);
    let body = p;
    if (m) { hemi = m[1].toUpperCase(); body = p.slice(m[0].length); }
    m = body.match(/\s*([NSEWO])$/i);
    if (m && !hemi) { hemi = m[1].toUpperCase(); body = body.slice(0, body.length - m[0].length); }
    const nums = body.match(/-?\d+(?:[.,]\d+)?/g);
    if (!nums || nums.length > 3) return null;
    // leftover characters must be separators only
    if (body.replace(/-?\d+(?:[.,]\d+)?/g, "").replace(/[\s°'"]/g, "") !== "") return null;
    const [d, mi = 0, se = 0] = nums.map(num);
    if (mi >= 60 || se >= 60) return null;
    let v = Math.abs(d) + mi / 60 + se / 3600;
    if (d < 0 || String(nums[0]).startsWith("-")) v = -v;
    if (hemi === "S" || hemi === "W") v = -Math.abs(v);
    return { v, hemi };
  }

  function parseCoordinates(input) {
    const raw = input.trim();
    if (!raw) return null;
    const viaUrl = parseUrl(raw);
    if (viaUrl) return viaUrl;
    let s = raw.replace(/[′’‘`´]/g, "'").replace(/[″“”]/g, '"').replace(/''/g, '"').replace(/º/g, "°")
      .replace(/\s+/g, " ").trim();
    if (!/^[\d\s.,;°'"NSEWOnsewo+\-/]+$/.test(s)) return null;
    if (!/\d/.test(s)) return null;

    // plain decimal pairs: "52.5163, 13.3777" / "52,5163 13,3777" / "52,5163; 13,3777"
    let m = s.match(/^(-?\d{1,3}(?:\.\d+)?)\s*[,;\s/]\s*(-?\d{1,3}(?:\.\d+)?)$/);
    if (m) return fromPair(num(m[1]), num(m[2]));
    m = s.match(/^(-?\d{1,3},\d+)\s*[;\s/]\s*(-?\d{1,3},\d+)$/) || s.match(/^(-?\d{1,3},\d+)\s*,\s+(-?\d{1,3},\d+)$/);
    if (m) return fromPair(num(m[1]), num(m[2]));

    // with hemispheres and/or degree marks: split into two components
    let parts = null;
    if (/[;]/.test(s)) parts = s.split(";");
    else if (/,/.test(s) && /[°'"NSEWO]/i.test(s) && s.split(",").length === 2) parts = s.split(",");
    if (!parts) {
      // split after a trailing N/S or before a leading E/W/O
      const k = s.search(/[NS](?=\s*[-\d])|[NS]\s+(?=[EWO])/i);
      if (k > 0) parts = [s.slice(0, k + 1), s.slice(k + 1)];
    }
    if (!parts) {
      const k = s.search(/\s[EWO]\s?\d/i);
      if (k > 0) parts = [s.slice(0, k), s.slice(k)];
    }
    if (!parts) {
      const nums = s.match(/-?\d+(?:\.\d+)?/g) || [];
      if (nums.length === 4 || nums.length === 6) {
        const h = nums.length / 2;
        parts = [nums.slice(0, h).join(" "), nums.slice(h).join(" ")];
      }
    }
    if (!parts || parts.length !== 2) return null;
    const a = parseComponent(parts[0]);
    const b = parseComponent(parts[1]);
    if (!a || !b) return null;
    if ((a.hemi === "E" || a.hemi === "W" || a.hemi === "O") || (b.hemi === "N" || b.hemi === "S"))
      return fromPair(b.v, a.v);
    return fromPair(a.v, b.v);
  }

  /* ------------------------------------------------------------------------------------------
   * Offline gazetteer
   * ------------------------------------------------------------------------------------------ */
  function normExpand(s) {
    return s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\bsankt\b/g, "st").replace(/[^a-z0-9]+/g, " ").trim();
  }
  function normStrip(s) {
    return s.toLowerCase().replace(/ß/g, "ss").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/\bsankt\b/g, "st").replace(/[^a-z0-9]+/g, " ").trim();
  }

  let entries = [];
  let plz = {};
  let placeByAgs = new Map();
  let ready = null;

  function load(url, districts) {
    if (ready) return ready;
    ready = fetch(url).then((r) => {
      if (!r.ok) throw new Error("places " + r.status);
      return r.json();
    }).then((g) => {
      const list = [];
      for (const d of districts) {
        list.push({ type: "district", id: d.id, name: d.display, sub: d, pop: d.pop || 0,
          n1: normExpand(d.display), n2: normStrip(d.display), n3: normExpand(d.name) });
      }
      for (const p of g.places) {
        const [name, ags, lon, lat, pop] = p;
        const e = { type: "place", id: ags, name, lon, lat, pop, kreis: ags.slice(0, 5),
          n1: normExpand(name), n2: normStrip(name) };
        list.push(e);
        placeByAgs.set(ags, e);
      }
      entries = list;
      plz = g.plz;
      return true;
    });
    return ready;
  }

  function matchClass(n, q) {
    if (!n || !q) return 9;
    if (n === q) return 0;
    if (n.startsWith(q)) return 1;
    if ((" " + n).includes(" " + q)) return 2;
    if (q.length >= 4 && n.includes(q)) return 3;
    return 9;
  }

  function suggest(query, limit = 8) {
    const q = query.trim();
    if (!q) return [];
    const out = [];
    if (/^\d{2,5}$/.test(q)) {
      const keys = Object.keys(plz).filter((k) => k.startsWith(q)).sort().slice(0, limit);
      for (const k of keys) out.push({ type: "plz", id: k, name: k, place: plz[k][0], districts: plz[k][1] });
      if (q.length === 5) {
        const d = entries.find((e) => e.type === "district" && e.id === q);
        if (d) out.unshift({ type: "district", id: d.id, name: d.name, sub: d.sub });
      }
      return out.slice(0, limit);
    }
    const q1 = normExpand(q), q2 = normStrip(q);
    if (q1.length < 2) return [];
    const scored = [];
    for (const e of entries) {
      const c = Math.min(matchClass(e.n1, q1), matchClass(e.n2, q2), e.n3 ? matchClass(e.n3, q1) : 9);
      if (c < 9) scored.push([c, e]);
    }
    scored.sort((a, b) => a[0] - b[0] || (b[1].pop - a[1].pop) ||
      (a[1].type === b[1].type ? 0 : a[1].type === "place" ? -1 : 1));
    for (const [c, e] of scored.slice(0, limit)) out.push(Object.assign({ cls: c }, e));
    return out;
  }

  function exactMatches(query) {
    const q1 = normExpand(query), q2 = normStrip(query);
    return entries.filter((e) => e.n1 === q1 || e.n2 === q2 || (e.n3 && e.n3 === q1));
  }

  function place(ags) { return placeByAgs.get(ags) || null; }
  function postcode(code) { return plz[code] ? { plz: code, place: plz[code][0], districts: plz[code][1] } : null; }

  /* ------------------------------------------------------------------------------------------
   * Online address search (Nominatim)
   * ------------------------------------------------------------------------------------------ */
  let lastCall = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function geocode(query, { url, email, lang }) {
    const wait = lastCall + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall = Date.now();
    const params = new URLSearchParams({
      q: query, format: "jsonv2", countrycodes: "de", limit: "6", addressdetails: "1",
      "accept-language": lang === "en" ? "en,de" : "de"
    });
    if (email) params.set("email", email);
    const r = await fetch(url + (url.includes("?") ? "&" : "?") + params.toString(), { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("geocoder " + r.status);
    const js = await r.json();
    return js
      .map((x) => ({ label: addressLabel(x), lat: +x.lat, lon: +x.lon, kind: x.addresstype || x.type }))
      .filter((x) => inDE(x.lat, x.lon));
  }

  // "Unter den Linden 1, 10117 Berlin" instead of Nominatim's long display name
  function addressLabel(x) {
    const a = x.address || {};
    const town = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || a.county || "";
    const street = a.road || a.pedestrian || a.footway || a.square || a.path || "";
    const parts = [];
    if (x.name && x.name !== street && x.name !== town && !/^\d+$/.test(x.name)) parts.push(x.name);
    if (street) parts.push(street + (a.house_number ? " " + a.house_number : ""));
    const place = [a.postcode, town].filter(Boolean).join(" ");
    if (place) parts.push(place);
    if (parts.length) return parts.join(", ");
    return String(x.display_name || "").split(", ").filter((p) => !/^(Deutschland|Germany)$/i.test(p)).slice(0, 4).join(", ");
  }

  /* ------------------------------------------------------------------------------------------
   * Browser geolocation
   * ------------------------------------------------------------------------------------------ */
  function locate() {
    return new Promise((resolve, reject) => {
      if (!window.isSecureContext) return reject(new Error("insecure"));
      if (!("geolocation" in navigator)) return reject(new Error("unavailable"));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        (e) => reject(e),
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
      );
    });
  }

  /* ------------------------------------------------------------------------------------------
   * Resolve free text without a picked suggestion
   * Returns {type: "point"|"district"|"plz"|"choices"|"online"|"none", ...}
   * ------------------------------------------------------------------------------------------ */
  function resolveLocal(text) {
    const s = text.trim();
    if (!s) return { type: "none" };
    const c = parseCoordinates(s);
    if (c) return { type: "point", lat: c.lat, lon: c.lon, source: "coords", label: fmtCoord(c.lat, c.lon) };

    const compact = s.replace(/\s+/g, " ");
    if (RE_FULL.test(compact) || RE_PADDED.test(compact)) {
      const p = olcDecode(compact);
      return { type: "point", lat: p.lat, lon: p.lon, source: "pluscode", label: compact.toUpperCase() };
    }
    const ms = compact.match(RE_SHORT);
    if (ms) {
      const code = ms[1];
      const locality = ms[2];
      let ref = null;
      if (locality) {
        const hit = suggest(locality, 1).find((e) => e.type === "place");
        if (hit) ref = hit;
      }
      const rl = ref ? ref.lat : 51.16, rn = ref ? ref.lon : 10.45;
      const p = olcRecover(code, rl, rn);
      return { type: "point", lat: p.lat, lon: p.lon, source: "pluscode",
        label: code.toUpperCase() + (ref ? " " + ref.name : "") };
    }

    if (/^\d{5}$/.test(s)) {
      const pc = postcode(s);
      if (pc) return Object.assign({ type: "plz" }, pc);
      const d = entries.find((e) => e.type === "district" && e.id === s);
      if (d) return { type: "district", id: d.id, label: d.name };
    }

    const ex = exactMatches(s);
    if (ex.length === 1) return entryToResolution(ex[0]);
    if (ex.length > 1) {
      // same name as town and district (e.g. "Starnberg"): prefer the municipality
      const places = ex.filter((e) => e.type === "place");
      if (places.length === 1) return entryToResolution(places[0]);
      return { type: "choices", items: ex.slice(0, 8) };
    }
    return { type: "online", query: s };
  }

  function entryToResolution(e) {
    if (e.type === "district") return { type: "district", id: e.id, label: e.name };
    if (e.type === "plz") return { type: "plz", plz: e.id, place: e.place, districts: e.districts };
    return { type: "point", lat: e.lat, lon: e.lon, kreis: e.kreis, source: "place", label: e.name, approx: true };
  }

  function fmtCoord(lat, lon) {
    return lat.toFixed(5) + ", " + lon.toFixed(5);
  }

  window.LE = window.LE || {};
  window.LE.search = {
    load, suggest, resolveLocal, entryToResolution, geocode, locate, parseCoordinates, place, postcode, inDE,
    olc: { decode: olcDecode, encode: olcEncode, recover: olcRecover }, fmtCoord
  };
})();
