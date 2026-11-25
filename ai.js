"use strict";

window.PIN = (function () {
  const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|avif|bmp)(\?|$)/i;
  const PROXIES_HTML = [
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
    (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  ];
  const PROXIES_BIN = [
    (u) => "https://images.weserv.nl/?url=" + encodeURIComponent(u.replace(/^https?:\/\//, "")),
    (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  ];

  async function fetchX(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 20000);
    try {
      return await fetch(url, { signal: ctrl.signal });
    } finally {
      clearTimeout(t);
    }
  }

  async function firstOk(makers) {
    let last = null;
    for (const make of makers) {
      try {
        const res = await fetchX(make());
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res;
      } catch (e) {
        last = e;
      }
    }
    throw last || new Error("ошибка сети");
  }

  function isProbablyImage(url) {
    return IMAGE_EXT_RE.test(url) || url.startsWith("data:");
  }

  async function extractFromHtml(html) {
    const patterns = [
      /<meta[^>]+property=["']og:image(:secure_url)?["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(:secure_url)?["']/i,
      /"images?"\s*:\s*{\s*[^{}]*"orig"\s*:\s*\{\s*"url"\s*:\s*"([^"]+)"/i,
      /<img[^>]+src=["']([^"']*pinimg\.com[^"']*)["']/i,
    ];
    for (const re of patterns) {
      const m = html.match(re);
      if (m) {
        const found = m[2] || m[1];
        if (found) return found.replace(/&amp;/g, "&").replace(/\\\//g, "/");
      }
    }
    return null;
  }

  async function resolvePinImage(url) {
    if (isProbablyImage(url)) return url;
    const html = await (await firstOk(PROXIES_HTML.map((p) => () => p(url)))).text();
    const found = await extractFromHtml(html);
    if (!found) throw new Error("В пине не найдена картинка — попробуйте прямую ссылку на изображение (i.pinimg.com/...)");
    return found;
  }

  async function resolvePinImagesAll(url) {
    if (isProbablyImage(url)) return [url];
    const html = await (await firstOk(PROXIES_HTML.map((p) => () => p(url)))).text();
    const urls = new Set();
    const og = await extractFromHtml(html);
    if (og) urls.add(og);
    const re = /https?:\/\/[^"'\s\\]+pinimg\.com[^"'\s\\]+/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
      const u = m[0];
      if (/\.(jpe?g|png|webp|gif)/i.test(u) && !/avatars|user|profile|favicon/i.test(u)) urls.add(u.replace(/\\\//g, "/"));
    }
    const list = [...urls].slice(0, 12);
    if (!list.length) throw new Error("Картинки в пине не найдены");
    return list;
  }

  async function urlToBlob(url) {
    if (url.startsWith("data:")) return (await fetch(url)).blob();
    const res = await firstOk(PROXIES_BIN.map((p) => () => p(url)));
    return res.blob();
  }

  async function urlToDataUrl(url) {
    const blob = await urlToBlob(url);
    return await blobToDataUrl(blob);
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  return { resolvePinImage, resolvePinImagesAll, urlToBlob, urlToDataUrl, blobToDataUrl, isProbablyImage };
})();

window.AI = (function () {
  const TONES = {
    "дружелюбный и лёгкий": "тёплый, дружелюбный тон, обращение на «вы»",
    "экспертный и деловой": "экспертный деловой тон без воды",
    "продающий, с призывом к действию": "продающий тон с призывом к действию",
    "весёлый, с юмором": "лёгкий весёлый тон с юмором",
    "короткий и ёмкий": "очень короткий ёмкий текст",
  };

  function cfg(settings) {
    const base = (settings.apiBase || "https://api.openai.com/v1").replace(/\/+$/, "");
    return base + "/chat/completions";
  }

  async function chat(settings, messages, opts) {
    if (!settings.apiKey) throw new Error("Укажите API-ключ в настройках (⚙️)");
    if (!settings.model) throw new Error("Укажите модель в настройках (⚙️)");
    const o = opts || {};
    const res = await fetch(cfg(settings), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + settings.apiKey,
      },
      body: JSON.stringify({
        model: settings.model,
        messages,
        temperature: o.temperature != null ? o.temperature : 0.9,
        max_tokens: o.maxTokens || 1500,
      }),
    });
    if (!res.ok) {
      let detail = "HTTP " + res.status;
      try {
        const j = await res.json();
        if (j.error && j.error.message) detail = j.error.message;
      } catch (e) { /* без деталей */ }
      throw new Error(detail);
    }
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
    if (!text) throw new Error("Пустой ответ модели");
    return text;
  }

  function systemPrompt(settings, context) {
    return [
      "Ты — опытный SMM-копирайтер. Пиши посты для соцсетей на русском языке.",
      "Стиль: " + (TONES[settings.tone] || settings.tone || "дружелюбный и лёгкий") + ".",
      "Пост должен быть готов к публикации: уместные эмодзи, абзацы, без пояснений от ИИ.",
      context ? "Контекст: " + context : "",
      "Верни ответ строго JSON-массивом строк, без markdown и без пояснений.",
    ].filter(Boolean).join(" ");
  }

  function parseVariants(text) {
    let t = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
    try {
      const arr = JSON.parse(t);
      if (Array.isArray(arr)) {
        const list = arr.map(String).map((s) => s.trim()).filter(Boolean);
        if (list.length) return list;
      }
    } catch (e) { /* не JSON */ }
    const parts = t.split(/\n\s*---+\s*\n/).map((s) => s.trim()).filter(Boolean);
    return parts.length ? parts : [t];
  }

  async function variants(settings, task, topic, imageDataUrl) {
    const n = Math.max(1, Math.min(5, settings.variants || 3));
    const userParts = [];
    let userText = task;
    if (topic) userText += "\n\nТема поста: " + topic;
    userParts.push({ type: "text", text: userText + "\n\nСделай " + n + " разных вариантов." });

    if (imageDataUrl) {
      userParts.push({ type: "image_url", image_url: { url: imageDataUrl, detail: "auto" } });
    }

    const text = await chat(settings, [
      { role: "system", content: systemPrompt(settings) },
      { role: "user", content: userParts },
    ], { temperature: 0.95, maxTokens: imageDataUrl ? 2200 : 1600 });

    return parseVariants(text).slice(0, n);
  }

  function expandTask(raw) {
    if (raw && raw.trim().length > 40) return raw.trim();
    return "Напиши пост по теме: «" + (raw && raw.trim() ? raw.trim() : "мета о бизнесе/lifestyle") + "»";
  }

  const IMAGE_VARIANT_TASK = "Опиши картинку и напиши к ней пост для соцсетей: живое описание, что зацепит зрителя, актуальные хэштеги.";

  return { variants, expandTask, IMAGE_VARIANT_TASK };
})();
