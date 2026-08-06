/**
 * App bootstrap: load data, fit curves, wire UI.
 */
(function () {
  "use strict";

  const pointInputs = {};
  const curveInputs = {};

  async function main() {
    wireInfoMenu();
    wireUnitToggle();

    try {
      const ships = await ShipData.loadShips("data/ships.csv");
      const fits = ShipData.fitAllCategories(ships);

      const canvas = document.getElementById("scale-chart");
      ScaleChart.init(canvas, ships, fits);
      buildToggles(ShipData.categoriesInData(ships));

      ScaleCalculator.init(document.getElementById("scale-calculator"), fits);
      ScaleCalculator.setUnitSystem(ScaleChart.getUnitSystem());

      ScaleChart.onVisibilityChange((points, curves) => {
        syncToggleInputs(points, curves);
      });

      document.getElementById("btn-reset-zoom")?.addEventListener("click", () => {
        ScaleChart.resetZoom();
      });
    } catch (err) {
      console.error(err);
    }
  }

  function wireUnitToggle() {
    document.querySelectorAll("[data-units]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-units");
        const sys = ScaleChart.setUnitSystem(id);
        ScaleCalculator.setUnitSystem(sys);
        document.querySelectorAll("[data-units]").forEach((b) => {
          const active = b.getAttribute("data-units") === id;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", active ? "true" : "false");
        });
      });
    });
  }

  function wireInfoMenu() {
    const btn = document.getElementById("info-btn");
    const panel = document.getElementById("info-panel");
    if (!btn || !panel) return;

    function setOpen(open) {
      panel.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      setOpen(panel.hidden);
    });

    document.addEventListener("click", (e) => {
      if (panel.hidden) return;
      if (panel.contains(e.target) || btn.contains(e.target)) return;
      setOpen(false);
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !panel.hidden) {
        setOpen(false);
        btn.focus();
      }
    });
  }

  function buildToggles(categories) {
    const pointBox = document.getElementById("toggle-points");
    const curveBox = document.getElementById("toggle-curves");
    if (!pointBox || !curveBox) return;

    pointBox.innerHTML = "";
    curveBox.innerHTML = "";
    Object.keys(pointInputs).forEach((k) => delete pointInputs[k]);
    Object.keys(curveInputs).forEach((k) => delete curveInputs[k]);

    categories.forEach((cat) => {
      const color = ShipData.colorFor(cat);

      const pointToggle = makeToggle(cat, color, true, (checked) => {
        ScaleChart.setPointVisible(cat, checked);
      });
      pointInputs[cat] = pointToggle.querySelector("input");
      pointBox.appendChild(pointToggle);

      const curveToggle = makeToggle(cat, color, true, (checked) => {
        ScaleChart.setCurveVisible(cat, checked);
      });
      curveInputs[cat] = curveToggle.querySelector("input");
      curveBox.appendChild(curveToggle);
    });
  }

  function syncToggleInputs(points, curves) {
    Object.keys(points).forEach((cat) => {
      if (pointInputs[cat]) pointInputs[cat].checked = points[cat] !== false;
      if (curveInputs[cat]) curveInputs[cat].checked = curves[cat] !== false;
    });
  }

  function makeToggle(label, color, checked, onChange) {
    const wrap = document.createElement("label");
    wrap.className = "toggle-item";
    wrap.innerHTML = `
      <input type="checkbox" ${checked ? "checked" : ""} />
      <span class="swatch" style="background:${color}"></span>
      <span>${label}</span>
    `;
    wrap.querySelector("input").addEventListener("change", (e) => {
      onChange(e.target.checked);
    });
    return wrap;
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
