#!/usr/bin/env python3
"""
Build the compact data files used by the web tool (site/data/*.json).

Sources (download them with scripts/download_sources.py):

  Life expectancy  Hoehn, A. & Mühlichen, M. (2026, March 21). Do Welfare Regimes Matter? A Comparative
                   Analysis of Area-Level Inequalities in Life Expectancy [Data set]. OSF.
                   https://doi.org/10.17605/OSF.IO/ZG5TJ  (CC BY 4.0)
                   Article: Mühlichen, M., Höhn, A., Lomax, N., Meier, P., & Grigoriev, P. (2026).
                   Geographical Analysis, 58(2), e70040. https://doi.org/10.1111/gean.70040
  GISD             Michalski, N., Soliman, L., Reis, M., Tetzlaff, F., Nowossadeck, E., & Hoebel, J.
                   (2026). German Index of Socioeconomic Deprivation (GISD) [Data set]. Zenodo.
                   https://doi.org/10.5281/zenodo.18983808  (release 2026-05-18, CC BY 4.0)
  INKAR            Laufende Raumbeobachtung des BBSR – INKAR, Ausgabe 07/2025. Hrsg.: Bundesinstitut
                   für Bau-, Stadt- und Raumforschung (BBSR), Bonn. https://www.inkar.de/
                   (dl-de/by-2-0)
  Boundaries       © GeoBasis-DE / BKG (2025), VG250-EW, Gebietsstand 31.12.2023 (dl-de/by-2-0)

Usage:
  pip install -r scripts/requirements.txt
  python scripts/download_sources.py --raw raw
  python scripts/build_data.py --raw raw --out site/data
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import math
import shutil
import subprocess
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

import geopandas as gpd
import pandas as pd
import topojson as tp

# --------------------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------------------

LE_SHEETS = [("Figure2", "both"), ("FigureS2", "female"), ("FigureS1", "male")]
SEXES = ["both", "female", "male"]

# INKAR indicator codes (INKAR 2025, Raumbezug "Kreise") used for the nine GISD indicators.
# "alo" is computed like in the GISD code: unemployed (alo) per 100 inhabitants aged 15-64 (ewf_1565_ges).
INKAR_CODES = {
    "a_svw_akadem", "a_svw_oAbschluss", "a_schul_oA",
    "alo", "ewf_1565_ges", "q_svw", "d_Bruttoverdienst",
    "q_einkst_bev", "d_Hausshaltseinkommen", "q_Schuldner", "xbev",
}
INDICATORS = [
    # key, INKAR code (or None if derived), GISD dimension, sign (+1: higher = more deprived), decimals
    ("akad",      "a_svw_akadem",          "edu",  -1, 1),
    ("ohneab",    "a_svw_oAbschluss",      "edu",  +1, 1),
    ("schulab",   "a_schul_oA",            "edu",  +1, 1),
    ("alo",       None,                    "emp",  +1, 1),
    ("beschq",    "q_svw",                 "emp",  -1, 1),
    ("brutto",    "d_Bruttoverdienst",     "emp",  -1, 0),
    ("est",       "q_einkst_bev",          "inc",  -1, 0),
    ("hhek",      "d_Hausshaltseinkommen", "inc",  -1, 0),
    ("schuldner", "q_Schuldner",           "inc",  +1, 1),
]
INKAR_YEARS = list(range(2000, 2024))

CITY_LABELS = [  # AGS of municipalities shown as orientation labels on the map
    "11000000", "02000000", "09162000", "05315000", "06412000", "08111000", "05111000",
    "14713000", "04011000", "14612000", "03241001", "09564000", "13003000", "01002000",
    "15003000", "16051000", "12054000", "10041100", "08311000", "06611000",
]

GEO_DISPLAY_TOL_M = 200   # Douglas-Peucker tolerance for the display map
GEO_DETAIL_TOL_M = 10     # tolerance for the point-in-polygon lookup geometry


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def r(x, nd):
    if x is None or (isinstance(x, float) and math.isnan(x)):
        return None
    v = round(float(x), nd)
    return int(v) if nd == 0 else v


def ags5(code) -> str:
    s = str(code).strip()
    if s.endswith(".0"):
        s = s[:-2]
    if len(s) in (7, 8) and s.endswith("000"):
        s = s[:-3]
    return s.zfill(5)


# --------------------------------------------------------------------------------------
# Life expectancy (OSF)
# --------------------------------------------------------------------------------------

def build_le(raw: Path):
    xlsx = raw / "osf" / "DE_UK_LifeExpectancy_Districts_2003-2021.xlsx"
    frames = []
    for sheet, sex in LE_SHEETS:
        df = pd.read_excel(xlsx, sheet_name=sheet, dtype={"Region Code": str})
        df = df[df["Country"] == "Germany"].copy()
        df["ags"] = df["Region Code"].map(ags5)
        df["sex"] = sex
        frames.append(df)
    le = pd.concat(frames)
    periods = sorted(le["Period"].unique(), key=lambda p: int(str(p)[:4]))
    ages = sorted(int(a) for a in le["Age"].unique())
    log("LE periods", periods, "ages", ages)
    idx = le.set_index(["ags", "Period", "sex", "Age"])["Life Expectancy"]
    out = {}
    for ags in sorted(le["ags"].unique()):
        vals = []
        for p in periods:
            for s in SEXES:
                for a in ages:
                    vals.append(r(idx.get((ags, p, s, a)), 2))
        assert all(v is not None for v in vals), ags
        out[ags] = vals
    assert len(out) == 400, len(out)
    # sanity: e0 between 70 and 90, e90 < e0
    for ags, v in out.items():
        assert 70 < v[0] < 90, (ags, v[0])

    # Annual life expectancy at birth with 95% CI (sheet Figure1)
    f1 = pd.read_excel(xlsx, sheet_name="Figure1", dtype={"Region Code": str})
    f1 = f1[f1["Country"] == "Germany"].copy()
    f1["key"] = f1["Region Code"].map(lambda c: ags5(c) if str(c).strip().isdigit() else str(c).strip())
    years = sorted(int(y) for y in f1["Year"].unique())
    annual = {}
    for key, g in f1.groupby("key"):
        rec = {}
        for sex_label, sx in (("Females", "f"), ("Males", "m")):
            gg = g[g["Sex"] == sex_label].set_index("Year")
            rec[sx] = [[r(gg.at[y, "Life Expectancy"], 2), r(gg.at[y, "Lower CI"], 2), r(gg.at[y, "Upper CI"], 2)]
                       if y in gg.index else None for y in years]
        annual[key] = rec
    log("annual LE keys", len(annual), "non-district:", [k for k in annual if not k.isdigit()])

    names = pd.read_excel(raw / "osf" / "DE_UK_Districts_Names.xlsx", dtype={"Region Code": str})
    names = names[names["Country"] == "Germany"]
    subregion = {ags5(c): s for c, s in zip(names["Region Code"], names["Subregion"]) if str(c).strip().isdigit()}
    return {"periods": [str(p).replace("\u2013", "–") for p in periods], "ages": ages,
            "values": out, "annualYears": years, "annual": annual, "subregion": subregion}


# --------------------------------------------------------------------------------------
# GISD (RKI)
# --------------------------------------------------------------------------------------

def build_gisd(raw: Path):
    df = pd.read_csv(raw / "gisd" / "GISD_Bund.tsv", sep="\t", dtype={"region_id": str}, low_memory=False)
    df = df[df["region_type"] == "Kreis"].copy()
    years = sorted(int(y) for y in df["year"].unique())
    out = {}
    for ags, g in df.groupby("region_id"):
        g = g.set_index("year")
        out[ags5(ags)] = {
            "s": [r(g.at[y, "gisd_score"], 3) if y in g.index else None for y in years],
            "q5": [int(g.at[y, "gisd_5"]) if y in g.index else None for y in years],
            "q10": [int(g.at[y, "gisd_10"]) if y in g.index else None for y in years],
        }
    assert len(out) == 400
    log("GISD years", years[0], "-", years[-1])
    return {"years": years, "values": out}


# --------------------------------------------------------------------------------------
# INKAR (BBSR)
# --------------------------------------------------------------------------------------

def iter_inkar_lines(raw: Path):
    """Yield text lines of inkar_2025.csv. Uses the extracted CSV if present, otherwise streams the
    zip through 7-Zip (the archive uses Deflate64, which Python's zipfile cannot read)."""
    csv_path = raw / "inkar" / "inkar_2025.csv"
    zip_path = raw / "inkar" / "inkar_2025.zip"
    if csv_path.exists():
        with open(csv_path, encoding="utf-8", errors="replace", newline="") as f:
            yield from f
        return
    exe = shutil.which("7z") or shutil.which("7za")
    for cand in (r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files (x86)\7-Zip\7z.exe"):
        if not exe and Path(cand).exists():
            exe = cand
    if not exe:
        sys.exit("INKAR: extract inkar_2025.csv from inkar_2025.zip into raw/inkar/ (needs Deflate64 support, "
                 "e.g. 7-Zip), or install 7-Zip so this script can stream it.")
    proc = subprocess.Popen([exe, "e", "-so", str(zip_path), "inkar_2025.csv"],
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    yield from io.TextIOWrapper(proc.stdout, encoding="utf-8", errors="replace", newline="")
    proc.wait()


def filter_inkar(raw: Path, cache: Path) -> pd.DataFrame:
    if not cache.exists():
        log("filtering INKAR (this streams ~6.8 GB and takes about a minute)…")
        n = kept = 0
        with open(cache, "w", encoding="utf-8", newline="") as out:
            w = csv.writer(out, delimiter=";")
            lines = iter_inkar_lines(raw)
            header = next(lines).rstrip("\r\n").split(";")
            w.writerow(header)
            for line in lines:
                n += 1
                p = line.rstrip("\r\n").split(";")
                if len(p) >= 9 and p[2] in INKAR_CODES and p[4] in ("Kreise", "Bund"):
                    w.writerow(p)
                    kept += 1
        log(f"INKAR lines {n:,}, kept {kept:,}")
    df = pd.read_csv(cache, sep=";", dtype={"Kennziffer": str}, decimal=",")
    df["Wert"] = pd.to_numeric(df["Wert"], errors="coerce")
    df["key"] = df.apply(lambda x: "DE" if x["Raumbezug"] == "Bund" else ags5(x["Kennziffer"]), axis=1)
    # prefer the 'Laufende Raumbeobachtung' (LRB) block when an indicator appears in several blocks
    df["prio"] = (df["Bereich"] != "LRB").astype(int)
    df = df.sort_values("prio").drop_duplicates(["Kuerzel", "key", "Zeitbezug"])
    return df


def build_inkar(raw: Path, work: Path):
    df = filter_inkar(raw, work / "inkar_gisd_kreise.csv")
    piv = df.pivot_table(index=["key", "Zeitbezug"], columns="Kuerzel", values="Wert", aggfunc="first")
    piv["alo_calc"] = piv["alo"] / piv["ewf_1565_ges"] * 100
    # Known issue in the INKAR 2025 bulk file: the 2023 'Schuldnerquote' is stored x100
    # (e.g. Germany 821.8 instead of 8.2 %). Values above 100 % are impossible, so rescale them.
    bad = piv["q_Schuldner"] > 100
    if bad.any():
        log(f"rescaling {int(bad.sum())} q_Schuldner values > 100 (years: "
            f"{sorted(set(piv[bad].index.get_level_values(1)))})")
        piv.loc[bad, "q_Schuldner"] = piv.loc[bad, "q_Schuldner"] / 100
    keys = sorted(k for k in piv.index.get_level_values(0).unique())
    assert len([k for k in keys if k != "DE"]) == 400
    out = {"years": INKAR_YEARS, "indicators": {}}
    coverage = {}
    for key, code, dim, sign, nd in INDICATORS:
        col = "alo_calc" if code is None else code
        series = {}
        avail = set()
        for k in keys:
            vals = []
            for y in INKAR_YEARS:
                v = piv[col].get((k, y), float("nan")) if (k, y) in piv.index else float("nan")
                vals.append(r(v, nd))
                if vals[-1] is not None:
                    avail.add(y)
            series[k] = vals
        out["indicators"][key] = {"code": code or "alo/ewf_1565_ges*100", "dim": dim, "sign": sign,
                                  "values": series}
        coverage[key] = (min(avail), max(avail))
    pop = {}
    for k in keys:
        pop[k] = [r(piv["xbev"].get((k, y), float("nan")), 0) if (k, y) in piv.index else None for y in INKAR_YEARS]
    out["population"] = pop
    log("INKAR coverage", coverage)
    out["coverage"] = {k: list(v) for k, v in coverage.items()}
    return out


# --------------------------------------------------------------------------------------
# Districts, municipalities, postcodes, geometry
# --------------------------------------------------------------------------------------

def build_reference(raw: Path):
    ref = pd.read_excel(raw / "inkar" / "BBSR_Raumgliederungen_Referenz_2023.xlsx",
                        sheet_name="Kreisreferenz", header=0, skiprows=[1], dtype=str)
    ref["ags"] = ref["KRS2023"].map(ags5)
    cols = ["ags", "KRS_NAME", "BLD2023", "BLD_NAME", "KTU2023", "KTU_NAME", "KWO_NAME", "SLK_NAME"]
    return ref[cols].set_index("ags")


def fix_winding(topo: dict) -> dict:
    """Make every exterior ring clockwise and every hole counter-clockwise (in lon/lat), the
    winding order d3-geo expects for polygons smaller than a hemisphere. Rings are reversed in the
    topology (arc order reversed, arc indices complemented), so shared borders stay shared."""
    sc, tr = topo["transform"]["scale"], topo["transform"]["translate"]
    arcs = []
    for a in topo["arcs"]:
        x = y = 0
        pts = []
        for dx, dy in a:
            x += dx; y += dy
            pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        arcs.append(pts)

    def coords(ring):
        pts = []
        for i in ring:
            seg = arcs[i] if i >= 0 else arcs[~i][::-1]
            pts.extend(seg if not pts else seg[1:])
        return pts

    def signed_area(p):
        return sum(p[i][0] * p[i + 1][1] - p[i + 1][0] * p[i][1] for i in range(len(p) - 1)) / 2

    fixed = 0
    for geom in topo["objects"]["kreise"]["geometries"]:
        polys = [geom["arcs"]] if geom["type"] == "Polygon" else geom["arcs"]
        for poly in polys:
            for ri, ring in enumerate(poly):
                a = signed_area(coords(ring))
                if (ri == 0 and a > 0) or (ri > 0 and a < 0):
                    poly[ri] = [~i for i in reversed(ring)]
                    fixed += 1
    log(f"winding: reversed {fixed} rings")
    return topo


def build_geometry(raw: Path, out_dir: Path):
    gpkg = raw / "bkg" / "DE_VG250.gpkg"
    krs = gpd.read_file(gpkg, layer="vg250_krs")
    krs = krs[krs["GF"] == 4][["AGS", "GEN", "BEZ", "EWZ", "KFL", "geometry"]]
    attrs = krs.drop(columns="geometry").drop_duplicates("AGS").set_index("AGS")
    shapes = krs[["AGS", "geometry"]].dissolve(by="AGS").reset_index().rename(columns={"AGS": "id"})
    assert len(shapes) == 400
    # a point guaranteed to lie inside each district (used for map pins of district-only selections)
    inner = shapes.set_index("id").geometry.representative_point().to_crs(4326)
    attrs["pt"] = [[round(p.x, 4), round(p.y, 4)] for p in inner.reindex(attrs.index)]

    def write_topo(tol, quant, path):
        topo = tp.Topology(shapes, prequantize=False, toposimplify=tol, prevent_oversimplify=True)
        g = topo.to_gdf().set_crs(25832, allow_override=True).to_crs(4326)
        g = g[["id", "geometry"]]
        t2 = tp.Topology(g, prequantize=quant, topology=True, object_name="kreise")
        topo_dict = fix_winding(json.loads(t2.to_json()))
        path.write_text(json.dumps(topo_dict, separators=(",", ":")), encoding="utf-8")
        log(f"wrote {path.name}: {path.stat().st_size/1024:.0f} KB")

    write_topo(GEO_DISPLAY_TOL_M, 1e5, out_dir / "geo.json")
    write_topo(GEO_DETAIL_TOL_M, 1e6, out_dir / "geo_detail.json")

    # municipality points (gazetteer) and city labels
    pk = gpd.read_file(gpkg, layer="vg250_pk", ignore_geometry=True)
    gem = gpd.read_file(gpkg, layer="vg250_gem", ignore_geometry=True)
    gem = gem[gem["GF"] == 4].drop_duplicates("AGS").set_index("AGS")
    places = []
    seen = set()
    for _, p in pk.iterrows():
        ags = str(p["AGS"])
        if ags in seen:
            continue
        seen.add(ags)
        ewz = int(gem.at[ags, "EWZ"]) if ags in gem.index and not pd.isna(gem.at[ags, "EWZ"]) else 0
        places.append([str(p["GEN"]), ags, round(float(p["LON_DEZ"]), 5), round(float(p["LAT_DEZ"]), 5), ewz])
    places.sort(key=lambda x: -x[4])
    labels = []
    by_ags = {p[1]: p for p in places}
    for a in CITY_LABELS:
        if a in by_ags:
            p = by_ags[a]
            labels.append({"name": p[0], "lon": p[2], "lat": p[3], "pop": p[4]})
        else:
            log("city label not found", a)
    return attrs, places, labels


def build_postcodes(raw: Path, place_by_ags: dict):
    import pyreadr
    res = pyreadr.read_r(str(raw / "gisd" / "EW_Gem_PLZ_Intersect_2023.rds"))
    df = next(iter(res.values()))
    df["krs"] = df["gemeinde_id"].astype(str).str.zfill(8).str[:5]
    df["w"] = df["population_intersect"].astype(float)
    out = {}
    for plz, g in df.groupby("PLZ_5"):
        tot = g["w"].sum()
        if tot <= 0:  # unpopulated postcode areas: fall back to area shares
            g = g.assign(w=g["flaeche_intersect"].astype(float))
            tot = g["w"].sum()
        by_krs = g.groupby("krs")["w"].sum().sort_values(ascending=False)
        shares = [[k, round(v / tot * 100)] for k, v in by_krs.items() if v / tot >= 0.01]
        main_gem = g.sort_values("w", ascending=False).iloc[0]
        gid = str(main_gem["gemeinde_id"]).zfill(8)
        name = place_by_ags.get(gid, [str(main_gem["gemeinde_name"])])[0]
        out[str(plz).zfill(5)] = [name, shares]
    log("postcodes", len(out), "multi-district:", sum(1 for v in out.values() if len(v[1]) > 1))
    return out


# --------------------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="raw", type=Path)
    ap.add_argument("--out", default="site/data", type=Path)
    ap.add_argument("--work", default=None, type=Path, help="folder for intermediate files (default: raw/work)")
    a = ap.parse_args()
    raw, out = a.raw, a.out
    work = a.work or (raw / "work")
    out.mkdir(parents=True, exist_ok=True)
    work.mkdir(parents=True, exist_ok=True)

    le = build_le(raw)
    gisd = build_gisd(raw)
    inkar = build_inkar(raw, work)
    ref = build_reference(raw)
    attrs, places, labels = build_geometry(raw, out)

    districts = []
    for ags in sorted(le["values"]):
        a_ = attrs.loc[ags]
        rf = ref.loc[ags]
        districts.append({
            "id": ags,
            "name": str(a_["GEN"]),
            "bez": str(a_["BEZ"]),
            "official": str(rf["KRS_NAME"]),
            "land": str(rf["BLD_NAME"]),
            "landId": ags[:2],
            "ktyp": int(rf["KTU2023"]),
            "wo": str(rf["KWO_NAME"]),
            "sub": le["subregion"].get(ags),
            "area": round(float(a_["KFL"]), 1),
            "pt": a_["pt"],
        })

    data = {
        "built": date.today().isoformat(),
        "districts": districts,
        "le": {"periods": le["periods"], "ages": le["ages"], "sexes": SEXES, "values": le["values"]},
        "leAnnual": {"years": le["annualYears"], "values": le["annual"]},
        "gisd": gisd,
        "inkar": inkar,
        "cities": labels,
    }
    (out / "data.json").write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"wrote data.json: {(out / 'data.json').stat().st_size/1024:.0f} KB")

    place_by_ags = {p[1]: p for p in places}
    plz = build_postcodes(raw, place_by_ags)
    gaz = {"places": places, "plz": plz}
    (out / "places.json").write_text(json.dumps(gaz, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    log(f"wrote places.json: {(out / 'places.json').stat().st_size/1024:.0f} KB")


if __name__ == "__main__":
    main()
