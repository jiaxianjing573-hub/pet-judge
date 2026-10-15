/* 宠物呵护小判官 · 本地后端
 * Node 18+，除可选的 Playwright 外无 npm 依赖。
 * 抖音解析链路：规范化链接 -> 页面内嵌数据 -> yt-dlp -> Playwright -> 显式配置的公共接口。
 */
const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { spawn } = require("child_process");

const env = {};
try {
  fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/).forEach(function (line) {
    const match = line.match(/^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*$/);
    if (match && !line.trim().startsWith("#")) env[match[1]] = match[2];
  });
} catch (_) {}

const KEY = env.MOONSHOT_API_KEY || process.env.MOONSHOT_API_KEY || "";
const BASE = (env.MOONSHOT_BASE || process.env.MOONSHOT_BASE || "https://api.moonshot.cn/v1").replace(/\/+$/, "");
const MODEL = env.KIMI_MODEL || process.env.KIMI_MODEL || "kimi-k3";
const PORT = +(process.env.PORT || env.PORT || 3210);
const COOKIE_FILE = path.join(__dirname, "cookies.txt");
const OCR2_KEY = env.OCR2_API_KEY || process.env.OCR2_API_KEY || "";
const OCR2_BASE = (env.OCR2_BASE || process.env.OCR2_BASE || "https://api.novita.ai/v3/openai").replace(/\/+$/, "");
const OCR2_MODEL = env.OCR2_MODEL || process.env.OCR2_MODEL || "deepseek/deepseek-ocr-2";
const COMMENT_STYLE_FILE = path.join(__dirname, "评论风格.json");
function loadCommentStyles() {
  try {
    const data = JSON.parse(fs.readFileSync(COMMENT_STYLE_FILE, "utf8"));
    if (data && Array.isArray(data.styles) && data.styles.length) return data;
  } catch (_) {}
  return null;
}
const FALLBACK_APIS = (env.DOUYIN_FALLBACK_APIS || process.env.DOUYIN_FALLBACK_APIS || "")
  .split(",").map(function (item) { return item.trim(); }).filter(Boolean);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const MIME = {
  ".html": "text/html; charset=utf-8", ".md": "text/markdown; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".mp4": "video/mp4"
};
const SHARE_HOSTS = ["douyin.com", "iesdouyin.com"];
const OTHER_SHORT_HOSTS = ["b23.tv", "bilibili.com"];
const MEDIA_HOSTS = [
  "douyinvod.com", "douyin.com", "iesdouyin.com", "bytecdn.cn", "bytedance.com",
  "bytedance.net", "zijieapi.com", "snssdk.com", "volces.com", "volcvideo.com"
];

