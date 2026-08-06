/**
 * Scale Calculator — converts L/W/H via the selected category's fitted curve.
 * Fits are in imperial (ft↔in); display units follow the plot unit system.
 */
(function (global) {
  "use strict";

  let fits = {};
  let form = null;
  let unitSystem = ShipData.UNIT_SYSTEMS.imperial;
  let formulaVisible = false;
  let direction = "universe-to-lego";

  function init(formEl, fitMap) {
    form = formEl;
    fits = fitMap;
    populateCategories();
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      convert();
    });
    form.querySelector("#calc-category")?.addEventListener("change", () => {
      updateFormulaText();
    });

    form.querySelectorAll("[data-direction]").forEach((btn) => {
      btn.addEventListener("click", () => {
        direction = btn.getAttribute("data-direction");
        syncDirectionUi();
        syncLabels();
      });
    });

    form.querySelector("#btn-toggle-formula")?.addEventListener("click", () => {
      formulaVisible = !formulaVisible;
      syncFormulaUi();
    });

    syncDirectionUi();
    syncLabels();
    syncFormulaUi();
    updateFormulaText();
  }

  function setFits(fitMap) {
    fits = fitMap;
    populateCategories();
    updateFormulaText();
  }

  function setUnitSystem(sys) {
    unitSystem = sys || ShipData.UNIT_SYSTEMS.imperial;
    syncLabels();
    updateFormulaText();
    const out = form?.querySelector("#calc-result-body");
    if (out) out.innerHTML = "";
  }

  function populateCategories() {
    const select = form.querySelector("#calc-category");
    if (!select) return;
    const prev = select.value;
    const cats = Object.keys(fits).sort((a, b) => {
      const oa = ShipData.CATEGORY_META[a]?.order ?? 99;
      const ob = ShipData.CATEGORY_META[b]?.order ?? 99;
      return oa - ob || a.localeCompare(b);
    });
    select.innerHTML = cats
      .map((c) => `<option value="${c}">${c}</option>`)
      .join("");
    if (cats.includes(prev)) select.value = prev;
  }

  function syncDirectionUi() {
    form.querySelectorAll("[data-direction]").forEach((btn) => {
      const active = btn.getAttribute("data-direction") === direction;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-pressed", active ? "true" : "false");
    });
  }

  function syncLabels() {
    const toUniverse = direction === "lego-to-universe";
    const inUnit = toUniverse ? unitSystem.legoLabel : unitSystem.universeLabel;
    const outHeading = toUniverse
      ? `In-universe (${unitSystem.universeLabel})`
      : `Lego (${unitSystem.legoLabel})`;
    const prefix = toUniverse ? "Lego" : "In-universe";

    form.querySelector("#label-l").textContent = `Length (${prefix} ${inUnit})`;
    form.querySelector("#label-w").textContent = `Width (${prefix} ${inUnit})`;
    form.querySelector("#label-h").textContent = `Height (${prefix} ${inUnit})`;
    form.querySelector("#result-unit").textContent = outHeading;

    const intro = document.getElementById("calc-intro");
    if (intro) {
      intro.textContent = `Convert dimensions using the fitted curve for a scale category (not a fixed ratio). In-universe: ${unitSystem.universeLabel}; Lego: ${unitSystem.legoLabel}.`;
    }
  }

  function syncFormulaUi() {
    const btn = form.querySelector("#btn-toggle-formula");
    const panel = form.querySelector("#calc-formula");
    if (!btn || !panel) return;
    btn.textContent = formulaVisible ? "Hide curve function" : "Show curve function";
    panel.hidden = !formulaVisible;
  }

  function updateFormulaText() {
    const cat = form.querySelector("#calc-category").value;
    const fit = fits[cat];
    const el = form.querySelector("#calc-formula");
    if (!el) return;
    if (!fit || fit.params.n < 2) {
      el.textContent = "Not enough data for a fit in this category.";
      return;
    }
    const r2 = Number.isFinite(fit.params.r2) ? fit.params.r2.toFixed(3) : "—";
    // Formula is always in native fit units (Lego in, in-universe ft).
    el.textContent = `${fit.formula}  (R² = ${r2}; y = Lego in, x = in-universe ft)`;
  }

  function readDims() {
    const l = parseFloat(form.querySelector("#calc-l").value);
    const w = parseFloat(form.querySelector("#calc-w").value);
    const h = parseFloat(form.querySelector("#calc-h").value);
    return { l, w, h };
  }

  function convertOne(displayValue, dir, fit) {
    if (!Number.isFinite(displayValue) || displayValue <= 0) return null;
    let nativeIn;
    let nativeOut;
    if (dir === "lego-to-universe") {
      nativeIn = unitSystem.fromLegoDisplay(displayValue);
      nativeOut = fit.inverse(nativeIn);
      if (!Number.isFinite(nativeOut)) return null;
      return unitSystem.toUniverseDisplay(nativeOut);
    }
    nativeIn = unitSystem.fromUniverseDisplay(displayValue);
    nativeOut = fit.predict(nativeIn);
    if (!Number.isFinite(nativeOut)) return null;
    return unitSystem.toLegoDisplay(nativeOut);
  }

  function convert() {
    const cat = form.querySelector("#calc-category").value;
    const fit = fits[cat];
    const out = form.querySelector("#calc-result-body");
    if (!out) return;
    if (!fit || fit.params.n < 2) {
      out.innerHTML = `<p class="calc-error">No valid curve for ${cat}.</p>`;
      return;
    }
    const { l, w, h } = readDims();
    const rl = convertOne(l, direction, fit);
    const rw = convertOne(w, direction, fit);
    const rh = convertOne(h, direction, fit);

    if (rl == null && rw == null && rh == null) {
      out.innerHTML = `<p class="calc-error">Enter at least one positive dimension.</p>`;
      return;
    }

    const unit =
      direction === "lego-to-universe"
        ? unitSystem.universeLabel
        : unitSystem.legoLabel;
    out.innerHTML = `
      <ul class="calc-dims">
        <li><span>Length</span><strong>${fmt(rl)} ${unit}</strong></li>
        <li><span>Width</span><strong>${fmt(rw)} ${unit}</strong></li>
        <li><span>Height</span><strong>${fmt(rh)} ${unit}</strong></li>
      </ul>
    `;
  }

  function fmt(n) {
    if (n == null) return "—";
    return Number(n.toPrecision(4)).toString();
  }

  global.ScaleCalculator = { init, setFits, setUnitSystem, convert };
})(window);
