"use strict";
const assert = require("assert");
const resolver = require("./server");

assert.strictEqual(
  resolver.extractSharedUrl("3.21 复制打开抖音 https://v.douyin.com/AbCdEf/ 一起看看"),
  "https://v.douyin.com/AbCdEf/"
);
assert.strictEqual(
  resolver.videoIdFromUrl("https://www.douyin.com/discover?modal_id=7456789012345678901"),
  "7456789012345678901"
);
assert.strictEqual(
  resolver.videoIdFromUrl("https://www.douyin.com/video/7456789012345678901"),
  "7456789012345678901"
);
assert.strictEqual(resolver.hostMatches("v.douyin.com", ["douyin.com"]), true);
assert.strictEqual(resolver.hostMatches("douyin.com.evil.test", ["douyin.com"]), false);

const embedded = `<html><head>
  <meta property="og:title" content="测试视频">
  <meta property="og:image" content="https://p3.douyinpic.com/cover.jpeg">
  </head><body><script type="application/json">${JSON.stringify({
    aweme: {
      video: {
        cover: { url_list: ["https://p3.douyinpic.com/cover.jpeg"] },
        play_addr: { url_list: ["https://v3.douyinvod.com/video/tos/test.mp4"] }
      }
    }
  })}</script></body></html>`;
const parsed = resolver.parseEmbeddedPage(embedded);
assert(parsed, "应从内嵌 JSON 找到视频");
assert.strictEqual(parsed.videoUrl, "https://v3.douyinvod.com/video/tos/test.mp4");
assert.strictEqual(parsed.title, "测试视频");
assert.strictEqual(parsed.source, "page");

console.log("抖音解析器本地测试全部通过");
