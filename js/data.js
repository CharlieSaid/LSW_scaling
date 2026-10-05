/**
 * Load ship rows from data/ships.csv.
 * Native units: X = movie_dominant_ft (in-universe), Y = lego_dominant_in.
 */
(function (global) {
  "use strict";

  const CATEGORY_META = {
    UCS: { color: "#2B6CB0", order: 0 },
    Playscale: { color: "#DD6B20", order: 1 },
    BAUFman: { color: "#2F855A", order: 2 },
  };

  /** Official LEGO horizontal module (stud pitch), in millimetres. */
  const STUD_MM = 8;
  const MM_PER_INCH = 25.4;

  /** Plot/calculator display units. Data + fits always use imperial (in/ft). */
  const UNIT_SYSTEMS = {
    imperial: {
      id: "imperial",
      legoLabel: "in",
      universeLabel: "ft",
      toLegoDisplay: (inches) => inches,
      toUniverseDisplay: (feet) => feet,
      fromLegoDisplay: (v) => v,
      fromUniverseDisplay: (v) => v,
    },
    metric: {
      id: "metric",
      legoLabel: "cm",
      universeLabel: "m",
      toLegoDisplay: (inches) => inches * 2.54,
      toUniverseDisplay: (feet) => feet * 0.3048,
      fromLegoDisplay: (cm) => cm / 2.54,
      fromUniverseDisplay: (m) => m / 0.3048,
    },
    studs: {
      id: "studs",
      legoLabel: "studs",
      universeLabel: "m",
      toLegoDisplay: (inches) => (inches * MM_PER_INCH) / STUD_MM,
      toUniverseDisplay: (feet) => feet * 0.3048,
      fromLegoDisplay: (studs) => (studs * STUD_MM) / MM_PER_INCH,
      fromUniverseDisplay: (m) => m / 0.3048,
    },
  };

  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]);
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cells = splitCsvLine(lines[i]);
      const obj = {};
      headers.forEach((h, idx) => {
        obj[h] = cells[idx] !== undefined ? cells[idx] : "";
      });
      rows.push(normalizeRow(obj));
    }
    return rows;
  }

  function splitCsvLine(line) {
    const out = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out;
  }

  function num(v) {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  }

  function normalizeRow(raw) {
    return {
      name: raw.name || "",
      category: raw.category || "",
      lego_length_in: num(raw.lego_length_in),
      lego_width_in: num(raw.lego_width_in),
      lego_height_in: num(raw.lego_height_in),
      movie_length_ft: num(raw.movie_length_ft),
      movie_width_ft: num(raw.movie_width_ft),
      movie_height_ft: num(raw.movie_height_ft),
      lego_dominant_in: num(raw.lego_dominant_in),
      movie_dominant_ft: num(raw.movie_dominant_ft),
      scale_ratio: num(raw.scale_ratio),
      scale_label: raw.scale_label || "",
      url: (raw.url || "").trim(),
    };
  }

  function categoriesInData(ships) {
    const seen = new Set();
    ships.forEach((s) => seen.add(s.category));
    return Array.from(seen).sort((a, b) => {
      const oa = CATEGORY_META[a]?.order ?? 99;
      const ob = CATEGORY_META[b]?.order ?? 99;
      if (oa !== ob) return oa - ob;
      return a.localeCompare(b);
    });
  }

  function colorFor(category) {
    return CATEGORY_META[category]?.color || "#4A5568";
  }

  async function loadShips(url) {
    const res = await fetch(url || "data/ships.csv");
    if (!res.ok) throw new Error(`Failed to load data: ${res.status}`);
    const text = await res.text();
    return parseCsv(text);
  }

  function fitAllCategories(ships, fitterName) {
    const cats = categoriesInData(ships);
    const fits = {};
    cats.forEach((cat) => {
      const subset = ships.filter((s) => s.category === cat);
      const xs = subset.map((s) => s.movie_dominant_ft);
      const ys = subset.map((s) => s.lego_dominant_in);
      fits[cat] = CurveFit.fitCategory(xs, ys, fitterName);
    });
    return fits;
  }

  global.ShipData = {
    CATEGORY_META,
    UNIT_SYSTEMS,
    loadShips,
    parseCsv,
    categoriesInData,
    colorFor,
    fitAllCategories,
  };
})(window);
