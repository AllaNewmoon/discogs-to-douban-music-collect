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

      // ✅ 新增：下载封面
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

      sendResponse({ ok: false, error: "Unknown message" });
    } catch (e) {
      sendResponse({ ok: false, error: String(e) });
    }
  })();

  return true;
});
