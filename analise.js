'use strict';
// =====================================================================================
// Análise financeira (Fase 1)
//
// - Só LÊ os dados (db): nunca grava nem altera movimentos, contas, saldos ou cópias de segurança.
// - Todos os cálculos são feitos em cêntimos inteiros.
// - As datas são texto AAAA-MM-DD; a aritmética de calendário usa UTC e números de dias
//   (sem horas), por isso não há erros de hora de verão ou de fuso horário.
// - O estado (período, filtros, seleção) vive só em memória (AN) e não entra nas cópias de segurança.
// - Depende de app.js apenas em tempo de execução (db, today, eur, esc, CATS, KINDS, entryRow, ...).
// =====================================================================================

const AN = { mode: 'month', anchor: null, accs: null, cats: null, sel: null, selCat: null, win: 7, limit: 100, model: null };
const AN_SPEND = new Set(['ordem', 'carteira']), AN_SAVE = new Set(['poupanca', 'investimento']);

// ---------- datas (texto AAAA-MM-DD, calendário em UTC) ----------
const anPad = n => String(n).padStart(2, '0');
const anCents = x => Math.round(x * 100);
const anNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5;
const anStr = n => { const d = new Date(Math.round(n * 864e5)); return `${d.getUTCFullYear()}-${anPad(d.getUTCMonth() + 1)}-${anPad(d.getUTCDate())}`; };
const anAddDays = (s, n) => anStr(anNum(s) + n);
function anAddMonths(s, n) {
  const m = +s.slice(5, 7) - 1 + n, y = +s.slice(0, 4) + Math.floor(m / 12), mm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mm + 1, 0)).getUTCDate();
  return `${y}-${anPad(mm + 1)}-${anPad(Math.min(+s.slice(8, 10), last))}`;
}
const anWeekStart = s => { const n = anNum(s); return anStr(n - ((((n + 3) % 7) + 7) % 7)); }; // semana de segunda a domingo
function anRange(mode, a) {
  if (mode === 'day') return { start: a, end: a };
  if (mode === 'week') { const s = anWeekStart(a); return { start: s, end: anAddDays(s, 6) }; }
  if (mode === 'month') { const s = a.slice(0, 7) + '-01'; return { start: s, end: anAddDays(anAddMonths(s, 1), -1) }; }
  return { start: a.slice(0, 4) + '-01-01', end: a.slice(0, 4) + '-12-31' };
}
function anShift(mode, a, dir) {
  if (mode === 'day') return anAddDays(a, dir);
  if (mode === 'week') return anAddDays(anWeekStart(a), 7 * dir);
  if (mode === 'month') return anAddMonths(a.slice(0, 7) + '-01', dir);
  return `${+a.slice(0, 4) + dir}-01-01`;
}
// período anterior com a mesma duração; num período a meio compara-se o mesmo número de dias
function anPrevRange(mode, r, T) {
  let ps, pe;
  if (mode === 'day') ps = pe = anAddDays(r.start, -1);
  else if (mode === 'week') { ps = anAddDays(r.start, -7); pe = anAddDays(r.end, -7); }
  else if (mode === 'month') { ps = anAddMonths(r.start, -1); pe = anAddDays(r.start, -1); }
  else { const y = +r.start.slice(0, 4) - 1; ps = `${y}-01-01`; pe = `${y}-12-31`; }
  if (r.start <= T && T < r.end) { const cut = anAddDays(ps, anNum(T) - anNum(r.start)); if (cut < pe) pe = cut; }
  return { start: ps, end: pe };
}

