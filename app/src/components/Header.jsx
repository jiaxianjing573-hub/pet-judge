export default function Header({ score, combo, compact }) {
  return (
    <header className={'header' + (compact ? ' compact' : '')}>
      <div className="logo">
        <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
        <div><h1>宠物小判官</h1><small>看懂行为，科学相伴</small></div>
      </div>
      <div className="hud">
        <span className="score-pill">{score}<small>知识分</small></span>
        {combo > 1 && <span className="streak">连对 {combo}</span>}
      </div>
    </header>
  );
}
