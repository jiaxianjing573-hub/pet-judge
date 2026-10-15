import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';

function formatTime(value) {
  const sec = Math.max(0, Math.floor(Number(value) || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function isAdClaim(card) {
  return card?.card_type === 'ad_claim';
}

function displayClaim(card) {
  return String(card?.claim || '').replace(/^视频中(?:称)?[，,：:]?/, '');
}

function promotionLabel(card) {
  if (card?.promotion_type === 'hard_ad') return '硬广说法';
  if (card?.promotion_type === 'soft_ad') return '软广说法';
  return '广告说法';
}

function evidenceConclusion(card) {
  const conclusions = {
    supported: '这条广告说法有较充分依据',
    conditional: '这条说法只在特定条件下成立',
    insufficient: '目前证据不足以支持这条说法',
    misleading: '这条广告表述容易造成误导'
  };
  return conclusions[card?.evidence_status]
    || (card?.verdict === 'right' ? '这条广告说法有科学依据' : '这条广告说法站不住');
}

function cardQuestion(card) {
  if (card.question?.trim()) return card.question.trim();
  if (isAdClaim(card)) return '这条广告说法有科学依据吗？';
  const claim = String(card.claim || '');
  if (/喂|吃|食物|零食|饮水|喝/.test(claim)) return '这种喂养方式对宠物安全吗？';
  if (/洗澡|梳毛|剪|驱虫|清洁|护理|抚摸|触碰/.test(claim)) return '这种处理方式合适吗？';
  if (/耳朵|尾巴|舔鼻|眼神|姿态|表现|情绪|放松|紧张/.test(claim)) return '对这些行为表现的理解准确吗？';
  if (/训练|奖励|惩罚|互动|口令/.test(claim)) return '这种互动训练方式合适吗？';
  if (/环境|笼|阳台|车|牵引|项圈/.test(claim)) return '这样的环境和措施安全吗？';
  return '这个做法合适吗？';
}

function choiceLabels(card) {
  const claim = String(card.claim || '');
  if (card.positive_label?.trim() && card.negative_label?.trim()) {
    return { yes: card.positive_label.trim(), no: card.negative_label.trim() };
  }
  if (isAdClaim(card)) return { yes: '有依据', no: '站不住' };
  if (/耳朵|尾巴|舔鼻|眼神|姿态|表现|情绪|放松|紧张/.test(claim)) return { yes: '理解准确', no: '理解有误' };
  if (/喂|吃|食物|零食|饮水|喝/.test(claim)) return { yes: '可以喂', no: '不能喂' };
  return { yes: '合适', no: '不合适' };
}

function ClipLoop({ src, start, end }) {
  const ref = useRef(null);
  const valid = src && Number.isFinite(start) && Number.isFinite(end) && end > start;
  const restart = () => {
    const video = ref.current;
    if (!video || !valid || video.readyState < 1) return;
    const max = Number.isFinite(video.duration) ? video.duration : end;
    video.currentTime = Math.min(Math.max(0, start), Math.max(0, max - 0.05));
    video.play()?.catch?.(() => {});
  };
  useEffect(() => { restart(); }, [src, start, end]);
  if (!valid) return <div className="clip-missing">片段时间点生成中</div>;
  return (
    <div className="card-video">
      <video ref={ref} src={src} muted autoPlay playsInline preload="auto" disablePictureInPicture
        onLoadedMetadata={restart} onEnded={restart}
        onTimeUpdate={e => { if (e.currentTarget.currentTime >= end - 0.08) restart(); }} />
      <span className="segment-tag">{formatTime(start)}–{formatTime(end)}</span>
      <span className="mute-tag"><i />静音循环</span>
    </div>
  );
}

function Progress({ game }) {
  return (
    <div className="quiz-progress">
      <div className="progress-dots">
        {game.cards.map((_, i) => <i key={i} className={(game.answers[i] ? 'done ' : '') + (i === game.idx && !game.complete ? 'active' : '')} />)}
      </div>
      <span>{game.complete ? '完成' : `${game.idx + 1} / ${game.cards.length}`}{game.answers[game.idx] && !game.complete ? ' · 已作答' : ''}</span>
    </div>
  );
}

function ResultCard({ game, onPrev, onRestart }) {
  const correctCount = game.answers.filter(answer => answer?.hit).length;
  const behaviorCards = game.cards.filter(card => !isAdClaim(card));
  const levels = behaviorCards.map(c => ['danger', 'attention', 'safe'].includes(c.risk_level) ? c.risk_level : (c.verdict === 'right' ? 'safe' : 'danger'));
  const danger = levels.filter(v => v === 'danger').length;
  const attention = levels.filter(v => v === 'attention').length;
  const safe = levels.filter(v => v === 'safe').length;
  const adClaims = game.cards.filter(isAdClaim).length;
  return (
    <div className="result-card">
      <span className="result-kicker">本轮判断结果</span>
      <div className="result-score">{correctCount}<small>/ {game.cards.length} 题答对</small></div>
      <h2>{correctCount === game.cards.length ? '全部判断正确' : '本轮判断已完成'}</h2>
      <p>你完成了这条视频中的全部 {game.cards.length} 个判断</p>
      <div className="summary-title">视频内容小结</div>
      <div className="result-summary">
        {danger > 0 && <span className="danger"><b>{danger}</b>个危险做法</span>}
        {attention > 0 && <span className="attention"><b>{attention}</b>个需注意行为</span>}
        {safe > 0 && <span className="safe"><b>{safe}</b>个科学做法</span>}
        {adClaims > 0 && <span className="ad"><b>{adClaims}</b>条广告说法</span>}
      </div>
      <button className="primary-action" onClick={onPrev}>回看刚才的判断</button>
      <button className="text-action" onClick={onRestart}>分析下一条视频</button>
    </div>
  );
}

function NextCardPreview({ card, videoSrc }) {
  if (!card) return null;
  return (
    <div className="next-card-preview" aria-hidden="true">
      <ClipLoop src={videoSrc} start={card.start_time} end={card.end_time} />
      <div className="question-side">
        <span className={'card-kicker' + (isAdClaim(card) ? ' ad' : '')}>下一张 · {isAdClaim(card) ? '广告里的说法' : '视频中的行为'}</span>
        <h2>{displayClaim(card)}</h2>
        <p className="question">{cardQuestion(card)}</p>
      </div>
    </div>
  );
}

export default function Judge({ detect, game, videoSrc, onJudge, onNext, onPrev, onFlip, onRestart }) {
  const [resultDrag, setResultDrag] = useState(null);
  const wheelLock = useRef(false);
  const gestureLock = useRef(false);
  const cardX = useMotionValue(0);
  const cardY = useMotionValue(0);
  const cardFlip = useMotionValue(0);
  const noButtonScale = useTransform(cardX, [-130, 0, 130], [1.08, 1, .96]);
  const yesButtonScale = useTransform(cardX, [-130, 0, 130], [.96, 1, 1.08]);
  const noButtonOpacity = useTransform(cardX, [0, 130], [1, .52]);
  const yesButtonOpacity = useTransform(cardX, [-130, 0], [.52, 1]);
  const noButtonBackground = useTransform(cardX, [-110, 0], ['#9b4035', '#f7e9e5']);
  const noButtonColor = useTransform(cardX, [-110, 0], ['#ffffff', '#9b4035']);
  const noButtonShadow = useTransform(cardX, [-110, 0], ['0 10px 25px rgba(155,64,53,.32)', '0 0 0 rgba(155,64,53,0)']);
  const yesButtonShadow = useTransform(cardX, [0, 110], ['0 0 0 rgba(71,117,65,0)', '0 10px 25px rgba(71,117,65,.34)']);
  const nextCardY = useTransform(cardY, [-720, 0], [0, 14]);
  const nextCardScale = useTransform(cardY, [-720, 0], [1, .96]);
  const nextCardOpacity = useTransform(cardY, [-720, 0], [1, .76]);
  const dragShadow = useTransform(cardX, [-140, 0, 140], [
    '0 22px 55px rgba(155,64,53,.28)',
    '0 18px 50px rgba(42,58,37,.12)',
    '0 22px 55px rgba(71,117,65,.28)'
  ]);

  useEffect(() => {
    cardX.set(0);
    cardY.set(0);
    gestureLock.current = false;
  }, [game?.idx, game?.face, game?.complete]);

  if (!detect && !game) return null;

  if (detect && !game) return (
    <section className="panel detect-panel">
      <div className="detect-orbit"><i /><span>{detect.claims.length || '…'}</span></div>
      <h2>{detect.head}</h2>
      <p>正在把视频里的行为整理成判断卡</p>
      <div className="detect-list">
        {detect.claims.map((c, i) => <span key={i} className="detect-chip">行为点 {i + 1}<i /></span>)}
      </div>
    </section>
  );

  const card = game.cards[game.idx];
  const answer = game.answers[game.idx];
  const front = game.face === 'front';
  const actualRight = card?.verdict === 'right';
  const risk = card?.risk_level || (actualRight ? 'safe' : 'danger');
  const riskText = risk === 'danger' ? '危险' : risk === 'attention' ? '需注意' : '科学做法';
  const adCard = isAdClaim(card);
  const showMarketingAnalysis = adCard && !actualRight && card.marketing_analysis && !/^未发现/.test(card.marketing_analysis);
  const showApplicableConditions = adCard && card.evidence_status === 'conditional' && card.applicable_conditions;
  const question = cardQuestion(card);
  const labels = choiceLabels(card);

  async function resetDrag() {
    await Promise.all([
      animate(cardX, 0, { type: 'spring', stiffness: 520, damping: 34 }),
      animate(cardY, 0, { type: 'spring', stiffness: 520, damping: 34 }),
      animate(cardFlip, 0, { type: 'spring', stiffness: 520, damping: 34 })
    ]);
  }

  function followCardPan(_, info) {
    const dx = info.offset.x;
    const dy = info.offset.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      cardX.set(dx);
      cardY.set(0);
      cardFlip.set(Math.max(-16, Math.min(16, dx * .13)));
    } else if (answer) {
      cardX.set(0);
      cardFlip.set(0);
      cardY.set(dy * .55);
    }
  }

  async function flipCard(action, direction = 1) {
    if (gestureLock.current) return;
    gestureLock.current = true;
    await Promise.all([
      animate(cardX, 0, { duration: .12 }),
      animate(cardY, 0, { duration: .12 }),
      animate(cardFlip, direction * 88, { duration: .18, ease: 'easeIn' })
    ]);
    flushSync(action);
    cardFlip.set(direction * -88);
    await animate(cardFlip, 0, { duration: .24, ease: 'easeOut' });
    gestureLock.current = false;
  }

  function answerWithFlip(userSaysRight) {
    flipCard(() => onJudge(userSaysRight), userSaysRight ? 1 : -1);
  }

  function toggleFaceWithFlip(direction = 1) {
    flipCard(onFlip, direction);
  }

  async function moveToCard(direction) {
    if (gestureLock.current || !answer) return;
    gestureLock.current = true;
    const goingNext = direction < 0;
    await animate(cardY, goingNext ? -720 : 720, { duration: .28, ease: [0.32, 0.72, 0, 1] });
    cardY.set(0); cardX.set(0); cardFlip.set(0);
    flushSync(goingNext ? onNext : onPrev);
    gestureLock.current = false;
  }

  async function finishCardDrag(_, info) {
    if (gestureLock.current) return;
    const projectedX = info.offset.x + info.velocity.x * .12;
    const projectedY = info.offset.y + info.velocity.y * .12;
    const horizontal = Math.abs(projectedX) > Math.abs(projectedY);

    if (horizontal && Math.abs(projectedX) >= 68) {
      gestureLock.current = true;
      if (!answer) {
        const userSaysRight = projectedX > 0;
        gestureLock.current = false;
        await flipCard(() => onJudge(userSaysRight), userSaysRight ? 1 : -1);
      } else {
        gestureLock.current = false;
        await flipCard(onFlip, projectedX > 0 ? 1 : -1);
      }
      return;
    }

    if (!horizontal && Math.abs(projectedY) >= 76 && answer) {
      await moveToCard(projectedY < 0 ? -1 : 1);
      return;
    }
    resetDrag();
  }

  function navigateVertical(direction) {
    if (game.complete) {
      if (direction < 0) onPrev();
      return;
    }
    if (direction > 0) moveToCard(-1);
    else moveToCard(1);
  }

  function handleWheel(e) {
    if (Math.abs(e.deltaY) < 28 || wheelLock.current) return;
    wheelLock.current = true;
    navigateVertical(e.deltaY > 0 ? 1 : -1);
    window.setTimeout(() => { wheelLock.current = false; }, 520);
  }

  return (
    <section className="quiz-screen" tabIndex="0" onWheel={handleWheel}
      onKeyDown={e => {
        if (e.key === 'ArrowDown') navigateVertical(1);
        if (e.key === 'ArrowUp') navigateVertical(-1);
        if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && game.answers[game.idx]) toggleFaceWithFlip(e.key === 'ArrowRight' ? 1 : -1);
      }}
      onPointerDown={e => { if (game.complete) setResultDrag({ x: e.clientX, y: e.clientY }); }}
      onPointerUp={e => {
        if (!game.complete || !resultDrag) return;
        const dy = e.clientY - resultDrag.y;
        setResultDrag(null);
        if (dy > 48) onPrev();
      }}>
      <Progress game={game} />
      <div className="deck-area">
        {!game.complete && game.idx < game.cards.length - 2 && <div className="deck-card layer-two" />}
        {!game.complete && game.idx < game.cards.length - 1 && (
          <motion.div className="deck-card layer-one" style={{ y: nextCardY, scale: nextCardScale, opacity: nextCardOpacity }}>
            <NextCardPreview card={game.cards[game.idx + 1]} videoSrc={videoSrc} />
          </motion.div>
        )}
        {game.complete ? <ResultCard game={game} onPrev={onPrev} onRestart={onRestart} /> : (
          <motion.article key={`card-${game.idx}`} className={'deck-card active-card ' + (front ? 'front-face' : 'back-face')}
            style={{ y: cardY, rotateY: cardFlip, transformPerspective: 1200, boxShadow: dragShadow }}
            whileTap={{ scale: 1.006, cursor: 'grabbing' }}
            onPan={followCardPan} onPanEnd={finishCardDrag}>
            {front ? (
              <>
                {answer && <span className={'answered-badge ' + risk}>{adCard ? promotionLabel(card) : riskText} · 已选{answer.choice ? labels.yes : labels.no}</span>}
                <ClipLoop key={`${game.idx}-${card.start_time}-${card.end_time}`} src={videoSrc} start={card.start_time} end={card.end_time} />
                <div className="question-side">
                  <span className={'card-kicker' + (adCard ? ' ad' : '')}>{adCard ? `${promotionLabel(card)} · 广告里的说法` : '视频中的行为'}</span>
                  <h2>{displayClaim(card)}</h2>
                  {!answer ? (
                    <>
                      <p className="question">{question}</p>
                      <div className="answer-actions">
                        <motion.button className="no"
                          style={{ scale: noButtonScale, opacity: noButtonOpacity, backgroundColor: noButtonBackground, color: noButtonColor, boxShadow: noButtonShadow }}
                          onClick={e => { e.stopPropagation(); answerWithFlip(false); }}><i />{labels.no}</motion.button>
                        <motion.button className="yes"
                          style={{ scale: yesButtonScale, opacity: yesButtonOpacity, boxShadow: yesButtonShadow }}
                          onClick={e => { e.stopPropagation(); answerWithFlip(true); }}>{labels.yes}<i /></motion.button>
                      </div>
                    </>
                  ) : <div className="post-answer-actions"><button onClick={e => { e.stopPropagation(); toggleFaceWithFlip(); }}>查看答案</button><button onClick={e => { e.stopPropagation(); moveToCard(-1); }}>下一张</button></div>}
                </div>
              </>
            ) : (
              <div className="answer-side">
                <div className={'answer-result ' + (answer.hit ? 'hit' : 'miss')}>
                  <svg className="answer-bone" viewBox="0 0 520 82" preserveAspectRatio="none" aria-hidden="true">
                    <path d="M34 4C23 4 15 12 15 23c0 5 2 9 5 13C10 39 4 47 4 57c0 12 10 21 22 21 9 0 17-5 21-12h426c4 7 12 12 21 12 12 0 22-9 22-21 0-10-6-18-16-21 3-4 5-8 5-13 0-11-8-19-19-19-10 0-18 6-21 14H55C52 10 44 4 34 4Z" />
                  </svg>
                  <b>{answer.hit ? '判断正确' : '判断错误'}</b>
                </div>
                <div className={'core-answer ' + risk + (adCard ? ' ad' : '')}>
                  <b>{adCard ? evidenceConclusion(card) : (actualRight ? '视频里的做法是科学的' : (risk === 'attention' ? '视频里的做法需要调整' : '视频里的做法不科学'))}</b>
                </div>
                <section className="reason-action">
                  <label>为什么这么判断</label>
                  <p>{card.explanation}</p>
                  {showMarketingAnalysis && <p className="marketing-copy">{card.marketing_analysis}</p>}
                  {!adCard && !actualRight && <div className="action-note"><span>你可以这样做</span><p>{card.correct_action || '停止或调整这种做法，出现异常时及时咨询兽医。'}</p></div>}
                  {showApplicableConditions && <div className="action-note conditional"><span>成立条件</span><p>{card.applicable_conditions}</p></div>}
                </section>
                <div className={'source-box' + (adCard ? ' ad' : '')}><span>AI 参考说明</span><b>{card.source || '基于通用宠物健康知识生成，尚未联网核验'}</b></div>
                <div className="answer-nav"><button onClick={e => { e.stopPropagation(); toggleFaceWithFlip(-1); }}>翻回看视频</button><button onClick={e => { e.stopPropagation(); moveToCard(-1); }}>下一张</button></div>
              </div>
            )}
          </motion.article>
        )}
      </div>
      <p className="gesture-hint">{game.complete ? '下滑回看 · 点击可分析下一条' : answer ? '左右翻面 · 上滑下一张 · 下滑回看' : `左滑${labels.no} · 右滑${labels.yes}`}</p>
    </section>
  );
}