// ---------- cálculo (puro: recebe os dados e devolve números; não toca na app) ----------
function anCompute(o) {
  const db = o.db, T = o.today, mode = o.mode;
  const accById = new Map(db.accounts.map(a => [a.id, a]));
  let ids = (o.accs ? [...o.accs] : []).filter(id => accById.has(id));
  if (!ids.length) ids = db.accounts.map(a => a.id);
  const S = new Set(ids), catSet = o.cats && o.cats.size ? o.cats : null;
  const range = anRange(mode, o.anchor), prevR = anPrevRange(mode, range, T);

  // Saldos: uma passagem pelos movimentos até hoje. Os futuros nunca entram.
  let opening = 0; for (const a of db.accounts) if (S.has(a.id)) opening += anCents(a.opening);
  const first = new Map(), dayDelta = new Map();
  const touch = (id, d) => { if (id && (!first.has(id) || d < first.get(id))) first.set(id, d); };
  for (const e of db.entries) {
    if (e.date > T) continue;
    const amt = anCents(e.amount); let d = 0;
    touch(e.accountId, e.date);
    if (e.kind === 'transfer') { touch(e.destId, e.date); if (S.has(e.accountId)) d -= amt; if (S.has(e.destId)) d += amt; }
    else if (S.has(e.accountId)) d = e.kind === 'income' ? amt : -amt;
    if (d) dayDelta.set(e.date, (dayDelta.get(e.date) || 0) + d);
  }
  const dates = [...dayDelta.keys()].sort(), cum = []; let run = 0;
  for (const d of dates) { run += dayDelta.get(d); cum.push(run); }
  const balanceAt = d => { let lo = 0, hi = dates.length - 1, i = -1; while (lo <= hi) { const m = (lo + hi) >> 1; if (dates[m] <= d) { i = m; lo = m + 1; } else hi = m - 1; } return opening + (i >= 0 ? cum[i] : 0); };
  // Estimado: antes do primeiro movimento registado de alguma conta só se conhece o saldo inicial. O dia de hoje é o saldo real.
  let maxFirst = ''; for (const id of S) { const f = first.get(id) || '9999-12-31'; if (f > maxFirst) maxFirst = f; }
  const isEst = d => d < T && d < maxFirst;

  const started = range.start <= T, endEff = range.end < T ? range.end : T, dayBefore = anAddDays(range.start, -1);
  const init = balanceAt(dayBefore), final = started ? balanceAt(endEff) : init;
  const elapsed = started ? anNum(endEff) - anNum(range.start) + 1 : 0;

  // Somas por período: receitas, despesas, transferências externas à seleção e por categoria.
  const SAVE_FROM = AN_SPEND, SAVE_TO = AN_SAVE;
  const aggregate = (r, nb, bucketOf) => {
    const A = { inc: 0, expAll: 0, exp: 0, trIn: 0, trOut: 0, save: 0, n: 0, nInt: 0, byCat: {}, buckets: nb ? Array.from({ length: nb }, () => ({ inc: 0, exp: 0 })) : [] };
    for (const e of db.entries) {
      if (e.date > T || e.date < r.start || e.date > r.end) continue;
      const amt = anCents(e.amount);
      if (e.kind === 'transfer') {
        const f = S.has(e.accountId), t = S.has(e.destId);
        if (f && !t) A.trOut += amt; else if (t && !f) A.trIn += amt; else if (f && t) A.nInt++;
        if (f || t) { const fa = accById.get(e.accountId), ta = accById.get(e.destId); if (fa && ta && SAVE_FROM.has(fa.kind) && SAVE_TO.has(ta.kind)) A.save += amt; }
        continue;
      }
      if (!S.has(e.accountId)) continue;
      A.n++;
      const b = nb ? A.buckets[bucketOf(e.date)] : null;
      if (e.kind === 'income') { A.inc += amt; if (b) b.inc += amt; }
      else {
        A.expAll += amt; A.byCat[e.category] = (A.byCat[e.category] || 0) + amt;
        if (!catSet || catSet.has(e.category)) { A.exp += amt; if (b) b.exp += amt; }
      }
    }
    return A;
  };
  let nb = 0, bucketOf = null, buckets = [];
  if (mode === 'year') { nb = 12; bucketOf = d => +d.slice(5, 7) - 1; }
  else if (mode !== 'day') { nb = anNum(range.end) - anNum(range.start) + 1; bucketOf = d => anNum(d) - anNum(range.start); }
  const cur = aggregate(range, nb, bucketOf), prev = aggregate(prevR, 0, null);
  for (let i = 0; i < nb; i++) {
    const b = cur.buckets[i];
    if (mode === 'year') { const s = `${range.start.slice(0, 4)}-${anPad(i + 1)}-01`; buckets.push({ ...b, start: s, end: anAddDays(anAddMonths(s, 1), -1) }); }
    else { const s = anAddDays(range.start, i); buckets.push({ ...b, start: s, end: s }); }
  }

  // Janela do gráfico de saldo: o período; na vista diária, os últimos 7 (ou 30) dias.
  let winStart = range.start, winEnd = range.end;
  if (mode === 'day') winStart = anAddDays(range.end, -(o.win === 30 ? 29 : 6));
  const series = [], last = winEnd < T ? winEnd : T;
  for (let n = anNum(winStart), e = anNum(last); n <= e; n++) { const d = anStr(n); series.push({ d, bal: balanceAt(d), est: isEst(d) }); }
  const estNames = []; for (const id of S) { const f = first.get(id); if (winStart < T && (!f || f > winStart)) estNames.push(accById.get(id).name); }

  return {
    range, prev: prevR, accounts: ids, elapsed, init, final, estInit: isEst(dayBefore), estFinal: started ? isEst(endEff) : isEst(dayBefore),
    inc: cur.inc, expAll: cur.expAll, exp: cur.exp, trIn: cur.trIn, trOut: cur.trOut, save: cur.save, n: cur.n, nInt: cur.nInt, byCat: cur.byCat, buckets,
    series, winStart, winEnd, estNames,
    prevAgg: { inc: prev.inc, exp: prev.exp, expAll: prev.expAll, n: prev.n, byCat: prev.byCat },
    recon: final - (init + cur.inc - cur.expAll + cur.trIn - cur.trOut), // tem de ser sempre 0
  };
}

