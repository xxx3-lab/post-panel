"use strict";

const PLATFORMS = [
  { id: "twitter", name: "X / Twitter", icon: "𝕏", limit: 280 },
  { id: "instagram", name: "Instagram", icon: "📸", limit: 2200 },
  { id: "telegram", name: "Telegram", icon: "✈️", limit: 4096 },
  { id: "vk", name: "VK", icon: "🅥", limit: 16000 },
  { id: "facebook", name: "Facebook", icon: "f", limit: 63206 },
];

const EMOJIS = [
  "😀","😅","😂","🤣","😊","😍","🥰","😎","🤔","🙃","😉","😴",
  "👏","👍","🙌","🤝","💪","🙏","👀","🔥","✨","⭐","💥","💯",
  "❤️","🧡","💛","💚","💙","💜","🤍","💔","🎉","🎊","🎁","🥳",
  "📌","🛒","🏷️","💰","💎","🚀","⏰","📅","✅","❌","⚡","🌟",
  "🌸","🍀","🌿","🌊","🌞","🌙","☕","🍕","🍰","🍷","🐱","🐶",
  "📷","💡","📈","🎯","📝","🔔","💬","🔗","🎨","🎵","🧠","⚽",
];

const DEFAULT_SETTINGS = {
  apiBase: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  variants: 3,
  tone: "дружелюбный и лёгкий",
};

const STORE_KEY = "postPanelStore_v2";
const MAX_STORE_BYTES = 4 * 1024 * 1024;

let store = {
  settings: { ...DEFAULT_SETTINGS },
  images: [],
  collections: [],
  drafts: [],
  history: [],
  current: { text: "", attachedIds: [], platforms: PLATFORMS.map((p) => p.id) },
};

let pinPreviewUrls = [];
let pickerSelection = [];
let collectionsImageId = null;
let saveTimer = null;

const $ = (id) => document.getElementById(id);

function esc(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function toast(msg, ms) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add("hidden"), ms || 2400);
}

function fmtDate(ts) {
  return new Date(ts).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function snippet(s, n) {
  const one = String(s).replace(/\s+/g, " ").trim();
  return one.length > n ? one.slice(0, n) + "…" : one;
}

function imageById(id) {
  return store.images.find((i) => i.id === id) || null;
}

function collectionNames() {
  const set = new Set(store.collections);
  store.images.forEach((img) => (img.collections || []).forEach((c) => set.add(c)));
  return [...set];
}

function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
      $("saveStatus").textContent = "Сохранено " + new Date().toLocaleTimeString("ru-RU");
    } catch (e) {
      $("saveStatus").textContent = "Хранилище переполнено";
      toast("Хранилище браузера переполнено — удалите часть картинок", 3500);
    }
  }, 400);
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    store = {
      settings: Object.assign({}, DEFAULT_SETTINGS, data.settings || {}),
      images: Array.isArray(data.images) ? data.images : [],
      collections: Array.isArray(data.collections) ? data.collections : [],
      drafts: Array.isArray(data.drafts) ? data.drafts : [],
      history: Array.isArray(data.history) ? data.history : [],
      current: Object.assign({ text: "", attachedIds: [], platforms: PLATFORMS.map((p) => p.id) }, data.current || {}),
    };
  } catch (e) { /* стартуем с пустого */ }
}

function storeBytes() {
  return new Blob([JSON.stringify(store)]).size;
}

function addDataUrlImage(dataUrl, name, source) {
  const img = { id: uid(), name: name || "image.jpg", dataUrl, fav: false, collections: [], source: source || "file", ts: Date.now() };
  store.images.unshift(img);
  return img;
}

function deleteImage(id) {
  const img = imageById(id);
  if (!img) return;
  store.current.attachedIds = store.current.attachedIds.filter((x) => x !== id);
  store.images = store.images.filter((i) => i.id !== id);
  saveStore();
  renderGallery();
  renderAttachStrip();
  renderPreview();
}

function attachImage(id) {
  if (!store.current.attachedIds.includes(id)) {
    store.current.attachedIds.push(id);
    saveStore();
  }
  renderAttachStrip();
  renderPreview();
  renderGallery();
}

