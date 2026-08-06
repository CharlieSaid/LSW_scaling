/**
 * Scatter plot: X = in-universe dominant, Y = Lego dominant.
 * Category point/curve toggles + zoom/pan via chartjs-plugin-zoom.
 * Display units: imperial (in/ft) or metric (cm/m).
 */
(function (global) {
  "use strict";

  let chart = null;
  let ships = [];
  let fits = {};
  let categories = [];
  let unitSystem = ShipData.UNIT_SYSTEMS.imperial;
  const pointVisible = {};
  const curveVisible = {};
  const visibilityListeners = [];

  function externalTooltipHandler(context) {
    const { chart: ch, tooltip } = context;
    let el = document.getElementById("chart-tooltip");
    if (!el) {
      el = document.createElement("div");
      el.id = "chart-tooltip";
      el.className = "chart-tooltip";
      document.body.appendChild(el);
    }

    if (tooltip.opacity === 0) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      return;
    }

    const dp = tooltip.dataPoints?.[0];
    if (!dp || dp.dataset.kind !== "points") {
      el.style.opacity = "0";
      return;
    }

    const ship = dp.raw.ship;
    const u = unitSystem;
    const linkHtml = ship.url
      ? `<a href="${escapeAttr(ship.url)}" target="_blank" rel="noopener noreferrer">View set</a>`
      : `<span class="link-placeholder">Link coming soon</span>`;

    const legoDims = [
      u.toLegoDisplay(ship.lego_length_in),
      u.toLegoDisplay(ship.lego_width_in),
      u.toLegoDisplay(ship.lego_height_in),
    ];
    const uniDims = [
      u.toUniverseDisplay(ship.movie_length_ft),
      u.toUniverseDisplay(ship.movie_width_ft),
      u.toUniverseDisplay(ship.movie_height_ft),
    ];

    el.innerHTML = `
      <strong>${escapeHtml(ship.name)}</strong>
      <div class="tip-row"><span>Category</span><span>${escapeHtml(ship.category)}</span></div>
      <div class="tip-row"><span>Lego (${u.legoLabel})</span><span>${fmtDim(legoDims[0])} × ${fmtDim(legoDims[1])} × ${fmtDim(legoDims[2])}</span></div>
      <div class="tip-row"><span>In-universe (${u.universeLabel})</span><span>${fmtDim(uniDims[0])} × ${fmtDim(uniDims[1])} × ${fmtDim(uniDims[2])}</span></div>
      <div class="tip-row"><span>Scale</span><span>${escapeHtml(ship.scale_label || "—")}</span></div>
      <div class="tip-link">${linkHtml}</div>
    `;

    const canvasRect = ch.canvas.getBoundingClientRect();
    const left = canvasRect.left + window.scrollX + tooltip.caretX;
    const top = canvasRect.top + window.scrollY + tooltip.caretY;
    el.style.opacity = "1";
    el.style.pointerEvents = "auto";
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transform = "translate(-50%, calc(-100% - 12px))";
  }

  function fmtDim(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    return Number(n.toPrecision(4)).toString();
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function curvePoints(fit, xMinFt, xMaxFt, samples) {
    if (!fit) return [];
    const pts = [];
    const n = samples || 60;
    const useLog = fit.label === "power-law";
    const xLo = Math.max(xMinFt, 1e-6);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const xFt = useLog
        ? Math.exp(Math.log(xLo) * (1 - t) + Math.log(xMaxFt) * t)
        : xMinFt * (1 - t) + xMaxFt * t;
      const yIn = fit.predict(xFt);
      if (Number.isFinite(yIn)) {
        pts.push({
          x: unitSystem.toUniverseDisplay(xFt),
          y: unitSystem.toLegoDisplay(yIn),
        });
      }
    }
    return pts;
  }

  function axisTitles() {
    return {
      x: `In-universe (${unitSystem.universeLabel})`,
      y: `Lego (${unitSystem.legoLabel})`,
    };
  }

  function buildDatasets() {
    const allX = ships.map((s) => s.movie_dominant_ft).filter(Number.isFinite);
    const xMin = Math.min(...allX) * 0.9;
    const xMax = Math.max(...allX) * 1.05;
    const datasets = [];

    categories.forEach((cat) => {
      const color = ShipData.colorFor(cat);
      const subset = ships.filter((s) => s.category === cat);

      datasets.push({
        label: cat,
        kind: "points",
        category: cat,
        data: subset.map((s) => ({
          x: unitSystem.toUniverseDisplay(s.movie_dominant_ft),
          y: unitSystem.toLegoDisplay(s.lego_dominant_in),
          ship: s,
        })),
        backgroundColor: color,
        borderColor: color,
        pointRadius: 5,
        pointHoverRadius: 7,
        showLine: false,
        hidden: pointVisible[cat] === false,
      });

      const fit = fits[cat];
      if (fit && fit.params.n >= 2) {
        datasets.push({
          label: `${cat} fit`,
          kind: "curve",
          category: cat,
          data: curvePoints(fit, xMin, xMax),
          borderColor: color,
          backgroundColor: "transparent",
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          pointHoverRadius: 0,
          showLine: true,
          tension: 0,
          hidden: curveVisible[cat] === false || pointVisible[cat] === false,
          order: 10,
        });
      }
    });

    return datasets;
  }

  function notifyVisibility() {
    visibilityListeners.forEach((fn) => fn({ ...pointVisible }, { ...curveVisible }));
  }

  function init(canvas, shipList, fitMap) {
    ships = shipList;
    fits = fitMap;
    categories = ShipData.categoriesInData(ships);
    categories.forEach((c) => {
      if (pointVisible[c] === undefined) pointVisible[c] = true;
      if (curveVisible[c] === undefined) curveVisible[c] = true;
    });

    if (chart) {
      chart.destroy();
      chart = null;
    }

    const titles = axisTitles();
    const ctx = canvas.getContext("2d");
    chart = new Chart(ctx, {
      type: "scatter",
      data: { datasets: buildDatasets() },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        animation: false,
        scales: {
          x: {
            type: "linear",
            title: {
              display: true,
              text: titles.x,
              color: "#2B6CB0",
              font: { size: 13, weight: "600" },
            },
            grid: { color: "rgba(43, 108, 176, 0.12)" },
            ticks: { color: "#4A5568" },
          },
          y: {
            type: "linear",
            title: {
              display: true,
              text: titles.y,
              color: "#2B6CB0",
              font: { size: 13, weight: "600" },
            },
            grid: { color: "rgba(43, 108, 176, 0.12)" },
            ticks: { color: "#4A5568" },
          },
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            enabled: false,
            external: externalTooltipHandler,
            filter: (item) => item.dataset.kind === "points",
          },
          zoom: {
            pan: { enabled: true, mode: "xy", modifierKey: null },
            zoom: {
              wheel: { enabled: true },
              pinch: { enabled: true },
              mode: "xy",
            },
            limits: {
              x: { min: "original", max: "original" },
              y: { min: "original", max: "original" },
            },
          },
        },
        onHover(evt, elements) {
          evt.native.target.style.cursor = elements.length ? "pointer" : "crosshair";
        },
      },
    });

    document.addEventListener("click", (e) => {
      const tip = document.getElementById("chart-tooltip");
      if (!tip) return;
      if (tip.contains(e.target)) return;
      if (canvas.contains(e.target)) return;
      tip.style.opacity = "0";
      tip.style.pointerEvents = "none";
    });

    return chart;
  }

  function refresh() {
    if (!chart) return;
    const titles = axisTitles();
    chart.options.scales.x.title.text = titles.x;
    chart.options.scales.y.title.text = titles.y;
    chart.data.datasets = buildDatasets();
    chart.update("none");
  }

  /**
   * Points off → curve off (no curve without points).
   * Curve off → points off (per product rule).
   * Curve on → points on.
   */
  function setPointVisible(cat, visible) {
    pointVisible[cat] = visible;
    if (!visible) curveVisible[cat] = false;
    refresh();
    notifyVisibility();
  }

  function setCurveVisible(cat, visible) {
    curveVisible[cat] = visible;
    if (visible) {
      pointVisible[cat] = true;
    } else {
      pointVisible[cat] = false;
    }
    refresh();
    notifyVisibility();
  }

  function setUnitSystem(id) {
    unitSystem = ShipData.UNIT_SYSTEMS[id] || ShipData.UNIT_SYSTEMS.imperial;
    if (chart) {
      chart.resetZoom();
      refresh();
    }
    return unitSystem;
  }

  function getUnitSystem() {
    return unitSystem;
  }

  function resetZoom() {
    if (chart) chart.resetZoom();
  }

  function getFits() {
    return fits;
  }

  function getCategories() {
    return categories;
  }

  function onVisibilityChange(fn) {
    visibilityListeners.push(fn);
  }

  global.ScaleChart = {
    init,
    refresh,
    setPointVisible,
    setCurveVisible,
    setUnitSystem,
    getUnitSystem,
    resetZoom,
    getFits,
    getCategories,
    onVisibilityChange,
    pointVisible,
    curveVisible,
  };
})(window);
