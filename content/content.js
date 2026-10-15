/**
 * 内容脚本：在商品详情页注入「获取图片」按钮，并按平台提取商品图片
 */
(function () {
  "use strict";

  const BTN_ID = "eie-float-btn";
  const TOAST_ID = "eie-toast";
  const MIN_SIZE = 80;

  const PLATFORM = detectPlatform(location.hostname, location.href);
  if (!PLATFORM) return;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  function init() {
    if (document.getElementById(BTN_ID)) return;
    injectButton();
  }

  function detectPlatform(host, href) {
    const h = host.toLowerCase();
    if (
      h.includes("taobao.com") ||
      h.includes("tmall.com") ||
      h.includes("tmall.hk")
    ) {
      return "taobao";
    }
    if (h.includes("jd.com") || h.includes("jd.hk")) {
      return "jd";
    }
    if (
      h.includes("pinduoduo.com") ||
      h.includes("yangkeduo.com")
    ) {
      // 商家后台 / 商品页均按 pdd 处理
      return "pdd";
    }
    // 兜底：URL 中带商品特征
    if (/item\.|detail\.|goods|product/i.test(href)) {
      return "generic";
    }
    return null;
  }

  function injectButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    btn.setAttribute("aria-label", "获取图片");
    btn.innerHTML = `
      <svg class="eie-ico" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h2.1l1.2-1.6A1.5 1.5 0 0 1 11 3h2a1.5 1.5 0 0 1 1.2.6L15.4 5H17.5A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" stroke="currentColor" stroke-width="1.6"/>
        <circle cx="12" cy="12" r="3.2" stroke="currentColor" stroke-width="1.6"/>
      </svg>
      <span>获取图片</span>
    `;
    btn.addEventListener("click", onExtractClick);
    document.documentElement.appendChild(btn);
  }

  async function onExtractClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn || btn.dataset.loading === "1") return;

    btn.dataset.loading = "1";
    const label = btn.querySelector("span");
    const prevText = label ? label.textContent : "";
    if (label) label.textContent = "提取中…";

    try {
      // 尝试展开详情区，便于懒加载图片进入 DOM
      await expandDetailSections();
      await waitForLazyImages(600);

      const images = extractImages();
      if (!images.length) {
        showToast("未找到商品图片，请滚动页面加载后再试");
        return;
      }

      showToast(`已提取 ${images.length} 张图片，正在打开预览页…`);

      const response = await chrome.runtime.sendMessage({
        type: "OPEN_VIEWER",
        payload: {
          images,
          sourceUrl: location.href,
          platform: PLATFORM,
          title: getPageTitle(),
        },
      });

      if (!response?.ok) {
        showToast(response?.error || "打开预览页失败");
      }
    } catch (err) {
      console.error("[EIE]", err);
      showToast("提取失败：" + (err?.message || String(err)));
    } finally {
      btn.dataset.loading = "0";
      if (label) label.textContent = prevText || "获取图片";
    }
  }

  function getPageTitle() {
    const candidates = [
      () => document.querySelector("meta[property='og:title']")?.content,
      () => document.querySelector("#title h1, .tb-main-title, .sku-name, .goods-title")?.textContent,
      () => document.title,
    ];
    for (const fn of candidates) {
      const t = (fn() || "").trim().replace(/\s+/g, " ");
      if (t) return t.slice(0, 80);
    }
    return "商品图片";
  }

  async function expandDetailSections() {
    const clickTargets = [
      // 淘宝 / 天猫
      "#J_DivItemDesc",
      ".desc-root",
      "[data-spm='description']",
      // 京东
      "#detail",
      ".detail-content",
      "#J-detail-content",
      // 拼多多
      ".goods-detail",
      "[class*='detail'] button",
      "[class*='Detail']",
    ];

    for (const sel of clickTargets) {
      document.querySelectorAll(sel).forEach((el) => {
        try {
          el.scrollIntoView({ block: "nearest" });
        } catch {
          /* ignore */
        }
      });
    }

    // 触发页面滚动帮助懒加载
    const maxY = Math.min(document.documentElement.scrollHeight, 4000);
    const step = 500;
    const startY = window.scrollY;
    for (let y = 0; y < maxY; y += step) {
      window.scrollTo(0, y);
      await sleep(40);
    }
    window.scrollTo(0, startY);
  }

  function waitForLazyImages(ms) {
    return sleep(ms);
  }

  function extractImages() {
    const urls = new Set();

    const siteSelectors = getSelectorsByPlatform(PLATFORM);
    siteSelectors.forEach((sel) => {
      document.querySelectorAll(sel).forEach((node) => {
        collectFromElement(node, urls);
      });
    });

    // 通用兜底：页面大图
    document.querySelectorAll("img").forEach((img) => {
      if (isLikelyProductImage(img)) {
        collectFromElement(img, urls);
      }
    });

    // 背景图
    document.querySelectorAll("[style*='background']").forEach((el) => {
      const bg = getComputedStyle(el).backgroundImage;
      const m = /url\(["']?(.*?)["']?\)/i.exec(bg || "");
      if (m?.[1] && !m[1].startsWith("data:image/svg")) {
        addUrl(urls, m[1]);
      }
    });

    // 淘宝/天猫详情常在 iframe
    tryCollectFromIframes(urls);

    return Array.from(urls).map((url, index) => ({
      id: `img_${index + 1}`,
      url: upgradeImageUrl(url),
      index: index + 1,
    }));
  }

  function getSelectorsByPlatform(platform) {
    const common = [
      "img[src*='alicdn']",
      "img[data-src*='alicdn']",
      "img[src*='360buyimg']",
      "img[data-src*='360buyimg']",
      "img[src*='pddpic']",
      "img[data-src*='pddpic']",
      "img[src*='yangkeduo']",
    ];

    if (platform === "taobao") {
      return [
        "#J_UlThumb img",
        "#J_ImgBooth",
        ".tb-thumb img",
        ".tb-pic img",
        ".tb-gallery img",
        "[class*='KeenImage'] img",
        "[class*='PicGallery'] img",
        "[class*='mainPic'] img",
        "#description img",
        "#J_DivItemDesc img",
        ".descV8-container img",
        ".desc-root img",
        "[class*='desc'] img",
        "video[poster]",
        ...common,
      ];
    }

    if (platform === "jd") {
      return [
        "#spec-list img",
        "#spec-img",
        ".lh img",
        ".preview img",
        ".spec-items img",
        "#main-img",
        ".main-img img",
        "#J-detail-content img",
        ".ssd-module-wrap img",
        ".detail-content img",
        "#detail img",
        "img[data-lazy-img]",
        "img[data-lazy]",
        ...common,
      ];
    }

    if (platform === "pdd") {
      return [
        // 消费者端
        ".goods-gallery img",
        "[class*='gallery'] img",
        "[class*='sku'] img",
        "[class*='GoodsImage'] img",
        "[class*='detail'] img",
        // 商家版 MMS
        ".goods-edit img",
        "[class*='Upload'] img",
        "[class*='upload'] img",
        "[class*='material'] img",
        "[class*='Material'] img",
        "[class*='preview'] img",
        ".ant-upload-list img",
        "img[src*='pddpic']",
        "img[src*='yangkeduo']",
        ...common,
      ];
    }

    return ["img", ...common];
  }

  function collectFromElement(el, urls) {
    if (!el) return;

    if (el.tagName === "VIDEO" && el.getAttribute("poster")) {
      addUrl(urls, el.getAttribute("poster"));
      return;
    }

    const attrs = [
      "src",
      "data-src",
      "data-lazy-img",
      "data-lazy",
      "data-original",
      "data-url",
      "data-img",
      "data-ks-lazyload",
      "large",
      "data-large",
    ];

    attrs.forEach((attr) => {
      const v = el.getAttribute?.(attr);
      if (v) addUrl(urls, v);
    });

    // srcset 取最大
    const srcset = el.getAttribute?.("srcset");
    if (srcset) {
      const best = pickBestFromSrcset(srcset);
      if (best) addUrl(urls, best);
    }
  }

  function pickBestFromSrcset(srcset) {
    let best = null;
    let bestW = -1;
    srcset.split(",").forEach((part) => {
      const bits = part.trim().split(/\s+/);
      const u = bits[0];
      const w = parseInt((bits[1] || "").replace(/\D/g, ""), 10) || 0;
      if (u && w >= bestW) {
        bestW = w;
        best = u;
      }
    });
    return best;
  }

  function isLikelyProductImage(img) {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    if (w && h && (w < MIN_SIZE || h < MIN_SIZE)) return false;

    const src =
      img.currentSrc ||
      img.src ||
      img.getAttribute("data-src") ||
      img.getAttribute("data-lazy-img") ||
      "";

    if (!src || src.startsWith("data:image/svg") || src.includes("spacer")) {
      return false;
    }

    const lower = src.toLowerCase();
    const deny = [
      "logo",
      "icon",
      "avatar",
      "sprite",
      "loading",
      "placeholder",
      "qrcode",
      "qr_code",
      "favicon",
      "1x1",
      "pixel",
      "tracker",
      "adsystem",
      "beacon",
    ];
    if (deny.some((k) => lower.includes(k))) return false;

    // CDN / 商品图特征
    const allowHostHints = [
      "alicdn",
      "tbcdn",
      "taobaocdn",
      "360buyimg",
      "jdcdn",
      "pddpic",
      "yangkeduo",
      "img.pdd",
    ];
    if (allowHostHints.some((k) => lower.includes(k))) return true;

    // 尺寸够大也收录
    return w >= 200 && h >= 200;
  }

  function tryCollectFromIframes(urls) {
    document.querySelectorAll("iframe").forEach((iframe) => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!doc) return;
        doc.querySelectorAll("img").forEach((img) => {
          if (isLikelyProductImage(img)) collectFromElement(img, urls);
        });
      } catch {
        // 跨域 iframe 无法访问
      }
    });
  }

  function addUrl(set, raw) {
    const url = normalizeUrl(raw);
    if (!url) return;
    if (!/^https?:/i.test(url) && !url.startsWith("data:image")) return;
    if (url.startsWith("data:image/svg")) return;
    set.add(url);
  }

  function normalizeUrl(raw) {
    if (!raw) return "";
    let url = String(raw).trim();
    if (!url || url === "about:blank") return "";
    if (url.startsWith("//")) url = location.protocol + url;
    if (url.startsWith("/")) {
      try {
        url = new URL(url, location.origin).href;
      } catch {
        return "";
      }
    }
    // 去掉多余查询中的尺寸限制前常见：淘宝 _xxx.webp 等保留，后续 upgrade
    return url;
  }

  /**
   * 尽量请求更高清原图（淘宝/京东常见缩略图后缀）
   */
  function upgradeImageUrl(url) {
    try {
      let u = url;

      // 淘宝 / 天猫：去掉 _50x50 / _q50 等缩略后缀
      u = u.replace(/_\d+x\d+(q\d+)?(\.[a-zA-Z]+)?/g, "");
      u = u.replace(/\.(jpg|jpeg|png|webp)_[^.]+/gi, ".$1");

      // 京东：s800x800_ 等前缀
      u = u.replace(/\/s\d+x\d+_/g, "/");
      u = u.replace(/!.*$/, "");

      // 拼多多：常见缩略参数
      u = u.replace(/[?&]imageView2[^&]*/g, "");
      u = u.replace(/[?&]thumbnail=\d+x\d+/g, "");

      return u;
    } catch {
      return url;
    }
  }

  function showToast(text) {
    let el = document.getElementById(TOAST_ID);
    if (!el) {
      el = document.createElement("div");
      el.id = TOAST_ID;
      document.documentElement.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("eie-show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => el.classList.remove("eie-show"), 2800);
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }
})();