function detachImage(id) {
  store.current.attachedIds = store.current.attachedIds.filter((x) => x !== id);
  saveStore();
  renderAttachStrip();
  renderPreview();
  renderGallery();
}

function switchView(name) {
  document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + name));
  if (name === "gallery") renderGallery();
  if (name === "history") renderHistory();
}

function openModal(id) {
  $(id).classList.remove("hidden");
}
function closeModal(id) {
  $(id).classList.add("hidden");
}
function closeAllModals() {
  document.querySelectorAll(".modal-backdrop").forEach((m) => m.classList.add("hidden"));
}

function renderPlatforms() {
  const wrap = $("platformList");
  wrap.innerHTML = "";
  const len = [...$("postText").value].length;
  PLATFORMS.forEach((p) => {
    const on = store.current.platforms.includes(p.id);
    const chip = document.createElement("label");
    chip.className = "platform-chip" + (on ? " on" : "");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = on;
    cb.addEventListener("change", () => {
      if (cb.checked) {
        if (!store.current.platforms.includes(p.id)) store.current.platforms.push(p.id);
      } else {
        store.current.platforms = store.current.platforms.filter((x) => x !== p.id);
      }
      renderPreviewTabs();
      renderPreview();
      saveStore();
    });
    chip.appendChild(cb);
    chip.appendChild(document.createTextNode(p.icon + " " + p.name));
    const cnt = document.createElement("span");
    cnt.className = "cnt " + (len > p.limit ? "cnt-err" : len > p.limit * 0.85 ? "cnt-warn" : "cnt-ok");
    cnt.textContent = len + "/" + p.limit;
    chip.appendChild(cnt);
    wrap.appendChild(chip);
  });
}

function renderPreviewTabs() {
  const tabs = $("previewTabs");
  tabs.innerHTML = "";
  PLATFORMS.forEach((p) => {
    if (!store.current.platforms.includes(p.id)) return;
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = p.icon + " " + p.name;
    b.classList.toggle("active", tabs.dataset.active === p.id);
    if (!tabs.dataset.active) b.classList.add("active");
    b.addEventListener("click", () => {
      tabs.dataset.active = p.id;
      renderPreview();
    });
    tabs.appendChild(b);
  });
}

function renderPreview() {
  if (!$("previewTabs").querySelector("button")) {
    $("previewTabs").dataset.active = "";
    renderPreviewTabs();
  }
  const chosen = PLATFORMS.find((p) => p.id === $("previewTabs").dataset.active) ||
    PLATFORMS.find((p) => store.current.platforms.includes(p.id)) || PLATFORMS[0];
  if (!store.current.platforms.includes(chosen.id)) renderPreviewTabs();

  const text = $("postText").value;
  const len = [...text].length;
  const imgs = store.current.attachedIds.map(imageById).filter(Boolean).slice(0, 4);
  const imgCls = "preview-images " + (imgs.length ? "n" + Math.min(imgs.length, 4) : "n1");

  const card = $("previewCard");
  card.innerHTML =
    '<p class="preview-text">' + (esc(text) || '<span style="color:var(--muted)">Текст поста появится здесь…</span>') + "</p>" +
    (imgs.length ? '<div class="' + imgCls + '">' + imgs.map((i) => '<img src="' + i.dataUrl + '" alt="">').join("") + "</div>" : "") +
    '<div class="preview-meta">' +
      '<span class="preview-avatar">' + chosen.icon + "</span>" +
      '<span class="preview-platform">' + esc(chosen.name) + "</span>" +
      "<span>" + len + " / " + chosen.limit + "</span>" +
      (len > chosen.limit ? '<span style="color:var(--err)">— превышен лимит!</span>' : "") +
    "</div>";
}

function renderAttachStrip() {
  const strip = $("attachStrip");
  strip.innerHTML = "";
  store.current.attachedIds.map(imageById).filter(Boolean).forEach((img) => {
    const item = document.createElement("div");
    item.className = "attach-item";
    item.title = img.name;
    const el = document.createElement("img");
    el.src = img.dataUrl;
    item.appendChild(el);
    const rm = document.createElement("button");
    rm.className = "rm";
    rm.type = "button";
    rm.textContent = "✕";
    rm.addEventListener("click", () => detachImage(img.id));
    item.appendChild(rm);
    strip.appendChild(item);
  });
}

