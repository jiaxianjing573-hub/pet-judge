/* 本地抽帧与辅助解析通道：预览帧条、字幕 OCR、微动作压缩复核 */
import { S, kimiChat, ocrFrame } from './api.js';
import { PROMPT_MICRO } from './prompts.js';

export function fmtTime(t) {
  const m = Math.floor(t / 60), s = (t % 60).toFixed(1);
  return (m < 10 ? '0' : '') + m + ':' + (+s < 10 ? '0' : '') + s;
}

/* 分块帧差：16x9 缩略图切 4x3=12 块取最大块差，局部微动作（如鼻子抽动）也能触发保留 */
export function frameDiff(a, b) {
  let maxBlock = 0;
  for (let by = 0; by < 3; by++) for (let bx = 0; bx < 4; bx++) {
    let s = 0, n = 0;
    for (let y = by * 3; y < by * 3 + 3; y++) for (let x = bx * 4; x < bx * 4 + 4; x++) {
      const i = (y * 16 + x) * 4;
      s += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); n++;
    }
    const m = s / n / 3; if (m > maxBlock) maxBlock = m;
  }
  return maxBlock;
}

/* 通用抽帧器。isAlive() 为 false 时中止（换视频/取消） */
export async function grabFrames(file, interval, maxW, isAlive, onFrame) {
  if (!/^video\//.test(file.type || '')) return [];
  const url = URL.createObjectURL(file);
  const v = document.createElement('video');
  v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
  const frames = [];
  try {
    await new Promise((res, rej) => { v.onloadedmetadata = res; v.onerror = () => rej(new Error('无法读取视频')); });
    const dur = v.duration;
    if (!isFinite(dur) || dur <= 0) return [];
    const step = Math.max(interval, dur / 160);
    const cv = document.createElement('canvas');
    const w = Math.min(maxW, v.videoWidth || maxW);
    const h = Math.max(40, Math.round(w * ((v.videoHeight / v.videoWidth) || 0.56)));
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const g = document.createElement('canvas'); g.width = 16; g.height = 9;
    const gctx = g.getContext('2d', { willReadFrequently: true });
    for (let t = 0; t < dur; t += step) {
      if (!isAlive()) break;
      await new Promise(res => {
        const h2 = setTimeout(res, 1500);
        v.onseeked = () => { clearTimeout(h2); res(); };
        v.currentTime = Math.min(t, Math.max(0, dur - 0.05));
      });
      ctx.drawImage(v, 0, 0, w, h);
      gctx.drawImage(v, 0, 0, 16, 9);
      const frame = { t, dataUrl: cv.toDataURL('image/jpeg', 0.7), lum: gctx.getImageData(0, 0, 16, 9).data };
      frames.push(frame);
      if (onFrame) onFrame(frame, frames.length);
    }
  } catch { /* 编码不支持等情况静默跳过 */ }
  finally { URL.revokeObjectURL(url); }
  return frames;
}

/* 预览帧条：本地真实抽帧给用户看 */
export async function previewChannel(file, isAlive, onUpdate) {
  const frames = await grabFrames(file, 2.2, 120, isAlive, (f, n) => onUpdate({ list: null, count: n, thumb: f.dataUrl }));
  if (isAlive() && frames.length) onUpdate({ list: frames.map(f => f.dataUrl), count: frames.length, done: true });
}

/* 字幕通道：0.75s/帧 OCR，相邻去重成时间轴。返回字幕文本（可能为空） */
export async function subtitleChannel(file, isAlive, onProgress) {
  if (!S.ocr2) return '';
  const frames = await grabFrames(file, 0.75, 640, isAlive);
  if (!isAlive() || !frames.length) return '';
  const texts = new Array(frames.length).fill('');
  let idx = 0, done = 0;
  async function worker() {
    while (idx < frames.length) {
      const i = idx++;
      if (!isAlive()) return;
      try { texts[i] = await ocrFrame(frames[i].dataUrl); } catch {}
      done++;
      if (isAlive() && done % 4 === 0) onProgress(done, frames.length);
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  if (!isAlive()) return '';
  const lines = []; let prev = '';
  frames.forEach((f, i) => {
    const t = texts[i].replace(/\s+/g, ' ').trim();
    if (t && t !== prev) lines.push(`[${fmtTime(f.t)}] ${t}`);
    if (t) prev = t;
  });
  return lines.join('\n');
}

/* 微动作通道：4帧/秒密集抽帧 → 分块帧差丢冗余（视觉压缩思路）→ 变化关键帧发模型细看 */
export async function microChannel(file, isAlive) {
  const frames = await grabFrames(file, 0.25, 320, isAlive);
  if (!isAlive() || frames.length < 4) return '';
  const kept = [frames[0]];
  for (const f of frames.slice(1)) {
    if (frameDiff(f.lum, kept[kept.length - 1].lum) > 6) kept.push(f);
    if (kept.length >= 30) break;
  }
  if (kept.length < 3) return '';
  try {
    const content = kept.map(f => ({ type: 'image_url', image_url: { url: f.dataUrl } }));
    content.push({ type: 'text', text: PROMPT_MICRO(kept.length, kept.map(f => fmtTime(f.t)).join('、')) });
    const out = await kimiChat(content);
    if (!isAlive()) return '';
    return out.micro || '';
  } catch { return ''; }
}
