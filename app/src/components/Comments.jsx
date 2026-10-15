function likeText(n) {
  const v = +n || 0;
  return v >= 1000 ? (v / 1000).toFixed(1) + 'k 赞' : v + ' 赞';
}

export default function Comments({ data }) {
  if (!data) return null;
  return (
    <div className="panel">
      <div className="sec-title">大家在关注什么<span className="mock-badge">AI 模拟</span></div>
      {data.loading && <div className="hint" style={{ textAlign: 'left' }}>正在根据视频内容模拟评论区…</div>}
      {(data.list || []).map((c, i) => (
        <div className="cmt-item" key={i}>
          <div className={'ava c' + (i % 3)}>{(c.user || '宠').slice(0, 1)}</div>
          <div>
            <div className="who">@{c.user || '网友'}</div>
            <div className="txt">{c.text}</div>
          </div>
          <div className="like">{likeText(c.likes)}</div>
        </div>
      ))}
    </div>
  );
}
