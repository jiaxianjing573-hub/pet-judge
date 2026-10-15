import { useState, useRef, useEffect, useCallback } from 'react';
import Header from './components/Header.jsx';
import VideoEntry from './components/VideoEntry.jsx';
import Pipeline from './components/Pipeline.jsx';
import Judge from './components/Judge.jsx';
import { configReady, kimiChatStream, uploadFile, partialJsonString, partialCardFields } from './api.js';
import { PROMPT_EXTRACT, PROMPT_CARDS, friendlyAnalyzeError, scanEntities } from './prompts.js';
import { previewChannel, subtitleChannel, microChannel } from './channels.js';

const WAIT_MSGS = [
  '正在聆听视频中的人声和声音',
  'AI 正在逐帧观看画面',
  '视频越长耗时越久，请放心等待',
  '还在认真分析中，就快好了'
];

const initSteps = () => ({
  prepare: { state: 'wait', text: '等待视频' },
  listen: { state: 'wait', text: '等待识别声音' },
  see: { state: 'wait', text: '等待理解画面' },
  tidy: { state: 'wait', text: '等待整理' }
});

export default function App() {
  const [entry, setEntry] = useState({ resolving: false, player: null, title: '', guide: false, error: null, fileName: '' });
  const [pipe, setPipe] = useState(null);
  const [live, setLive] = useState({ transcript: '', visual: '', chips: [], frames: [], subState: '' });
  const [detect, setDetect] = useState(null);
  const [game, setGame] = useState(null);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [toast, setToast] = useState('');

  const seqRef = useRef(0);
  const D = useRef({ file: null, clipUrl: '', lastUrl: '', transcript: '', visual: '', micro: '', subtitles: '', comments: [], subJob: null, microJob: null, extractDone: false, chipsFound: new Set(), streamGot: false, startTs: 0 });
  const toastTimer = useRef(null);

  const say = useCallback(msg => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
  }, []);

  const alive = seq => () => seq === seqRef.current;
  const setStep = (key, state, text) =>
    setPipe(p => p ? { ...p, steps: { ...p.steps, [key]: { state, text: text ?? p.steps[key].text } } } : p);

  /* 计时器 + 等待死区轮换文案 */
  useEffect(() => {
    if (!pipe || pipe.status !== 'running') return;
    const id = setInterval(() => {
      const sec = Math.max(0, Math.floor((Date.now() - D.current.startTs) / 1000));
      setPipe(p => {
        if (!p || p.status !== 'running') return p;
        const next = { ...p, elapsed: sec };
        if (!D.current.streamGot && p.steps.listen.state === 'active') {
          next.steps = { ...p.steps, listen: { state: 'active', text: WAIT_MSGS[Math.floor(sec / 6) % WAIT_MSGS.length] } };
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(id);
  }, [pipe?.status]);

  useEffect(() => () => {
    if (D.current.clipUrl) URL.revokeObjectURL(D.current.clipUrl);
  }, []);

  /* ---------- 载入来源 ---------- */
  function resetForNewSource() {
    seqRef.current++;
    if (D.current.clipUrl) URL.revokeObjectURL(D.current.clipUrl);
    Object.assign(D.current, { file: null, clipUrl: '', transcript: '', visual: '', micro: '', subtitles: '', comments: [], subJob: null, microJob: null, extractDone: false, chipsFound: new Set(), streamGot: false });
    setPipe(null); setLive({ transcript: '', visual: '', chips: [], frames: [], subState: '' });
    setDetect(null); setGame(null);
  }

  const extractUrl = t => (t.match(/https?:\/\/[^\s，。、；！？"'“”<>()（）【】]+/) || [t.trim()])[0];
  const douyinId = u => (u.match(/(?:video|note|slides)\/(\d{15,})/) || u.match(/(?:modal_id|vid|item_ids)=(\d{15,})/) || [])[1] || null;
  const isDouyin = u => { try { return /(^|\.)(douyin\.com|iesdouyin\.com)$/i.test(new URL(u).hostname); } catch { return false; } };

  async function loadUrl(raw) {
    let url = extractUrl(raw || '');
    if (!url) return say('请先粘贴视频链接或分享文字');
    resetForNewSource();
    setEntry(e => ({ ...e, error: null, title: '', guide: false, player: null }));

    if (isDouyin(url)) {
      setEntry(e => ({ ...e, resolving: true }));
      try {
        const r = await fetch('/douyin/parse?url=' + encodeURIComponent(url));
        const d = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
        if (!r.ok || !d.playUrl) throw Object.assign(new Error(d.error || '解析失败'), { attempts: d.attempts || [], hint: d.hint || '' });
        D.current.lastUrl = d.canonicalUrl;
        setEntry(e => ({ ...e, resolving: false, player: { kind: 'video', src: d.playUrl }, title: d.title || '抖音视频', guide: true }));
        say('抖音链接解析成功');
        return;
      } catch (err) {
        setEntry(e => ({ ...e, resolving: false, error: { message: err.message, hint: err.hint || '请使用视频分享菜单复制出的链接，或保存视频后从本地上传。', attempts: (err.attempts || []).filter(Boolean) } }));
        if (!douyinId(url)) return;
      }
    }

    if (/^https?:\/\/(v\.douyin\.com|b23\.tv)\//.test(url)) {
      try {
        const d = await (await fetch('/resolve?url=' + encodeURIComponent(url))).json();
        if (!d.url) throw new Error(d.error || '解析失败');
        url = d.url;
      } catch (err) { return say('短链解析失败（' + err.message + '），请在浏览器打开视频后复制完整链接'); }
    }

    D.current.lastUrl = url;
    let m;
    if ((m = url.match(/(BV[0-9A-Za-z]{10})/))) {
      setEntry(e => ({ ...e, player: { kind: 'iframe', src: `https://player.bilibili.com/player.html?bvid=${m[1]}&autoplay=0&danmaku=0` }, guide: true }));
    } else if ((m = douyinId(url))) {
      setEntry(e => ({ ...e, player: { kind: 'iframe', src: `https://open.douyin.com/player/video?vid=${m}&autoplay=0` }, guide: true }));
    } else {
      setEntry(e => ({ ...e, player: { kind: 'video', src: url } }));
      say('已按视频地址尝试播放');
      try {
        const r = await fetch(url); if (!r.ok) throw 0;
        const b = await r.blob();
        say('已获取视频数据，开始自动解析');
        analyzeVideo(new File([b], 'video', { type: b.type || 'video/mp4' }));
      } catch { say('这个链接无法直接读取内容，请把视频保存后从「本地视频」上传'); }
    }
  }

  async function serverDownload() {
    if (!D.current.lastUrl) return say('请先粘贴并播放一个链接');
    say('正在获取视频，可能需要十几秒');
    try {
      const r = await fetch('/download?url=' + encodeURIComponent(D.current.lastUrl));
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('video/')) {
        const e = await r.json().catch(() => ({ error: 'HTTP ' + r.status }));
        throw new Error(e.error || '下载失败');
      }
      const b = await r.blob();
      const f = new File([b], 'video.mp4', { type: 'video/mp4' });
      setEntry(e => ({ ...e, player: { kind: 'video', src: URL.createObjectURL(b) }, guide: false }));
      say('已获取（' + (b.size / 1048576).toFixed(1) + 'MB），开始自动解析');
      analyzeVideo(f);
    } catch (err) { say(err.message); }
  }

  function onFile(f) {
    setEntry(e => ({ ...e, player: { kind: 'video', src: URL.createObjectURL(f) }, guide: false, fileName: f.name, title: '', error: null }));
    say('本地视频已载入，开始自动解析');
    analyzeVideo(f);
  }

  /* ---------- 主解析 ---------- */
  async function analyzeVideo(file) {
    await configReady;
    if (!file) return say('请先载入视频');
    if (file.size > 95 * 1024 * 1024) return say('视频超过 95MB，请先剪辑或压缩后重新选择');
    resetForNewSource();
    const seq = seqRef.current, isAlive = alive(seq);
    D.current.file = file;
    D.current.clipUrl = URL.createObjectURL(file);
    D.current.startTs = Date.now();
    setPipe({ status: 'running', elapsed: 0, pct: 0, steps: { ...initSteps(), prepare: { state: 'active', text: file.name || '视频' } }, errTech: '' });

    previewChannel(file, isAlive, u => {
      if (!isAlive()) return;
      setLive(l => ({ ...l, frames: u.list || (u.thumb ? [...l.frames, u.thumb] : l.frames) }));
    });
    D.current.subJob = subtitleChannel(file, isAlive, (done, total) => {
      if (isAlive()) setLive(l => ({ ...l, subState: `正在识别画面文字 ${done}/${total}` }));
    }).then(sub => {
      if (!isAlive()) return;
      D.current.subtitles = sub;
      setLive(l => ({ ...l, subState: sub || (l.subState ? '（画面中未发现文字）' : '') }));
    }).catch(() => {});
    D.current.microJob = microChannel(file, isAlive).then(micro => {
      if (!isAlive() || !micro) return;
      D.current.micro = micro;
      if (D.current.extractDone) {
        D.current.visual += '\n\n【微动作观察（密集帧复核）】\n' + micro;
        setLive(l => ({ ...l, visual: D.current.visual }));
      }
    }).catch(() => {});

    try {
      const info = await uploadFile(file, (loaded, total) => {
        if (!isAlive()) return;
        const pct = Math.min(100, Math.round(loaded / total * 100));
        setPipe(p => p ? { ...p, pct: Math.round(pct * 0.35), steps: { ...p.steps, prepare: { state: 'active', text: `正在准备视频 ${pct}%` } } } : p);
      });
      if (!isAlive()) return;
      setStep('prepare', 'done', '视频准备好了');
      setStep('listen', 'active', '正在聆听视频中的人声和声音');

      const out = await kimiChatStream([
        { type: 'video_url', video_url: { url: `ms://${info.id}` } },
        { type: 'text', text: PROMPT_EXTRACT }
      ], content => {
        if (!isAlive()) return;
        D.current.streamGot = true;
        const tr = partialJsonString(content, 'transcript');
        const vi = partialJsonString(content, 'visual');
        const added = scanEntities(tr + ' ' + vi, D.current.chipsFound);
        setPipe(p => p ? { ...p, pct: Math.min(90, 35 + Math.round(content.length / 80)) } : p);
        setLive(l => ({ ...l, transcript: tr || l.transcript, visual: vi || l.visual, chips: added.length ? [...l.chips, ...added] : l.chips }));
        if (vi) {
          setStep('listen', 'done', tr ? '对话与声音识别完成' : '未检测到清晰人声');
          setStep('see', 'active', '正在还原动作、场景和画面文字');
        } else if (tr) {
          setStep('listen', 'active', '正在生成对话脚本');
        }
      });
      if (!isAlive()) return;

      setStep('listen', 'done', out.transcript ? '对话与声音识别完成' : '未检测到清晰人声');
      setStep('see', 'done', out.visual ? '画面内容理解完成' : '未获得画面描述');
      setStep('tidy', 'done', '内容整理完成');
      D.current.transcript = out.transcript || '';
      D.current.visual = (out.visual || '') + (D.current.micro ? '\n\n【微动作观察（密集帧复核）】\n' + D.current.micro : '');
      D.current.extractDone = true;
      const elapsed = Math.max(1, Math.floor((Date.now() - D.current.startTs) / 1000));
      setPipe(p => p ? { ...p, status: 'done', elapsed, pct: 100 } : p);
      setLive(l => ({ ...l, transcript: D.current.transcript || '（没有识别到对话内容）', visual: D.current.visual || '（没有获得画面描述）' }));
      say('解析完成，正在自动生成判断卡片');
      autoFlow(seq);
    } catch (err) {
      if (!isAlive()) return;
      setPipe(p => {
        if (!p) return p;
        const steps = { ...p.steps };
        for (const k of ['prepare', 'listen', 'see', 'tidy']) {
          if (steps[k].state === 'active') steps[k] = { state: 'error', text: friendlyAnalyzeError(err.message) };
        }
        return { ...p, status: 'error', steps, errTech: String(err.message || '未知错误') };
      });
      say(friendlyAnalyzeError(err.message));
    }
  }

  /* ---------- 自动流程：评论 → 卡片 ---------- */
  async function autoFlow(seq) {
    const isAlive = alive(seq);
    const jobs = [];
    if (D.current.microJob) jobs.push(D.current.microJob);
    if (D.current.subJob) jobs.push(D.current.subJob);
    await Promise.race([Promise.allSettled(jobs), new Promise(r => setTimeout(r, 25000))]);
    if (!isAlive()) return;
    generateCards(seq);
  }

  async function generateCards(seq) {
    const isAlive = alive(seq);
    if (!D.current.transcript && !D.current.visual) return;
    setDetect({ head: '正在检测行为点', claims: [], sources: [] });
    setGame(null);
    try {
      const out = await kimiChatStream(
        PROMPT_CARDS(D.current.transcript, D.current.visual, [], D.current.subtitles),
        raw => {
          if (!isAlive()) return;
          const claims = partialCardFields(raw, 'claim');
          if (!claims.length) return;
          const sources = partialCardFields(raw, 'source');
          setDetect({ head: `检测到 ${claims.length} 个行为点，正在比对科学养宠知识库`, claims, sources });
        }
      );
      if (!isAlive()) return;
      const arr = Array.isArray(out) ? out : out.cards;
      if (!Array.isArray(arr) || !arr.length) {
        setDetect(null);
        return say('未在视频中发现养宠相关要点');
      }
      setDetect(d => d ? { ...d, head: `共检测到 ${arr.length} 个行为点，哪些做法科学？你来判断`, sources: d.claims.map(() => '') } : d);
      setTimeout(() => {
        if (!isAlive()) return;
        setDetect(null);
        setGame({ cards: arr.map(normalizeCardClip), idx: 0, answers: [], face: 'front', complete: false });
      }, 900);
    } catch (err) {
      if (!isAlive()) return;
      setDetect(null);
      say('生成失败: ' + err.message);
    }
  }

  /* ---------- 判官游戏 ---------- */
  function judge(userSaysRight) {
    setGame(g => {
      if (!g || g.answers[g.idx]) return g;
      const card = g.cards[g.idx];
      const actual = card.verdict === 'right';
      const hit = userSaysRight === actual;
      if (hit) { setScore(s => s + 100); setCombo(c => c + 1); }
      else setCombo(0);
      const answers = [...g.answers];
      answers[g.idx] = { hit, actual, choice: userSaysRight };
      return { ...g, answers, face: 'back' };
    });
  }
  const nextCard = () => setGame(g => {
    if (!g || !g.answers[g.idx]) return g;
    if (g.idx >= g.cards.length - 1) return { ...g, complete: true };
    const idx = g.idx + 1;
    return { ...g, idx, face: g.answers[idx] ? 'back' : 'front' };
  });
  const prevCard = () => setGame(g => {
    if (!g) return g;
    if (g.complete) return { ...g, complete: false, face: 'back' };
    if (g.idx <= 0) return g;
    return { ...g, idx: g.idx - 1, face: 'back' };
  });
  const flipCard = () => setGame(g => g && g.answers[g.idx] ? { ...g, face: g.face === 'front' ? 'back' : 'front' } : g);

  function startOver() {
    resetForNewSource();
    setEntry({ resolving: false, player: null, title: '', guide: false, error: null, fileName: '' });
  }

  function parseCardTime(value) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    const text = String(value ?? '').trim();
    if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
    const match = text.match(/(?:(\d+):)?(\d{1,2})(?:\.(\d+))?/);
    if (!match) return null;
    return (Number(match[1] || 0) * 60) + Number(match[2]) + Number('0.' + (match[3] || 0));
  }

  function normalizeCardClip(card) {
    const start = parseCardTime(card.start_time ?? card.start ?? card.clip_start);
    let end = parseCardTime(card.end_time ?? card.end ?? card.clip_end);
    const risk = card.verdict === 'right' ? 'safe' : (card.risk_level === 'attention' ? 'attention' : 'danger');
    if (start == null) return { ...card, risk_level: risk, start_time: null, end_time: null };
    if (end == null || end <= start) end = start + 6;
    return { ...card, risk_level: risk, start_time: Math.max(0, start), end_time: Math.max(start + 1, Math.min(end, start + 20)) };
  }

  function cancelAnalyze() {
    seqRef.current++;
    setPipe({ status: 'cancelled' });
    say('已取消，可点击「重新解析」再试');
  }
  const retry = () => { if (D.current.file) analyzeVideo(D.current.file); };

  return (
    <main className={game ? 'app-shell quiz-mode' : 'app-shell'}>
      <Header score={score} combo={combo} compact={!!game} />
      {!pipe && !detect && !game && <VideoEntry entry={entry} onLoadUrl={loadUrl} onFile={onFile} onServerDownload={serverDownload} />}
      {pipe && !detect && !game && <Pipeline pipe={pipe} live={live} onCancel={cancelAnalyze} onRetry={retry} />}
      {(detect || game) && (
        <Judge detect={detect} game={game} videoSrc={D.current.clipUrl} onJudge={judge}
          onNext={nextCard} onPrev={prevCard} onFlip={flipCard} onRestart={startOver} />
      )}
      <div className={'toast' + (toast ? ' show' : '')}>{toast}</div>
    </main>
  );
}
