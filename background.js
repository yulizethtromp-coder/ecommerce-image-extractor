/**
 * Service Worker — 接收图片列表、打开预览页、将图片转为 PNG 并下载
 */

const STORAGE_KEY = "extractedImages";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "OPEN_VIEWER") {
    handleOpenViewer(message.payload)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "DOWNLOAD_PNG") {
    downloadAsPng(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  if (message?.type === "DOWNLOAD_BATCH_PNG") {
    downloadBatchAsPng(message.payload)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: String(err?.message || err) }));
    return true;
  }

  return false;
});

async function handleOpenViewer(payload) {
  const images = Array.isArray(payload?.images) ? payload.images : [];
  const meta = {
    sourceUrl: payload?.sourceUrl || "",
    platform: payload?.platform || "unknown",
    title: payload?.title || "商品图片",
    extractedAt: Date.now(),
  };

  await chrome.storage.session.set({
    [STORAGE_KEY]: { images, meta },
  });

  await chrome.tabs.create({
    url: chrome.runtime.getURL("viewer/viewer.html"),
  });
}

/**
 * 将任意图片 URL 拉取后转为 PNG Blob，再触发下载
 */
async function downloadAsPng({ url, filename }) {
  if (!url) throw new Error("缺少图片地址");

  const safeName = sanitizeFilename(filename || deriveNameFromUrl(url));
  const pngName = ensurePngExtension(safeName);

  const blob = await fetchImageAsPngBlob(url);
  // 使用 data URL，避免 Service Worker 休眠导致 blob: URL 失效
  const dataUrl = await blobToDataUrl(blob);

  const downloadId = await chrome.downloads.download({
    url: dataUrl,
    filename: `ecommerce-images/${pngName}`,
    saveAs: false,
    conflictAction: "uniquify",
  });
  return { downloadId, filename: pngName };
}

async function downloadBatchAsPng({ items }) {
  const list = Array.isArray(items) ? items : [];
  const results = [];
  let success = 0;
  let failed = 0;

  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    try {
      const name =
        item.filename ||
        `image_${String(i + 1).padStart(3, "0")}`;
      const result = await downloadAsPng({
        url: item.url,
        filename: name,
      });
      results.push({ ok: true, ...result });
      success += 1;
      // 避免下载队列过快被浏览器限流
      await sleep(180);
    } catch (err) {
      results.push({ ok: false, url: item.url, error: String(err?.message || err) });
      failed += 1;
    }
  }

  return { success, failed, results };
}

async function fetchImageAsPngBlob(url) {
  // data: / blob: 直接处理
  if (url.startsWith("data:") || url.startsWith("blob:")) {
    const res = await fetch(url);
    const blob = await res.blob();
    return await convertBlobToPng(blob);
  }

  const response = await fetch(url, {
    credentials: "omit",
    cache: "no-cache",
  });

  if (!response.ok) {
    throw new Error(`图片请求失败 (${response.status})`);
  }

  const blob = await response.blob();
  return await convertBlobToPng(blob);
}

/**
 * Service Worker 无 OffscreenCanvas 画图兼容问题时，用 createImageBitmap + OffscreenCanvas
 */
async function convertBlobToPng(blob) {
  if (blob.type === "image/png") {
    return blob;
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    // 部分 webp/avif 或损坏资源：原样包一层失败则抛错
    throw new Error("无法解码图片，请检查图片地址是否可访问");
  }

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  return await canvas.convertToBlob({ type: "image/png" });
}

async function blobToDataUrl(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return `data:image/png;base64,${btoa(binary)}`;
}

function deriveNameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").filter(Boolean).pop() || "image";
    return base.split("?")[0].replace(/\.[a-zA-Z0-9]+$/, "") || "image";
  } catch {
    return "image";
  }
}

function sanitizeFilename(name) {
  return String(name)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 120) || "image";
}

function ensurePngExtension(name) {
  return name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