// ---------- apresentação ----------
const anEur = c => eur(c / 100);
const anDate = (s, o) => new Date(anNum(s) * 864e5).toLocaleDateString('pt-PT', { timeZone: 'UTC', ...o });
const anSet = (set, valid) => { if (!set) return null; const s = new Set([...set].filter(x => valid.includes(x))); return s.size && s.size < valid.length ? s : null; };
function anLabel(mode, r) {
  if (mode === 'day') return anDate(r.start, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  if (mode === 'week') return `${anDate(r.start, { day: 'numeric', month: 'short' })} a ${anDate(r.end, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  if (mode === 'month') return anDate(r.start, { month: 'long', year: 'numeric' });
  return r.start.slice(0, 4);
}
const anPrevName = (mode, r, T) => ({ day: 'dia anterior', week: 'semana anterior', month: 'mês anterior', year: 'ano anterior' }[mode]) + (r.start <= T && T < r.end && mode !== 'day' ? ' (mesmo período)' : '');
const anResetSel = () => { AN.sel = null; AN.selCat = null; AN.limit = 100; };

function anControls(range) {
  const T = today(), isCur = range.start <= T && T <= range.end;
  const accTxt = !AN.accs ? 'Todas as contas' : AN.accs.size === 1 ? esc(db.accounts.find(a => a.id === [...AN.accs][0])?.name || 'Conta') : `${AN.accs.size} contas`;
  const catTxt = !AN.cats ? 'Todas as categorias' : AN.cats.size === 1 ? `${CATS[[...AN.cats][0]][1]} ${CATS[[...AN.cats][0]][0]}` : `${AN.cats.size} categorias`;
  return `<div class="seg an-modes" role="group" aria-label="Período">${[['day', 'Dia'], ['week', 'Semana'], ['month', 'Mês'], ['year', 'Ano']].map(([k, l]) => `<button data-an="mode:${k}" class="${AN.mode === k ? 'on' : ''}" aria-pressed="${AN.mode === k}">${l}</button>`).join('')}</div>
  <div class="an-nav"><button data-an="prev" aria-label="Período anterior">‹</button><div class="lbl" aria-live="polite">${anLabel(AN.mode, range)}</div><button data-an="next" aria-label="Período seguinte" ${range.end >= T ? 'disabled' : ''}>›</button></div>
  ${isCur ? '' : '<button class="linkbtn an-today" data-an="today">Voltar a hoje</button>'}
  <div class="an-chips"><button class="an-chip ${AN.accs ? 'on' : ''}" data-an="accs">🏦 ${accTxt}</button><button class="an-chip ${AN.cats ? 'on' : ''}" data-an="cats">🏷️ ${catTxt}</button>${AN.accs || AN.cats ? '<button class="an-chip" data-an="clear">✕ Limpar filtros</button>' : ''}</div>`;
}

let anSemTxt = 'sem movimentos no período anterior'; // diz que intervalo se comparou (definido em anCards)
function anDelta(cur, prv, goodUp, has, name) {
  if (!has) return `<small class="sub">${anSemTxt}</small>`;
  const d = cur - prv; if (d === 0) return `<small class="sub">= igual ao ${name}</small>`;
  return `<small class="${(d > 0) === goodUp ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${anEur(Math.abs(d))} vs. ${name}</small>`;
}
function anCards(m, catOn) {
  const T = today(), pn = anPrevName(AN.mode, m.range, T), has = m.prevAgg.n > 0, est = f => (f ? '<small class="warnt">estimado</small>' : '');
  const dm = { day: 'numeric', month: 'short' }, ra = anDate(m.prev.start, dm), rb = anDate(m.prev.end, dm);
  anSemTxt = m.prev.start === m.prev.end ? `sem movimentos em ${ra}` : `sem movimentos de ${ra} a ${rb}`;
  const res = m.inc - m.expAll, pres = m.prevAgg.inc - m.prevAgg.expAll, rate = m.inc > 0 ? (res / m.inc) * 100 : null;
  const avg = m.elapsed ? Math.round(m.exp / m.elapsed) : 0;
  const pDays = anNum(m.prev.end) - anNum(m.prev.start) + 1, pAvg = pDays > 0 ? Math.round((catOn ? anSelExp(m.prevAgg.byCat) : m.prevAgg.expAll) / pDays) : 0;
  const varSaldo = m.final - m.init;
  const c = (t, v, sub, cls = '') => `<div class="card an-card"><span>${t}</span><b class="${cls}">${v}</b>${sub}</div>`;
  const out = [c('Saldo inicial', anEur(m.init), est(m.estInit)), c('Saldo final', anEur(m.final), `${est(m.estFinal)}<small class="${varSaldo >= 0 ? 'pos' : 'neg'}">${varSaldo >= 0 ? '▲' : '▼'} ${anEur(Math.abs(varSaldo))} no período</small>`)];
  if (!catOn) {
    out.push(c('Receitas', anEur(m.inc), anDelta(m.inc, m.prevAgg.inc, true, has, pn), 'pos'), c('Despesas', anEur(m.expAll), anDelta(m.expAll, m.prevAgg.expAll, false, has, pn)));
    out.push(c('Resultado líquido', anEur(res), anDelta(res, pres, true, has, pn), res < 0 ? 'neg' : 'pos'), c('Taxa de poupança', rate === null ? '-' : pct(rate), rate === null ? '<small class="sub">sem receitas no período</small>' : ''));
    out.push(c('Média diária de despesas', anEur(avg), anDelta(avg, pAvg, false, has && pDays > 0, pn)), c('Para poupança/investimento', anEur(m.save), '<small class="sub">transferido no período</small>'));
  } else {
    out.push(c('Despesas (categorias escolhidas)', anEur(m.exp), anDelta(m.exp, anSelExp(m.prevAgg.byCat), false, has, pn)), c('Média diária', anEur(avg), anDelta(avg, pAvg, false, has && pDays > 0, pn)));
    out.push(c('Peso nas despesas totais', m.expAll ? pct((m.exp / m.expAll) * 100) : '-', '<small class="sub">do total gasto no período</small>'));
  }
  return `<div class="an-grid">${out.join('')}</div>`;
}
const anSelExp = byCat => (AN.cats ? [...AN.cats].reduce((s, k) => s + (byCat[k] || 0), 0) : Object.values(byCat).reduce((s, v) => s + v, 0));

function anBridge(m, catOn) {
  const row = (t, v, cls = '') => `<div><span>${t}</span><b class="${cls}">${v}</b></div>`;
  return `<details class="card an-bridge"><summary>Como o saldo mudou</summary><div class="an-rows">${row('Saldo inicial', anEur(m.init))}${row('+ Receitas', anEur(m.inc), 'pos')}${row('− Despesas', anEur(m.expAll))}${row('+ Transferências recebidas', anEur(m.trIn))}${row('− Transferências enviadas', anEur(m.trOut))}<div class="tot"><span>= Saldo final</span><b>${anEur(m.final)}</b></div></div>
  <p class="sub">${m.nInt ? `${m.nInt} transferência(s) entre as contas escolhidas não contam (o dinheiro só mudou de conta). ` : ''}Transferências de ou para contas fora da seleção mudam o saldo, mas não são receita nem despesa.${catOn ? ' O filtro de categorias não altera o saldo.' : ''}</p>${m.recon !== 0 ? '<p class="neg">Aviso: este resumo não bate certo. Diz-me, para eu corrigir.</p>' : ''}</details>`;
}

// ---------- gráficos (SVG próprio, sem bibliotecas) ----------
const AN_W = 340;
function anBalanceChart(m) {
  const s = m.series; if (!s.length) return '<p class="sub">Sem dados neste período (ainda não começou).</p>';
  const W = AN_W, H = 170, px = 8, top = 14, bot = 22, nDays = Math.max(anNum(m.winEnd) - anNum(m.winStart), 1);
  const vals = s.map(p => p.bal / 100); let min = Math.min(...vals), max = Math.max(...vals); if (min === max) { min -= 1; max += 1; }
  const x = d => px + ((anNum(d) - anNum(m.winStart)) / nDays) * (W - 2 * px), y = v => top + (1 - (v - min) / (max - min)) * (H - top - bot), base = H - bot;
  m.geo = { W, px, nDays, x, y, top, base };
  const seg = { up: '', down: '', flat: '', upe: '', downe: '', flate: '' }; let estEnd = null;
  for (let i = 0; i < s.length; i++) { if (s[i].est) estEnd = s[i].d; if (!i) continue; const a = s[i - 1], b = s[i], t = b.bal > a.bal ? 'up' : b.bal < a.bal ? 'down' : 'flat'; seg[t + (b.est ? 'e' : '')] += `M${x(a.d).toFixed(1)},${y(a.bal / 100).toFixed(1)}L${x(b.d).toFixed(1)},${y(b.bal / 100).toFixed(1)}`; }
  const line = s.map((p, i) => `${i ? 'L' : 'M'}${x(p.d).toFixed(1)},${y(p.bal / 100).toFixed(1)}`).join(''), area = `${line}L${x(s[s.length - 1].d).toFixed(1)},${base}L${x(s[0].d).toFixed(1)},${base}Z`;
  const col = { up: 'var(--green)', down: 'var(--red)', flat: 'var(--sub)' }, ci = anCursorIdx(m), cs = s[ci];
  const path = (k, dash) => (seg[k] ? `<path d="${seg[k]}" fill="none" style="stroke:${col[k.replace('e', '')]}" stroke-width="2.6" stroke-linecap="round" ${dash ? 'stroke-dasharray="2 5" opacity=".85"' : ''}/>` : '');
  const estRect = estEnd ? `<rect x="${px}" y="${top - 6}" width="${Math.max(x(estEnd) - px, 0).toFixed(1)}" height="${base - top + 6}" fill="url(#anh)"/>` : '';
  const zero = min < 0 && max > 0 ? `<line x1="${px}" x2="${W - px}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" style="stroke:var(--sub)" stroke-dasharray="3 3" stroke-width="1"/><text x="${W - px}" y="${(y(0) - 3).toFixed(1)}" text-anchor="end" class="ax">0</text>` : '';
  return `<div class="an-tip" id="an-tip" aria-live="polite">${anTipBal(m, ci)}</div>
  <div class="an-chart" id="an-bal" data-chart="bal" tabindex="0" role="group" aria-label="Evolução do saldo. Toca num ponto ou usa as setas do teclado para mudar de dia.">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Saldo de ${anEur(s[0].bal)} a ${anEur(s[s.length - 1].bal)}"><defs><pattern id="anh" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" style="stroke:var(--line)" stroke-width="3"/></pattern></defs>
  ${estRect}<path d="${area}" style="fill:var(--forest)" opacity=".1"/>${zero}${path('flat')}${path('up')}${path('down')}${path('flate', 1)}${path('upe', 1)}${path('downe', 1)}
  <line id="an-cur" x1="${x(cs.d).toFixed(1)}" x2="${x(cs.d).toFixed(1)}" y1="${top - 6}" y2="${base}" style="stroke:var(--text)" stroke-width="1" opacity=".5"/><circle id="an-dot" cx="${x(cs.d).toFixed(1)}" cy="${y(cs.bal / 100).toFixed(1)}" r="5" style="fill:var(--text);stroke:var(--card)" stroke-width="2"/>
  <text x="${px}" y="${H - 6}" class="ax">${anDate(m.winStart, { day: 'numeric', month: 'short' })}</text><text x="${W - px}" y="${H - 6}" text-anchor="end" class="ax">${anDate(m.winEnd, { day: 'numeric', month: 'short' })}</text>
  <text x="${px}" y="${top + 2}" class="ax">${anEur(Math.round(max * 100))}</text><text x="${px}" y="${base - 4}" class="ax">${anEur(Math.round(min * 100))}</text></svg></div>
  <div class="an-step"><button data-an="bstep:-1" aria-label="Dia anterior">‹</button><span>Toca no gráfico ou muda de dia</span><button data-an="bstep:1" aria-label="Dia seguinte">›</button></div>
  <div class="an-leg"><span><i style="background:var(--green)"></i>subiu</span><span><i style="background:var(--red)"></i>desceu</span><span><i class="dash"></i>estimado</span></div>`;
}
function anCursorIdx(m) {
  const s = m.series; if (!s.length) return -1;
  if (AN.mode === 'day') { const i = s.findIndex(p => p.d === m.range.end); return i >= 0 ? i : s.length - 1; }
  if (AN.sel) { let i = 0; for (let k = 0; k < s.length; k++) if (s[k].d <= AN.sel.end) i = k; return i; }
  return s.length - 1;
}
function anTipBal(m, i) {
  const p = m.series[i]; if (!p) return '';
  const d = i > 0 ? p.bal - m.series[i - 1].bal : null;
  return `<b>${anDate(p.d, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</b> · ${anEur(p.bal)}${p.est ? ' <span class="warnt">(estimado)</span>' : ''}${d === null ? '' : d === 0 ? ' · sem alteração' : ` · <span class="${d > 0 ? 'pos' : 'neg'}">${d > 0 ? '▲' : '▼'} ${anEur(Math.abs(d))}</span>`}`;
}
function anBarSel(m) { if (!AN.sel) return -1; return m.buckets.findIndex(b => b.start <= AN.sel.start && AN.sel.end <= b.end); }
function anBarsChart(m, catOn) {
  const b = m.buckets, nb = b.length, W = AN_W, H = 150, px = 8, top = 8, bot = 22, slot = (W - 2 * px) / nb;
  const max = Math.max(...b.flatMap(k => (catOn ? [k.exp] : [k.inc, k.exp])), 1), h = v => (v <= 0 ? 0 : Math.max((v / max) * (H - top - bot), 1.5));
  const bw = catOn ? Math.min(18, slot - 2) : Math.max(2, Math.min(14, slot / 2 - 1)), sel = anBarSel(m);
  m.bgeo = { W, px, slot, nb, sy: top - 4, sh: H - bot - top + 4 };
  const lbl = i => (AN.mode === 'month' ? (i === 0 || (i + 1) % 5 === 0 ? i + 1 : '') : AN.mode === 'week' ? anDate(b[i].start, { weekday: 'short' }).replace('.', '') : anDate(b[i].start, { month: 'short' }).replace('.', ''));
  const bars = b.map((k, i) => { const cx = px + slot * i + slot / 2; return (catOn ? '' : `<rect x="${(cx - bw - 0.5).toFixed(1)}" y="${(H - bot - h(k.inc)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(k.inc).toFixed(1)}" rx="2" style="fill:var(--green)"/>`)
    + `<rect x="${(catOn ? cx - bw / 2 : cx + 0.5).toFixed(1)}" y="${(H - bot - h(k.exp)).toFixed(1)}" width="${bw.toFixed(1)}" height="${h(k.exp).toFixed(1)}" rx="2" style="fill:var(--orange)"/><text x="${cx.toFixed(1)}" y="${H - 6}" text-anchor="middle" class="ax">${lbl(i)}</text>`; }).join('');
  const table = `<details class="an-data"><summary>Ver estes valores em lista</summary><table><thead><tr><th>Período</th>${catOn ? '' : '<th>Receitas</th>'}<th>Despesas</th></tr></thead><tbody>${b.map(k => `<tr><td>${anDate(k.start, AN.mode === 'year' ? { month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' })}</td>${catOn ? '' : `<td>${anEur(k.inc)}</td>`}<td>${anEur(k.exp)}</td></tr>`).join('')}</tbody></table></details>`;
  return `<div class="an-tip" id="an-btip" aria-live="polite">${anTipBar(m, sel, catOn)}</div>
  <div class="an-chart" id="an-bars" data-chart="bars" tabindex="0" role="group" aria-label="Receitas e despesas. Toca numa barra ou usa as setas do teclado.">
  <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas por período">${sel >= 0 ? `<rect id="an-bsel" x="${(px + slot * sel).toFixed(1)}" y="${top - 4}" width="${slot.toFixed(1)}" height="${H - bot - top + 4}" rx="4" style="fill:var(--forest)" opacity=".13"/>` : '<rect id="an-bsel" x="0" y="0" width="0" height="0"/>'}
  <line x1="${px}" x2="${W - px}" y1="${H - bot}" y2="${H - bot}" style="stroke:var(--line)"/>${bars}</svg></div>
  <div class="an-step"><button data-an="kstep:-1" aria-label="Período anterior da seleção">‹</button><span>Toca numa barra para ver os movimentos</span><button data-an="kstep:1" aria-label="Período seguinte da seleção">›</button></div>
  <div class="legend"><span><i style="background:var(--green)"></i>Receitas</span><span><i style="background:var(--orange)"></i>Despesas</span></div>${table}`;
}
function anTipBar(m, i, catOn) {
  if (i < 0) return '<span class="sub">Toca numa barra para ver os movimentos desse período.</span>';
  const k = m.buckets[i], name = AN.mode === 'year' ? anDate(k.start, { month: 'long', year: 'numeric' }) : anDate(k.start, { weekday: 'short', day: 'numeric', month: 'short' });
  return `<b>${name}</b> · ${catOn ? '' : `Receitas <span class="pos">${anEur(k.inc)}</span> · `}Despesas ${anEur(k.exp)}`;
}

// ---------- categorias e movimentos ----------
function anCategories(m) {
  const T = today(), pn = anPrevName(AN.mode, m.range, T), hasPrev = m.prevAgg.n > 0;
  let rows = Object.entries(m.byCat).filter(([k]) => !AN.cats || AN.cats.has(k)).sort((a, b) => b[1] - a[1]);
  if (!rows.length) return '<div class="card"><p class="sub" style="margin:0">Sem despesas neste período.</p></div>';
  const top = rows[0][1];
  return `<div class="card an-cats">${rows.map(([k, v]) => {
    const pv = m.prevAgg.byCat[k] || 0, d = v - pv, on = AN.selCat === k;
    return `<button class="an-cat ${on ? 'on' : ''}" data-an="cat:${k}" aria-pressed="${on}"><span class="between"><span>${CATS[k][1]} ${CATS[k][0]}</span><span>${anEur(v)} <small class="sub">${m.expAll ? pct((v / m.expAll) * 100) : ''}</small></span></span><span class="bar"><i style="width:${Math.round((v / top) * 100)}%"></i></span>${hasPrev ? `<small class="${d === 0 ? 'sub' : d > 0 ? 'neg' : 'pos'}">${d === 0 ? '= igual' : (d > 0 ? '▲ ' : '▼ ') + anEur(Math.abs(d))} vs. ${pn}</small>` : ''}</button>`;
  }).join('')}</div>`;
}
function anDrill(m) {
  const T = today(), S = new Set(m.accounts), catOn = !!AN.cats;
  const scope = AN.sel || m.range, show = AN.mode === 'day' || AN.sel || AN.selCat;
  if (!show) return '<p class="note" id="an-drill">Toca num ponto, numa barra ou numa categoria para ver os movimentos correspondentes aqui.</p>';
  const list = byDate(db.entries.filter(e => {
    if (e.date > T || e.date < scope.start || e.date > scope.end) return false;
    if (e.kind === 'transfer') return !AN.selCat && !catOn && (S.has(e.accountId) || S.has(e.destId));
    if (!S.has(e.accountId)) return false;
    if (AN.selCat) return e.kind === 'expense' && e.category === AN.selCat;
    return !catOn || (e.kind === 'expense' && AN.cats.has(e.category));
  }));
  const title = `${AN.selCat ? CATS[AN.selCat][1] + ' ' + CATS[AN.selCat][0] + ' · ' : ''}${scope.start === scope.end ? anDate(scope.start, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }) : AN.mode === 'year' && AN.sel ? anDate(scope.start, { month: 'long', year: 'numeric' }) : anLabel(AN.mode, scope.start === m.range.start && scope.end === m.range.end ? m.range : scope)}`;
  return `<div id="an-drill"><div class="between an-dh"><h2>${esc(title)}</h2>${AN.sel || AN.selCat ? '<button class="linkbtn" data-an="clearsel">✕ Limpar seleção</button>' : ''}</div>
  ${list.length ? `<p class="note" style="margin-top:0">${list.length} movimento(s). Toca num movimento para o editar.</p><div class="list">${list.slice(0, AN.limit).map(entryRow).join('')}</div>${list.length > AN.limit ? `<button class="btn" data-an="more" style="width:100%">Mostrar mais (${list.length - AN.limit})</button>` : ''}` : '<div class="card"><p class="sub" style="margin:0">Sem movimentos nesta seleção.</p></div>'}</div>`;
}

function analysisView() {
  const T = today(); if (!AN.anchor) AN.anchor = T;
  const range = anRange(AN.mode, AN.anchor);
  AN.accs = anSet(AN.accs, db.accounts.map(a => a.id)); AN.cats = anSet(AN.cats, Object.keys(CATS));
  const head = anControls(range);
  if (!db.entries.some(e => e.date <= T)) { AN.model = null; return head + emptyBox('📈', 'Ainda não há movimentos para analisar. Regista alguns e volta aqui.'); }
  // Modo privado: gráficos, valores e conclusões ficam completamente escondidos.
  if (masked()) { AN.model = null; return head + '<div class="card an-lock"><span>🔒</span><p>Modo privado: os gráficos e os valores estão escondidos.<br>Mantém premido o 👁️ para ver a análise.</p></div>'; }
  const catOn = !!AN.cats, m = AN.model = anCompute({ db, today: T, mode: AN.mode, anchor: AN.anchor, accs: AN.accs, cats: AN.cats, win: AN.win });
  const estimated = m.estInit || m.series.some(p => p.est);
  const names = m.estNames.slice(0, 3).map(esc).join(', ') + (m.estNames.length > 3 ? '…' : '');
  const notes = [];
  if (estimated) notes.push(`<div class="alert info">ℹ️ <b>Saldos estimados.</b> Antes do primeiro movimento registado${names ? ` (${names})` : ''}, a app só conhece o saldo inicial das contas, por isso essa parte (tracejada) é uma estimativa e não um valor confirmado.</div>`);
  if (catOn) notes.push('<div class="alert info">🏷️ Filtro de categorias ativo: os indicadores mostram só essas despesas. <b>O saldo real não depende deste filtro.</b></div>');
  if (!m.n && !m.trIn && !m.trOut && !m.nInt) notes.push('<div class="alert info">Sem movimentos neste período para as contas escolhidas.</div>');
  const win = AN.mode === 'day' ? `<div class="seg an-win" role="group" aria-label="Janela do gráfico">${[7, 30].map(n => `<button data-an="win:${n}" class="${AN.win === n ? 'on' : ''}" aria-pressed="${AN.win === n}">${n} dias</button>`).join('')}</div>` : '';
  return `${head}${notes.join('')}<div class="an-fade">${anCards(m, catOn)}${anBridge(m, catOn)}
  <h2>Evolução do saldo</h2><div class="card">${win}${anBalanceChart(m)}<p class="sub an-foot">Saldo calculado a partir do saldo inicial das contas e dos movimentos registados. Movimentos com data futura não contam.</p></div>
  ${AN.mode === 'day' ? '' : `<h2>Receitas e despesas</h2><div class="card">${anBarsChart(m, catOn)}</div>`}
  <h2>Despesas por categoria</h2>${anCategories(m)}${anDrill(m)}</div>`;
}

// ---------- interação ----------
function anFocusLater(id) { if (id) setTimeout(() => { const el = $(id); if (el) el.focus(); }, 0); }
function anCommit(sel, refocus) { AN.sel = sel; render(true); anFocusLater(refocus); }
function anSameSel(a, b) { return !!a && !!b && a.start === b.start && a.end === b.end; }
function anPickDay(d, toggle, refocus) {
  if (AN.mode === 'day') { AN.anchor = d; anResetSel(); render(true); anFocusLater(refocus); return; } // na vista diária, tocar escolhe esse dia
  const s = { start: d, end: d }; anCommit(toggle && anSameSel(AN.sel, s) ? null : s, refocus);
}
function anPickBucket(i, toggle, refocus) { const k = AN.model.buckets[i]; if (!k) return; const s = { start: k.start, end: k.end }; anCommit(toggle && anSameSel(AN.sel, s) ? null : s, refocus); }
function anScrub(c, clientX, commit) {
  const m = AN.model; if (!m) return; const r = c.querySelector('svg').getBoundingClientRect(), x = ((clientX - r.left) / r.width) * AN_W;
  if (c.dataset.chart === 'bal') {
    const g = m.geo, off = Math.round(((x - g.px) / (AN_W - 2 * g.px)) * g.nDays), i = Math.min(Math.max(off, 0), m.series.length - 1), p = m.series[i];
    $('an-cur').setAttribute('x1', g.x(p.d)); $('an-cur').setAttribute('x2', g.x(p.d)); $('an-dot').setAttribute('cx', g.x(p.d)); $('an-dot').setAttribute('cy', g.y(p.bal / 100)); $('an-tip').innerHTML = anTipBal(m, i);
    if (commit) anPickDay(p.d, true, null);
  } else {
    const g = m.bgeo, i = Math.min(Math.max(Math.floor((x - g.px) / g.slot), 0), g.nb - 1), b = $('an-bsel');
    b.setAttribute('x', g.px + g.slot * i); b.setAttribute('width', g.slot); b.setAttribute('height', g.sh); b.setAttribute('y', g.sy); $('an-btip').innerHTML = anTipBar(m, i, !!AN.cats);
    if (commit) anPickBucket(i, true, null);
  }
}
let anDrag = null;
document.addEventListener('pointerdown', ev => { const c = ev.target.closest && ev.target.closest('.an-chart'); if (!c || !AN.model) return; anDrag = { c, id: ev.pointerId }; try { c.setPointerCapture(ev.pointerId); } catch (e) {} anScrub(c, ev.clientX, false); });
document.addEventListener('pointermove', ev => { if (anDrag && ev.pointerId === anDrag.id) anScrub(anDrag.c, ev.clientX, false); });
document.addEventListener('pointerup', ev => { if (!anDrag || ev.pointerId !== anDrag.id) return; const d = anDrag; anDrag = null; anScrub(d.c, ev.clientX, true); });
document.addEventListener('pointercancel', () => { if (anDrag) { anDrag = null; render(true); } }); // o navegador ficou com o gesto (scroll): repõe a seleção
document.addEventListener('keydown', ev => {
  const c = ev.target.closest && ev.target.closest('.an-chart'); if (!c || !AN.model || !/^Arrow(Left|Right)$/.test(ev.key)) return;
  ev.preventDefault(); const m = AN.model, dir = ev.key === 'ArrowLeft' ? -1 : 1;
  if (c.dataset.chart === 'bal') anStepDay(dir, c.id); else anStepBucket(dir, c.id);
});
function anStepDay(dir, refocus) { const m = AN.model, i = Math.min(Math.max(anCursorIdx(m) + dir, 0), m.series.length - 1); anPickDay(m.series[i].d, false, refocus); }
function anStepBucket(dir, refocus) { const m = AN.model, cur = anBarSel(m), i = Math.min(Math.max((cur < 0 ? (dir > 0 ? -1 : m.buckets.length) : cur) + dir, 0), m.buckets.length - 1); anPickBucket(i, false, refocus); }

function anSheet(kind) {
  const isAcc = kind === 'accs', cur = isAcc ? AN.accs : AN.cats;
  const items = isAcc ? db.accounts.map(a => [a.id, `${KINDS[a.kind][1]} ${a.name}`, KINDS[a.kind][0]]) : Object.entries(CATS).map(([k, v]) => [k, `${v[1]} ${v[0]}`, '']);
  const presets = isAcc ? [['all', 'Todas'], ['spend', 'Disponível'], ['save', 'Poupança'], ['inv', 'Investimento']] : [['all', 'Todas']];
  openSheet(`<h2>${isAcc ? 'Contas' : 'Categorias de despesa'}</h2>
  <p class="note" style="margin-top:0">Escolhe as ${isAcc ? 'contas' : 'categorias'} que queres ver. Se não escolheres nenhuma, mostra todas.</p>
  <div class="an-chips">${presets.map(([k, l]) => `<button class="an-chip ${k === 'all' && !cur ? 'on' : ''}" data-an="${kind}:${k}">${l}</button>`).join('')}</div>
  <div class="card an-pick">${items.map(([id, name, sub]) => `<label class="chk"><input type="checkbox" data-an-${isAcc ? 'acc' : 'cat'}="${esc(id)}" ${cur && cur.has(id) ? 'checked' : ''}><span class="nm">${esc(name)}</span>${sub ? `<small class="sub">${sub}</small>` : ''}</label>`).join('')}</div>
  ${isAcc ? '' : '<p class="note">As categorias só se aplicam às despesas. O saldo das contas não muda.</p>'}
  <div class="actionbar"><div class="btns"><button class="btn main" data-act="cancel">Concluir</button></div></div>`);
}
document.addEventListener('click', ev => {
  const t = ev.target.closest && ev.target.closest('[data-an]'); if (!t) return;
  const [cmd, a1] = t.dataset.an.split(':'), T = today();
  if (cmd === 'mode') { AN.mode = a1; anResetSel(); render(true); }
  else if (cmd === 'prev' || cmd === 'next') { AN.anchor = anShift(AN.mode, AN.anchor || T, cmd === 'next' ? 1 : -1); anResetSel(); render(true); }
  else if (cmd === 'today') { AN.anchor = T; anResetSel(); render(true); }
  else if (cmd === 'win') { AN.win = +a1; render(true); }
  else if (cmd === 'accs' || cmd === 'cats') {
    if (!a1) return anSheet(cmd);
    if (cmd === 'accs') { const k = { all: null, spend: AN_SPEND, save: new Set(['poupanca']), inv: new Set(['investimento']) }[a1]; AN.accs = k ? new Set(db.accounts.filter(x => k.has(x.kind)).map(x => x.id)) : null; if (AN.accs && !AN.accs.size) { AN.accs = null; toast('Não tens contas desse tipo.'); } }
    else AN.cats = null;
    anResetSel(); render(true); anSheet(cmd);
  }
  else if (cmd === 'clear') { AN.accs = null; AN.cats = null; anResetSel(); render(true); }
  else if (cmd === 'cat') { AN.selCat = AN.selCat === a1 ? null : a1; AN.limit = 100; render(true); }
  else if (cmd === 'clearsel') { anResetSel(); render(true); }
  else if (cmd === 'more') { AN.limit += 100; render(true); }
  else if (cmd === 'bstep' && AN.model) anStepDay(+a1, null);
  else if (cmd === 'kstep' && AN.model) anStepBucket(+a1, null);
});
document.addEventListener('change', ev => {
  const t = ev.target; if (!t.matches || !t.matches('input[data-an-acc],input[data-an-cat]')) return;
  const isAcc = t.hasAttribute('data-an-acc'), all = isAcc ? db.accounts.map(a => a.id) : Object.keys(CATS), id = isAcc ? t.dataset.anAcc : t.dataset.anCat;
  const cur = new Set((isAcc ? AN.accs : AN.cats) || []); if (t.checked) cur.add(id); else cur.delete(id);
  const next = cur.size && cur.size < all.length ? cur : null;
  if (isAcc) AN.accs = next; else AN.cats = next;
  anResetSel(); render(true); // nenhuma escolha = todas
});
