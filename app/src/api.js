/* 后端通信层：配置、Kimi 对话（普通/流式）、文件上传、OCR、流式 JSON 解析 */

export const S = { model: 'kimi-k3', commentStyles: null, ocr2: false };

export const configReady = fetch('/app-config')
  .then(r => (r.ok ? r.json() : {}))
  .then(c => {
    if (c.model) S.model = c.model;
    if (c.commentStyles) S.commentStyles = c.commentStyles;
    S.ocr2 = !!c.ocr2;
  })
  .catch(() => {});

export function parseModelJson(text) {
  const clean = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(clean || '{}');
}

export async function kimiChat(userContent, sys) {
  const r = await fetch('/api/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: S.model,
      messages: [
        { role: 'system', content: sys || '你是专业的视频内容分析与宠物科学专家。所有回答必须是合法 JSON。' },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' }
    })
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${r.status}`);
  }
  const d = await r.json();
  return parseModelJson(d.choices?.[0]?.message?.content || '{}');
}

export async function kimiChatStream(userContent, onContent) {
  const r = await fetch('/api/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: S.model,
      messages: [
        { role: 'system', content: '你是专业的视频内容分析与宠物科学专家。所有回答必须是合法 JSON。' },
        { role: 'user', content: userContent }
      ],
      response_format: { type: 'json_object' },
      stream: true
    })
  });
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error?.message || `HTTP ${r.status}`);
  }
  const ct = r.headers.get('content-type') || '';
  if (!r.body || !ct.includes('text/event-stream')) {
    const d = await r.json();
    const content = d.choices?.[0]?.message?.content || '{}';
    onContent(content);
    return parseModelJson(content);
  }
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let pending = '', full = '', streamError = '';
  function consume(line) {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    let event; try { event = JSON.parse(data); } catch { return; }
    if (event.error) { streamError = event.error.message || '模型流式输出失败'; return; }
    const delta = event.choices?.[0]?.delta?.content || event.choices?.[0]?.message?.content || '';
    if (delta) { full += delta; onContent(full); }
  }
  for (;;) {
    const part = await reader.read();
    pending += decoder.decode(part.value || new Uint8Array(), { stream: !part.done });
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    lines.forEach(consume);
    if (part.done) break;
  }
  if (pending) consume(pending);
  if (streamError) throw new Error(streamError);
  if (!full.trim()) throw new Error('模型没有返回可解析内容');
  return parseModelJson(full);
}

export function uploadFile(file, onProgress) {
  const fd = new FormData();
  fd.append('file', file, file.name || 'video.mp4');
  fd.append('purpose', 'video');
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files');
    xhr.upload.onprogress = e => { if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total); };
    xhr.onerror = () => reject(new Error('上传失败：网络连接中断'));
    xhr.onload = () => {
      let info = {}; try { info = JSON.parse(xhr.responseText || '{}'); } catch {}
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('上传失败: ' + (info.error?.message || `HTTP ${xhr.status}`)));
      if (!info.id) return reject(new Error('上传失败：未返回文件 ID'));
      resolve(info);
    };
    xhr.send(fd);
  });
}

export async function ocrFrame(dataUrl) {
  const r = await fetch('/ocr/recognize', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: dataUrl })
  });
  const d = await r.json().catch(() => ({}));
  return (d.text || '').trim();
}

/* 从流式 JSON 中提取某 key 的字符串值（可能未闭合） */
export function partialJsonString(raw, key) {
  const match = new RegExp('"' + key + '"\\s*:\\s*"').exec(raw);
  if (!match) return '';
  let out = '', i = match.index + match[0].length;
  for (; i < raw.length; i++) {
    const ch = raw[i];
    if (ch === '"') break;
    if (ch !== '\\') { out += ch; continue; }
    i++; if (i >= raw.length) break;
    const next = raw[i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'u' && /^[0-9a-f]{4}$/i.test(raw.slice(i + 1, i + 5))) { out += String.fromCharCode(parseInt(raw.slice(i + 1, i + 5), 16)); i += 4; }
    else out += next;
  }
  return out;
}

/* 从流式 JSON 中提取某 key 的所有"已完整"字符串值 */
export function partialCardFields(raw, key) {
  const out = [], re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"', 'g');
  let m;
  while ((m = re.exec(raw))) { try { out.push(JSON.parse('"' + m[1] + '"')); } catch { out.push(m[1]); } }
  return out;
}
