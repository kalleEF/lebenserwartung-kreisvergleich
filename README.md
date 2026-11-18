# Lebenserwartung im Kreisvergleich / Life expectancy by district

An interactive web tool for teaching and science communication. Users pick two places in Germany (address, town, postcode, district, coordinates, Plus Code, map link, own location or a click on the map). The tool compares life expectancy in the districts (Landkreise and kreisfreie Städte) the places belong to:

- **Main comparison:** life expectancy at birth, latest period (2020–2021), both sexes combined, with the difference in years and each district's rank among all 400.
- **Settings:** sex (total, women, men), age (0, 1, 5, 10 … 90 → remaining life expectancy) and period (2003–2005, 2009–2011, 2017–2019, 2020–2021).
- **Change** between the first period (2003–2005) and the latest (2020–2021), with the median of all districts as reference.
- **Context:** the distribution across all 400 districts, annual estimates 2003–2021 with 95 % confidence intervals, the gap at every age, the GISD deprivation score (strip, scatter plot with regression, trend since 1998) and the nine GISD indicators from INKAR, each averaged over the selected period.
- **Street View:** for addresses, towns, coordinates and the browser location, a link to Google Street View. The embedded picture appears once a Google Maps Embed API key is set (see below).
- Interface in German (default) and English, light and dark mode, shareable links, works on phones.

The whole tool is a static website in `site/`. It needs no server-side code, database or build step.

```
site/                 ← upload this folder
  index.html
  config.js           ← settings: Street View key, geocoder, legal links, example
  assets/css, js, fonts, vendor (D3 7.9.0, TopoJSON client 3.1.0, self-hosted)
  data/
    data.json         life expectancy, GISD, INKAR, district attributes   (1.5 MB, ~0.4 MB gzipped)
    geo.json          district boundaries for the map                      (0.45 MB)
    geo_detail.json   detailed boundaries, loaded only to locate addresses (2 MB)
    places.json       municipalities and postcodes for the search          (0.85 MB, loaded on first use)
scripts/
  download_sources.py   fetches the raw data (~0.5 GB) into raw/
  build_data.py         builds site/data/*.json from the raw data
  requirements.txt
```

## Try it locally

The page loads its data with `fetch`, so it must be served over HTTP (opening `index.html` as a file does not work):

```bash
python -m http.server 8000 --directory site
```

Then open http://localhost:8000.

## Publish

### GitHub Pages

The repository contains a workflow ([.github/workflows/pages.yml](.github/workflows/pages.yml)) that publishes `site/` whenever a change to it is pushed to `main`.

1. Create a repository on GitHub and push this folder, for example with the GitHub CLI:
   ```bash
   gh repo create lebenserwartung-kreisvergleich --public --source . --push
   ```
2. In the repository, open *Settings → Pages* and set *Build and deployment → Source* to **GitHub Actions** (one time only).
3. Start the first deployment: push any change to `site/`, or run the workflow under *Actions → Deploy site to GitHub Pages → Run workflow*.
4. The tool is then online at `https://<your-user>.github.io/<repository>/`.

GitHub Pages on private repositories needs a paid GitHub plan; for a teaching tool a public repository is the usual choice. Everything in `config.js` is public, which is normal for a browser key: restrict a Google key to your Pages address (`https://<your-user>.github.io/<repository>/*`), and only add a contact e-mail for the geocoder if it may be public.

### Other hosts

Copy the contents of `site/` to any static web host, for example:

- **University web server:** upload the folder via the usual web space (e.g. `public_html`).
- **Netlify, Cloudflare Pages:** drag and drop the `site` folder.

Serve the site over **https**. Browsers only allow the "use my location" button on secure pages. Most hosts compress JSON automatically; if yours does not, enable gzip or brotli for `.json` files to cut the transfer size by about 70 %.

Public websites in Germany usually need a legal notice (Impressum) and a privacy policy. Put their URLs into `imprintUrl` and `privacyUrl` in `site/config.js` to link them in the footer. The privacy section of the page lists what the tool sends to third parties (see below).

## Street View setup

The pictures use the official **Google Maps Embed API**, which Google offers free of charge (check the current Google Maps Platform pricing page). You need a Google Cloud project with a billing account to create the key.

1. Open the Google Cloud console and create a project.
2. *APIs & Services → Library*: enable **Maps Embed API**.
3. *APIs & Services → Credentials → Create credentials → API key*.
4. Restrict the key: *Application restrictions → Websites*, add your domain (e.g. `https://example.org/*`). *API restrictions → Maps Embed API* only.
5. Paste the key into `site/config.js`: `googleMapsEmbedApiKey: "AIza…"`.

With a key, each Street View panel first shows a consent button ("Street View laden"), because loading the picture sends the visitor's IP address to Google. The "don't ask again" box stores the consent for the browser session only. Without a key, the panel shows a small locator map and a link that opens Street View on google.com.

## Address search

