const STATE_KEY = "d2d_music_draft";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg?.type === "SAVE_DRAFT") {
        await chrome.storage.local.set({ [STATE_KEY]: msg.draft || null });
        sendResponse({ ok: true });
        return;
      }
      if (msg?.type === "GET_DRAFT") {
        const res = await chrome.storage.local.get([STATE_KEY]);
        sendResponse({ ok: true, draft: res[STATE_KEY] || null });
        return;
      }
      if (msg?.type === "CLEAR_DRAFT") {
        await chrome.storage.local.remove([STATE_KEY]);
        sendResponse({ ok: true });
        return;
      }

      // ✅ 下载封面
      if (msg?.type === "DOWNLOAD_COVER") {
        const url = msg.url;
        const filename = msg.filename || "douban_cover.jpg";
        if (!url) {
          sendResponse({ ok: false, error: "Missing url" });
          return;
        }

        const downloadId = await chrome.downloads.download({
          url,
          filename,
          saveAs: false
        });

        sendResponse({ ok: true, downloadId });
        return;
      }
      
      

      // ✅ 解析 Discogs artist 页面，拿更完整的艺人名（优先 Real Name，其次 og:title）
      if (msg?.type === "RESOLVE_ARTISTS") {
        const urls = Array.isArray(msg.urls) ? msg.urls : [];
        if (!urls.length) {
          sendResponse({ ok: true, names: [] });
          return;
        }

        async function fetchText(url) {
          const res = await fetch(url, {
            credentials: "include",
            redirect: "follow",
            headers: {
              "accept": "text/html,application/xhtml+xml"
            }
          });
          if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
          return await res.text();
        }

        function decodeHtmlEntities(str) {
          // service worker 没有 DOMParser 也能用的简易解码
          return String(str || "")
            .replace(/&amp;/g, "&")
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
        }

        function cleanName(s) {
          return decodeHtmlEntities(String(s || ""))
            .replace(/\s+/g, " ")
            .replace(/[*✱]+/g, "")
            .trim();
        }

        function parseArtistNameFromHtml(html) {
          const src = String(html || "");

          const clean = (s) =>
            String(s || "")
              .replace(/&amp;/g, "&")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/\s+/g, " ")
              .replace(/[*✱]+/g, "")
              .trim();

          const normalize = (s) => {
            let t = clean(s);

            // 去 Discogs 尾巴
            t = t.replace(/\s*(\||-|–|—)\s*Discogs\s*$/i, "");
            t = t.replace(/\s*(\||-|–|—)\s*Artist\s*$/i, "");
            t = t.replace(/\s*(\||-|–|—)\s*Profile\s*$/i, "");

            // 去 (2)(3)
            t = t.replace(/\s*\(\d+\)\s*$/g, "");

            // 基本合法性判断
            if (!t) return "";
            if (/^discogs$/i.test(t)) return "";
            if (!/[A-Za-z0-9\u4e00-\u9fff]/.test(t)) return "";
            if (t.length < 2) return "";

            return t;
          };

          // 1️⃣ og:title（最优）
          {
            const m = src.match(
              /<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i
            );
            if (m?.[1]) {
              const out = normalize(m[1]);
              if (out) return out;
            }
          }

          // 2️⃣ twitter:title
          {
            const m = src.match(
              /<meta\s+name=["']twitter:title["']\s+content=["']([^"']+)["']/i
            );
            if (m?.[1]) {
              const out = normalize(m[1]);
              if (out) return out;
            }
          }

          // 3️⃣ <title>
          {
            const m = src.match(/<title>\s*([^<]+)\s*<\/title>/i);
            if (m?.[1]) {
              const out = normalize(m[1]);
              if (out) return out;
            }
          }

          // 4️⃣ <h1>（清掉 script/style）
          {
            const cleaned = src
              .replace(/<style[\s\S]*?<\/style>/gi, "")
              .replace(/<script[\s\S]*?<\/script>/gi, "");
            const m = cleaned.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
            if (m?.[1]) {
              const text = clean(m[1].replace(/<[^>]+>/g, " "));
              const out = normalize(text);
              if (out) return out;
            }
          }

          // 5️⃣ JSON-LD 兜底
          {
            const m = src.match(/"name"\s*:\s*"([^"]{2,120})"/i);
            if (m?.[1]) {
              const out = normalize(m[1]);
              if (out) return out;
            }
          }

          return "";
        }

        const names = [];
        for (const url of urls.slice(0, 6)) {
          try {
            const html = await fetchText(url);
            const n = parseArtistNameFromHtml(html);
            if (n) names.push(n);
          } catch (e) {
            // 某个 artist 页面失败不影响其它
            continue;
          }
        }

        // 去重（保持顺序）
        const uniq = [];
        const seen = new Set();
        for (const n of names) {
          const key = n.trim();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          uniq.push(key);
        }

        sendResponse({ ok: true, names: uniq });
        return;
      }

      sendResponse({ ok: false, error: "Unknown message" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  return true;
});