function renderGallery() {
  const grid = $("masonry");
  grid.innerHTML = "";
  const favOnly = $("filterSelect").value === "fav";

  const items = store.images.filter((img) => {
    if (favOnly && !img.fav) return false;
    const val = $("filterSelect").value;
    if (val.startsWith("col:")) return (img.collections || []).includes(val.slice(4));
    return true;
  });

  $("galleryEmpty").classList.toggle("hidden", items.length > 0);
  $("tabGalleryCount").textContent = "Галерея (" + store.images.length + ")";

  items.forEach((img) => {
    const card = document.createElement("div");
    card.className = "m-card";

    const el = document.createElement("img");
    el.src = img.dataUrl;
    el.alt = img.name;
    el.loading = "lazy";
    el.addEventListener("click", () => attachImage(img.id));
    card.appendChild(el);

    const body = document.createElement("div");
    body.className = "m-body";

    const name = document.createElement("div");
    name.className = "m-name";
    name.textContent = img.name;
    body.appendChild(name);

    const tools = document.createElement("div");
    tools.className = "m-tools";

    const mk = (icon, cls, title, fn) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "icon-btn" + (cls ? " " + cls : "");
      b.textContent = icon;
      b.title = title;
      b.addEventListener("click", fn);
      return b;
    };

    tools.appendChild(mk("⭐", img.fav ? "fav" : "", "В избранное", () => {
      img.fav = !img.fav;
      saveStore();
      renderGallery();
    }));
    tools.appendChild(mk("➕", store.current.attachedIds.includes(img.id) ? "attached" : "", "В пост", () => {
      if (store.current.attachedIds.includes(img.id)) detachImage(img.id);
      else attachImage(img.id);
    }));
    tools.appendChild(mk("🏷️", "col", "Коллекции", () => openCollections(img.id)));
    tools.appendChild(mk("📋", "", "Скопировать в буфер", () => copyImageDataUrl(img.dataUrl)));
    tools.appendChild(mk("⬇️", "", "Скачать", () => downloadDataUrl(img.dataUrl, img.name)));
    tools.appendChild(mk("🗑️", "", "Удалить", () => deleteImage(img.id)));
    body.appendChild(tools);

    if ((img.collections || []).length) {
      const tags = document.createElement("div");
      tags.className = "col-tags";
      img.collections.forEach((c) => {
        const t = document.createElement("span");
        t.className = "col-tag";
        t.textContent = c;
        tags.appendChild(t);
      });
      body.appendChild(tags);
    }

    card.appendChild(body);
    grid.appendChild(card);
  });
}

function rebuildFilterOptions() {
  const sel = $("filterSelect");
  const val = sel.value;
  sel.innerHTML = '<option value="all">Все картинки</option><option value="fav">⭐ Избранное</option>';
  collectionNames().forEach((name) => {
    const o = document.createElement("option");
    o.value = "col:" + name;
    o.textContent = "🏷 " + name;
    sel.appendChild(o);
  });
  sel.value = [...sel.options].some((o) => o.value === val) ? val : "all";
}

function openCollections(imageId) {
  collectionsImageId = imageId;
  const img = imageById(imageId);
  if (!img) return;
  const body = $("collectionsBody");
  body.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "collection-check";
  collectionNames().forEach((name) => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = (img.collections || []).includes(name);
    cb.addEventListener("change", () => {
      img.collections = img.collections || [];
      if (cb.checked) img.collections.push(name);
      else img.collections = img.collections.filter((c) => c !== name);
      saveStore();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode("🏷 " + name));
    wrap.appendChild(label);
  });
  body.appendChild(wrap);

  const row = document.createElement("div");
  row.className = "field";
  row.innerHTML = '<span>Новая коллекция</span>';
  const irow = document.createElement("div");
  irow.style.display = "flex";
  irow.style.gap = "8px";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Например: Лето 2025";
  const btn = document.createElement("button");
  btn.className = "btn accent small";
  btn.type = "button";
  btn.textContent = "Создать";
  btn.addEventListener("click", () => {
    const name = input.value.trim();
    if (!name) return;
    img.collections = img.collections || [];
    if (!img.collections.includes(name)) img.collections.push(name);
    if (!store.collections.includes(name)) store.collections.push(name);
    saveStore();
    rebuildFilterOptions();
    openCollections(imageId);
    toast("Добавлено в «" + name + "»");
  });
  irow.appendChild(input);
  irow.appendChild(btn);
  row.appendChild(irow);
  body.appendChild(row);
  openModal("collectionsModal");
}

