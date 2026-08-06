/**
 * Curve fitters — swap ACTIVE_FITTER (or pass a name) to change the model site-wide.
 * Each fitter exposes: fit(xs, ys) → { predict, inverse, params, label, formula }
 *
 * Units on the plot: X = real-world dominant (ft), Y = Lego dominant (in).
 * The same predict/inverse are used by the Scale Calculator for each dimension.
 */
(function (global) {
  "use strict";

  function mean(arr) {
    return arr.reduce((s, v) => s + v, 0) / arr.length;
  }

  /** Ordinary least squares for y = m*x + b */
  function linearRegression(xs, ys) {
    const n = xs.length;
    const xBar = mean(xs);
    const yBar = mean(ys);
    let num = 0;
    let den = 0;
    for (let i = 0; i < n; i++) {
      num += (xs[i] - xBar) * (ys[i] - yBar);
      den += (xs[i] - xBar) ** 2;
    }
    const m = den === 0 ? 0 : num / den;
    const b = yBar - m * xBar;
    return { m, b };
  }

  function rSquared(xs, ys, predict) {
    const yBar = mean(ys);
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < ys.length; i++) {
      ssRes += (ys[i] - predict(xs[i])) ** 2;
      ssTot += (ys[i] - yBar) ** 2;
    }
    return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
  }

  const Fitters = {
    /**
     * Power law: y = a * x^b
     * Fit via log-log linearization: ln(y) = ln(a) + b*ln(x)
     */
    powerLaw: {
      id: "powerLaw",
      name: "Power law",
      fit(xs, ys) {
        if (xs.length < 2) {
          return nullFit("Need at least 2 points");
        }
        const pairs = [];
        for (let i = 0; i < xs.length; i++) {
          if (xs[i] > 0 && ys[i] > 0) pairs.push([xs[i], ys[i]]);
        }
        if (pairs.length < 2) {
          return nullFit("Need at least 2 positive points");
        }
        const logX = pairs.map(([x]) => Math.log(x));
        const logY = pairs.map(([, y]) => Math.log(y));
        const { m: b, b: lnA } = linearRegression(logX, logY);
        const a = Math.exp(lnA);

        function predict(x) {
          if (x <= 0) return NaN;
          return a * x ** b;
        }
        function inverse(y) {
          if (y <= 0 || a <= 0) return NaN;
          return (y / a) ** (1 / b);
        }

        const r2 = rSquared(
          pairs.map(([x]) => x),
          pairs.map(([, y]) => y),
          predict
        );

        return {
          predict,
          inverse,
          params: { a, b, r2, n: pairs.length },
          label: "power-law",
          formula: `y = ${fmt(a)} · x^${fmt(b)}`,
        };
      },
    },

    /**
     * Linear: y = m*x + c  (ready to switch later — set ACTIVE_FITTER = "linear")
     */
    linear: {
      id: "linear",
      name: "Linear",
      fit(xs, ys) {
        if (xs.length < 2) return nullFit("Need at least 2 points");
        const { m, b: c } = linearRegression(xs, ys);
        function predict(x) {
          return m * x + c;
        }
        function inverse(y) {
          if (m === 0) return NaN;
          return (y - c) / m;
        }
        const r2 = rSquared(xs, ys, predict);
        return {
          predict,
          inverse,
          params: { m, c, r2, n: xs.length },
          label: "linear",
          formula: `y = ${fmt(m)} · x + ${fmt(c)}`,
        };
      },
    },
  };

  function nullFit(reason) {
    return {
      predict: () => NaN,
      inverse: () => NaN,
      params: { r2: NaN, n: 0, reason },
      label: "none",
      formula: "n/a",
    };
  }

  function fmt(n) {
    if (!Number.isFinite(n)) return "?";
    const abs = Math.abs(n);
    if (abs !== 0 && (abs < 0.01 || abs >= 1000)) return n.toExponential(3);
    return Number(n.toPrecision(4)).toString();
  }

  /** Change this string to switch the global fit model (e.g. "linear"). */
  const ACTIVE_FITTER = "powerLaw";

  function getFitter(name) {
    return Fitters[name || ACTIVE_FITTER] || Fitters.powerLaw;
  }

  function fitCategory(xs, ys, fitterName) {
    return getFitter(fitterName).fit(xs, ys);
  }

  global.CurveFit = {
    Fitters,
    ACTIVE_FITTER,
    getFitter,
    fitCategory,
  };
})(window);
