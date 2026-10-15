const STEP_META = [
  ['prepare', '准备视频'],
  ['listen', '听视频里说了什么'],
  ['see', '看视频里发生了什么'],
  ['tidy', '整理成可读结果']
];

export default function Pipeline({ pipe, live, onCancel, onRetry }) {
  if (!pipe) return null;

  if (pipe.status === 'cancelled') {
    return (
      <div className="panel pipeline-panel">
        <button className="primary-action" onClick={onRetry}>重新解析</button>
      </div>
    );
  }

  const running = pipe.status === 'running';
  const headText = pipe.status === 'done' ? '视频已理解'
    : pipe.status === 'error' ? '解析遇到问题' : '正在理解这段视频';
  const timeText = pipe.status === 'done' ? `共用时 ${pipe.elapsed} 秒`
    : `${pipe.elapsed} 秒`;

  return (
    <section className="panel pipeline-panel">
      <div className="analysis-visual" aria-hidden="true"><span className="pet-silhouette" /><i className="scan-line" /></div>
      <div className="pipe-head">
        <b>{headText}</b>
        <span className="pipe-right">
          <span className="pipe-time">{timeText}</span>
          {running && <button className="pipe-cancel" onClick={onCancel}>取消</button>}
        </span>
      </div>
      {running && <div className="eta">正在从声音、动作和画面文字中寻找养宠行为点</div>}
      {running && <div className="progress"><i style={{ width: pipe.pct + '%' }} /></div>}
      {STEP_META.map(([key, name]) => {
        const st = pipe.steps[key];
        return (
          <div className={'step ' + st.state} key={key}>
            <span className="dot">{st.state === 'done' || st.state === 'error' ? '' : STEP_META.findIndex(m => m[0] === key) + 1}</span>
            <div><b>{name}</b><small>{st.text}</small></div>
          </div>
        );
      })}

      {live.chips.length > 0 && (
        <div className="detail-block">
          <div className="caption">刚刚发现</div>
          <div className="tagrow">{live.chips.map(c => <span className="chip" key={c}>{c}<i /></span>)}</div>
        </div>
      )}

      {pipe.status === 'error' && (
        <div className="mt12">
          <details className="error-details"><summary>查看技术详情</summary><span>{pipe.errTech}</span></details>
          <button className="primary-action" onClick={onRetry}>重新解析</button>
        </div>
      )}
    </section>
  );
}