async function importPin() {
  const url = $("pinUrl").value.trim();
  if (!url) {
    toast("Вставьте ссылку на пин или картинку");
    return;
  }
  const btn = $("pinAddBtn");
  btn.disabled = true;
  btn.textContent = "Ищем...";
  try {
    pinPreviewUrls = await window.PIN.resolvePinImagesAll(url);
    renderPinPreview();
    openModal("pinPreviewModal");
  } catch (e) {
    toast(e.message || "Ошибка импорта", 3500);
  } finally {
    btn.disabled = false;
    btn.textContent = "📌 Импорт";
  }
}

function renderPinPreview() {
  const body = $("pinPreviewBody");
  body.innerHTML = "";
  pinPreviewUrls.forEach((u, idx) => {
    const label = document.createElement("label");
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = idx === 0;
    cb.dataset.url = u;
    label.appendChild(cb);
    const img = document.createElement("img");
    img.src = u;
    img.loading = "lazy";
    label.appendChild(img);
    const cap = document.createElement("span");
    cap.textContent = u.split("/").pop().slice(0, 28) || "картинка";
    label.appendChild(cap);
    body.appendChild(label);
  });
}

async function confirmPinAdd() {
  const cbs = [...$("pinPreviewBody").querySelectorAll("input:checked")];
  if (!cbs.length) {
    toast("Отметьте хотя бы одну картинку");
    return;
  }
  $("pinConfirmAdd").disabled = true;
  $("pinPreviewBody").classList.add("hidden");
  try {
    const added = [];
    const totalBefore = storeBytes();
    for (const cb of cbs) {
      try {
        const dataUrl = await window.PIN.urlToDataUrl(cb.dataset.url);
        const pinId = ($("pinUrl").value.match(/pin\/(\d+)/) || [])[1];
        const name = pinId && cbs.length > 1
          ? "pin-" + pinId + "-" + (cbs.indexOf(cb) + 1) + ".jpg"
          : pinId ? "pin-" + pinId + ".jpg" : "pinterest.jpg";
        added.push(addDataUrlImage(dataUrl, name, "pin"));
      } catch (e) {
        toast("Не удалось скачать: " + snippet(e.message, 80), 3500);
      }
    }
    if (added.length) {
      saveStore();
      $("pinUrl").value = "";
      closeModal("pinPreviewModal");
      toast("Добавлено картинок: " + added.length + " ✨");
      renderGallery();
      renderPreview();
      if (totalBefore + added.length * 400000 > MAX_STORE_BYTES) {
        toast("Галерея близка к лимиту хранилища — часть картинок может не сохраниться");
      }
    }
  } finally {
    $("pinConfirmAdd").disabled = false;
    $("pinPreviewBody").classList.remove("hidden");
  }
}

function openGalleryPicker() {
  const body = $("galleryPickerBody");
  body.innerHTML = "";
  pickerSelection = [...store.current.attachedIds];
  store.images.forEach((img) => {
    const item = document.createElement("div");
    item.className = "picker-item" + (pickerSelection.includes(img.id) ? " sel" : "");
    const el = document.createElement("img");
    el.src = img.dataUrl;
    el.loading = "lazy";
    item.appendChild(el);
    item.addEventListener("click", () => {
      if (pickerSelection.includes(img.id)) {
        pickerSelection = pickerSelection.filter((x) => x !== img.id);
        item.classList.remove("sel");
      } else {
        pickerSelection.push(img.id);
        item.classList.add("sel");
      }
    });
    body.appendChild(item);
  });
  openModal("galleryPickerModal");
}

function applyGalleryPicker() {
  store.current.attachedIds = pickerSelection.filter((id) => imageById(id));
  saveStore();
  closeModal("galleryPickerModal");
  renderAttachStrip();
  renderPreview();
}

