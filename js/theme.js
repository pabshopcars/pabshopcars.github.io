// Runs in <head> so the chosen theme and photo style apply before the first paint.
// ?theme=black|plate and ?photos=fit|pop in the address also set them.
(function () {
  var root = document.documentElement;
  function pick(param, key, allowed, fallback) {
    var value;
    try {
      value = new URLSearchParams(location.search).get(param) || localStorage.getItem(key);
    } catch (e) {}
    if (allowed.indexOf(value) < 0) value = fallback;
    try { localStorage.setItem(key, value); } catch (e) {}
    return value;
  }
  root.setAttribute("data-theme", pick("theme", "pab-theme", ["plate", "black"], "plate"));
  root.setAttribute("data-photos", pick("photos", "pab-photos", ["fit", "pop"], "fit"));
})();