function hostMatches(host, suffixes) {
  host = String(host || "").toLowerCase().replace(/\.$/, "");
  return suffixes.some(function (suffix) { return host === suffix || host.endsWith("." + suffix); });
}
function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(data));
}
function readBody(req, maxBytes) {
  return new Promise(function (resolve, reject) {
    const chunks = []; let size = 0;
    req.on("data", function (chunk) {
      size += chunk.length;
      if (size > maxBytes) { req.destroy(); return reject(new Error("请求体过大")); }
      chunks.push(chunk);
    });
    req.on("end", function () { resolve(Buffer.concat(chunks).toString("utf8")); });
    req.on("error", reject);
  });
}
/* 调用 OCR2 识别单帧图片中的文字（OpenAI 兼容 chat/completions） */
function ocr2Recognize(imageDataUrl) {
  return new Promise(function (resolve, reject) {
    const payload = JSON.stringify({
      model: OCR2_MODEL,
      messages: [{ role: "user", content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: "识别这张视频截图中出现的所有文字（字幕、花字、标题、贴纸文字），按阅读顺序输出为纯文本，不要任何解释；如果画面中没有文字，只输出空字符串。" }
      ] }],
      max_tokens: 500
    });
    const target = new URL(OCR2_BASE + "/chat/completions");
    const req = https.request(target, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + OCR2_KEY, "content-length": Buffer.byteLength(payload) }
    }, function (response) {
      const chunks = [];
      response.on("data", function (c) { chunks.push(c); });
      response.on("end", function () {
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (data.error) return reject(new Error(data.error.message || "OCR 接口返回错误"));
          resolve(String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "").trim());
        } catch (error) { reject(new Error("OCR 响应解析失败")); }
      });
    });
    req.on("error", reject);
    req.setTimeout(30000, function () { req.destroy(new Error("OCR 请求超时")); });
    req.end(payload);
  });
}
function extractSharedUrl(text) {
  const match = String(text || "").match(/https?:\/\/[^\s，。、；！？'"“”<>()（）【】]+/i);
  return (match ? match[0] : String(text || "").trim()).replace(/[),.;!?，。；！？）】]+$/, "");
}
function videoIdFromUrl(url) {
  const match = String(url).match(/\/(?:video|note|slides)\/(\d{15,})/i) ||
    String(url).match(/[?&](?:modal_id|vid|item_ids)=(\d{15,})/i);
  return match ? match[1] : "";
}
function safeUrl(raw, allowedHosts) {
  const parsed = new URL(raw);
  if (!/^https?:$/.test(parsed.protocol) || !hostMatches(parsed.hostname, allowedHosts)) {
    throw new Error("不支持的链接域名: " + parsed.hostname);
  }
  return parsed;
}
function requestOnce(raw, options) {
  options = options || {};
  return new Promise(function (resolve, reject) {
    const parsed = new URL(raw);
    const client = parsed.protocol === "https:" ? https : http;
    const headers = Object.assign({ "user-agent": UA, accept: "text/html,application/json;q=0.9,*/*;q=0.8", "accept-encoding": "identity" }, options.headers || {});
    const req = client.request(parsed, { method: options.method || "GET", headers: headers }, function (response) {
      resolve(response);
    });
    req.on("error", reject);
    req.setTimeout(options.timeout || 15000, function () { req.destroy(new Error("请求超时")); });
    req.end();
  });
}
async function resolveRedirects(raw, allowedHosts, maxRedirects) {
  let current = safeUrl(raw, allowedHosts).href;
  for (let i = 0; i <= (maxRedirects || 7); i += 1) {
    const response = await requestOnce(current);
    const location = response.headers.location;
    response.resume();
    if (location && response.statusCode >= 300 && response.statusCode < 400) {
      current = safeUrl(new URL(location, current).href, allowedHosts).href;
      continue;
    }
    return current;
  }
  throw new Error("短链重定向次数过多");
}
async function readText(raw, allowedHosts, maxBytes) {
  let current = safeUrl(raw, allowedHosts).href;
  for (let i = 0; i < 8; i += 1) {
    const response = await requestOnce(current);
    if (response.headers.location && response.statusCode >= 300 && response.statusCode < 400) {
      current = safeUrl(new URL(response.headers.location, current).href, allowedHosts).href;
      response.resume();
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 400) {
      response.resume();
      throw new Error("页面请求失败: HTTP " + response.statusCode);
    }
    return await new Promise(function (resolve, reject) {
      const chunks = []; let size = 0;
      response.on("data", function (chunk) {
        size += chunk.length;
        if (size > maxBytes) return response.destroy(new Error("页面数据过大"));
        chunks.push(chunk);
      });
      response.on("end", function () { resolve({ text: Buffer.concat(chunks).toString("utf8"), url: current }); });
      response.on("error", reject);
    });
  }
  throw new Error("页面重定向次数过多");
}

function decodeHtml(value) {
  return String(value || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\\u002[fF]/g, "/").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
}
function pageMetadata(html) {
  function meta(property) {
    const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const a = html.match(new RegExp('<meta[^>]+(?:property|name)=["\\\']' + escaped + '["\\\'][^>]+content=["\\\']([^"\\\']+)', "i"));
    const b = html.match(new RegExp('<meta[^>]+content=["\\\']([^"\\\']+)["\\\'][^>]+(?:property|name)=["\\\']' + escaped + '["\\\']', "i"));
    return decodeHtml((a || b || [])[1] || "").trim();
  }
  return { title: meta("og:title") || meta("twitter:title"), cover: meta("og:image") || meta("twitter:image") };
}
function extractMediaCandidates(value, results, trail, depth) {
  if (depth > 16 || value == null) return;
  if (typeof value === "string") {
    const decoded = decodeHtml(value);
    if (/^https?:\/\//i.test(decoded)) results.push({ url: decoded, trail: trail });
    decoded.match(/https?:\\?\/\\?\/[^\s"'<>]+/g)?.forEach(function (url) {
      results.push({ url: decodeHtml(url), trail: trail });
    });
    return;
  }
  if (Array.isArray(value)) return value.forEach(function (item) { extractMediaCandidates(item, results, trail, depth + 1); });
  if (typeof value === "object") Object.keys(value).forEach(function (key) {
    extractMediaCandidates(value[key], results, trail + "." + key.toLowerCase(), depth + 1);
  });
}
function scoreMedia(candidate) {
  let parsed; try { parsed = new URL(candidate.url); } catch (_) { return -1000; }
  const text = (candidate.trail + " " + candidate.url).toLowerCase();
  let score = hostMatches(parsed.hostname, MEDIA_HOSTS) ? 10 : 0;
  if (/play_addr|playaddr|play_url|playurl|video_url|download_addr|bitrate|playwm|playApi/i.test(candidate.trail)) score += 30;
  if (/\.mp4(?:\?|$)|video\/tos|mime_type=video|media-video/i.test(text)) score += 20;
  if (/nwm|watermark=0|ratio=play/i.test(text)) score += 5;
  if (/cover|avatar|music|audio|poster|image|\.jpe?g|\.png|\.webp/i.test(text)) score -= 50;
  return score;
}
function bestMediaFromObject(value) {
  const candidates = [];
  extractMediaCandidates(value, candidates, "root", 0);
  const unique = new Map();
  candidates.forEach(function (item) {
    const url = item.url.replace(/[\\"'}\]]+$/, "");
    if (!unique.has(url) || scoreMedia(item) > scoreMedia(unique.get(url))) unique.set(url, { url: url, trail: item.trail });
  });
  return Array.from(unique.values()).sort(function (a, b) { return scoreMedia(b) - scoreMedia(a); })[0] || null;
}
function parseEmbeddedPage(html) {
  const decoded = decodeHtml(html);
  const objects = [];
  const scriptPattern = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while ((match = scriptPattern.exec(decoded))) {
    try { objects.push(JSON.parse(match[1].trim())); } catch (_) {}
  }
  let best = bestMediaFromObject(objects);
  if (!best) best = bestMediaFromObject(decoded);
  if (!best || scoreMedia(best) < 15) return null;
  const meta = pageMetadata(html);
  return { videoUrl: best.url, title: meta.title, cover: meta.cover, source: "page" };
}

function runProcess(command, args, timeoutMs) {
  return new Promise(function (resolve, reject) {
    let child;
    try { child = spawn(command, args, { windowsHide: true }); } catch (error) { return reject(error); }
    const stdout = []; const stderr = []; let done = false;
    const timer = setTimeout(function () { if (!done) child.kill(); }, timeoutMs || 90000);
    child.on("error", function (error) { clearTimeout(timer); if (!done) { done = true; reject(error); } });
    child.stdout.on("data", function (chunk) { if (Buffer.concat(stdout).length < 12 * 1024 * 1024) stdout.push(chunk); });
    child.stderr.on("data", function (chunk) { if (Buffer.concat(stderr).length < 1024 * 1024) stderr.push(chunk); });
    child.on("close", function (code) {
      clearTimeout(timer); if (done) return; done = true;
      resolve({ code: code, stdout: Buffer.concat(stdout).toString("utf8"), stderr: Buffer.concat(stderr).toString("utf8") });
    });
  });
}
async function runYtDlp(args) {
  const cookieArgs = fs.existsSync(COOKIE_FILE) ? ["--cookies", COOKIE_FILE] : [];
  const fullArgs = cookieArgs.concat(["--no-playlist", "--no-warnings", "--socket-timeout", "20"], args);
  const runners = [
    ["yt-dlp", fullArgs], ["python", ["-m", "yt_dlp"].concat(fullArgs)], ["py", ["-m", "yt_dlp"].concat(fullArgs)]
  ];
  let details = "";
  for (const runner of runners) {
    try {
      const result = await runProcess(runner[0], runner[1], 120000);
      details += result.stderr + "\n";
      if (result.code === 0) return result;
    } catch (error) { details += error.message + "\n"; }
  }
  throw new Error(details.trim().slice(-500) || "未找到 yt-dlp，请运行「安装依赖.bat」");
}
async function parseWithYtDlp(url) {
  const result = await runYtDlp(["--dump-single-json", "--skip-download", url]);
  const info = JSON.parse(result.stdout);
  let media = info.url || "";
  if (!media && Array.isArray(info.formats)) {
    const formats = info.formats.filter(function (format) { return format.url && format.vcodec !== "none"; });
    formats.sort(function (a, b) { return (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0); });
    media = formats[0] && formats[0].url;
  }
  if (!media) throw new Error("yt-dlp 没有返回视频流地址");
  return { videoUrl: media, title: info.title || info.description || "", cover: info.thumbnail || "", author: info.uploader || "", duration: info.duration || null, source: "yt-dlp" };
}
async function parseWithBrowser(url) {
  let playwright;
  try { playwright = require("playwright"); } catch (_) { throw new Error("未安装 Playwright（可选回退）"); }
  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ userAgent: UA });
    const found = [];
    page.on("response", function (response) {
      const headers = response.headers(); const candidate = response.url();
      if (/^video\//i.test(headers["content-type"] || "") || /\.mp4(?:\?|$)|video\/tos/i.test(candidate)) found.push(candidate);
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 35000 });
    await page.waitForTimeout(5000);
    if (!found.length) throw new Error("浏览器未捕获到视频请求");
    return { videoUrl: found[found.length - 1], title: await page.title(), cover: "", source: "browser" };
  } finally { await browser.close(); }
}
async function parseWithPublicApis(url) {
  if (!FALLBACK_APIS.length) throw new Error("未配置公共解析接口");
  let lastError = "";
  for (const template of FALLBACK_APIS) {
    try {
      const endpoint = template.includes("{url}") ? template.replace("{url}", encodeURIComponent(url)) : template + (template.includes("?") ? "&" : "?") + "url=" + encodeURIComponent(url);
      const response = await readText(endpoint, [new URL(endpoint).hostname], 5 * 1024 * 1024);
      const data = JSON.parse(response.text); const media = bestMediaFromObject(data);
      if (!media || scoreMedia(media) < 10) throw new Error("响应中没有视频地址");
      return { videoUrl: media.url, title: data.title || data.desc || "", cover: data.cover || data.pic || "", source: "public-api" };
    } catch (error) { lastError = error.message; }
  }
  throw new Error(lastError || "公共接口解析失败");
}
async function normalizeDouyin(text) {
  const shared = extractSharedUrl(text);
  const parsed = safeUrl(shared, SHARE_HOSTS);
  const finalUrl = await resolveRedirects(parsed.href, SHARE_HOSTS, 7);
  const id = videoIdFromUrl(finalUrl) || videoIdFromUrl(shared);
  if (!id) throw new Error("这不是具体的视频链接，请在抖音视频的分享菜单中选择“复制链接”后重试");
  const canonicalUrl = id ? "https://www.douyin.com/video/" + id : finalUrl;
  return { originalUrl: shared, finalUrl: finalUrl, canonicalUrl: canonicalUrl, videoId: id };
}
async function resolveDouyin(text) {
  const normalized = await normalizeDouyin(text);
  const attempts = [];
  try {
    const page = await readText(normalized.canonicalUrl, SHARE_HOSTS, 8 * 1024 * 1024);
    const result = parseEmbeddedPage(page.text);
    if (result) return Object.assign(normalized, result, { attempts: attempts });
    attempts.push("页面内嵌数据: 未找到视频流");
  } catch (error) { attempts.push("页面内嵌数据: " + error.message); }
  const methods = [
    ["yt-dlp", parseWithYtDlp],
    ["无头浏览器", parseWithBrowser],
    ["公共接口", parseWithPublicApis]
  ];
  for (const entry of methods) {
    try { return Object.assign(normalized, await entry[1](normalized.canonicalUrl), { attempts: attempts }); }
    catch (error) { attempts.push(entry[0] + ": " + error.message); }
  }
  const error = new Error("所有解析方式均失败"); error.attempts = attempts; throw error;
}
function failureHint(attempts) {
  const text = attempts.join(" ").toLowerCase();
  if (/unsupported url|不是具体的视频链接/.test(text)) return "请使用视频分享菜单复制出的短链或 /video/数字ID 链接，不要使用搜索页地址。";
  if (/cookie|login|sign in|fresh/.test(text) && !fs.existsSync(COOKIE_FILE)) return "抖音拒绝了未登录请求。如确认有权访问该视频，可导出自己账号的 cookies.txt 后重试。";
  if (/captcha|verify|风控|blocked|forbidden|403/.test(text)) return "请求触发了抖音风控。建议改用视频分享短链，或保存视频后从“本地视频”上传。";
  return "建议先确认链接来自视频的“分享 → 复制链接”；仍失败时，可保存视频后从“本地视频”上传。";
}
function publicResult(result) {
  const token = Buffer.from(result.videoUrl, "utf8").toString("base64url");
  return {
    ok: true, platform: "douyin", videoId: result.videoId, canonicalUrl: result.canonicalUrl,
    title: result.title || "抖音视频", author: result.author || "", cover: result.cover || "",
    duration: result.duration || null, source: result.source, attempts: result.attempts,
    playUrl: "/douyin/media?token=" + encodeURIComponent(token)
  };
}

async function proxyMedia(req, res, raw, redirects) {
  const parsed = safeUrl(raw, MEDIA_HOSTS.concat(SHARE_HOSTS));
  const headers = { "user-agent": UA, referer: "https://www.douyin.com/", accept: "*/*" };
  if (req.headers.range) headers.range = req.headers.range;
  const response = await requestOnce(parsed.href, { headers: headers, timeout: 25000 });
  if (response.headers.location && response.statusCode >= 300 && response.statusCode < 400 && redirects < 6) {
    const next = new URL(response.headers.location, parsed.href).href; response.resume();
    return proxyMedia(req, res, next, redirects + 1);
  }
  const passthrough = {};
  ["content-type", "content-length", "content-range", "accept-ranges", "last-modified"].forEach(function (name) {
    if (response.headers[name]) passthrough[name] = response.headers[name];
  });
  passthrough["cache-control"] = "private, max-age=300";
  res.writeHead(response.statusCode || 502, passthrough); response.pipe(res);
}

async function handle(req, res) {
  const requestUrl = new URL(req.url, "http://local");
  if (requestUrl.pathname === "/app-config") {
    return sendJson(res, 200, { model: MODEL, commentStyles: loadCommentStyles(), ocr2: !!OCR2_KEY });
  }
  if (requestUrl.pathname === "/ocr/recognize" && req.method === "POST") {
    if (!OCR2_KEY) return sendJson(res, 400, { error: "未配置 OCR2_API_KEY" });
    try {
      const body = JSON.parse(await readBody(req, 3 * 1024 * 1024));
      if (!/^data:image\/(jpeg|png|webp);base64,/.test(String(body.image || ""))) throw new Error("无效的图片数据");
      return sendJson(res, 200, { text: await ocr2Recognize(body.image) });
    } catch (error) { return sendJson(res, 422, { error: error.message }); }
  }
  if (requestUrl.pathname === "/douyin/parse") {
    const raw = requestUrl.searchParams.get("url") || "";
    if (!raw) return sendJson(res, 400, { error: "请提供抖音链接或分享文字" });
    try { return sendJson(res, 200, publicResult(await resolveDouyin(raw))); }
    catch (error) {
      const attempts = error.attempts || [];
      return sendJson(res, 422, { error: error.message, attempts: attempts, hint: failureHint(attempts.concat(error.message)) });
    }
  }
  if (requestUrl.pathname === "/douyin/media") {
    try {
      const token = requestUrl.searchParams.get("token") || "";
      if (!token || token.length > 16384) throw new Error("无效的视频令牌");
      const raw = Buffer.from(token, "base64url").toString("utf8");
      return await proxyMedia(req, res, raw, 0);
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  if (requestUrl.pathname === "/resolve") {
    const raw = extractSharedUrl(requestUrl.searchParams.get("url") || "");
    try {
      const host = new URL(raw).hostname;
      const allowed = hostMatches(host, SHARE_HOSTS) ? SHARE_HOSTS : OTHER_SHORT_HOSTS;
      safeUrl(raw, allowed);
      return sendJson(res, 200, { url: await resolveRedirects(raw, allowed, 7) });
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
  }
  if (requestUrl.pathname === "/download") {
    const raw = extractSharedUrl(requestUrl.searchParams.get("url") || "");
    try {
      const parsed = new URL(raw);
      if (!hostMatches(parsed.hostname, SHARE_HOSTS.concat(OTHER_SHORT_HOSTS))) throw new Error("仅支持抖音/B站公开视频链接");
      const output = path.join(os.tmpdir(), "pcj_" + crypto.randomBytes(8).toString("hex") + ".mp4");
      try {
        await runYtDlp(["-f", "mp4/best[ext=mp4]/best", "-o", output, raw]);
        if (!fs.existsSync(output)) throw new Error("下载完成但未生成视频文件");
        const stat = fs.statSync(output);
        res.writeHead(200, { "content-type": "video/mp4", "content-length": stat.size, "content-disposition": "inline; filename=video.mp4" });
        const stream = fs.createReadStream(output); stream.pipe(res);
        const cleanup = function () { fs.unlink(output, function () {}); };
        stream.on("close", cleanup); stream.on("error", cleanup);
      } catch (error) { fs.unlink(output, function () {}); return sendJson(res, 422, { error: "下载失败: " + error.message }); }
    } catch (error) { return sendJson(res, 400, { error: error.message }); }
    return;
  }
  if (requestUrl.pathname.startsWith("/api/")) {
    if (!KEY) return sendJson(res, 500, { error: { message: "服务端未配置 MOONSHOT_API_KEY，请检查 .env" } });
    const target = new URL(BASE + requestUrl.pathname.slice(4) + requestUrl.search);
    const headers = Object.assign({}, req.headers, { host: target.host, authorization: "Bearer " + KEY });
    delete headers["accept-encoding"];
    const proxy = https.request(target, { method: req.method, headers: headers }, function (upstream) {
      res.writeHead(upstream.statusCode, upstream.headers); upstream.pipe(res);
    });
    proxy.on("error", function (error) { sendJson(res, 502, { error: { message: "代理请求失败: " + error.message } }); });
    req.pipe(proxy); return;
  }

  let pathname;
  try { pathname = decodeURIComponent(requestUrl.pathname); } catch (_) { res.writeHead(400); return res.end("Bad Request"); }
  if (pathname === "/") pathname = "/index.html";
  const root = path.resolve(__dirname);
  const distRoot = path.resolve(__dirname, "dist");
  let file = path.resolve(distRoot, "." + pathname);
  if (!(file === distRoot || file.startsWith(distRoot + path.sep)) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    file = path.resolve(root, "." + pathname);
  }
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403); return res.end("Forbidden"); }
  fs.readFile(file, function (error, data) {
    if (error) { res.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); return res.end("404 Not Found"); }
    res.writeHead(200, { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream" }); res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  Promise.resolve(handle(req, res)).catch(function (error) {
    if (!res.headersSent) sendJson(res, 500, { error: "服务器内部错误: " + error.message });
    else res.destroy(error);
  });
});

if (require.main === module) {
  server.listen(PORT, function () {
    console.log("=================================");
    console.log("🐾 宠物呵护小判官 已启动");
    console.log("   打开浏览器访问: http://localhost:" + PORT);
    console.log("   抖音解析: 页面数据 → yt-dlp" + (fs.existsSync(COOKIE_FILE) ? "（已加载 cookies.txt）" : "（无 Cookie）") + " → Playwright → 公共接口");
    console.log("   API Key: " + (KEY ? "已配置（服务端注入）" : "⚠ 未配置，请编辑 .env"));
    console.log("=================================");
  });
}

module.exports = {
  server: server,
  extractSharedUrl: extractSharedUrl,
  videoIdFromUrl: videoIdFromUrl,
  hostMatches: hostMatches,
  parseEmbeddedPage: parseEmbeddedPage,
  bestMediaFromObject: bestMediaFromObject
};
