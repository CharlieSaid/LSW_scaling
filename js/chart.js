/**
 * Scatter plot: X = in-universe dominant, Y = Lego dominant.
 * Category point/curve toggles + zoom/pan via chartjs-plugin-zoom.
 * Display units: imperial (in/ft), metric (cm/m), or studs (studs/m).
 * Optional 1:35–1:45 scale cone + live "Your model" calculator point.
 * Up to 5 named custom points: right-click chart to add, drag to move.
 */
(function (global) {
  "use strict";

  /** Fixed linear scales for the cone: y_in = x_ft * 12 / N */
  const CONE_RATIOS = [45, 35];
  const USER_COLOR = "#F6E05E";
  const USER_BORDER = "#D69E2E";
  const MAX_CUSTOM = 5;
  const CUSTOM_COLORS = [
    { fill: "#E53E3E", border: "#C53030", label: "#742A2A" },
    { fill: "#6B46C1", border: "#553C9A", label: "#44337A" },
    { fill: "#319795", border: "#2C7A7B", label: "#234E52" },
    { fill: "#D53F8C", border: "#B83280", label: "#702459" },
    { fill: "#5A67D8", border: "#4C51BF", label: "#3C366B" },
  ];

  let chart = null;
  let ships = [];
  let fits = {};
  let categories = [];
  let unitSystem = ShipData.UNIT_SYSTEMS.imperial;
  let coneVisible = false;
  /** @type {{ xFt: number, yIn: number, category?: string } | null} */
  let userModel = null;
  /** @type {{ id: string, name: string, xFt: number, yIn: number, colorIndex: number }[]} */
  let customPoints = [];
  let editingPopupId = null;
  let nextCustomId = 1;
  /** @type {{ id: string, moved: boolean } | null} */
  let dragState = null;
  const pointVisible = {};
  const curveVisible = {};
  const visibilityListeners = [];
  const customListeners = [];

  const conePlugin = {
    id: "scaleCone",
    beforeDatasetsDraw(ch) {
      if (!coneVisible) return;
      const { ctx, chartArea, scales } = ch;
      const xScale = scales.x;
      const yScale = scales.y;
      if (!chartArea || !xScale || !yScale) return;

      const xMin = xScale.min;
      const xMax = xScale.max;
      if (!(xMax > xMin)) return;

      const pts = CONE_RATIOS.map((ratio) => {
        const yAt = (xDisp) => {
          const xFt = unitSystem.fromUniverseDisplay(xDisp);
          const yIn = (xFt * 12) / ratio;
          return unitSystem.toLegoDisplay(yIn);
        };
        return {
          ratio,
          y0: yAt(xMin),
          y1: yAt(xMax),
        };
      });

      const lo = pts[0];
      const hi = pts[1];
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(xScale.getPixelForValue(xMin), yScale.getPixelForValue(lo.y0));
      ctx.lineTo(xScale.getPixelForValue(xMax), yScale.getPixelForValue(lo.y1));
      ctx.lineTo(xScale.getPixelForValue(xMax), yScale.getPixelForValue(hi.y1));
      ctx.lineTo(xScale.getPixelForValue(xMin), yScale.getPixelForValue(hi.y0));
      ctx.closePath();
      ctx.fillStyle = "rgba(43, 108, 176, 0.10)";
      ctx.fill();

      pts.forEach(({ ratio, y0, y1 }) => {
        ctx.beginPath();
        ctx.moveTo(xScale.getPixelForValue(xMin), yScale.getPixelForValue(y0));
        ctx.lineTo(xScale.getPixelForValue(xMax), yScale.getPixelForValue(y1));
        ctx.strokeStyle = "rgba(45, 55, 72, 0.55)";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([5, 4]);
        ctx.stroke();
        ctx.setLineDash([]);

        const lx = xScale.getPixelForValue(xMax) - 8;
        const ly = yScale.getPixelForValue(y1) - 6;
        ctx.fillStyle = "rgba(45, 55, 72, 0.75)";
        ctx.font = "600 11px Source Sans 3, Segoe UI, sans-serif";
        ctx.textAlign = "right";
        ctx.fillText(`1:${ratio}`, lx, ly);
      });
      ctx.restore();
    },
  };

  const pointLabelPlugin = {
    id: "pointLabels",
    afterDatasetsDraw(ch) {
      const { ctx } = ch;
      ctx.save();
      ctx.font = "700 12px Source Sans 3, Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.strokeStyle = "rgba(255,255,255,0.9)";
      ctx.lineWidth = 3;

      if (userModel) {
        const dsIndex = ch.data.datasets.findIndex((d) => d.kind === "user");
        if (dsIndex >= 0) {
          const meta = ch.getDatasetMeta(dsIndex);
          const el = meta.data?.[0];
          if (el && !meta.hidden) {
            ctx.fillStyle = "#744210";
            const tx = el.x + 10;
            const ty = el.y - 8;
            ctx.strokeText("Your model", tx, ty);
            ctx.fillText("Your model", tx, ty);
          }
        }
      }

      const customDs = ch.data.datasets.findIndex((d) => d.kind === "custom");
      if (customDs >= 0) {
        const meta = ch.getDatasetMeta(customDs);
        const ds = ch.data.datasets[customDs];
        (meta.data || []).forEach((el, i) => {
          if (!el || meta.hidden) return;
          const raw = ds.data[i];
          if (!raw) return;
          const palette = CUSTOM_COLORS[raw.colorIndex] || CUSTOM_COLORS[0];
          ctx.fillStyle = palette.label;
          const tx = el.x + 10;
          const ty = el.y - 8;
          ctx.strokeText(raw.name, tx, ty);
          ctx.fillText(raw.name, tx, ty);
        });
      }

      ctx.restore();
    },
  };

  function externalTooltipHandler(context) {
    const { chart: ch, tooltip } = context;
    let el = document.getElementById("chart-tooltip");
    if (!el) {
      el = document.createElement("div");
      el.id = "chart-tooltip";
      el.className = "chart-tooltip";
      document.body.appendChild(el);
    }

    if (editingPopupId || getCustomPopup()?.hidden === false || dragState) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      return;
    }

    if (tooltip.opacity === 0) {
      el.style.opacity = "0";
      el.style.pointerEvents = "none";
      return;
    }

    const dp = tooltip.dataPoints?.[0];
    if (!dp || (dp.dataset.kind !== "points" && dp.dataset.kind !== "user")) {
      el.style.opacity = "0";
      return;
    }

    const u = unitSystem;
    let html;

    if (dp.dataset.kind === "user") {
      const raw = dp.raw;
      html = `
        <strong>Your model</strong>
        <div class="tip-row"><span>Category</span><span>${escapeHtml(raw.category || "—")}</span></div>
        <div class="tip-row"><span>Lego (${u.legoLabel})</span><span>${fmtDim(raw.y)}</span></div>
        <div class="tip-row"><span>In-universe (${u.universeLabel})</span><span>${fmtDim(raw.x)}</span></div>
      `;
    } else {
      const ship = dp.raw.ship;
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

      html = `
        <strong>${escapeHtml(ship.name)}</strong>
        <div class="tip-row"><span>Category</span><span>${escapeHtml(ship.category)}</span></div>
        <div class="tip-row"><span>Lego (${u.legoLabel})</span><span>${fmtDim(legoDims[0])} × ${fmtDim(legoDims[1])} × ${fmtDim(legoDims[2])}</span></div>
        <div class="tip-row"><span>In-universe (${u.universeLabel})</span><span>${fmtDim(uniDims[0])} × ${fmtDim(uniDims[1])} × ${fmtDim(uniDims[2])}</span></div>
        <div class="tip-row"><span>Scale</span><span>${escapeHtml(ship.scale_label || "—")}</span></div>
        <div class="tip-link">${linkHtml}</div>
      `;
    }

    el.innerHTML = html;

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

  function dataXRangeFt() {
    const allX = ships.map((s) => s.movie_dominant_ft).filter(Number.isFinite);
    if (userModel && Number.isFinite(userModel.xFt)) allX.push(userModel.xFt);
    customPoints.forEach((p) => {
      if (Number.isFinite(p.xFt)) allX.push(p.xFt);
    });
    if (!allX.length) return { xMin: 0, xMax: 100 };
    return {
      xMin: Math.min(...allX) * 0.9,
      xMax: Math.max(...allX) * 1.05,
    };
  }

  function nextColorIndex() {
    const used = new Set(customPoints.map((p) => p.colorIndex));
    for (let i = 0; i < CUSTOM_COLORS.length; i++) {
      if (!used.has(i)) return i;
    }
    return customPoints.length % CUSTOM_COLORS.length;
  }

  function buildDatasets() {
    const { xMin, xMax } = dataXRangeFt();
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

    if (userModel && Number.isFinite(userModel.xFt) && Number.isFinite(userModel.yIn)) {
      datasets.push({
        label: "Your model",
        kind: "user",
        data: [
          {
            x: unitSystem.toUniverseDisplay(userModel.xFt),
            y: unitSystem.toLegoDisplay(userModel.yIn),
            category: userModel.category || "",
          },
        ],
        backgroundColor: USER_COLOR,
        borderColor: USER_BORDER,
        borderWidth: 2,
        pointRadius: 8,
        pointHoverRadius: 10,
        showLine: false,
        order: 0,
      });
    }

    if (customPoints.length) {
      datasets.push({
        label: "Custom",
        kind: "custom",
        data: customPoints.map((p) => ({
          x: unitSystem.toUniverseDisplay(p.xFt),
          y: unitSystem.toLegoDisplay(p.yIn),
          id: p.id,
          name: p.name,
          colorIndex: p.colorIndex,
        })),
        backgroundColor: customPoints.map(
          (p) => (CUSTOM_COLORS[p.colorIndex] || CUSTOM_COLORS[0]).fill
        ),
        borderColor: customPoints.map(
          (p) => (CUSTOM_COLORS[p.colorIndex] || CUSTOM_COLORS[0]).border
        ),
        borderWidth: 2,
        pointRadius: 8,
        pointHoverRadius: 10,
        pointStyle: "rectRot",
        showLine: false,
        order: 0,
      });
    }

    return datasets;
  }

  function notifyVisibility() {
    visibilityListeners.forEach((fn) => fn({ ...pointVisible }, { ...curveVisible }));
  }

  function notifyCustom() {
    const state = {
      count: customPoints.length,
      max: MAX_CUSTOM,
      points: customPoints.slice(),
    };
    customListeners.forEach((fn) => fn(state));
  }

  function getCustomPopup() {
    return document.getElementById("custom-point-popup");
  }

  function ensureCustomPopup() {
    let el = getCustomPopup();
    if (!el) {
      el = document.createElement("div");
      el.id = "custom-point-popup";
      el.className = "custom-point-popup";
      el.hidden = true;
      document.body.appendChild(el);
      el.addEventListener("click", (e) => e.stopPropagation());
      el.addEventListener("keydown", (e) => e.stopPropagation());
    }
    return el;
  }

  function hideCustomPopup() {
    const el = getCustomPopup();
    if (el) {
      el.hidden = true;
      el.innerHTML = "";
    }
    editingPopupId = null;
  }

  function positionPopupAtCanvas(el, canvasX, canvasY) {
    if (!chart) return;
    const canvasRect = chart.canvas.getBoundingClientRect();
    const left = canvasRect.left + window.scrollX + canvasX;
    const top = canvasRect.top + window.scrollY + canvasY;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
    el.style.transform = "translate(-50%, calc(-100% - 14px))";
  }

  function positionPopupNearPoint(el, pointId) {
    if (!chart) return;
    const dsIndex = chart.data.datasets.findIndex((d) => d.kind === "custom");
    if (dsIndex < 0) return;
    const ds = chart.data.datasets[dsIndex];
    const idx = ds.data.findIndex((d) => d.id === pointId);
    if (idx < 0) return;
    const meta = chart.getDatasetMeta(dsIndex);
    const pt = meta.data?.[idx];
    if (!pt) return;
    positionPopupAtCanvas(el, pt.x, pt.y);
  }

  function canvasCoordsFromEvent(e) {
    const rect = chart.canvas.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    };
  }

  function inChartArea(x, y) {
    const area = chart?.chartArea;
    if (!area) return false;
    return x >= area.left && x <= area.right && y >= area.top && y <= area.bottom;
  }

  function displayFromCanvas(x, y) {
    const xDisp = chart.scales.x.getValueForPixel(x);
    const yDisp = chart.scales.y.getValueForPixel(y);
    return { xDisp, yDisp };
  }

  function nativeFromCanvas(x, y) {
    const { xDisp, yDisp } = displayFromCanvas(x, y);
    if (!Number.isFinite(xDisp) || !Number.isFinite(yDisp)) return null;
    const xFt = unitSystem.fromUniverseDisplay(xDisp);
    const yIn = unitSystem.fromLegoDisplay(yDisp);
    if (!Number.isFinite(xFt) || !Number.isFinite(yIn)) return null;
    return { xFt, yIn, xDisp, yDisp };
  }

  function findCustomHit(elements) {
    const hit = (elements || []).find((el) => {
      const ds = chart.data.datasets[el.datasetIndex];
      return ds && ds.kind === "custom";
    });
    if (!hit) return null;
    const raw = chart.data.datasets[hit.datasetIndex].data[hit.index];
    return raw?.id ? { id: raw.id, element: hit } : null;
  }

  function renderCustomPopup(pointId, { editing = false } = {}) {
    const point = customPoints.find((p) => p.id === pointId);
    if (!point) {
      hideCustomPopup();
      return;
    }

    const el = ensureCustomPopup();
    editingPopupId = pointId;
    const u = unitSystem;
    const xDisp = unitSystem.toUniverseDisplay(point.xFt);
    const yDisp = unitSystem.toLegoDisplay(point.yIn);
    const palette = CUSTOM_COLORS[point.colorIndex] || CUSTOM_COLORS[0];

    if (editing) {
      el.innerHTML = `
        <form class="custom-point-edit" id="custom-point-edit-form">
          <label for="custom-point-edit-name">Name</label>
          <input id="custom-point-edit-name" type="text" maxlength="40" value="${escapeAttr(point.name)}" />
          <div class="tip-actions">
            <button type="submit" class="btn btn-tiny">Save</button>
            <button type="button" class="btn btn-tiny btn-ghost" data-action="cancel-edit">Cancel</button>
          </div>
        </form>
      `;
      const form = el.querySelector("#custom-point-edit-form");
      const input = el.querySelector("#custom-point-edit-name");
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const name = input.value.trim() || point.name;
        renameCustomPoint(pointId, name);
        renderCustomPopup(pointId, { editing: false });
      });
      el.querySelector("[data-action='cancel-edit']").addEventListener("click", () => {
        renderCustomPopup(pointId, { editing: false });
      });
      positionPopupNearPoint(el, pointId);
      el.hidden = false;
      input.focus();
      input.select();
      return;
    }

    el.innerHTML = `
      <div class="custom-point-popup-head">
        <span class="custom-swatch" style="background:${palette.fill};border-color:${palette.border}"></span>
        <strong>${escapeHtml(point.name)}</strong>
      </div>
      <div class="tip-row"><span>Lego (${u.legoLabel})</span><span>${fmtDim(yDisp)}</span></div>
      <div class="tip-row"><span>In-universe (${u.universeLabel})</span><span>${fmtDim(xDisp)}</span></div>
      <p class="popup-hint">Drag the point to move it</p>
      <div class="tip-actions">
        <button type="button" class="btn btn-tiny btn-ghost" data-action="edit">Edit name</button>
        <button type="button" class="btn btn-tiny btn-danger" data-action="delete">Delete</button>
      </div>
    `;
    el.querySelector("[data-action='edit']").addEventListener("click", () => {
      renderCustomPopup(pointId, { editing: true });
    });
    el.querySelector("[data-action='delete']").addEventListener("click", () => {
      removeCustomPoint(pointId);
    });
    positionPopupNearPoint(el, pointId);
    el.hidden = false;
  }

  function showAddPointMenu(canvasX, canvasY) {
    const native = nativeFromCanvas(canvasX, canvasY);
    if (!native || !(native.xFt > 0) || !(native.yIn > 0)) return;

    const tip = document.getElementById("chart-tooltip");
    if (tip) {
      tip.style.opacity = "0";
      tip.style.pointerEvents = "none";
    }

    const el = ensureCustomPopup();
    editingPopupId = null;
    const u = unitSystem;
    const atMax = customPoints.length >= MAX_CUSTOM;

    if (atMax) {
      el.innerHTML = `
        <strong>Point limit reached</strong>
        <p class="popup-hint">You can add up to ${MAX_CUSTOM} custom points. Delete one to add another.</p>
        <div class="tip-actions">
          <button type="button" class="btn btn-tiny btn-ghost" data-action="dismiss">Close</button>
        </div>
      `;
      el.querySelector("[data-action='dismiss']").addEventListener("click", hideCustomPopup);
    } else {
      el.innerHTML = `
        <strong>Add custom point</strong>
        <div class="tip-row"><span>Lego (${u.legoLabel})</span><span>${fmtDim(native.yDisp)}</span></div>
        <div class="tip-row"><span>In-universe (${u.universeLabel})</span><span>${fmtDim(native.xDisp)}</span></div>
        <div class="tip-actions">
          <button type="button" class="btn btn-tiny" data-action="add">Add point here</button>
          <button type="button" class="btn btn-tiny btn-ghost" data-action="dismiss">Cancel</button>
        </div>
      `;
      el.querySelector("[data-action='add']").addEventListener("click", () => {
        createCustomAt(native.xFt, native.yIn);
      });
      el.querySelector("[data-action='dismiss']").addEventListener("click", hideCustomPopup);
    }

    positionPopupAtCanvas(el, canvasX, canvasY);
    el.hidden = false;
  }

  function ensureNameDialog() {
    let dlg = document.getElementById("custom-point-dialog");
    if (dlg) return dlg;

    dlg = document.createElement("dialog");
    dlg.id = "custom-point-dialog";
    dlg.className = "custom-point-dialog";
    dlg.innerHTML = `
      <form method="dialog" id="custom-point-dialog-form">
        <h3>Name this point</h3>
        <p class="muted">Up to ${MAX_CUSTOM} custom points on the chart.</p>
        <label for="custom-point-name-input">Name</label>
        <input id="custom-point-name-input" type="text" maxlength="40" required placeholder="e.g. My UCS build" />
        <div class="tip-actions">
          <button type="submit" class="btn btn-tiny" value="ok">Add point</button>
          <button type="submit" class="btn btn-tiny btn-ghost" value="cancel" formnovalidate>Cancel</button>
        </div>
      </form>
    `;
    document.body.appendChild(dlg);
    return dlg;
  }

  function promptForName(defaultName) {
    const dlg = ensureNameDialog();
    const input = dlg.querySelector("#custom-point-name-input");
    input.value = defaultName || "";

    return new Promise((resolve) => {
      function onClose() {
        dlg.removeEventListener("close", onClose);
        if (dlg.returnValue === "ok") {
          resolve(input.value.trim() || defaultName || "Custom point");
        } else {
          resolve(null);
        }
      }
      dlg.addEventListener("close", onClose);
      dlg.querySelector('button[value="cancel"]').addEventListener(
        "click",
        () => {
          dlg.returnValue = "cancel";
        },
        { once: true }
      );
      if (typeof dlg.showModal === "function") {
        dlg.showModal();
      } else {
        const name = window.prompt("Name this point", defaultName || "");
        resolve(name && name.trim() ? name.trim() : null);
        return;
      }
      input.focus();
      input.select();
    });
  }

  function setPanEnabled(enabled) {
    if (!chart?.options?.plugins?.zoom?.pan) return;
    chart.options.plugins.zoom.pan.enabled = enabled;
  }

  async function createCustomAt(xFt, yIn) {
    if (customPoints.length >= MAX_CUSTOM) return;
    hideCustomPopup();
    const defaultName = `Point ${customPoints.length + 1}`;
    const name = await promptForName(defaultName);
    if (!name) return;

    const point = {
      id: `custom-${nextCustomId++}`,
      name,
      xFt,
      yIn,
      colorIndex: nextColorIndex(),
    };
    customPoints.push(point);
    refresh();
    notifyCustom();
    renderCustomPopup(point.id);
  }

  function moveCustomPoint(id, xFt, yIn) {
    const point = customPoints.find((p) => p.id === id);
    if (!point) return;
    if (!(xFt > 0) || !(yIn > 0)) return;
    point.xFt = xFt;
    point.yIn = yIn;
    refresh();
  }

  function renameCustomPoint(id, name) {
    const point = customPoints.find((p) => p.id === id);
    if (!point) return;
    const trimmed = String(name || "").trim();
    if (!trimmed) return;
    point.name = trimmed;
    refresh();
    notifyCustom();
  }

  function removeCustomPoint(id) {
    const before = customPoints.length;
    customPoints = customPoints.filter((p) => p.id !== id);
    if (customPoints.length === before) return;
    if (editingPopupId === id) hideCustomPopup();
    refresh();
    notifyCustom();
  }

  function onPointerDown(e) {
    if (!chart || e.button !== 0) return;
    const { x, y } = canvasCoordsFromEvent(e);

    const elements = chart.getElementsAtEventForMode(
      e,
      "nearest",
      { intersect: true },
      false
    );
    const customHit = findCustomHit(elements);

    if (customHit) {
      e.preventDefault();
      hideCustomPopup();
      setPanEnabled(false);
      dragState = { id: customHit.id, moved: false };
      chart.canvas.classList.add("is-dragging-custom");
      try {
        chart.canvas.setPointerCapture(e.pointerId);
      } catch (_) {
        /* ignore */
      }
    }
  }

  function onPointerMove(e) {
    if (!chart || !dragState) return;

    const { x, y } = canvasCoordsFromEvent(e);
    if (!inChartArea(x, y)) return;
    const native = nativeFromCanvas(x, y);
    if (!native || !(native.xFt > 0) || !(native.yIn > 0)) return;
    dragState.moved = true;
    moveCustomPoint(dragState.id, native.xFt, native.yIn);
  }

  function onPointerUp(e) {
    if (!chart || !dragState) return;

    const id = dragState.id;
    const moved = dragState.moved;
    dragState = null;
    chart.canvas.classList.remove("is-dragging-custom");
    setPanEnabled(true);
    try {
      chart.canvas.releasePointerCapture(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    renderCustomPopup(id);
    if (moved) notifyCustom();
  }

  function onPointerCancel() {
    if (dragState) {
      dragState = null;
      chart?.canvas.classList.remove("is-dragging-custom");
      setPanEnabled(true);
    }
  }

  function onContextMenu(e) {
    if (!chart) return;
    // Always suppress the browser menu over the plot
    e.preventDefault();
    e.stopPropagation();

    const { x, y } = canvasCoordsFromEvent(e);
    if (!inChartArea(x, y)) return;

    let customHit = null;
    try {
      const elements = chart.getElementsAtEventForMode(
        e,
        "nearest",
        { intersect: true },
        false
      );
      customHit = findCustomHit(elements);
    } catch (_) {
      /* native contextmenu events are fine; hit-test is best-effort */
    }

    if (customHit) {
      renderCustomPopup(customHit.id);
      return;
    }

    showAddPointMenu(x, y);
  }

  let pluginsRegistered = false;
  let outsideClickBound = false;
  /** @type {AbortController | null} */
  let pointerAbort = null;

  function bindPointerHandlers(canvas) {
    if (pointerAbort) pointerAbort.abort();
    pointerAbort = new AbortController();
    const { signal } = pointerAbort;
    const opts = { signal };

    canvas.addEventListener("pointerdown", onPointerDown, opts);
    canvas.addEventListener("pointermove", onPointerMove, opts);
    canvas.addEventListener("pointerup", onPointerUp, opts);
    canvas.addEventListener("pointercancel", onPointerCancel, opts);
    // Capture phase so we beat other listeners / plugins
    canvas.addEventListener("contextmenu", onContextMenu, { capture: true, signal });

    const wrap = canvas.closest(".chart-wrap") || canvas.parentElement;
    if (wrap && wrap !== canvas) {
      wrap.addEventListener("contextmenu", onContextMenu, { capture: true, signal });
    }
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

    if (!pluginsRegistered) {
      Chart.register(conePlugin, pointLabelPlugin);
      pluginsRegistered = true;
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
            filter: (item) =>
              item.dataset.kind === "points" || item.dataset.kind === "user",
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
          if (dragState) {
            evt.native.target.style.cursor = "grabbing";
            return;
          }
          const overCustom = elements.some((el) => {
            const ds = chart.data.datasets[el.datasetIndex];
            return ds && ds.kind === "custom";
          });
          if (overCustom) {
            evt.native.target.style.cursor = "grab";
            return;
          }
          evt.native.target.style.cursor = elements.length ? "pointer" : "crosshair";
        },
      },
    });

    // Bind after Chart init so we attach to the live canvas Chart uses
    bindPointerHandlers(chart.canvas);

    if (!outsideClickBound) {
      document.addEventListener("click", (e) => {
        const tip = document.getElementById("chart-tooltip");
        if (tip && !tip.contains(e.target) && !canvas.contains(e.target)) {
          tip.style.opacity = "0";
          tip.style.pointerEvents = "none";
        }
        const popup = getCustomPopup();
        const dlg = document.getElementById("custom-point-dialog");
        if (
          popup &&
          !popup.hidden &&
          !popup.contains(e.target) &&
          !canvas.contains(e.target) &&
          !(dlg && dlg.contains(e.target))
        ) {
          hideCustomPopup();
        }
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
          if (getCustomPopup() && !getCustomPopup().hidden) {
            hideCustomPopup();
          }
        }
      });
      outsideClickBound = true;
    }

    return chart;
  }

  function refresh() {
    if (!chart) return;
    const titles = axisTitles();
    chart.options.scales.x.title.text = titles.x;
    chart.options.scales.y.title.text = titles.y;
    chart.data.datasets = buildDatasets();
    chart.update("none");
    if (editingPopupId && getCustomPopup() && !getCustomPopup().hidden) {
      positionPopupNearPoint(getCustomPopup(), editingPopupId);
    }
  }

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

  function setConeVisible(visible) {
    coneVisible = !!visible;
    refresh();
  }

  function setUserModel(model) {
    userModel =
      model && Number.isFinite(model.xFt) && Number.isFinite(model.yIn)
        ? {
            xFt: model.xFt,
            yIn: model.yIn,
            category: model.category || "",
          }
        : null;
    refresh();
  }

  function setUnitSystem(id) {
    unitSystem = ShipData.UNIT_SYSTEMS[id] || ShipData.UNIT_SYSTEMS.imperial;
    if (chart) {
      chart.resetZoom();
      refresh();
    }
    if (editingPopupId && getCustomPopup() && !getCustomPopup().hidden) {
      renderCustomPopup(editingPopupId, { editing: false });
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

  function onCustomPointsChange(fn) {
    customListeners.push(fn);
    fn({
      count: customPoints.length,
      max: MAX_CUSTOM,
      points: customPoints.slice(),
    });
  }

  function getCustomPointsState() {
    return {
      count: customPoints.length,
      max: MAX_CUSTOM,
      points: customPoints.slice(),
    };
  }

  global.ScaleChart = {
    init,
    refresh,
    setPointVisible,
    setCurveVisible,
    setConeVisible,
    setUserModel,
    setUnitSystem,
    getUnitSystem,
    resetZoom,
    getFits,
    getCategories,
    onVisibilityChange,
    onCustomPointsChange,
    getCustomPointsState,
    renameCustomPoint,
    removeCustomPoint,
    pointVisible,
    curveVisible,
  };
})(window);
