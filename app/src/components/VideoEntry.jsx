import { useState } from 'react';

export default function VideoEntry({ entry, onLoadUrl, onFile, onServerDownload }) {
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState('file');

  const urlPane = (
    <div>
      <input
        className="url-input"
        placeholder="粘贴 B站 / 抖音链接，整段分享文字也行"
        value={url}
        onChange={e => setUrl(e.target.value)}
      />
      <button className="primary-action" disabled={entry.resolving} onClick={() => onLoadUrl(url)}>
        {entry.resolving ? '正在解析' : '解析并播放'}
      </button>
      {entry.error && (
        <div className="err-box">
          <b>解析失败：{entry.error.message}</b>
          <div>{entry.error.hint}</div>
          {entry.error.attempts?.length > 0 && (
            <details><summary>查看详细原因</summary><ol>{entry.error.attempts.map((a, i) => <li key={i}>{a}</li>)}</ol></details>
          )}
        </div>
      )}
    </div>
  );

  const filePane = (
    <div>
      <label className="file-label">
        <span className="upload-icon"><i /></span>
        <b>{entry.fileName || '上传宠物视频'}</b>
        <small>推荐竖屏 · 15–60 秒 · 100MB 以内</small>
        <input type="file" accept="video/*,audio/*" onChange={e => { const f = e.target.files[0]; if (f) onFile(f); e.target.value = ''; }} />
      </label>
    </div>
  );

  return (
    <section className="entry-screen">
      <div className="welcome-copy">
        <span className="eyebrow">VIDEO PET CARE QUIZ</span>
        <h2>看一段宠物视频，<br />发现藏在画面里的养宠知识。</h2>
        <p>上传后自动理解视频，并生成可以边看边判断的知识卡。</p>
      </div>
      <div className="panel entry-panel">
        <div className="source-tabs" role="tablist">
          <button className={mode === 'file' ? 'active' : ''} onClick={() => setMode('file')}>本地视频</button>
          <button className={mode === 'url' ? 'active' : ''} onClick={() => setMode('url')}>视频链接</button>
        </div>
        {mode === 'file' ? filePane : urlPane}
        {entry.player && (
          <div className="player-box mt12">
            {entry.player.kind === 'video'
              ? <video src={entry.player.src} controls playsInline preload="metadata" />
              : <iframe src={entry.player.src} allowFullScreen scrolling="no" title="player" />}
          </div>
        )}
        {entry.title && <div className="video-title">{entry.title}</div>}
        {entry.guide && (
          <div className="download-card">
            <b>视频已就绪</b>
            <button className="primary-action" onClick={onServerDownload}>获取视频并开始分析</button>
            <p className="hint">获取不到时，把视频保存到手机或电脑后从「本地视频」上传</p>
          </div>
        )}
      </div>
      <p className="privacy-note">视频仅用于本次内容分析</p>
    </section>
  );
}
