(() => {
  console.log("[D2D] content script starts");

  const LOCAL_KEY = "D2D_MUSIC_LOCAL";
  const DOUBAN_NEW_SUBJECT = "https://music.douban.com/new_subject";

  /* -------------------- utils -------------------- */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function cleanText(v) {
    return String(v ?? "").replace(/\s+/g, " ").trim();
  }

  function decodeHtmlEntities(s) {
    const str = String(s ?? "");
    // 快速处理常见情况（避免创建节点也能解决 90%）
    const quick = str
      .replace(/&#x27;/gi, "'")
      .replace(/&#39;/g, "'")
      .replace(/&amp;/gi, "&")
      .replace(/&quot;/gi, '"')
      .replace(/&lt;/gi, "<")
      .replace(/&gt;/gi, ">");

    // 兜底：用 textarea 解码任意实体（包含 &#xNNNN;）
    const ta = document.createElement("textarea");
    ta.innerHTML = quick;
    return ta.value;
  }

  function sanitizeFilename(value) {
    return cleanText(value)
      .replace(/[^\x20-\x7E]/g, "") // 去掉非 ASCII（可选：保留也行，但下载更稳）
      .replace(/[\\/:*?"<>|]+/g, "")
      .replace(/\s+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 120);
  }

  function guessExtFromUrl(url) {
    try {
      const u = new URL(url);
      const m = u.pathname.match(/\.(jpg|jpeg|png|webp|gif)$/i);
      if (m) return m[1].toLowerCase();
    } catch (e) {}
    return "jpg";
  }

  // 3) 去掉链接信息（避免审核不过）
  function stripUrls(text) {
    const t = String(text ?? "");
    return t
      .replace(/https?:\/\/\S+/gi, "")
      .replace(/\bwww\.\S+/gi, "")
      .replace(/\s+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function setValue(el, value) {
  if (!el) return;
  el.focus();
  el.value = value ?? "";
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));
}

  async function bgSend(msg) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(msg, (resp) => resolve(resp || { ok: false }));
    });
  }

  // 2) 艺人名去掉 (1)(2) / * / ✱
  function cleanArtistName(name) {
    return cleanText(name)
      .replace(/\s*\(\d+\)\s*/g, "") // (1)(2)
      .replace(/[*✱]+/g, "")         // 去掉星号
      .replace(/\s+/g, " ")
      .trim();
  }

  // 1) 不把 And / & 当分隔符，避免组合名误拆
  function splitArtistsTo3(artistsText) {
    const raw = cleanText(decodeHtmlEntities(artistsText));


    // 只按更可靠的“多人分隔符”拆：
    // 逗号、分号、斜杠、Featuring/feat/ft
    const parts = raw
      .split(/\s*(?:,|;|\/|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b)\s*/i)
      .map(cleanArtistName)
      .filter(Boolean);

    return [parts[0] || "", parts[1] || "", parts[2] || ""];
  }

  function normalizeDateToYYYYMMDD(raw) {
  let t = cleanText(raw);
  if (!t) return "";

  // 先清理：去掉逗号、括号内容、st/nd/rd/th
  t = t
    .replace(/\([^)]*\)/g, " ")
    .replace(/[,]/g, " ")
    .replace(/(\d+)(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // 直接命中：YYYY-MM-DD / YYYY-MM / YYYY
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  if (/^\d{4}-\d{2}$/.test(t)) return `${t}-01`;
  if (/^\d{4}$/.test(t)) return `${t}-01-01`;

  // YYYY/MM/DD 或 YYYY.MM.DD
  let m = t.match(/^(\d{4})[\/.](\d{1,2})[\/.](\d{1,2})$/);
  if (m) {
    const y = m[1];
    const mo = String(Number(m[2])).padStart(2, "0");
    const d = String(Number(m[3])).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }

  // DD/MM/YYYY 或 MM/DD/YYYY（无法可靠区分时按 MM/DD/YYYY 优先，Discogs 更常见英文月，其次是日/月）
  m = t.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    const y = m[3];
    // 如果第一段 > 12，说明是 DD/MM/YYYY
    const month = a > 12 ? b : a;
    const day = a > 12 ? a : b;
    const mo = String(month).padStart(2, "0");
    const d = String(day).padStart(2, "0");
    return `${y}-${mo}-${d}`;
  }

  // 英文月份映射
  const monthMap = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  const monthNum = (name) => monthMap[String(name || "").toLowerCase()] || 0;

  // 1) "12 Oct 1981"
  m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const d = Number(m[1]);
    const mo = monthNum(m[2]);
    const y = Number(m[3]);
    if (y && mo && d) return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // 2) "Oct 12 1981" 或 "October 12 1981"
  m = t.match(/^([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})$/);
  if (m) {
    const mo = monthNum(m[1]);
    const d = Number(m[2]);
    const y = Number(m[3]);
    if (y && mo && d) return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  // 3) "Oct 1981" / "October 1981"
  m = t.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (m) {
    const mo = monthNum(m[1]);
    const y = Number(m[2]);
    if (y && mo) return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-01`;
  }

  // 兜底：抓取年份
  m = t.match(/\b(\d{4})\b/);
  if (m) return `${m[1]}-01-01`;

  return "";
}

  // 你要求的：曲号后补空格 + 人员信息另起行 + 适当空行
  function formatDiscogsTrackText(raw) {
  if (!raw) return "";

  let text = String(raw)
    .replace(/\r/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();

  // A1Title -> A1 Title
  text = text.replace(/(^|\n)([A-Z]\d+)(?=[A-Za-z])/g, "$1$2 ");
  // 纯数字曲号：1Title -> 1 Title  （同时兼容 10Title）
  text = text.replace(/(^|\n)(\d{1,3})(?=[A-Za-z])/g, "$1$2 ");

  // Title 后遇到人员信息关键词时换行（补全更多关键字，兼容 Written–By / Co–producer）
  text = text.replace(
    /(–[^\n]+?)(?=(Vocals|Guitar|Horns|Percussion|Drums|Bass|Keyboards|Synth|Piano|Organ|Strings|Engineer|Producer|Written–By|Written-By|Co–producer|Co-producer))/g,
    "$1\n"
  );

  // 人员信息缩进（补全）
  text = text.replace(
    /\n(Vocals|Guitar|Horns|Percussion|Drums|Bass|Keyboards|Synth|Piano|Organ|Strings|Engineer|Producer|Written–By|Written-By|Co–producer|Co-producer)/g,
    "\n    $1"
  );

  // ===== [FINAL PATCH] 强制把 role 行切开（防止 Queen 那种 Producer 后面又粘 Written–By） =====
  const roles2 =
    "(?:Co–producer|Co-producer|Producer|Executive\\s*Producer|Written–By|Written-By|Engineer|Mixed\\s*By|Mastered\\s*By|Vocals?|Guitar|Horns?|Percussion|Drums?|Bass|Keyboards?|Synth|Piano|Organ|Strings?)";
  const roleGroupRe2 = new RegExp(`(\\b${roles2}\\b(?:\\s*,\\s*\\b${roles2}\\b)*)\\s*–\\s*`, "g");
  text = text.replace(roleGroupRe2, "\n    $1 – ");

  // 去重：连续重复行 + 全局重复行
  const lines = text.split("\n");
  const out = [];
  const seen = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/[ \t]+/g, " ").trimEnd();
    const key = line.trim();
    if (!key) {
      if (out.length && out[out.length - 1] === "") continue;
      out.push("");
      continue;
    }
    // 连续重复
    if (i > 0 && key === lines[i - 1].trim()) continue;
    // 全局重复（你那种重复两遍 credits）
    if (seen.has(key) && key.startsWith("    ")) continue;
    seen.add(key);
    out.push(line);
  }

  // 每个曲目之间加空行（识别 A1/A2/B1... 行首）
  return out
  .join("\n")
  // ✅ 关键补丁：删掉“空白行(可含空格)+下一行是缩进credits”的情况
  .replace(/\n[ \t]*\n(?=\s{4}\S)/g, "\n")
  // 仍保持曲目之间空一行（只对曲目行开头）
  .replace(/\n(?=[A-Z]\d+ )/g, "\n\n")
  // 避免极端情况产生三行以上
  .replace(/\n{3,}/g, "\n\n")
  .trim();
}

function compactTracksByBlocks(text) {
  const t = String(text || "").replace(/\r/g, "").trim();
  if (!t) return "";

  const lines = t.split("\n");

  // 识别曲目标题行：A1 / A2 / B1 / C3 ...
  const isHeader = (s) => /^[A-Z]\d+\s+/.test(String(s || "").trim());

  const blocks = [];
  let cur = [];

  for (const rawLine of lines) {
    const line = String(rawLine || "").replace(/[ \t]+/g, " ").trim();
    if (!line) continue;

    if (isHeader(line)) {
      if (cur.length) blocks.push(cur);
      cur = [line];
      continue;
    }
    cur.push(line);
  }
  if (cur.length) blocks.push(cur);

  // 用于去重的规范化：统一 dash、合并空格、去掉行尾时长
  const normKey = (s) =>
    String(s || "")
      .replace(/[—-]/g, "–")
      .replace(/[ \t]+/g, " ")
      .replace(/(\d{1,2}:\d{2})\s*$/g, "") // 去掉行尾时长（有无空格都行）
      .trim();

  const cleanedBlocks = blocks.map((blk) => {
    // ===== [PATCH] 把块内任何行尾出现的时长挪到标题行末尾（兼容无空格黏连） =====
    // 例： "Written–By – ...Tony McDaid3:08" -> 标题行末尾加 " 3:08"，该行删掉 3:08
    const durations = [];
    for (let i = 1; i < blk.length; i++) {
      const m = blk[i].match(/(\d{1,2}:\d{2})\s*$/);
      if (m) {
        durations.push(m[1]);
        blk[i] = blk[i].replace(/(\d{1,2}:\d{2})\s*$/g, "").trimEnd();
      }
    }
    if (durations.length) {
      // 通常一个块只有一个时长，取最后一个最稳
      const dur = durations[durations.length - 1];
      blk[0] = (blk[0] + " " + dur).replace(/[ \t]+/g, " ").trim();
    }

    // 块内去重（保留顺序）
    const seen = new Set();
    const out = [];

    for (let i = 0; i < blk.length; i++) {
      const line = blk[i];
      if (!line) continue;

      if (i === 0) {
        out.push(line);
        continue;
      }

      const key = normKey(line);
      if (!key) continue;

      if (seen.has(key)) continue;
      seen.add(key);

      out.push(line);
    }

    return out;
  });

  // 块内用单换行，块之间用双换行
  return cleanedBlocks.map((blk) => blk.join("\n")).join("\n\n").trim();
}



  /* -------------------- page detection -------------------- */

  function isDiscogsPage() {
    return (
      location.hostname.includes("discogs.com") &&
      (location.pathname.startsWith("/release/") || location.pathname.startsWith("/master/"))
    );
  }

  function isDoubanNewSubject() {
    return location.hostname === "music.douban.com" && location.pathname.includes("/new_subject");
  }

  function getDoubanMusicStep() {
    // 与你贴的插件一致：basic 数量判断
    const nBasic = document.getElementsByClassName("basic").length;
    if (nBasic === 2) return 1;
    if (nBasic > 2) return 2;
    return 0;
  }

  /* -------------------- [PATCH] pre-format dense Discogs lines -------------------- */
  // 说明：你的 raw trackText 在某些 Discogs 页面会被 cleanText 压扁成一行：
  // A4 Pink Floyd– Another Brick... Co-producer – ... Producer – ... Written-By, Producer – ... 3:02
  // 我们在送入 formatDiscogsTrackText() 之前，把它“恢复成多行结构”，这样原函数就能正常处理。
  function preFormatDenseDiscogs(trackText) {
  if (!trackText) return "";

  let t = String(trackText).replace(/\r/g, "");

  // 把各种 dash 统一成标准 en-dash：–
  t = t.replace(/[—-]/g, "–");

  // 逐行处理（注意：你的 trackText 可能已经被压扁/或半压扁）
  const lines = t
    .split("\n")
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const ROLE_WORDS = [
    "Co–producer", "Co-producer", "Producer", "Executive Producer",
    "Written–By", "Written-By", "Co–written–By", "Co-written-By",
    "Composed By", "Arranged By", "Engineer", "Mixed By", "Mastered By",
    "Vocals", "Vocal", "Guitar", "Horns", "Percussion", "Drums", "Bass",
    "Keyboards", "Synth", "Piano", "Organ", "Strings"
  ];

  // 把 role 变成一个大正则（兼容 role 之间逗号组合：Producer, Written–By）
  const roleToken = ROLE_WORDS
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");

  const roleGroupRe = new RegExp(
    `\\b(?:${roleToken})\\b(?:\\s*,\\s*\\b(?:${roleToken})\\b)*\\s*–\\s*`,
    "g"
  );

  const out = [];

  for (let line of lines) {
    // A1Tiffany -> A1 Tiffany
    line = line.replace(/^([A-Z]\d+)(?=\S)/, "$1 ");

    // 把 “X–Y” 两侧空格规整，但不强制加空格（避免破坏你原结构）
    line = line.replace(/\s*–\s*/g, "–");

    // 抽取末尾时长（3:49 / 12:34）
    let dur = "";
    const mDur = line.match(/\b(\d{1,2}:\d{2})\b\s*$/);
    if (mDur) {
      dur = mDur[1];
      line = line.replace(/\b(\d{1,2}:\d{2})\b\s*$/, "").trim();
    }

    // 在 role-group 前强制换行并缩进（这一步是关键）
    line = line.replace(roleGroupRe, "\n    $&");

    // 把刚刚加进去的 "$&" 中 role-group 尾部多余空格整理一下
    line = line.replace(/\n\s+([^\n]+)\s+/g, "\n    $1 ");

    // 把 “\n    Producer – ” 这种多余空格再压一遍
    line = line.replace(/\n    ([^–\n]+)\s*–\s*/g, "\n    $1 – ");

    // 如果有时长，把时长放回“第一行末尾”
    if (dur) {
      const parts = line.split("\n");
      parts[0] = parts[0].trimEnd() + " " + dur;
      line = parts.join("\n");
    }

    // 行内去重（避免 Written–By 重复两次）
    const segs = line.split("\n");
    const uniq = [];
    const seen = new Set();
    for (const seg of segs) {
      const key = seg.trim();
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      uniq.push(seg);
    }
    out.push(uniq.join("\n"));
  }

  // 每个曲目之间空一行
  return out.join("\n\n").trim();
}

  /* -------------------- Discogs collect -------------------- */

  function collectDiscogsMusic() {
    const data = {
      url: location.href,
      album: "",
      barcode: "",
      albumAltName: "",
      artist0: "",
      artist1: "",
      artist2: "",
      genre: "",
      releaseType: "Album",
      media: "",
      date: "",
      label: "",
      numberOfDiscs: "1",
      isrc: "",
      tracks: "",
      description: "",
      imgUrl: ""
    };

    // album & artists
    try {
      const h1 = document.querySelector("h1");
      const profileTitle = document.getElementById("profile_title");

      if (profileTitle?.children?.[1]) {
        data.album = cleanText(profileTitle.children[1].textContent);
      } else if (h1) {
        const parts = cleanText(h1.textContent).split("–");
        data.album = cleanText(parts.length > 1 ? parts.slice(1).join("–") : parts[0]);
      }

      // artists text（尽量取结构化链接）
      let artistsText = "";

      // [PATCH A] 只抓 Discogs 的 artist 链接，优先 title / aria-label，再 fallback textContent
      function collectArtistNamesFromContainer(container) {
        if (!container) return "";

        const links = Array.from(container.querySelectorAll("a[href*='/artist/']"));
        const names = links
          .map((a) =>
            cleanText(
              a.getAttribute("title") ||
              a.getAttribute("aria-label") ||
              a.textContent
            )
          )
          .map(cleanArtistName) // 你原来就有：去掉(1)(2) / * / ✱
          .filter(Boolean);

        // 去重（保持顺序）
        const uniq = [];
        const seen = new Set();
        for (const n of names) {
          if (seen.has(n)) continue;
          seen.add(n);
          uniq.push(n);
        }
        return uniq.join(", ");
      }

      const profile = document.querySelector(".profile");
      if (profile) {
        artistsText = collectArtistNamesFromContainer(profile);
      }

      // fallback：从 h1 里再试一次（有些页面 profile 不同结构）
      if (!artistsText && h1) {
        artistsText = collectArtistNamesFromContainer(h1);

        // 再 fallback：你原来的 span 方案保留（防止极端页面没 artist 链接）
        if (!artistsText) {
          const spans = h1.querySelectorAll("span");
          if (spans?.length) {
            artistsText = Array.from(spans)
              .map((s) => cleanText(s.textContent))
              .join(", ");
          }
        }
      }

      const [a0, a1, a2] = splitArtistsTo3(artistsText);
      data.artist0 = a0;
      data.artist1 = a1;
      data.artist2 = a2;

      // [PATCH] Discogs 常见 Various / Various Artists：保证 artist0 不为空
      if (!data.artist0) {
        const h1Text = cleanText(document.querySelector("h1")?.textContent || "");
        if (/\bvarious\b/i.test(h1Text)) {
          data.artist0 = "Various Artists";
        }
      }
    } catch (e) {}

    // profile block: genre/date/media/label
    try {
      let pairs = [];
      const profile = document.querySelector(".profile");

      if (profile) {
        for (let i = 1; i < profile.children.length - 1; i += 2) {
          pairs.push([cleanText(profile.children[i].textContent), cleanText(profile.children[i + 1].textContent)]);
        }
      } else {
        const header = document.getElementById("release-header");
        const rows = header?.children?.[2]?.children;
        if (rows) {
          for (const row of rows) {
            if (row?.children?.length >= 2) {
              pairs.push([cleanText(row.children[0].textContent), cleanText(row.children[1].textContent)]);
            }
          }
        }
      }

      const keyRename = { Genre: "genre", Year: "date", Released: "date", Format: "media", Label: "label" };
      const valueRename = { "Hip Hop": "Rap", File: "Digital" };

      for (const [kRaw, vRaw] of pairs) {
        const k = keyRename[cleanText(kRaw).replace(":", "")] || "";
        if (!k) continue;

        let v = cleanText(vRaw);
        if (k !== "date") v = cleanText(v.split(/[,–]\s*/)[0]);

        if (valueRename[v]) v = valueRename[v];

        if (k === "genre" && !data.genre) data.genre = v;
        if (k === "media" && !data.media) data.media = v;
        if (k === "label" && !data.label) data.label = cleanArtistName(v);
        if (k === "date" && !data.date) data.date = normalizeDateToYYYYMMDD(v);
      }
    } catch (e) {}

    // [PATCH] 日期兜底：Discogs 页面结构变化时，从更通用的“key/value”块抓 Released/Year
    if (!data.date) {
      try {
        // 1) 新版 release 页面常见：#release-header 的表格行（你已有，但有时 children[2] 不存在）
        const header = document.getElementById("release-header");
        if (header) {
          const rows = header.querySelectorAll("tr, .content tr, .profile tr, .table tr");
          for (const row of rows) {
            const cells = row.querySelectorAll("th, td");
            if (cells.length >= 2) {
              const k = cleanText(cells[0].textContent).replace(":", "");
              const v = cleanText(cells[1].textContent);
              if (!v) continue;
              if (/^Released$/i.test(k) || /^Release Date$/i.test(k)) {
                data.date = normalizeDateToYYYYMMDD(v);
                break;
              }
              if (/^Year$/i.test(k)) {
                data.date = normalizeDateToYYYYMMDD(v);
                // 不 break，让 Released 有机会覆盖更精确日期
              }
            }
          }
        }

        // 2) 侧边栏/资料块：常见 dt/dd 或 label/value
        if (!data.date) {
          const candidates = Array.from(document.querySelectorAll("dt, th, strong, span"));
          for (const node of candidates) {
            const label = cleanText(node.textContent).replace(":", "");
            if (!/^(Released|Release Date|Year)$/i.test(label)) continue;

            // dt/dd 结构
            const dd = node.nextElementSibling;
            if (dd) {
              const v = cleanText(dd.textContent);
              if (v) {
                data.date = normalizeDateToYYYYMMDD(v);
                if (data.date) break;
              }
            }

            // 同行结构
            const parent = node.parentElement;
            if (parent) {
              const v = cleanText(parent.textContent.replace(node.textContent, ""));
              if (v) {
                data.date = normalizeDateToYYYYMMDD(v);
                if (data.date) break;
              }
            }
          }
        }

        // 3) 最后兜底：从页面文本抓（最粗暴但几乎必命中）
        if (!data.date) {
          const body = document.body.innerText || "";
          const m =
            body.match(/\bReleased\b\s*[:：]\s*([^\n]+)/i) ||
            body.match(/\bRelease Date\b\s*[:：]\s*([^\n]+)/i) ||
            body.match(/\bYear\b\s*[:：]\s*(\d{4})/i);
          if (m && m[1]) data.date = normalizeDateToYYYYMMDD(m[1]);
        }
      } catch (e) {}
    }
    // tracks
    try {
      let trackText = "";

      const tracklistTable = document.getElementById("tracklist");
      if (tracklistTable) {
        const trs = tracklistTable.getElementsByTagName("tr");
        for (let i = 0; i < trs.length; i++) {
          const tr = trs[i];
          let pos = tr.getAttribute("data-track-position") || "";
          const posEl = tr.querySelector(".tracklist_track_pos");
          if (posEl) pos = cleanText(posEl.textContent) || pos;

          const titleEl = tr.querySelector(".tracklist_track_title");
          const durEl = tr.querySelector(".tracklist_track_duration");
          const title = titleEl ? cleanText(titleEl.textContent) : cleanText(tr.textContent);
          const dur = durEl ? cleanText(durEl.textContent) : "";

          if (title) trackText += `${pos || i + 1}. ${title}${dur ? " " + dur : ""}\n`;
        }
      } else {
        const releaseTracklist = document.getElementById("release-tracklist");
        if (releaseTracklist) {
          const trs = releaseTracklist.getElementsByTagName("tr");
          for (let i = 0; i < trs.length; i++) {
            const tr = trs[i];
            const line = cleanText(tr.textContent);
            if (line) trackText += line + "\n";
          }
        }
      }

      // =========================
      // [PATCH] 在送进 formatDiscogsTrackText 之前，先把“压扁的 credits + 时长”恢复成多行
      // 这样不改 formatDiscogsTrackText 原逻辑，也能兼容 Tiffany / Clash / Queen / Pink Floyd 这种结构
      // =========================
      const patched = preFormatDenseDiscogs(trackText.trim());

      data.tracks = compactTracksByBlocks(formatDiscogsTrackText(patched));
    } catch (e) {}

    // barcode：兜底从页面全文找 8-14 位
    try {
      const text = document.body.innerText || "";
      const m = text.match(/\b(?:Barcode|EAN|UPC)\b[^\d]{0,20}(\d{8,14})/i);
      if (m) data.barcode = m[1];
    } catch (e) {}

    // cover image
    try {
      const gallery = document.querySelector(".image_gallery");
      const dataImages = gallery?.getAttribute("data-images");
      if (dataImages) {
        const images = JSON.parse(dataImages);
        data.imgUrl = images?.[0]?.full || "";
      }
      if (!data.imgUrl) {
        data.imgUrl = document.querySelector('[property="og:image"]')?.content || "";
      }
    } catch (e) {}

    // description：不包含链接信息（也不放 Discogs url）
    try {
      let notesText = "";
      const notes = document.getElementById("notes") || document.getElementById("release-notes");
      if (notes) notesText = cleanText(notes.textContent);

      notesText = stripUrls(notesText);

      const suffix = "本条目由 Discogs → 豆瓣音乐 Collect 插件自动生成，如有信息错误请更正。";
      data.description = (notesText ? `${notesText}\n\n========\n\n${suffix}` : suffix).trim();
    } catch (e) {
      data.description = "本条目由 Discogs → 豆瓣音乐 Collect 插件自动生成，如有信息错误请更正。";
    }

    // media/label/date 兜底
    if (!data.media) data.media = "Vinyl";
    if (!data.label) data.label = "Self-Released";

    return data;
  }

  async function maybeDownloadCover(draft) {
    if (!draft?.imgUrl) return;

    // 防重复：同一个 imgUrl 只下 1 次
    const key = `${draft.imgUrl}|${draft.album}|${draft.artist0}`;
    const stored = await chrome.storage.local.get(["d2d_downloaded_cover_key"]);
    if (stored?.d2d_downloaded_cover_key === key) return;

    const artist = cleanArtistName(draft.artist0 || "");
    const base = sanitizeFilename([draft.album, artist].filter(Boolean).join("-")) || "douban_cover";
    const ext = guessExtFromUrl(draft.imgUrl);
    const filename = `${base}.${ext}`;

    const resp = await bgSend({ type: "DOWNLOAD_COVER", url: draft.imgUrl, filename });
    if (resp?.ok) {
      await chrome.storage.local.set({ d2d_downloaded_cover_key: key });
      console.log("[D2D] cover downloaded:", filename);
    } else {
      console.warn("[D2D] cover download failed:", resp?.error || "unknown");
    }
  }

  function injectCollectButton() {
    if (document.getElementById("d2d-collect-btn")) return;

    const btn = document.createElement("button");
    btn.id = "d2d-collect-btn";
    btn.textContent = "Collect";
    btn.style.cssText = `
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 999999;
      padding: 8px 12px;
      border: 0;
      border-radius: 6px;
      background: #1f1f1f;
      color: #fff;
      font-size: 14px;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(0,0,0,.2);
    `;

    // [PATCH] Resolve full artist names by visiting /artist/ pages (needs background support)
    async function resolveArtistsFromDiscogsPages() {
      const isArtistUrl = (u) => /\/artist\/\d+/.test(String(u || ""));

      // ✅ 优先主标题里的 artist（只要 /artist/数字）
      const h1Links = Array.from(document.querySelectorAll("h1 a[href*='/artist/']"))
        .map((a) => a.href)
        .filter((u) => u && isArtistUrl(u));

      // ✅ 再补 profile 里的 artist（只要 /artist/数字）
      const profileLinks = Array.from(document.querySelectorAll(".profile a[href*='/artist/']"))
        .map((a) => a.href)
        .filter((u) => u && isArtistUrl(u));

      // 合并 + 去重（保持顺序）
      const uniq = [];
      const seen = new Set();
      for (const u of [...h1Links, ...profileLinks]) {
        if (seen.has(u)) continue;
        seen.add(u);
        uniq.push(u);
      }

      const target = uniq.slice(0, 3);
      console.log("[D2D] artist target urls:", target); // 你可以看是不是 /artist/数字

      if (!target.length) return "";

      const resp = await bgSend({ type: "RESOLVE_ARTISTS", urls: target });
      if (!resp?.ok || !Array.isArray(resp.names) || !resp.names.length) return "";

      return resp.names.join(", ");
    }


    btn.addEventListener("click", async () => {
      try {
        const draft = collectDiscogsMusic();
        console.log("[D2D] draft.date =", draft.date, "raw url:", draft.url);
        console.log("[D2D] collected:", draft);

        // ✅ 自动下载封面（在打开豆瓣前就触发）
        await maybeDownloadCover(draft);

        // ✅ [PATCH] 尝试把艺人名升级成“artist 页的规范名/Real Name”
        try {
          const resolvedArtistsText = await resolveArtistsFromDiscogsPages();
          if (resolvedArtistsText) {
            const [a0, a1, a2] = splitArtistsTo3(resolvedArtistsText);

            // 仅在解析到更好的名字时覆盖（不强行覆盖空值）
            if (a0) draft.artist0 = a0;
            if (a1) draft.artist1 = a1;
            if (a2) draft.artist2 = a2;

            console.log("[D2D] resolved artists:", draft.artist0, draft.artist1, draft.artist2);
          } else {
            console.log("[D2D] resolved artists: (none)");
          }
        } catch (e) {
          console.warn("[D2D] resolve artists failed:", e);
        }

        const resp = await bgSend({ type: "SAVE_DRAFT", draft });
        if (!resp?.ok) console.warn("[D2D] SAVE_DRAFT failed:", resp?.error);

        window.open(DOUBAN_NEW_SUBJECT, "_blank");
      } catch (e) {
        console.error("[D2D] collect failed:", e);
      }
    });

    document.body.appendChild(btn);
  }

  /* -------------------- Douban autofill -------------------- */

  async function waitFor(conditionFn, timeoutMs = 15000, intervalMs = 250) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const v = conditionFn();
      if (v) return v;
      await sleep(intervalMs);
    }
    return null;
  }

  function fillDoubanStep1(draft) {
    const titleInput = document.getElementById("p_title");
    const barcodeInput = document.getElementById("uid");

    if (titleInput) setValue(titleInput, draft.album || "");
    if (barcodeInput && draft.barcode) setValue(barcodeInput, draft.barcode);

    // 存到 douban 本域，保证跨第2步
    localStorage.setItem(LOCAL_KEY, JSON.stringify(draft));

    // 推进流程
    let btn = null;
    if (draft.barcode) {
      btn = document.getElementsByClassName("submit")?.[0] || null;
    } else {
      btn = document.getElementsByClassName("btn-link")?.[0] || null;
    }
    if (btn) btn.click();
  }

  function fillDoubanStep2(draft) {
    const albumTitle = draft.album || "";
    const releaseDate = draft.date || "";
    const label = draft.label || "";
    const barcode = draft.barcode || "";
    const a0 = cleanArtistName(draft.artist0 || "");
    const a1 = cleanArtistName(draft.artist1 || "");
    const a2 = cleanArtistName(draft.artist2 || "");

    // 双保险：description 再清一遍链接
    if (draft.description) draft.description = stripUrls(draft.description);

    // class 版（参考你贴的插件 DoubanMusicPage2）
    try {
      const basicItems = document.getElementsByClassName("item basic");
      if (basicItems?.length >= 3) {
        const albumEl =
          basicItems[0].querySelector(".input_basic.modified") ||
          basicItems[0].querySelector(".input_basic") ||
          basicItems[0].querySelector("input");
        if (albumEl) setValue(albumEl, albumTitle);

        const dateEl = basicItems[1].querySelector(".datepicker") || basicItems[1].querySelector("input");
        if (dateEl) setValue(dateEl, releaseDate);

        const labelEl = basicItems[2].querySelector(".input_basic") || basicItems[2].querySelector("input");
        if (labelEl) setValue(labelEl, label);

        const maybeBarcode = document.querySelector("#p_53, input[name='p_53'], input[name*='barcode']");
        if (maybeBarcode && barcode) setValue(maybeBarcode, barcode);
      }

      const musicianBlock = document.getElementsByClassName("item list musicians")?.[0];
      if (musicianBlock) {
        const inputs = musicianBlock.getElementsByClassName("input_basic");
        if (inputs?.[0] && a0) setValue(inputs[0], a0);
        if (inputs?.[1] && a1) setValue(inputs[1], a1);
        if (inputs?.[2] && a2) setValue(inputs[2], a2);
      }

      const textSections = document.getElementsByClassName("item text section");
      if (textSections?.[0]) {
        const t = textSections[0].querySelector(".textarea_basic, textarea");
        if (t && draft.tracks) setValue(t, draft.tracks);
      }
      if (textSections?.[1]) {
        const d = textSections[1].querySelector(".textarea_basic, textarea");
        if (d && draft.description) setValue(d, draft.description);
      }
    } catch (e) {}

    // id/name 兜底（防页面结构变化）
    try {
      const title2 = document.querySelector("#p_27, input[name='p_27']");
      if (title2) setValue(title2, albumTitle);

      const barcode2 = document.querySelector("#p_53, input[name='p_53']");
      if (barcode2 && barcode) setValue(barcode2, barcode);

      const release2 = document.querySelector("#p_51, input[name='p_51']");
      if (release2 && releaseDate) setValue(release2, releaseDate);

      // [PATCH] 日期控件有时不是 #p_51，兜底抓任何 datepicker / hasDatepicker
      const releaseFallback =
        document.querySelector("input.hasDatepicker") ||
        document.querySelector("input.datepicker") ||
        document.querySelector("input[id^='date_p_']") ||
        null;
      if (releaseFallback && releaseDate) setValue(releaseFallback, releaseDate);

      const publisher2 = document.querySelector("#p_50, input[name='p_50']");
      if (publisher2 && label) setValue(publisher2, label);

      const performerInputs = document.querySelectorAll("input[name='p_48']");
      if (performerInputs?.length) {
        if (performerInputs[0] && a0) setValue(performerInputs[0], a0);
        if (performerInputs[1] && a1) setValue(performerInputs[1], a1);
        if (performerInputs[2] && a2) setValue(performerInputs[2], a2);
      }

      // 参考资料：这里仍然保留 Discogs url（通常审核不会卡），如果你也想去掉我再给你改成纯文本 id
      const ref = document.querySelector("textarea[name='p_152_other']");
      if (ref) setValue(ref, draft.url || "");
    } catch (e) {}
  }

  async function runDoubanAutoFill() {
    // 先从 background 取 draft
    let draft = null;
    const resp = await bgSend({ type: "GET_DRAFT" });
    if (resp?.ok && resp.draft) draft = resp.draft;

    // 第2步可能需要从 douban localStorage 取（同域续命）
    if (!draft) {
      const local = localStorage.getItem(LOCAL_KEY);
      if (local) {
        try {
          draft = JSON.parse(local);
        } catch (e) {}
      }
    }

    if (!draft) {
      console.log("[D2D] no draft found on douban page");
      return;
    }

    await waitFor(() => document.body);

    const step = await waitFor(() => {
      const s = getDoubanMusicStep();
      return s || null;
    });

    if (!step) {
      console.warn("[D2D] cannot detect douban step");
      return;
    }

    console.log("[D2D] douban step =", step);

    if (step === 1) {
      const ok = await waitFor(
        () =>
          document.getElementById("p_title") &&
          (document.getElementsByClassName("btn-link")?.[0] || document.getElementsByClassName("submit")?.[0]),
        15000,
        250
      );
      if (!ok) {
        console.warn("[D2D] step1 elements not found (#p_title / .btn-link)");
        return;
      }
      fillDoubanStep1(draft);
      return;
    }

    if (step === 2) {
      const local = localStorage.getItem(LOCAL_KEY);
      if (local) {
        try {
          draft = JSON.parse(local);
        } catch (e) {}
      }

      fillDoubanStep2(draft);

      // 清理
      localStorage.removeItem(LOCAL_KEY);
      await bgSend({ type: "CLEAR_DRAFT" });

      console.log("[D2D] step2 filled and cleared draft");
    }
  }

  /* -------------------- main -------------------- */

  (async function main() {
    if (isDiscogsPage()) {
      injectCollectButton();
    }
    if (isDoubanNewSubject()) {
      await runDoubanAutoFill();
    }
  })();

  console.log("[D2D] content script ends");
})();