function addFiles(files) {
  const valid = [...files].filter((f) => f.type.startsWith("image/"));
  if (!valid.length) {
    toast("Нет изображений для добавления");
    return;
  }
  let queued = 0;
  let done = 0;
  const finish = () => {
    if (done === queued) {
      saveStore();
      renderGallery();
      toast("Добавлено картинок: " + done);
    }
  };
  valid.forEach((f) => {
    queued++;
    const r = new FileReader();
    r.onload = () => {
      addDataUrlImage(r.result, f.name, "file");
      done++;
      finish();
    };
    r.onerror = () => {
      done++;
      finish();
    };
    r.readAsDataURL(f);
  });
}

function addText() {
  const input = $("hashtagInput");
  const ta = $("postText");
  const words = input.value.split(/[\s,]+/).map((w) => w.trim()).filter(Boolean)
    .map((w) => (w.startsWith("#") ? w : "#" + w.replace(/^#+/, "")));
  if (!words.length) return;
  const unique = words.filter((w) => !ta.value.includes(w));
  if (!unique.length) {
    toast("Такие хэштеги уже есть");
    input.value = "";
    return;
  }
  ta.value = (ta.value.trimEnd() + (ta.value.trim() ? "\n\n" : "") + unique.join(" ")).trimStart();
  input.value = "";
  onTextChanged();
}

function onTextChanged() {
  store.current.text = $("postText").value;
  renderPlatforms();
  renderPreview();
  saveStore();
}

async function copyText() {
  const text = $("postText").value;
  if (!text) {
    toast("Нечего копировать");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Текст скопирован ✓");
  } catch (e) {
    const ta = $("postText");
    ta.select();
    document.execCommand("copy");
    toast("Текст скопирован ✓");
  }
}

async function copyImageDataUrl(dataUrl) {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    let png = blob;
    if (blob.type !== "image/png") {
      const bmp = await createImageBitmap(blob);
      const canvas = document.createElement("canvas");
      canvas.width = bmp.width;
      canvas.height = bmp.height;
      canvas.getContext("2d").drawImage(bmp, 0, 0);
      png = await new Promise((res) => canvas.toBlob(res, "image/png"));
    }
    await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
    toast("Картинка скопирована ✓");
  } catch (e) {
    toast("Браузер не поддерживает копирование картинок");
  }
}

function downloadDataUrl(dataUrl, name) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name || "image.jpg";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function downloadAllImages() {
  const imgs = store.current.attachedIds.map(imageById).filter(Boolean);
  if (!imgs.length) {
    toast("К посту не прикреплены картинки");
    return;
  }
  imgs.forEach((img, i) => setTimeout(() => downloadDataUrl(img.dataUrl, img.name), i * 250));
}

function downloadText() {
  const text = $("postText").value;
  if (!text) {
    toast("Текст пуст");
    return;
  }
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "post.txt";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function saveDraft() {
  const text = $("postText").value.trim();
  if (!text && !store.current.attachedIds.length) {
    toast("Пустой пост — сохранить нечего");
    return;
  }
  store.drafts.unshift({
    id: uid(),
    text,
    imageIds: [...store.current.attachedIds],
    platforms: [...store.current.platforms],
    ts: Date.now(),
  });
  if (store.drafts.length > 30) store.drafts.pop();
  saveStore();
  renderDraftCount();
  toast("Черновик сохранён 💾");
}

function renderDraftCount() {
  $("draftCount").textContent = store.drafts.length;
}

function openDrafts() {
  const list = $("draftsList");
  list.innerHTML = "";
  if (!store.drafts.length) {
    list.innerHTML = '<div class="ai-loading">Черновиков пока нет</div>';
  }
  store.drafts.forEach((d) => {
    const item = document.createElement("div");
    item.className = "draft-item";
    const main = document.createElement("div");
    main.className = "d-snippet";
    main.innerHTML =
      '<div class="d-meta">' + fmtDate(d.ts) + " · картинок: " + (d.imageIds || []).length + "</div>" +
      '<div class="d-text">' + (esc(snippet(d.text, 140)) || '<span style="color:var(--muted)">без текста</span>') + "</div>";
    item.appendChild(main);
    const restore = document.createElement("button");
    restore.className = "btn small accent";
    restore.type = "button";
    restore.textContent = "Восстановить";
    restore.addEventListener("click", () => {
      $("postText").value = d.text;
      store.current.attachedIds = (d.imageIds || []).map(imageById).filter(Boolean).map((i) => i.id);
      store.current.platforms = (d.platforms || PLATFORMS.map((p) => p.id)).filter((p) => PLATFORMS.some((x) => x.id === p));
      saveStore();
      onTextChanged();
      renderAttachStrip();
      renderPreview();
      closeModal("draftsModal");
      switchView("composer");
      toast("Черновик восстановлен");
    });
    item.appendChild(restore);
    const del = document.createElement("button");
    del.className = "btn small ghost";
    del.type = "button";
    del.textContent = "🗑️";
    del.addEventListener("click", () => {
      store.drafts = store.drafts.filter((x) => x.id !== d.id);
      saveStore();
      renderDraftCount();
      openDrafts();
    });
    item.appendChild(del);
    list.appendChild(item);
  });
  openModal("draftsModal");
}

function toHistory() {
  const text = $("postText").value.trim();
  const imgs = store.current.attachedIds.map(imageById).filter(Boolean);
  if (!text && !imgs.length) {
    toast("Пустой пост — в историю нечего добавлять");
    return;
  }
  store.history.unshift({
    id: uid(),
    text,
    platforms: [...store.current.platforms],
    images: imgs.slice(0, 4).map((i) => i.dataUrl),
    ts: Date.now(),
  });
  if (store.history.length > 50) store.history.pop();
  saveStore();
  renderHistory();
  toast("Добавлено в историю 🕘");
}

function renderHistory() {
  const list = $("historyList");
  list.innerHTML = "";
  $("historyEmpty").classList.toggle("hidden", store.history.length > 0);
  store.history.forEach((h) => {
    const item = document.createElement("div");
    item.className = "history-item";

    const main = document.createElement("div");
    main.className = "h-text";
    const platIcons = PLATFORMS.filter((p) => (h.platforms || []).includes(p.id)).map((p) => p.icon).join(" ");
    main.innerHTML =
      '<div class="h-meta"><span>🕘 ' + fmtDate(h.ts) + "</span><span>" + esc(platIcons) + "</span><span>" + [...(h.text || "")].length + " симв.</span></div>" +
      '<div class="h-snippet">' + (esc(h.text) || '<span style="color:var(--muted)">без текста</span>') + "</div>";
    item.appendChild(main);

    if ((h.images || []).length) {
      const thumbs = document.createElement("div");
      thumbs.className = "h-thumbs";
      h.images.forEach((src) => {
        const im = document.createElement("img");
        im.src = src;
        thumbs.appendChild(im);
      });
      item.appendChild(thumbs);
    }

    const tools = document.createElement("div");
    tools.className = "h-tools";
    const reuse = document.createElement("button");
    reuse.className = "btn small accent";
    reuse.type = "button";
    reuse.textContent = "Повторить пост";
    reuse.addEventListener("click", () => {
      $("postText").value = h.text || "";
      store.current.attachedIds = [];
      saveStore();
      onTextChanged();
      renderAttachStrip();
      renderPreview();
      switchView("composer");
      toast("Текст загружен в редактор");
    });
    tools.appendChild(reuse);
    const del = document.createElement("button");
    del.className = "btn small ghost";
    del.type = "button";
    del.textContent = "🗑️";
    del.addEventListener("click", () => {
      store.history = store.history.filter((x) => x.id !== h.id);
      saveStore();
      renderHistory();
    });
    tools.appendChild(del);
    item.appendChild(tools);

    list.appendChild(item);
  });
}

function openSettings() {
  $("sApiBase").value = store.settings.apiBase;
  $("sApiKey").value = store.settings.apiKey;
  $("sModel").value = store.settings.model;
  $("sVariants").value = String(store.settings.variants);
  $("sTone").value = store.settings.tone;
  openModal("settingsModal");
}

function applySettings() {
  store.settings = {
    apiBase: $("sApiBase").value.trim() || DEFAULT_SETTINGS.apiBase,
    apiKey: $("sApiKey").value.trim(),
    model: $("sModel").value.trim() || DEFAULT_SETTINGS.model,
    variants: parseInt($("sVariants").value, 10) || 3,
    tone: $("sTone").value,
  };
  saveStore();
  closeModal("settingsModal");
  toast("Настройки сохранены ⚙️");
}

function clearAllData() {
  if (!confirm("Удалить все картинки, черновики, историю и настройки?")) return;
  localStorage.removeItem(STORE_KEY);
  store = {
    settings: { ...DEFAULT_SETTINGS },
    images: [],
    collections: [],
    drafts: [],
    history: [],
    current: { text: "", attachedIds: [], platforms: PLATFORMS.map((p) => p.id) },
  };
  $("postText").value = "";
  rebuildFilterOptions();
  renderGallery();
  renderAttachStrip();
  renderPlatforms();
  renderPreview();
  renderDraftCount();
  renderHistory();
  closeModal("settingsModal");
  toast("Все данные очищены");
}

function showAiModal(loading) {
  $("aiBody").innerHTML = '<div class="ai-loading">Генерируем варианты...</div>';
  $("aiRegenerate").classList.toggle("hidden", loading);
  openModal("aiModal");
}

function renderAiVariants(variants) {
  const body = $("aiBody");
  body.innerHTML = "";
  variants.forEach((v, idx) => {
    const card = document.createElement("div");
    card.className = "ai-variant";
    const p = document.createElement("p");
    p.textContent = "Вариант " + (idx + 1);
    card.appendChild(p);
    const text = document.createElement("div");
    text.className = "v-text";
    text.style.cssText = "font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-word;margin-bottom:10px;max-height:200px;overflow-y:auto";
    text.textContent = v;
    card.appendChild(text);
    const tools = document.createElement("div");
    tools.className = "v-tools";
    const mkBtn = (label, primary, fn) => {
      const b = document.createElement("button");
      b.className = "btn small" + (primary ? " accent" : " ghost");
      b.type = "button";
      b.textContent = label;
      b.addEventListener("click", fn);
      return b;
    };
    tools.appendChild(mkBtn("✓ Использовать", true, () => {
      $("postText").value = v;
      onTextChanged();
      closeModal("aiModal");
      toast("Вариант " + (idx + 1) + " вставлен ✨");
    }));
    tools.appendChild(mkBtn("＋ К тексту", false, () => {
      const ta = $("postText");
      ta.value = (ta.value.trimEnd() + "\n\n" + v).trimStart();
      onTextChanged();
      closeModal("aiModal");
    }));
    tools.appendChild(mkBtn("📋", false, async () => {
      try {
        await navigator.clipboard.writeText(v);
        toast("Скопировано ✓");
      } catch (e) {
        toast("Не удалось скопировать");
      }
    }));
    card.appendChild(tools);
    body.appendChild(card);
  });
}

function renderAiError(msg) {
  $("aiBody").innerHTML = '<div class="ai-error">⚠️ ' + esc(msg) + "</div>";
}

async function runAiGeneration(task, useImage) {
  if (!store.settings.apiKey) {
    toast("Сначала укажите ключ и модель в настройках ⚙️");
    openSettings();
    return;
  }
  showAiModal(true);
  try {
    let imageDataUrl = null;
    if (useImage) {
      const img = store.current.attachedIds.map(imageById).filter(Boolean)[0];
      if (!img) {
        toast("Прикрепите к посту хотя бы одну картинку");
        closeModal("aiModal");
        return;
      }
      imageDataUrl = img.dataUrl;
    }
    const variants = await window.AI.variants(store.settings, task, null, imageDataUrl);
    renderAiVariants(variants);
  } catch (e) {
    renderAiError(e.message || "Ошибка запроса к модели");
  }
}

function buildEmojiPicker() {
  const picker = $("emojiPicker");
  EMOJIS.forEach((e) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = e;
    b.addEventListener("click", () => {
      const ta = $("postText");
      const start = ta.selectionStart, end = ta.selectionEnd;
      ta.value = ta.value.slice(0, start) + e + ta.value.slice(end);
      ta.selectionStart = ta.selectionEnd = start + e.length;
      ta.focus();
      onTextChanged();
    });
    picker.appendChild(b);
  });
}

function init() {
  loadStore();
  $("postText").value = store.current.text || "";
  rebuildFilterOptions();

  document.querySelectorAll(".tab").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view)));

  $("postText").addEventListener("input", onTextChanged);

  $("emojiBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    $("emojiPicker").classList.toggle("hidden");
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".emoji-wrap")) $("emojiPicker").classList.add("hidden");
  });

  $("aiBtn").addEventListener("click", () =>
    runAiGeneration(window.AI.expandTask($("postText").value || ""), false));
  $("aiByImageBtn").addEventListener("click", () =>
    runAiGeneration(window.AI.IMAGE_VARIANT_TASK, true));
  $("aiRegenerate").addEventListener("click", () =>
    runAiGeneration($("postText").value ? window.AI.expandTask($("postText").value) : window.AI.IMAGE_VARIANT_TASK, false));

  $("addHashtagsBtn").addEventListener("click", addText);
  $("hashtagInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addText();
    }
  });

  $("copyTextBtn").addEventListener("click", copyText);
  $("downloadTextBtn").addEventListener("click", downloadText);
  $("saveDraftBtn").addEventListener("click", saveDraft);
  $("draftsBtn").addEventListener("click", openDrafts);
  $("toHistoryBtn").addEventListener("click", toHistory);
  $("clearHistoryBtn").addEventListener("click", () => {
    if (!store.history.length) return;
    if (confirm("Очистить всю историю публикаций?")) {
      store.history = [];
      saveStore();
      renderHistory();
    }
  });

  $("cFileBtn").addEventListener("click", () => $("cFileInput").click());
  $("cFileInput").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });
  $("cGalleryBtn").addEventListener("click", openGalleryPicker);
  $("galleryPickerApply").addEventListener("click", applyGalleryPicker);

  $("pinAddBtn").addEventListener("click", importPin);
  $("pinUrl").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      importPin();
    }
  });
  $("pinConfirmAdd").addEventListener("click", confirmPinAdd);

  $("gFileBtn").addEventListener("click", () => $("gFileInput").click());
  $("gFileInput").addEventListener("change", (e) => {
    addFiles(e.target.files);
    e.target.value = "";
  });

  const dz = $("dropZone");
  ["dragenter", "dragover"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add("dragover");
    }));
  ["dragleave", "drop"].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove("dragover");
    }));
  dz.addEventListener("drop", (e) => addFiles(e.dataTransfer.files));

  document.addEventListener("paste", (e) => {
    if ($("view-gallery").classList.contains("active") || $("view-composer").classList.contains("active")) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      const imgs = [...(e.clipboardData.files || [])].filter((f) => f.type.startsWith("image/"));
      if (imgs.length) addFiles(imgs);
    }
  });

  $("filterSelect").addEventListener("change", renderGallery);
  $("newCollectionBtn").addEventListener("click", () => {
    const name = prompt("Название коллекции:");
    if (!name) return;
    const trimmed = name.trim();
    if (trimmed && !store.collections.includes(trimmed)) store.collections.push(trimmed);
    saveStore();
    rebuildFilterOptions();
    $("filterSelect").value = "col:" + trimmed;
    renderGallery();
    toast("Коллекция создана 🏷");
  });

  $("settingsBtn").addEventListener("click", openSettings);
  $("settingsSave").addEventListener("click", applySettings);
  $("clearAllBtn").addEventListener("click", clearAllData);

  document.querySelectorAll(".modal-backdrop").forEach((mb) => {
    mb.addEventListener("click", (e) => {
      if (e.target === mb) mb.classList.add("hidden");
    });
    mb.querySelectorAll("[data-close]").forEach((x) =>
      x.addEventListener("click", () => mb.classList.add("hidden")));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAllModals();
  });

  buildEmojiPicker();
  renderPlatforms();
  renderPreviewTabs();
  renderPreview();
  renderAttachStrip();
  renderGallery();
  renderDraftCount();
  renderHistory();
}

document.addEventListener("DOMContentLoaded", init);