Full street addresses are geocoded with **OpenStreetMap Nominatim**. Its [usage policy](https://operations.osmfoundation.org/policies/nominatim/) allows at most one request per second and no search-as-you-type. The tool complies: suggestions while typing come from a local list of municipalities, districts and postcodes, and Nominatim is only asked when someone submits an address (at most one request per second per visitor). For heavy use, such as a large lecture where everyone searches at once, set `geocoderEmail` in `config.js` or point `geocoderUrl` at your own Nominatim-compatible service. Set `geocoderUrl: ""` to switch address search off; towns, postcodes, districts, coordinates and Plus Codes keep working because they are resolved in the browser.

Points are assigned to districts with the official district boundaries (VG250, simplified to 10 m). Postcodes are assigned to the district where most of the postcode area's residents live; if a postcode spans several districts substantially, the tool says so.

## What is sent where (privacy)

- Fonts, libraries and data are served from your own server. No cookies, no analytics.
- Search text is processed in the browser. Only a submitted **street address** goes to Nominatim (OpenStreetMap Foundation, UK).
- **Google** receives a request only when a visitor clicks "Street View laden" (with a key configured) or follows the Street View link.
- The browser's local storage keeps the language choice; session storage keeps the Street View consent.
- Shared links contain district keys and settings, never addresses or coordinates.

## Updating the data

```bash
pip install -r scripts/requirements.txt
python scripts/download_sources.py --raw raw
python scripts/build_data.py --raw raw --out site/data
```

7-Zip is needed for the INKAR bulk file (it uses Deflate64 compression). For newer releases, adjust `GISD_TAG` and the INKAR/BKG URLs in `download_sources.py` and the INKAR indicator codes in `build_data.py`. The build script checks that all sources cover the same 400 districts.

Processing notes:

- Life expectancy by period and age comes from sheets `Figure2` (both sexes), `FigureS2` (women) and `FigureS1` (men); annual values with 95 % CIs from `Figure1`. District codes are harmonised to five digits.
- GISD: district level (`region_type == "Kreis"`) of `GISD_Bund.tsv`, release 2026-05-18, 1998–2023. Cards, strip, scatter plot and the table of all districts show the mean of the annual scores in the selected period; only the trend chart shows single years. Quintiles of the period means are formed like the official district quintiles: districts ranked by score, 80 per quintile (`gisdPeriod` in `app.js`). Applied to single years, this rule reproduces the official `gisd_5` classes except for a few pairs of districts whose rounded scores are tied (36 of 10,400 district-years).
- INKAR 2025 indicators (district level): `a_svw_akadem`, `a_svw_oAbschluss`, `a_schul_oA`, `q_svw`, `d_Bruttoverdienst`, `q_einkst_bev`, `d_Hausshaltseinkommen`, `q_Schuldner`; unemployment is computed like in the GISD code as `alo / ewf_1565_ges × 100`; population `xbev`. **Known issue:** the INKAR 2025 bulk file stores the 2023 *Schuldnerquote* 100 times too high (Germany 821.8 instead of 8.2 %); the build script divides values above 100 by 100 and logs it.
- INKAR table: every indicator, and the population, is the mean of the annual values in the selected period; years without data are skipped. `q_Schuldner` starts in 2004 (so 2003–2005 uses 2004–2005), `a_svw_akadem` and `a_svw_oAbschluss` start in 2012 (so they are empty for 2003–2005 and 2009–2011). Euro values are nominal. The averaging happens in the browser (`inkarYears`/`inkarMean` in `app.js`); `data.json` keeps the annual values.
- Map colour classes are equal intervals that stay fixed across periods for a given age and sex, so changes over time are visible. Differences shown on screen are computed from the rounded values, so the arithmetic on screen adds up.
- Settlement type: BBSR *Siedlungsstruktureller Kreistyp* 2023 (reference file shipped with INKAR 2025).

## Sources and citation

Please cite the original data when you use numbers or figures from the tool:

- Hoehn, A., & Mühlichen, M. (2026, March 21). *Do Welfare Regimes Matter? A Comparative Analysis of Area-Level Inequalities in Life Expectancy* [Data set]. OSF. https://doi.org/10.17605/OSF.IO/ZG5TJ (CC BY 4.0)
- Mühlichen, M., Höhn, A., Lomax, N., Meier, P., & Grigoriev, P. (2026). Do welfare regimes matter? A comparative analysis of area-level inequalities in life expectancy in Germany and the United Kingdom, 2003–2021. *Geographical Analysis, 58*(2), e70040. https://doi.org/10.1111/gean.70040
- Michalski, N., Soliman, L., Reis, M., Tetzlaff, F., Nowossadeck, E., & Hoebel, J. (2026). *German Index of Socioeconomic Deprivation (GISD)* [Data set, version 2026-05-18]. Zenodo. https://doi.org/10.5281/zenodo.18983808 (CC BY 4.0; GitHub release `2026-05-18`)
- Michalski, N., Reis, M., Tetzlaff, F., Herber, M., Kroll, L. E., Hövener, C., Nowossadeck, E., & Hoebel, J. (2022). German Index of Socioeconomic Deprivation (GISD): Revision, update and applications. *Journal of Health Monitoring, 7*(S5), 2–23. https://doi.org/10.25646/10641
- Laufende Raumbeobachtung des BBSR – INKAR, Ausgabe 07/2025. Hrsg.: Bundesinstitut für Bau-, Stadt- und Raumforschung (BBSR), Bonn. https://www.inkar.de/ (dl-de/by-2-0)
- © GeoBasis-DE / BKG (2025). Verwaltungsgebiete 1:250 000 mit Einwohnerzahlen (VG250-EW), Stand 31.12.2023. https://gdz.bkg.bund.de/ (dl-de/by-2-0)
- Address search: Nominatim, data © OpenStreetMap contributors (ODbL). Street-level imagery: Google Street View.

Software: D3.js and TopoJSON client (ISC licence), Source Serif 4 and Libre Franklin (SIL Open Font License 1.1); licence files are in `site/assets/vendor` and `site/assets/fonts`.
