/**
 * 预览页：展示提取的图片，支持多选并以 PNG 下载
 */

const STORAGE_KEY = "extractedImages";

const els = {
  gallery: document.getElementById("gallery"),
  empty: document.getElementById("empty"),
  pageTitle: document.getElementById("pageTitle"),
  pageMeta: document.getElementById("pageMeta"),
  selectedCount: document.getElementById("selectedCount"),
  totalCount: document.getElementById("totalCount"),
  statusText: document.getElementById("statusText"),
  btnSelectAll: document.getElementById("btnSelectAll"),
  btnSelectNone: document.getElementById("btnSelectNone"),
  btnDownload: document.getElementById("btnDownload"),
  progressMask: document.getElementById("progressMask"),
  progressText: document.getElementById("progressText"),
};

/** @type {{ id: string, url: string, index: number }[]} */
let images = [];
/** @type {Set<string>} */
const selected = new Set();

init();

async function init() {
  const data = await chrome.storage.session.get(STORAGE_KEY);
  const payload = data?.[STORAGE_KEY];

  images = Array.isArray(payload?.images) ? payload.images : [];
  const meta = payload?.meta || {};

  els.pageTitle.textContent = meta.title || "商品图片";
  const platformLabel = platformName(meta.platform);
  const time = meta.extractedAt
    ? new Date(meta.extractedAt).toLocaleString()
    : "";
  els.pageMeta.textContent = [
    platformLabel,
    images.length ? `${images.length} 张` : "",
    time,
    meta.sourceUrl ? "来源页已记录" : "",
  ]
    .filter(Boolean)
    .join(" · ");

  if (!images.length) {
    els.empty.classList.remove("hidden");
    updateCounts();
    return;
  }

  // 默认全选
  images.forEach((img) => selected.add(img.id));
  renderGallery();
  bindEvents();
  updateCounts();
}

function platformName(p) {
  const map = {
    taobao: "淘宝/天猫",
    jd: "京东",
    pdd: "拼多多",
    generic: "通用",
  };
  return map[p] || "未知平台";
}

function bindEvents() {
  els.btnSelectAll.addEventListener("click", () => {
    images.forEach((img) => selected.add(img.id));
    syncCardSelection();
    updateCounts();
  });

  els.btnSelectNone.addEventListener("click", () => {
    selected.clear();
    syncCardSelection();
    updateCounts();
  });

  els.btnDownload.addEventListener("click", onDownloadSelected);
}

function renderGallery() {
  els.gallery.innerHTML = "";
  const frag = document.createDocumentFragment();

  images.forEach((img, i) => {
    const card = document.createElement("article");
    card.className = "card" + (selected.has(img.id) ? " selected" : "");
    card.dataset.id = img.id;
    card.style.animationDelay = `${Math.min(i, 24) * 25}ms`;

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "check";
    check.checked = selected.has(img.id);
    check.addEventListener("click", (e) => e.stopPropagation());
    check.addEventListener("change", () => toggleSelect(img.id, check.checked));

    const thumb = document.createElement("img");
    thumb.className = "thumb";
    thumb.alt = `商品图 ${img.index}`;
    thumb.loading = "lazy";
    thumb.referrerPolicy = "no-referrer";
    thumb.src = img.url;
    thumb.addEventListener("error", () => {
      thumb.alt = "加载失败";
      thumb.style.opacity = "0.4";
    });

    const footer = document.createElement("div");
    footer.className = "footer";
    footer.innerHTML = `<span>#${img.index}</span>`;

    const dlOne = document.createElement("button");
    dlOne.type = "button";
    dlOne.className = "dl-one";
    dlOne.textContent = "下载 PNG";
    dlOne.addEventListener("click", async (e) => {
      e.stopPropagation();
      await downloadOne(img);
    });
    footer.appendChild(dlOne);

    card.append(check, thumb, footer);
    card.addEventListener("click", () => {
      const next = !selected.has(img.id);
      toggleSelect(img.id, next);
    });

    frag.appendChild(card);
  });

  els.gallery.appendChild(frag);
}

function toggleSelect(id, on) {
  if (on) selected.add(id);
  else selected.delete(id);
  syncCardSelection();
  updateCounts();
}

function syncCardSelection() {
  els.gallery.querySelectorAll(".card").forEach((card) => {
    const id = card.dataset.id;
    const on = selected.has(id);
    card.classList.toggle("selected", on);
    const check = card.querySelector(".check");
    if (check) check.checked = on;
  });
}

function updateCounts() {
  els.selectedCount.textContent = String(selected.size);
  els.totalCount.textContent = String(images.length);
  els.btnDownload.disabled = selected.size === 0;
}

async function downloadOne(img) {
  setProgress(true, `正在转换 PNG：#${img.index}`);
  try {
    const res = await chrome.runtime.sendMessage({
      type: "DOWNLOAD_PNG",
      payload: {
        url: img.url,
        filename: `product_${String(img.index).padStart(3, "0")}`,
      },
    });
    if (!res?.ok) throw new Error(res?.error || "下载失败");
    setStatus(`已下载 #${img.index}.png`);
  } catch (err) {
    setStatus(String(err?.message || err), true);
  } finally {
    setProgress(false);
  }
}

async function onDownloadSelected() {
  const items = images
    .filter((img) => selected.has(img.id))
    .map((img) => ({
      url: img.url,
      filename: `product_${String(img.index).padStart(3, "0")}`,
    }));

  if (!items.length) return;

  setProgress(true, `正在下载 0 / ${items.length}…`);
  els.btnDownload.disabled = true;

  try {
    // 分批反馈进度：逐张调用以便更新文案
    let success = 0;
    let failed = 0;
    for (let i = 0; i < items.length; i++) {
      els.progressText.textContent = `正在下载 ${i + 1} / ${items.length}（PNG）…`;
      const res = await chrome.runtime.sendMessage({
        type: "DOWNLOAD_PNG",
        payload: items[i],
      });
      if (res?.ok) success += 1;
      else failed += 1;
    }
    setStatus(
      failed
        ? `完成：成功 ${success}，失败 ${failed}`
        : `已全部下载为 PNG（${success} 张）`
    );
  } catch (err) {
    setStatus(String(err?.message || err), true);
  } finally {
    setProgress(false);
    updateCounts();
  }
}

function setProgress(show, text) {
  els.progressMask.classList.toggle("hidden", !show);
  els.progressMask.setAttribute("aria-hidden", show ? "false" : "true");
  if (text) els.progressText.textContent = text;
}

function setStatus(text, isError = false) {
  els.statusText.textContent = text || "";
  els.statusText.style.color = isError ? "#b91c1c" : "";
}
