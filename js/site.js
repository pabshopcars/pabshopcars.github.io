// PAB SHOP redesign: renders the pages from the live cars table (Supabase, read only).
(() => {
  const { business: B, supabase: SB, fbListings: FB = {} } = window.PAB;
  const PHOTOS = window.PAB_PHOTOS || {};   // per photo: [crop %, pop-out strip, car depth] (tools/photos.py)
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const NF = new Intl.NumberFormat("en-US");
  const money = (n) => `$${NF.format(Math.round(n))}`;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const shortMiles = (n) => (n >= 1000 ? `${Math.round(n / 1000)}k mi` : `${n} mi`);
  const shortTransmission = (t) => (/manual/i.test(t) ? "Manual" : /auto|cvt|dct|tiptronic/i.test(t) ? "Auto" : t);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const icon = (name, cls = "ic") => `<svg class="${cls}" aria-hidden="true"><use href="#${name}"></use></svg>`;
  const carHref = (id) => `car.html?id=${encodeURIComponent(id)}`;
  const priceText = (c) => (c.status === "sold" ? "Sold" : c.price !== null ? money(c.price) : "Call for price");
  const smsHref = (text) => `sms:${B.phone}?&body=${encodeURIComponent(text)}`;
  const shortDate = (iso) => {
    const d = new Date(iso);
    const year = d.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {};
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...year });
  };
  const fromHtml = (html) => {
    const t = document.createElement("template");
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const samePage = (a, b) => a.replace(/index\.html$/, "") === b.replace(/index\.html$/, "");

  const root = document.documentElement;
  let page = null;          // "home" | "sold" | "car", read from #view[data-page]
  let currentCarId = null;
  let shown = "";           // path + query of the view on screen

  /* ---------- cars from the live database ----------
     The new Supabase project (js/data.js), not the one pabshop.com still reads, so only cars
     imported from Facebook into the new project show here. Rows are read once per page
     load and reused by in-site links. Photos are the importer's uploads: per photo a /full/ file
     (longest side 1000px), a /card/ file (640px, framed the same) and a /thumb/ file (420px,
     cropped to 3:2). Some older cars point at Cloudinary ids instead. */
  // A list card shows one photo, a price, a name and two facts, so the list asks for those columns
  // only. Dragging every description and every photo URL of every car along made the request 207 KB
  // with 63 cars, against about 25 KB this way, and none of it is cached (the database answers are
  // marked dynamic, unlike the photos, which are cached for a year). The car page then fetches its
  // own row in full — one small request, once per car opened.
  const LIST_COLUMNS = "id,title,price,mileage,year,make,model,drivetrain,status,pending,cover_image,photo_count,listed_at,created_at";
  const HEADERS = { apikey: SB.key, Authorization: `Bearer ${SB.key}` };
  const askFor = (query) => fetch(`${SB.url}/rest/v1/cars?${query}`, { headers: HEADERS })
    .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); });

  let cars = [];
  let carsRequest = null;
  function loadCars() {
    carsRequest ??= askFor(`select=${LIST_COLUMNS}&order=created_at.desc`)
      .then((rows) => { cars = rows.map(toCar); })
      .catch((err) => { carsRequest = null; throw err; });
    return carsRequest;
  }

  // The photos of one car, fetched when that car's page opens and kept for the rest of the visit.
  const carRequests = new Map();
  function loadCar(id) {
    if (!id) return Promise.resolve();
    if (!carRequests.has(id)) {
      carRequests.set(id, askFor(`select=*&id=eq.${encodeURIComponent(id)}`)
        .then((rows) => {
          if (!rows.length) return;
          const full = toCar(rows[0]);
          const at = cars.findIndex((c) => c.id === full.id);
          if (at < 0) cars.push(full); else cars[at] = full;
        })
        .catch((err) => { carRequests.delete(id); throw err; }));
    }
    return carRequests.get(id);
  }

  const STORAGE = `${SB.url}/storage/v1/object/public/cars/`;
  const CLOUDINARY = "https://res.cloudinary.com/dhhbcpnez/image/upload/";
  const encodePath = (path) => path.split("/").map(encodeURIComponent).join("/");
  // Three sizes per photo, uploaded by the importer: /full/ (1000px), /card/ (640px, framed like
  // full) and /thumb/ (420px, cropped 3:2). Cards and gallery offer full and card in a srcset so a
  // phone never downloads the big one.
  function photoUrls(ref) {
    if (/^https?:\/\//.test(ref)) {
      const full = ref.replace("/card/", "/full/").replace("/thumb/", "/full/");
      const sized = (dir) => (full.includes("/full/") ? full.replace("/full/", dir) : full);
      return { full, card: sized("/card/"), sm: sized("/thumb/") };
    }
    const path = ref.replace(/^\/+/, "");
    if (/\/(full|card|thumb)\//.test(path)) {
      const full = STORAGE + encodePath(path.replace("/thumb/", "/full/").replace("/card/", "/full/"));
      return { full, card: full.replace("/full/", "/card/"), sm: full.replace("/full/", "/thumb/") };
    }
    const id = encodePath(path);
    return {
      full: `${CLOUDINARY}f_auto,q_auto,w_1000/${id}`,
      card: `${CLOUDINARY}f_auto,q_auto,w_640/${id}`,
      sm: `${CLOUDINARY}f_auto,q_auto,w_420/${id}`,
    };
  }

  // Each photo is cropped where its own car sits (tools/photos.py measured it); 72% is the low crop
  // that suits most of these phone shots, used for a photo the script has not seen yet.
  const fileName = (u) => u.split("?")[0].split("/").pop();
  function framed(p) {
    const [y, pop, depth] = PHOTOS[fileName(p.full)] || [];
    return { ...p, y: Number.isFinite(y) ? y : 72, pop, depth };
  }

  const text = (v) => String(v ?? "").trim();
  const num = (v) => (v === null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v));
  function toCar(r) {
    // the cover first, so the card's photo is the gallery's first photo
    const refs = [r.cover_image, ...(Array.isArray(r.images) ? r.images : [])]
      .map(text)
      .filter((ref) => ref && !/^(data|blob):/.test(ref));
    const photos = [];
    refs.forEach((ref) => {
      const p = photoUrls(ref);
      if (!photos.some((q) => q.full === p.full)) photos.push(framed(p));
    });
    const year = num(r.year);
    return {
      id: String(r.id),
      name: text(r.title || r.name) || [year, text(r.make), text(r.model)].filter(Boolean).join(" ") || "Car",
      year,
      make: text(r.make),
      model: text(r.model),
      price: num(r.price),
      mileage: num(r.mileage),
      transmission: text(r.transmission),
      drivetrain: text(r.drivetrain),
      engine: text(r.engine),
      exterior: text(r.exterior_color),
      interior: text(r.interior_color),
      vin: text(r.vin),
      description: text(r.description),
      status: text(r.status),
      listed: text(r.created_at),
      photos,
      // List rows carry only the cover and a count; a car page's own row carries every photo.
      photoCount: Number.isFinite(Number(r.photo_count)) ? Number(r.photo_count) : photos.length,
    };
  }

  /* ---------- motion helpers ---------- */
  // Timing lives in css/site.css; JS only decides what moves.
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");
  const scrollBehavior = () => (reduceMotion.matches ? "auto" : "smooth");
  const canMorph = () => Boolean(document.startViewTransition) && !reduceMotion.matches;
  const vtName = (el, name = "") => { if (el) el.style.viewTransitionName = name; };
  const clearVtNames = () => $$('[style*="view-transition-name"]').forEach((el) => vtName(el));

  // iOS Safari only shows :active press states when a touch listener exists.
  document.addEventListener("touchstart", () => {}, { passive: true });

  // Focus rings are for keyboard users. On a phone, focus still moves (the viewer's close button
  // when it opens, back to the photo when it closes) and the browser draws the ring anyway.
  // The "keyboard" class turns rings on from the first key press until the next tap or click.
  document.addEventListener("keydown", (e) => {
    if (!e.metaKey && !e.ctrlKey && !e.altKey) root.classList.add("keyboard");
  }, true);
  document.addEventListener("pointerdown", () => root.classList.remove("keyboard"), true);

  // One view transition at a time. Starting one while another is still playing makes the browser
  // skip the first: everything jumps to its end in one frame (seen opening and closing a car
  // quickly). So the playing one is sped up and the next starts the moment it ends. `before` runs
  // right before a transition starts, which is where the elements that travel get their names;
  // all names are cleared when a transition ends. The vt-<kind> class on <html> picks CSS timing.
  const HURRY = 3;
  let active = null;
  let queue = Promise.resolve();
  const hurry = () => document.getAnimations().forEach((a) => {
    if (a.effect?.pseudoElement?.startsWith("::view-transition")) a.updatePlaybackRate(HURRY);
  });
  function transition(kind, update, before) {
    if (!document.startViewTransition) {
      update();
      return Promise.resolve();
    }
    const run = () => {
      before?.();
      root.classList.add(`vt-${kind}`);
      const t = document.startViewTransition(update);
      active = t;
      t.ready.catch(() => {});
      return t.finished.catch(() => {}).then(() => {
        root.classList.remove(`vt-${kind}`);
        root.style.removeProperty("--vt-photo-shift");
        clearVtNames();
        active = null;
      });
    };
    if (active) hurry();
    queue = queue.then(run).catch(() => { active = null; });
    return queue;
  }

  // While a view transition is on screen, Chrome hit-tests its overlay, so a tap lands on <html>
  // and would be lost (pointer-events on ::view-transition does not change that). Hurry the
  // animation and hand the tap to whatever is under the finger when it ends. A second tap on the
  // same spot right after following a link is a double tap, not a new tap, so it is dropped.
  let lastNavTap = { at: 0, x: 0, y: 0 };
  document.addEventListener("click", (e) => {
    if (!active || e.target !== root) return;
    const near = Math.hypot(e.clientX - lastNavTap.x, e.clientY - lastNavTap.y) < 40;
    if (near && performance.now() - lastNavTap.at < 350) return;
    const { clientX: x, clientY: y } = e;
    hurry();
    queue.then(() => {
      const target = document.elementFromPoint(x, y)?.closest("button, a[href], input, select, textarea");
      if (!target) return;
      if (target.matches("input, select, textarea")) target.focus();
      else target.click();
    });
  }, true);

  // Photos fade in when they arrive instead of popping. Visible by default: the class is only
  // added to images that are still loading. Photos already loaded once skip it, so a list drawn
  // again (coming back from a car) shows them at once.
  const seenPhotos = new Set();
  function fadeInImages(scope) {
    $$(".car-photo img", scope).forEach((img) => {
      const src = img.getAttribute("src");
      if (img.complete || seenPhotos.has(src)) return;
      img.classList.add("is-loading");
      img.addEventListener("load", () => { img.classList.remove("is-loading"); seenPhotos.add(src); }, { once: true });
      img.addEventListener("error", () => img.classList.remove("is-loading"), { once: true });
    });
  }

  const inView = (el) => {
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.bottom > 0 && r.top < innerHeight;
  };
  const cardPhotoFor = (id) => $$(".car-link").find((a) => a.getAttribute("href") === carHref(id) && inView(a))?.querySelector(".car-photo");

  /* ---------- in-site navigation without page loads ----------
     Chrome on iPhone resets its toolbar insets on every navigation that loads a new document
     (Chromium ios/chrome/browser/fullscreen/ui_bundled/fullscreen_web_state_observer.mm:
     DidFinishNavigation calls ResetForNavigation, skipped for same-document navigations). Until the
     next page painted, that drew the old page a toolbar-height too high (screen recordings, 2026-09-15;
     Safari and Firefox on the same phone were fine). So links between the list, sold and car pages
     swap #view in place and use history.pushState. Every page is still a real HTML file, so direct
     links, reloads and browsers where fetch fails (file://) keep working as normal navigation. */
  const PAGE_PATH = /(^|\/)(index|sold|car)\.html$|\/$/;
  const htmlCache = new Map();
  function fetchPage(path) {
    if (!htmlCache.has(path)) {
      const request = fetch(path)
        .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
        .catch((err) => { htmlCache.delete(path); throw err; });
      htmlCache.set(path, request);
    }
    return htmlCache.get(path);
  }
  function inSiteUrl(a) {
    if (!a || a.target || a.hasAttribute("download")) return null;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin || !PAGE_PATH.test(url.pathname)) return null;
    if (url.hash && url.pathname === location.pathname && url.search === location.search) return null;
    return url;
  }

  // Start loading the next page as soon as a finger lands on the link.
  document.addEventListener("pointerdown", (e) => {
    const url = inSiteUrl(e.target.closest?.("a[href]"));
    if (url) fetchPage(url.pathname).catch(() => {});
  }, { capture: true, passive: true });

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const url = inSiteUrl(e.target.closest("a[href]"));
    if (!url) return;
    e.preventDefault();
    lastNavTap = { at: performance.now(), x: e.clientX, y: e.clientY };
    navigate(url, true);
  });

  history.scrollRestoration = "manual";
  addEventListener("popstate", () => {
    if (location.pathname + location.search === shown) return;   // a #hash change, not a page change
    navigate(new URL(location.href), false);
  });

  let navToken = 0;
  async function navigate(url, push) {
    const token = ++navToken;
    let html;
    try {
      // A car page needs its own row (the photos) before the transition starts, like the HTML does.
      const wanted = url.pathname.includes("car.html") ? url.searchParams.get("id") : null;
      [html] = await Promise.all([fetchPage(url.pathname), loadCars(), loadCar(wanted)]);
    } catch (err) {
      location.assign(url.href);
      return;
    }
    if (token !== navToken) return;
    const next = new DOMParser().parseFromString(html, "text/html");
    const nextView = next.getElementById("view");
    if (!nextView) { location.assign(url.href); return; }
    const nextCarId = nextView.dataset.page === "car" ? url.searchParams.get("id") : null;

    const restoreY = push ? 0 : (history.state?.scrollY ?? 0);
    // The photo that travels: the tapped card's (into a car page) or the gallery's (out of one).
    // The price or Sold tag travels too, between the card's tag and the car page's sticker, as its
    // own layer above the photo: a tag that only faded in or out let the photo show through it.
    let travelling = null;
    const nameCard = (photoEl) => {
      vtName(photoEl, "car-photo");
      vtName(photoEl?.closest(".car-link")?.querySelector(".price-tag"), "car-price");
    };

    transition("page", () => {
      clearVtNames();
      cleanupView();
      if (push) {
        history.replaceState({ ...history.state, scrollY }, "");
        history.pushState({ scrollY: 0, from: location.pathname }, "", url.href);
      }
      $("#view").replaceWith(document.importNode(nextView, true));
      document.title = next.title;
      init();
      scrollTo(0, restoreY);
      if (travelling && page === "car" && travelling === currentCarId) {
        vtName($(".gallery-frame"), "car-photo");
        const tag = $("#priceTag");
        vtName(tag, "car-price");
        tag.classList.add("travelled");   // it flies in with the photo instead of slapping on
      } else if (travelling && page !== "car") {
        const to = cardPhotoFor(travelling);
        nameCard(to);
        to?.querySelector("img.is-loading")?.classList.remove("is-loading");
      }
      if (push) $("#view").focus({ preventScroll: true });
    }, () => {
      if (!canMorph()) return;
      if (nextCarId && nextCarId !== currentCarId) {
        const from = cardPhotoFor(nextCarId);
        if (from) {
          nameCard(from);
          travelling = nextCarId;
        }
      } else if (page === "car" && inView($(".gallery-frame"))) {
        // the whole frame, so the photo counter (and desktop arrows) travel with the photo
        vtName($(".gallery-frame"), "car-photo");
        if (inView($("#priceTag"))) vtName($("#priceTag"), "car-price");
        travelling = currentCarId;
      }
    });
  }

  // Things a view sets up outside its own elements, undone when it is swapped out.
  const cleanups = [];
  const cleanupView = () => cleanups.splice(0).forEach((fn) => fn());

  /* ---------- theme ---------- */
  function syncThemeControls() {
    const theme = root.dataset.theme;
    $$("[data-set-theme]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.setTheme === theme)));
    $$("[data-toggle-theme]").forEach((b) => {
      b.setAttribute("aria-label", theme === "black" ? "Switch to light theme" : "Switch to black theme");
      b.innerHTML = icon(theme === "black" ? "sun" : "moon");
    });
    $$("[data-set-photos]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.setPhotos === root.dataset.photos)));
  }
  function setTheme(theme) {
    if (theme === root.dataset.theme) return;
    try { localStorage.setItem("pab-theme", theme); } catch (e) {}
    transition("theme", () => {
      root.dataset.theme = theme;
      syncThemeControls();
    });
  }
  document.addEventListener("click", (e) => {
    const set = e.target.closest("[data-set-theme]");
    if (set) setTheme(set.dataset.setTheme);
    if (e.target.closest("[data-toggle-theme]")) setTheme(root.dataset.theme === "black" ? "plate" : "black");
    // Preview only: Fit (low crop) or Pop-out (the car's bottom continues below the photo box)
    const photos = e.target.closest("[data-set-photos]")?.dataset.setPhotos;
    if (photos && photos !== root.dataset.photos) {
      try { localStorage.setItem("pab-photos", photos); } catch (err) {}
      transition("theme", () => {
        root.dataset.photos = photos;
        syncThemeControls();
      });
    }
  });

  /* ---------- shared bits ---------- */
  function fillContacts(message) {
    $$("[data-tel]").forEach((a) => { a.href = `tel:${B.phone}`; });
    $$("[data-tel2]").forEach((a) => { a.href = `tel:${B.phone2}`; });
    $$("[data-sms]").forEach((a) => { a.href = smsHref(message); });
    $$("[data-email]").forEach((a) => { a.href = `mailto:${B.email}`; });
    $$("[data-phone-label]").forEach((el) => { el.textContent = B.phoneLabel; });
    $$("[data-phone2-label]").forEach((el) => { el.textContent = B.phone2Label; });
    $$("[data-email-label]").forEach((el) => { el.textContent = B.email; });
  }

  // "2016 Buick encore" -> "Encore": the model column when filled, else the word after year and make.
  const modelOf = (c) => {
    const model = c.model || c.name.match(/^(?:19|20)\d\d\s+\S+\s+(\S+)/)?.[1] || "";
    return model.charAt(0).toUpperCase() + model.slice(1);
  };

  const factRows = (list) => list
    .filter(([, , value]) => value !== null && value !== "")
    .map(([ic, label, value]) => `<div><dt>${icon(ic)}<span>${label}</span></dt><dd>${esc(value)}</dd></div>`)
    .join("");

  function card(c, { sizes = "(min-width: 1180px) 370px, (min-width: 720px) 45vw, 100vw" } = {}) {
    const sold = c.status === "sold";
    const [cover] = c.photos;
    // Always the full photo: the thumbnail is already a centred 3:2 crop, so it has lost the
    // bottom of the car that the low card crop keeps, and it would not line up with the gallery.
    const photoHtml = cover
      ? `<img src="${esc(cover.card)}" srcset="${esc(cover.card)} 640w, ${esc(cover.full)} 1000w" sizes="${sizes}"
               width="1000" height="667" style="--photo-y: ${cover.y}%"
               loading="${seenPhotos.has(cover.card) ? "eager" : "lazy"}" decoding="async" draggable="false" alt="${esc(c.name)}">`
      : icon("car", "ic no-photo");
    const pop = cover && cover.pop;
    const count = c.photoCount > 1
      ? `<span class="photo-count" aria-label="${c.photoCount} photos">${icon("images")}${c.photoCount}</span>`
      : "";
    const facts = [
      c.mileage !== null && `${icon("gauge")}${shortMiles(c.mileage)}`,
      c.drivetrain && `${icon("disc-3")}${esc(c.drivetrain)}`,
    ].filter(Boolean);
    return `
      <li class="car-card${sold ? " is-sold" : ""}${pop ? " has-pop" : ""}" style="--vt: card-${esc(c.id)}${pop ? `; --pop-h: ${Number(cover.depth) || 0}` : ""}">
        <a class="car-link" href="${carHref(c.id)}" draggable="false">
          <div class="car-photo">${photoHtml}${count}</div>
          ${pop ? `<img class="car-pop" src="${esc(pop)}" alt="" loading="lazy" decoding="async" draggable="false">` : ""}
          <p class="price-tag${sold ? " is-sold" : ""}">${priceText(c)}</p>
          <h3 class="car-title">${esc(c.name)}</h3>
          ${facts.length ? `<ul class="car-facts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>` : ""}
        </a>
      </li>`;
  }

  function renderCards(el, list, opts) {
    el.innerHTML = list.map((c) => card(c, opts)).join("");
    fadeInImages(el);
  }

  /* ---------- homepage ---------- */
  function initHome() {
    // rows arrive newest listing first, the order the live site uses
    const available = cars.filter((c) => c.status === "available");
    const sold = cars.filter((c) => c.status === "sold");
    const grid = $("#carGrid");
    const q = $("#q");
    const count = $("#resultCount");
    const empty = $("#empty");
    const sortButton = $("#sortButton");
    const sortMenu = $("#sortMenu");
    const sortOptions = $$("[data-sort]", sortMenu);
    const last = (v, dir = 1) => (v === null ? Infinity : v * dir);   // cars without the number go last
    const sorters = {
      newest: (a, b) => b.listed.localeCompare(a.listed),
      "price-asc": (a, b) => last(a.price) - last(b.price) || 0,
      "price-desc": (a, b) => last(a.price, -1) - last(b.price, -1) || 0,
      miles: (a, b) => last(a.mileage) - last(b.mileage) || 0,
      year: (a, b) => (b.year ?? 0) - (a.year ?? 0) || last(a.mileage) - last(b.mileage) || 0,
    };

    // One element per car, reused on every render: loaded photos stay loaded and the
    // reorder transition moves the same boxes instead of fading in new ones.
    const nodes = new Map(available.map((c) => [c.id, fromHtml(card(c))]));
    nodes.forEach((li) => fadeInImages(li));

    // Search and sort live in the address, so a shared or reloaded link shows the same list.
    const params = new URLSearchParams(location.search);
    let sort = sorters[params.get("sort")] ? params.get("sort") : "newest";
    q.value = params.get("q") || "";
    $("#homeTitle").textContent = `${plural(available.length, "car")} for sale`;
    // The search hint names models that are actually for sale ("Encore, Legacy…").
    const models = [...new Set(available.map(modelOf).filter((m) => /[a-z]/i.test(m)))].slice(0, 3);
    if (models.length) q.placeholder = `${models.join(", ")}…`;

    function syncUrl() {
      const p = new URLSearchParams(location.search);
      const put = (key, value, fallback) => (value && value !== fallback ? p.set(key, value) : p.delete(key));
      put("q", q.value.trim(), "");
      put("sort", sort, "newest");
      p.delete("show");   // the old quick filters are gone
      const qs = p.toString();
      history.replaceState(history.state, "", qs ? `?${qs}` : location.pathname);
      shown = location.pathname + location.search;
    }

    // The button shows the chosen order's icon and name; the menu ticks it.
    function syncSortControl() {
      const current = sortOptions.find((o) => o.dataset.sort === sort);
      sortOptions.forEach((o) => o.setAttribute("aria-selected", String(o === current)));
      $("#sortLabel").textContent = current.querySelector("span").textContent;
      sortButton.querySelector("use").setAttribute("href", current.querySelector("use").getAttribute("href"));
    }

    function render() {
      const term = q.value.trim().toLowerCase();
      const list = available
        .filter((c) => !term || [c.name, c.make, c.model, c.year, c.drivetrain, c.transmission, c.engine, c.exterior]
          .join(" ").toLowerCase().includes(term))
        .sort(sorters[sort]);
      grid.replaceChildren(...list.map((c) => nodes.get(c.id)));
      count.textContent = term ? `${list.length} of ${available.length}` : plural(available.length, "car");
      empty.hidden = list.length > 0;
      $("h2", empty).textContent = available.length ? "No cars match" : "Nothing for sale right now";
      $("#clearSearch").hidden = !available.length;
      syncSortControl();
      syncUrl();
    }

    // Sort menu: a popover list so each order can show an icon (a native select can't, on phones).
    // It opens under the button with right edges lined up, or above it when there is no room below.
    const menuOpen = () => sortMenu.matches(":popover-open");
    sortMenu.addEventListener("beforetoggle", (e) => {
      if (e.newState !== "open") return;
      const r = sortButton.getBoundingClientRect();
      const height = sortOptions.length * 48 + 14;   // rows are 48px, plus padding and border
      const above = r.bottom + 8 + height > innerHeight && r.top - 8 - height > 0;
      sortMenu.classList.toggle("above", above);
      sortMenu.style.right = `${document.documentElement.clientWidth - r.right}px`;
      sortMenu.style.top = `${above ? r.top - 8 - height : r.bottom + 8}px`;
    });
    sortMenu.addEventListener("toggle", (e) => {
      const open = e.newState === "open";
      sortButton.setAttribute("aria-expanded", String(open));
      if (open) sortOptions.find((o) => o.getAttribute("aria-selected") === "true")?.focus({ preventScroll: true });
    });
    sortMenu.addEventListener("keydown", (e) => {
      const i = sortOptions.indexOf(document.activeElement);
      const step = { ArrowDown: 1, ArrowUp: -1 }[e.key];
      if (step) {
        e.preventDefault();
        sortOptions[(i + step + sortOptions.length) % sortOptions.length].focus();
      }
      if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        (e.key === "Home" ? sortOptions[0] : sortOptions.at(-1)).focus();
      }
      if (e.key === "Tab") sortMenu.hidePopover();
    });
    sortOptions.forEach((o) => o.addEventListener("click", () => {
      sortMenu.hidePopover();
      sortButton.focus({ preventScroll: true });
      if (o.dataset.sort === sort) return;
      sort = o.dataset.sort;
      // the closing menu gets its own layer, so the cards sliding underneath don't cover it
      transition("list", render, () => vtName(sortMenu, "sort-menu"));
    }));
    // A fixed menu would drift away from its button when the page scrolls, so scrolling closes it.
    const closeOnScroll = () => { if (menuOpen()) sortMenu.hidePopover(); };
    addEventListener("scroll", closeOnScroll, { passive: true });
    cleanups.push(() => removeEventListener("scroll", closeOnScroll));

    // Sorting reorders with a short move; typing in search updates instantly.
    q.addEventListener("input", render);
    $("#clearSearch").addEventListener("click", () => { q.value = ""; render(); q.focus(); });
    render();

    $("#soldStrip").hidden = !sold.length;
    renderCards($("#soldRow"), sold.slice(0, 6), { sizes: "260px" });
    fillContacts("Yo, what cars do you have right now?");
  }

  /* ---------- sold page ---------- */
  function initSold() {
    const sold = cars.filter((c) => c.status === "sold");
    $("#soldCount").textContent = sold.length;
    renderCards($("#soldGrid"), sold);
    fillContacts("Yo, got anything like these?");
  }

  /* ---------- photo slider (native scroll + snap points) ---------- */
  function createSlider(track, onChange) {
    const s = { index: -1, count: track.children.length, target: null };
    const width = () => track.clientWidth || 1;

    function set(i) {
      if (i === s.index) return;
      s.index = i;
      [i - 1, i + 1].forEach((n) => {
        const img = track.children[n]?.querySelector("img");
        if (img && img.loading !== "eager") img.loading = "eager";
      });
      onChange(i);
    }

    s.goTo = (i, smooth = true) => {
      if (!s.count || !track.clientWidth) return;   // hidden (a closed viewer): nothing to scroll
      const wraps = i < 0 || i >= s.count;
      const back = i < 0;
      i = ((i % s.count) + s.count) % s.count;
      const move = () => {
        const left = i * width();
        s.target = Math.abs(track.scrollLeft - left) > 2 ? i : null;
        track.scrollTo({ left, behavior: smooth && !wraps ? scrollBehavior() : "auto" });
        set(i);
      };
      // Going past the last photo (or before the first) cannot scroll there: every photo in between
      // would fly past. So the two photos slide over each other the way the arrow points instead of
      // swapping in one frame.
      if (!wraps || !smooth || !canMorph()) return move();
      const slidePhoto = (n) => track.children[n]?.querySelector("img");
      transition(back ? "wrap-back" : "wrap", () => {
        vtName(slidePhoto(s.index));
        move();
        vtName(slidePhoto(i), "wrap-photo");
      }, () => vtName(slidePhoto(s.index), "wrap-photo"));
    };
    s.reset = () => { s.index = -1; };

    let frame = 0;
    track.addEventListener("scroll", () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const w = track.clientWidth;
        // A hidden track (the viewer once it closes) reports no width, and browsers reset its scroll
        // position: that is not the visitor choosing photo 1, so it must not move the index.
        if (!w) return;
        if (s.target !== null) {
          if (Math.abs(track.scrollLeft - s.target * w) > 2) return;
          s.target = null;
        }
        set(Math.min(s.count - 1, Math.max(0, Math.round(track.scrollLeft / w))));
      });
    }, { passive: true });

    ["touchstart", "wheel", "keydown"].forEach((type) => track.addEventListener(type, () => { s.target = null; }, { passive: true }));

    let lastWidth = track.clientWidth;
    const resize = new ResizeObserver(() => {
      const w = track.clientWidth;
      if (!w || w === lastWidth) return;
      lastWidth = w;
      s.target = null;
      track.scrollTo({ left: Math.max(0, s.index) * w, behavior: "auto" });
    });
    resize.observe(track);
    cleanups.push(() => resize.disconnect());

    set(0);
    return s;
  }

  /* ---------- car page ---------- */
  function initCar() {
    const c = cars.find((x) => x.id === currentCarId);
    if (!c) {
      $("#carMain").hidden = true;
      $("#notFound").hidden = false;
      document.title = "Car not found - PAB SHOP";
      fillContacts("Yo, what cars do you have right now?");
      return;
    }

    const sold = c.status === "sold";
    const name = c.name;
    document.title = `${name} - PAB SHOP`;

    // Back goes back in history when the list is the entry right before this one,
    // so the list comes back with its scroll position and search.
    const back = $("#backLink");
    back.href = sold ? "sold.html" : "index.html";
    $("#backText").textContent = sold ? "Sold cars" : "All cars";
    back.addEventListener("click", (e) => {
      const from = history.state?.from;
      if (from && samePage(from, new URL(back.href).pathname)) {
        e.preventDefault();
        history.back();
      }
    });
    $(sold ? '[data-nav="sold"]' : '[data-nav="sale"]')?.setAttribute("aria-current", "page");

    const tag = $("#priceTag");
    tag.textContent = priceText(c);
    tag.classList.toggle("is-sold", sold);
    $("#carName").textContent = name;

    // Only what the listing has: a fact without a value is left out.
    const keyFacts = factRows([
      ["calendar", "Year", c.year],
      ["gauge", "Miles", c.mileage === null ? null : NF.format(c.mileage)],
      ["cog", "Transmission", shortTransmission(c.transmission)],
      ["disc-3", "Drive", c.drivetrain],
    ]);
    $("#keyFacts").innerHTML = keyFacts;
    $("#keyFacts").hidden = !keyFacts;

    $("#about").textContent = c.description;
    $("#aboutSection").hidden = !c.description;

    const specs = factRows([
      ["cog", "Engine", c.engine],
      // only when it says more than the Auto/Manual tile above ("6-speed automatic", not "Automatic")
      ["cog", "Transmission", /^(auto|automatic|manual)$/i.test(c.transmission) ? "" : c.transmission],
      ["palette", "Color", c.exterior],
      ["armchair", "Interior", c.interior],
      ["hash", "VIN", c.vin],
      ["calendar", "Listed", c.listed && shortDate(c.listed)],
    ]);
    $("#specList").innerHTML = specs;
    $("#detailsSection").hidden = !specs;

    fillContacts(sold
      ? `Yo, got anything like the ${name}?`
      : `Yo, is the ${name} still available?`);

    const fbId = FB[c.id];
    const fbLink = $("#fbLink");
    fbLink.hidden = !fbId;
    if (fbId) fbLink.href = `https://www.facebook.com/marketplace/item/${encodeURIComponent(fbId)}/`;

    const more = cars.filter((x) => x.status === "available" && x.id !== c.id).slice(0, 3);
    renderCards($("#moreGrid"), more);
    $("#moreSection").hidden = !more.length;

    // Gallery
    const shots = c.photos;
    const track = $("#slides");
    const thumbs = $("#thumbs");
    const count = $("#galCount");
    const several = shots.length > 1;
    [thumbs, count, $("#galPrev"), $("#galNext"), $("#viewerPrev"), $("#viewerNext")].forEach((el) => { el.hidden = !several; });
    if (!shots.length) {
      track.innerHTML = `<div class="slide no-photo">${icon("car")}</div>`;
      return;
    }

    // Gallery and viewer load the full photo: the thumbnail is a 3:2 crop, not a smaller copy.
    const slidesHtml = () => shots.map((p, i) => `
      <div class="slide">
        <img src="${esc(p.full)}" srcset="${esc(p.card)} 640w, ${esc(p.full)} 1000w" sizes="(min-width: 960px) 62vw, 100vw"
             width="1000" height="667" style="--photo-y: ${p.y}%"
             alt="${esc(name)}, photo ${i + 1} of ${shots.length}" loading="${i < 2 ? "eager" : "lazy"}" decoding="async" draggable="false">
      </div>`).join("");

    track.innerHTML = slidesHtml();
    thumbs.innerHTML = shots.map((p, i) => `
      <li><button type="button" data-i="${i}" aria-label="Show photo ${i + 1}">
        <img src="${esc(p.sm)}" alt="" width="420" height="280" loading="lazy" decoding="async">
      </button></li>`).join("");

    const main = createSlider(track, (i) => {
      count.innerHTML = `${icon("images")}<span>${i + 1}/${shots.length}</span>`;
      $$("button", thumbs).forEach((b, k) => {
        if (k === i) {
          b.setAttribute("aria-current", "true");
          thumbs.scrollTo({ left: b.offsetLeft - (thumbs.clientWidth - b.clientWidth) / 2, behavior: scrollBehavior() });
        } else {
          b.removeAttribute("aria-current");
        }
      });
    });
    thumbs.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      if (b) main.goTo(Number(b.dataset.i));
    });
    $("#galPrev").addEventListener("click", () => main.goTo(main.index - 1));
    $("#galNext").addEventListener("click", () => main.goTo(main.index + 1));

    // Fullscreen viewer: the tapped photo grows into it and shrinks back on close.
    const viewer = $("#viewer");
    const vtrack = $("#viewerSlides");
    const vcount = $("#viewerCount");
    vtrack.innerHTML = slidesHtml();
    // Which photo the viewer is showing. Kept here because a closed dialog is display: none, and a
    // hidden scroller's position is reset to the start: reading it back after closing gave photo 1.
    let shownInViewer = 0;
    const full = createSlider(vtrack, (i) => {
      shownInViewer = i;
      vcount.textContent = several ? `${i + 1}/${shots.length}` : "";
    });
    const galleryImg = (i) => track.children[i]?.querySelector("img");
    const viewerImg = (i) => vtrack.children[i]?.querySelector("img");
    const ready = (img) => {
      if (!img) return null;
      img.loading = "eager";
      return img.decode().catch(() => {});
    };

    // What travels on the gallery side is the whole frame, so the photo counter (and desktop arrows)
    // move with the photo. The viewer's close button, counter and arrows get their own layers so
    // they stay above the growing or shrinking photo instead of popping on top when it ends.
    const frame = $(".gallery-frame");
    const nameViewerControls = (on) => {
      vtName($(".viewer-bar", viewer), on ? "viewer-bar" : "");
      vtName($("#viewerPrev"), on ? "viewer-prev" : "");
      vtName($("#viewerNext"), on ? "viewer-next" : "");
    };

    // The viewer shows the whole photo; the gallery shows a crop of it. Without help the full photo
    // simply appears at its final size (both are the width of the screen on a phone, so nothing
    // scales) and reads as a pop. So the full photo starts shifted to sit exactly where the gallery's
    // crop is, and slides back as the box grows: the picture opens out of the crop.
    function alignPhoto(i) {
      const img = galleryImg(i);
      const box = frame.getBoundingClientRect();
      const shape = img?.naturalWidth ? img.naturalHeight / img.naturalWidth : 0;
      const visible = shape ? Math.min(1, box.height / box.width / shape) : 1;   // share of the photo the crop shows
      const y = (parseFloat(getComputedStyle(img).objectPosition.split(" ")[1]) || 50) / 100;
      root.style.setProperty("--vt-photo-shift", `${(-y * (1 - visible) * 100).toFixed(2)}%`);
    }

    function openViewer() {
      let i = 0;
      let morph = false;
      transition("viewer-open", async () => {
        vtName(frame);
        viewer.showModal();
        full.reset();
        full.goTo(i, false);
        if (morph) {
          vtName(viewerImg(i), "viewer-photo");
          nameViewerControls(true);
          await ready(viewerImg(i));
        }
      }, () => {
        i = main.index;
        morph = canMorph();
        if (morph) {
          vtName(frame, "viewer-photo");
          alignPhoto(i);
        }
      });
    }

    function closeViewer() {
      if (!viewer.open) return;
      let i = 0;
      let morph = false;
      transition("viewer-close", async () => {
        vtName(viewerImg(i));
        nameViewerControls(false);
        viewer.close();
        main.goTo(i, false);
        if (morph) {
          vtName(frame, "viewer-photo");
          await ready(galleryImg(i));
        }
      }, () => {
        i = shownInViewer;
        morph = canMorph();
        if (morph) {
          vtName(viewerImg(i), "viewer-photo");
          nameViewerControls(true);
          alignPhoto(i);
        }
      });
    }

    let downX = 0;
    let moved = false;
    track.addEventListener("pointerdown", (e) => { downX = e.clientX; moved = false; }, { passive: true });
    track.addEventListener("pointermove", (e) => { if (Math.abs(e.clientX - downX) > 8) moved = true; }, { passive: true });
    track.addEventListener("click", () => { if (!moved) openViewer(); });
    // Escape and the phone's back gesture close the dialog directly, without closeViewer: keep the
    // gallery on the photo the viewer was showing (closeViewer has already done it in that path).
    viewer.addEventListener("close", () => main.goTo(shownInViewer, false));
    $("#viewerClose").addEventListener("click", closeViewer);
    $("#viewerPrev").addEventListener("click", () => full.goTo(full.index - 1));
    $("#viewerNext").addEventListener("click", () => full.goTo(full.index + 1));
    vtrack.addEventListener("click", (e) => { if (e.target.tagName !== "IMG") closeViewer(); });
    viewer.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") full.goTo(full.index + 1);
      if (e.key === "ArrowLeft") full.goTo(full.index - 1);
    });
  }

  /* ---------- start the view on screen (first load, and after every in-site link) ---------- */
  function init() {
    const view = $("#view");
    page = view.dataset.page;
    view.removeAttribute("aria-busy");   // entrance animations start now, with the content
    currentCarId = page === "car" ? new URLSearchParams(location.search).get("id") : null;
    shown = location.pathname + location.search;
    $$("[data-nav]").forEach((a) => a.removeAttribute("aria-current"));
    if (page === "home") $('[data-nav="sale"]').setAttribute("aria-current", "page");
    if (page === "sold") $('[data-nav="sold"]').setAttribute("aria-current", "page");
    if (page === "home") initHome();
    if (page === "sold") initSold();
    if (page === "car") initCar();
    syncThemeControls();
  }

  // First load: grey placeholder cards show until the cars arrive.
  syncThemeControls();
  fillContacts("Yo, what cars do you have right now?");
  const firstCar = $("#view").dataset.page === "car" ? new URLSearchParams(location.search).get("id") : null;
  Promise.all([loadCars(), loadCar(firstCar)]).then(init, () => {
    const view = $("#view");
    view.removeAttribute("aria-busy");
    $("main", view).replaceChildren(fromHtml(`
      <div class="wrap empty load-error">
        ${icon("wifi-off", "ic empty-icon")}
        <h1>Couldn't load the cars</h1>
        <button class="btn btn-accent" type="button">Try again</button>
      </div>`));
    $(".load-error button").addEventListener("click", () => location.reload());
  });
})();
