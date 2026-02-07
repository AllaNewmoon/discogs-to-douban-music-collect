(() => {
  // 只在 Discogs 的 release / master 页面运行
  if (
    !location.hostname.includes("discogs.com") ||
    !/^\/(release|master)\//.test(location.pathname)
  ) {
    return;
  }

  console.log("[D2D][search] loaded");

  function clean(s) {
    return String(s || "").replace(/\s+/g, " ").trim();
  }

  function cleanArtistName(name) {
    return String(name || "")
        .replace(/\s*\(\d+\)\s*/g, "") // 去掉 (1)(2)
        .replace(/[*✱]+/g, "")         // 去掉 *
        .replace(/\s+/g, " ")
        .trim();
}

  function getArtistAndAlbum() {
  let artist = "";
  let album = "";

  const h1 = document.querySelector("h1");
  if (h1) {
    const text = clean(h1.textContent);
    const parts = text.split("–");
    if (parts.length >= 2) {
      artist = cleanArtistName(parts[0]);              // ✅ 用 cleanArtistName
      album = clean(parts.slice(1).join("–"));
    } else {
      album = text;
    }
  }

  // artist 兜底：找 Discogs artist 链接
  if (!artist) {
    const a =
      document.querySelector("h1 a[href*='/artist/']") ||
      document.querySelector(".profile a[href*='/artist/']");
    if (a) artist = cleanArtistName(a.textContent);    // ✅ 用 cleanArtistName
  }

  return { artist, album };
}

  function injectSearchButton() {
    if (document.getElementById("d2d-search-btn")) return;

    const btn = document.createElement("button");
    btn.id = "d2d-search-btn";
    btn.textContent = "Search";
    btn.title = "在豆瓣搜索该专辑";
    btn.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      z-index: 999999;
      padding: 8px 12px;
      border: 0;
      border-radius: 6px;
      background: #1f1f1f;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,.25);
      opacity: .92;
    `;

    btn.onmouseenter = () => (btn.style.opacity = "1");
    btn.onmouseleave = () => (btn.style.opacity = ".92");

    btn.onclick = () => {
      const { artist, album } = getArtistAndAlbum();
      const q = clean([artist, album].filter(Boolean).join(" "));

      if (!q) {
        console.warn("[D2D][search] empty query");
        return;
      }

      const url =
        "https://music.douban.com/subject_search?cat=1003&search_text=" +
        encodeURIComponent(q);

      console.log("[D2D][search] open:", q);
      window.open(url, "_blank");
    };

    document.body.appendChild(btn);
  }

  // Discogs 是 SPA，切 release / master 时要重新插
  const observer = new MutationObserver(() => {
    injectSearchButton();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  injectSearchButton();
})();
