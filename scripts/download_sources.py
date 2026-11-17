#!/usr/bin/env python3
"""
Download the raw source data used by build_data.py into ./raw (about 0.5 GB).

  raw/osf/    life expectancy (OSF 10.17605/OSF.IO/ZG5TJ)
  raw/gisd/   GISD release 2026-05-18 (GitHub, robert-koch-institut)
  raw/inkar/  INKAR 2025 bulk file (BBSR)
  raw/bkg/    VG250-EW administrative areas, 31.12.2023 (BKG)

The INKAR zip uses Deflate64 compression, which Python's zipfile module cannot read.
The script therefore uses 7-Zip (7z) to extract the reference workbook when it is installed;
build_data.py streams the large CSV through 7-Zip as well.

Usage:
  python scripts/download_sources.py [--raw raw]
"""
from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
import urllib.request
import zipfile
from pathlib import Path

GISD_TAG = "2026-05-18"
GISD_RAW = f"https://raw.githubusercontent.com/robert-koch-institut/German_Index_of_Socioeconomic_Deprivation_GISD/{GISD_TAG}"

FILES = [
    ("osf/DE_UK_LifeExpectancy_Districts_2003-2021.xlsx", "https://osf.io/download/e6yzw/"),
    ("osf/DE_UK_Districts_Names.xlsx", "https://osf.io/download/8xw65/"),
    ("gisd/GISD_Bund.tsv", f"{GISD_RAW}/GISD_Bund.tsv"),
    ("gisd/EW_Gem_PLZ_Intersect_2023.rds", f"{GISD_RAW}/Kontextmaterialien/Rohdaten/SHP/EW_Gem_PLZ_Intersect_2023.rds"),
    ("inkar/inkar_2025.zip", "https://www.bbr-server.de/imagemap/inkar/download/inkar_2025.zip"),
    ("bkg/vg250-ew_12-31.utm32s.gpkg.ebenen.zip",
     "https://daten.gdz.bkg.bund.de/produkte/vg/vg250-ew_ebenen_1231/2023/vg250-ew_12-31.utm32s.gpkg.ebenen.zip"),
]


def download(url: str, dest: Path) -> None:
    if dest.exists() and dest.stat().st_size > 0:
        print(f"  exists  {dest}")
        return
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    print(f"  get     {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "le-district-tool-data-build/1.0"})
    with urllib.request.urlopen(req) as r, open(tmp, "wb") as f:
        shutil.copyfileobj(r, f, length=1 << 20)
    tmp.rename(dest)


def find_7z() -> str | None:
    exe = shutil.which("7z") or shutil.which("7za")
    for cand in (r"C:\Program Files\7-Zip\7z.exe", r"C:\Program Files (x86)\7-Zip\7z.exe"):
        if not exe and Path(cand).exists():
            exe = cand
    return exe


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", default="raw", type=Path)
    raw = ap.parse_args().raw
    for rel, url in FILES:
        download(url, raw / rel)

    # BKG: extract the GeoPackage (standard deflate)
    gpkg = raw / "bkg" / "DE_VG250.gpkg"
    if not gpkg.exists():
        with zipfile.ZipFile(raw / "bkg" / "vg250-ew_12-31.utm32s.gpkg.ebenen.zip") as z:
            name = next(n for n in z.namelist() if n.endswith("DE_VG250.gpkg"))
            with z.open(name) as src, open(gpkg, "wb") as dst:
                shutil.copyfileobj(src, dst, length=1 << 20)
        print(f"  extract {gpkg}")

    # INKAR: extract the spatial reference workbook (Deflate64 -> 7-Zip)
    ref = raw / "inkar" / "BBSR_Raumgliederungen_Referenz_2023.xlsx"
    if not ref.exists():
        exe = find_7z()
        if exe:
            subprocess.run([exe, "e", "-y", f"-o{ref.parent}", str(raw / "inkar" / "inkar_2025.zip"), ref.name],
                           check=True, stdout=subprocess.DEVNULL)
            print(f"  extract {ref}")
        else:
            sys.exit(f"Please extract {ref.name} (and optionally inkar_2025.csv) from raw/inkar/inkar_2025.zip "
                     "with a tool that supports Deflate64 (e.g. 7-Zip), then run build_data.py.")
    print("done")


if __name__ == "__main__":
    main()
