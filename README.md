# 电商图片提取下载（Chrome 扩展 · Manifest V3）

从**淘宝 / 天猫、京东、拼多多（含商家版）**商品详情页一键提取商品图片，在新标签页预览、多选，并统一下载为 **PNG**。

## 项目结构

```
ecommerce-image-extractor/
├── manifest.json          # MV3 清单
├── background.js          # Service Worker：打开预览页、PNG 转换与下载
├── content/
│   ├── content.js         # 注入「获取图片」按钮与图片提取
│   └── content.css        # 浮动按钮样式
├── viewer/
│   ├── viewer.html        # 图片预览与选择页
│   ├── viewer.css
│   └── viewer.js
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## 安装方法

1. 打开 Chrome，地址栏进入 `chrome://extensions/`
2. 开启右上角 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择本目录 `ecommerce-image-extractor`

## 使用方法

1. 打开支持站点的商品详情页（或拼多多商家后台商品相关页）
2. 页面右下角出现橙色 **获取图片** 按钮
3. 点击后自动滚动加载并提取图片，新标签打开预览页
4. 勾选需要的图片，点击 **下载选中 (PNG)**  
   - 也可单张点击「下载 PNG」
5. 文件默认保存到浏览器下载目录下的 `ecommerce-images/` 文件夹

## 支持站点（匹配规则）

| 平台 | 示例域名 |
|------|----------|
| 淘宝 / 天猫 | `item.taobao.com`、`detail.tmall.com` |
| 京东 | `item.jd.com`、`item.m.jd.com` |
| 拼多多 | `*.pinduoduo.com`、`*.yangkeduo.com`、`mms.pinduoduo.com`（商家版） |

## 技术说明

- **Manifest V3**：`service_worker` + `content_scripts` + `chrome.storage.session` 传图列表
- **提取策略**：按平台选择器 + 大图启发式过滤 + 缩略图 URL 升清
- **PNG 输出**：`createImageBitmap` + `OffscreenCanvas.convertToBlob({ type: 'image/png' })`，再经 `chrome.downloads` 保存

## 注意

- 部分图片若 CDN 防盗链或动态加密，可能提取失败或预览裂图，可滚动详情区加载后再试
- 商家版后台 DOM 结构常变，若漏图可在 `content/content.js` 的 `getSelectorsByPlatform('pdd')` 中补充选择器
- 首次下载时 Chrome 可能询问下载权限，请允许

## 权限说明

| 权限 | 用途 |
|------|------|
| `storage` | 在预览页传递图片列表 |
| `downloads` | 保存 PNG 文件 |
| `host_permissions` | 读取商品页并拉取图片资源做格式转换 |
