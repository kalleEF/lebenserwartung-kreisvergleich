/*
 * Settings for the life expectancy comparison tool.
 * Edit this file on the server; no build step is needed.
 */
window.LE_CONFIG = {
  /*
   * Google Maps Embed API key for the Street View pictures.
   * Without a key, the tool shows a link to Google Street View and a small locator map instead
   * of the picture. How to create a key: see README.md ("Street View einrichten").
   * Restrict the key to your domain (HTTP referrer) in the Google Cloud console.
   */
  googleMapsEmbedApiKey: "",

  /*
   * Address search (geocoding) for full street addresses.
   * Default: OpenStreetMap Nominatim. Its usage policy allows at most one request per second
   * and no search-as-you-type; this tool only sends a request when someone submits an address.
   * https://operations.osmfoundation.org/policies/nominatim/
   * Set geocoderUrl to "" to switch online address search off. Place names, postcodes, districts,
   * coordinates and Plus Codes still work, because they are resolved locally.
   */
  geocoderUrl: "https://nominatim.openstreetmap.org/search",
  /* Optional contact e-mail sent with each geocoding request (recommended by the Nominatim policy). */
  geocoderEmail: "",

  /* Language shown first: "de" or "en". Visitors can switch in the header. */
  defaultLanguage: "de",

  /* Optional credit line in the footer, for example "Lehrstuhl für …, Universität …". */
  credit: "",

  /* Links to your legal notice (Impressum) and privacy policy (Datenschutzerklärung).
     Public websites in Germany usually need both. Leave empty to hide the links. */
  imprintUrl: "",
  privacyUrl: "",

  /*
   * Comparison shown when the page is opened without a selection in the link.
   * Values are municipality keys (AGS, 8 digits) from data/places.json or district keys (5 digits).
   * Default: Stadt Starnberg (highest life expectancy at birth 2020–2021) and Gelsenkirchen
   * (highest GISD deprivation score 2023).
   */
  example: { a: "09188139", b: "05513000" }
};
