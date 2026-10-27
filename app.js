'use strict';

// ---------- Constantes ----------
const KEY = 'poupanca-v2';
const KINDS = { ordem: ['Conta à ordem', '🏦'], poupanca: ['Poupança', '🔒'], carteira: ['Dinheiro físico', '💵'], investimento: ['Investimento', '📈'] };
const ENTRY = { income: 'Receita', expense: 'Despesa', transfer: 'Transferência' };
const CATS = {
  habitacao: ['Habitação', '🏠'], alimentacao: ['Alimentação', '🍔'], restaurantes: ['Restaurantes', '🍽️'], transportes: ['Transportes', '🚗'],
  compras: ['Compras', '🛒'], desporto: ['Desporto', '🏋️'], viagens: ['Viagens', '✈️'], lazer: ['Lazer', '🍻'], subscricoes: ['Subscrições', '📱'],
  saude: ['Saúde', '🩺'], investimentos: ['Investimentos', '💰'], outros: ['Outros', '📦'],
};
const FREQ = { monthly: 'Mensal', weekly: 'Semanal', yearly: 'Anual' };
const INV = { etf: 'ETF', acao: 'Ação', cripto: 'Criptomoeda', deposito: 'Depósito a prazo', aforro: 'Certificado de Aforro', outro: 'Outro investimento', divida: 'Dívida / empréstimo' };

// ---------- Dados ----------
let db;
function empty() { return { accounts: [], entries: [], budgets: [], goals: [], recurring: [], invest: [] }; }
function load() {
  try {
    let d = JSON.parse(localStorage.getItem(KEY));
    if (!d) { const old = localStorage.getItem('poupanca-v1'); if (old) d = JSON.parse(old); }
    if (d && d.accounts) return normalize(d);
  } catch (e) {}
  return empty();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { alert('Não foi possível guardar os dados.'); } }
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// Aceita dados da versão anterior e o financas.json da app Swift (datas em segundos desde 2001, nomes em português).
function normalize(d) {
  const kindMap = { Banco: 'ordem', banco: 'ordem', Dinheiro: 'carteira', 'Poupança': 'poupanca' };
  const entryMap = { Entrada: 'income', Despesa: 'expense', 'Transferência': 'transfer' };
  const catMap = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [v[0], k])); catMap.Casa = 'habitacao'; catMap.casa = 'habitacao';
  const cat = c => (CATS[c] ? c : catMap[c] || 'outros');
  const date = x => typeof x === 'number' ? new Date((x + 978307200) * 1000).toISOString().slice(0, 10) : String(x).slice(0, 10);
  const t = today();
  return {
    accounts: (d.accounts || []).map(a => ({ id: a.id, name: a.name, kind: kindMap[a.kind] || a.kind, opening: a.opening ?? a.openingBalance ?? 0 })),
    entries: (d.entries || []).map(e => ({ id: e.id, date: date(e.date), kind: entryMap[e.kind] || e.kind, amount: e.amount, accountId: e.accountId ?? e.accountID, destId: e.destId ?? e.destinationID ?? null, category: cat(e.category), note: e.note || '', goalId: e.goalId || null, recId: e.recId || null })),
    budgets: (d.budgets || []).map(b => ({ id: b.id, category: cat(b.category), limit: b.limit ?? b.monthlyLimit })),
    goals: (d.goals || []).map(g => ({ id: g.id, name: g.name, target: g.target, saved: g.saved, deadline: g.deadline || '', created: g.created || t, base: g.base ?? g.saved })),
    recurring: d.recurring || [],
    invest: d.invest || [],
  };
}

// ---------- Utilitários ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const eur = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n);
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const parseD = s => new Date(s + 'T12:00:00');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = s => parseD(s).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });
const monthName = (ym, long) => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('pt-PT', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
const addMonthKey = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return ymd(d).slice(0, 7); };
const num = n => String(n).replace('.', ',');
const pct = n => `${(Math.round(n * 10) / 10).toString().replace('.', ',')}%`;

// Aceita 12,50 e 12.50; sem negativos.
function parseMoney(raw) {
  const n = Number(String(raw).replace(/\s/g, '').replace(',', '.'));
  return raw !== '' && Number.isFinite(n) && n >= 0 ? n : null;
}

const acc = id => db.accounts.find(a => a.id === id);
function balance(a) {
  return db.entries.reduce((b, e) => {
    if (e.kind === 'transfer') return e.accountId === a.id ? b - e.amount : e.destId === a.id ? b + e.amount : b;
    if (e.accountId !== a.id) return b;
    return b + (e.kind === 'income' ? e.amount : -e.amount);
  }, a.opening);
}
const spendable = () => db.accounts.filter(a => a.kind !== 'investimento').reduce((s, a) => s + balance(a), 0);
const investedAccounts = () => db.accounts.filter(a => a.kind === 'investimento').reduce((s, a) => s + balance(a), 0);
const assets = () => db.invest.filter(i => i.type !== 'divida').reduce((s, i) => s + i.current, 0);
const debts = () => db.invest.filter(i => i.type === 'divida').reduce((s, i) => s + i.current, 0);
const netWorth = () => spendable() + investedAccounts() + assets() - debts();

const curMonth = () => today().slice(0, 7);
const sumEntries = (kind, ym, cat, upToDay) => db.entries
  .filter(e => e.kind === kind && e.date.startsWith(ym) && (!cat || e.category === cat) && (!upToDay || +e.date.slice(8, 10) <= upToDay))
  .reduce((s, e) => s + e.amount, 0);
const byDate = list => [...list].sort((a, b) => b.date.localeCompare(a.date) || 0);

// ---------- Recorrentes ----------
function advance(rec) {
  const d = parseD(rec.next);
  if (rec.freq === 'weekly') { d.setDate(d.getDate() + 7); return ymd(d); }
  const y = d.getFullYear(), m = d.getMonth() + (rec.freq === 'yearly' ? 12 : 1);
  return ymd(new Date(y, m, Math.min(rec.day, new Date(y, m + 1, 0).getDate()), 12));
}
function applyRecurring() {
  let changed = false;
  for (const r of db.recurring) {
    if (!r.active || !acc(r.accountId)) continue;
    let guard = 0;
    while (r.next <= today() && guard++ < 400) {
      db.entries.push({ id: uid(), date: r.next, kind: r.kind, amount: r.amount, accountId: r.accountId, destId: r.destId || null, category: r.category || 'outros', note: r.name, goalId: r.goalId || null, recId: r.id });
      r.next = advance(r); changed = true;
    }
  }
  if (changed) save();
}
// Ocorrências previstas depois de hoje, até `until` (inclusive).
function upcoming(until) {
  const out = [];
  for (const r of db.recurring) {
    if (!r.active) continue;
    let c = { ...r }, guard = 0;
    while (c.next <= until && guard++ < 100) { if (c.next > today()) out.push({ date: c.next, rec: r }); c.next = advance(c); }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const monthEnd = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)); };
const plusDays = n => { const d = new Date(); d.setDate(d.getDate() + n); return ymd(d); };
const sign = r => (r.kind === 'income' ? 1 : r.kind === 'expense' ? -1 : 0) * r.amount;

// ---------- Objetivos ----------
function goalInfo(g) {
  const contrib = db.entries.filter(e => e.goalId === g.id).reduce((s, e) => s + e.amount, 0);
  const saved = g.saved + contrib, remaining = Math.max(g.target - saved, 0), p = Math.min(saved / Math.max(g.target, .01), 1);
  const info = { saved, remaining, p, contrib, need: null, status: '', tone: '' };
  if (remaining === 0) { info.status = 'Concluído ✅'; info.tone = 'pos'; return info; }
  if (g.deadline) {
    const days = (parseD(g.deadline) - parseD(today())) / 864e5;
    if (days <= 0) { info.status = 'Prazo ultrapassado'; info.tone = 'neg'; info.need = remaining; return info; }
    info.need = remaining / Math.max(1, Math.ceil(days / 30.44));
    const total = Math.max((parseD(g.deadline) - parseD(g.created)) / 864e5, 1), frac = Math.min(Math.max((total - days) / total, 0), 1);
    const expected = g.base + (g.target - g.base) * frac, diff = saved - expected, tol = g.target * .02;
    if (diff >= tol) { info.status = 'Adiantado'; info.tone = 'pos'; } else if (diff <= -tol) { info.status = 'Atrasado'; info.tone = 'neg'; } else { info.status = 'No ritmo'; info.tone = 'pos'; }
  }
  return info;
}

// ---------- Cópia de segurança: estado ----------
const BKKEY = 'poupanca-lastbackup';
const lastBackup = () => { try { return localStorage.getItem(BKKEY) || ''; } catch (e) { return ''; } };
function backupStatus() {
  const d = lastBackup();
  if (!d) return { tone: 'neg', icon: '🔴', text: 'Nunca fizeste uma cópia de segurança.' };
  const days = Math.floor((parseD(today()) - parseD(d)) / 864e5);
  if (days >= 30) return { tone: 'warn', icon: '🟠', text: `A última cópia foi há ${days} dias (${fmtDate(d)}).`, days };
  return { tone: 'pos', icon: '🟢', text: `Última cópia: ${fmtDate(d)}${days ? ` (há ${days} dia${days > 1 ? 's' : ''})` : ' (hoje)'}.`, days };
}
function markBackup() { try { localStorage.setItem(BKKEY, today()); } catch (e) {} render(true); }

// ---------- Alertas ----------
function alerts() {
  const out = [], ym = curMonth(), prev = addMonthKey(ym, -1), day = +today().slice(8, 10);
  const bk = backupStatus();
  if ((db.accounts.length || db.entries.length) && bk.tone !== 'pos') out.push([bk.tone, `${bk.text} Exporta uma cópia em Contas → Cópia de segurança.`]);
  for (const b of db.budgets) {
    const s = sumEntries('expense', ym, b.category), p = s / Math.max(b.limit, .01);
    if (p >= 1) out.push(['neg', `Excedeste o orçamento de ${CATS[b.category][0]}: ${eur(s)} de ${eur(b.limit)}.`]);
    else if (p >= .8) out.push(['warn', `Já gastaste ${Math.round(p * 100)}% do teu orçamento de ${CATS[b.category][0]}.`]);
  }
  for (const u of upcoming(plusDays(3)).filter(u => u.rec.kind === 'expense')) {
    const n = Math.round((parseD(u.date) - parseD(today())) / 864e5);
    out.push(['info', `«${esc(u.rec.name)}» (${eur(u.rec.amount)}) será cobrado ${n === 1 ? 'amanhã' : 'em ' + n + ' dias'}.`]);
  }
  for (const c of Object.keys(CATS)) {
    const diff = sumEntries('expense', ym, c) - sumEntries('expense', prev, c, day);
    if (diff >= 50) out.push(['warn', `Este mês gastaste mais ${eur(diff)} em ${CATS[c][0]} do que no mesmo período do mês anterior.`]);
  }
  for (const g of db.goals) {
    const i = goalInfo(g);
    if (i.status === 'Atrasado') out.push(['warn', `O objetivo «${esc(g.name)}» está atrasado: precisas de poupar ${eur(i.need)} por mês.`]);
    if (i.status === 'Adiantado') out.push(['pos', `Estás adiantado no objetivo «${esc(g.name)}». Continua assim!`]);
  }
  return out;
}

// ---------- Gráficos (SVG) ----------
function monthEnds(n) {
  const res = [], ym = curMonth();
  for (let i = n - 1; i >= 0; i--) {
    const k = addMonthKey(ym, -i);
    const end = i === 0 ? today() : ymd(new Date(+k.slice(0, 4), +k.slice(5, 7), 0));
    res.push({ k, end });
  }
  return res;
}
function lineChart(pts) {
  const W = 340, H = 140, px = 14, top = 22, bot = 24;
  const vs = pts.map(p => p.v), min = Math.min(...vs), max = Math.max(...vs), span = max - min || 1;
  const x = i => px + (i * (W - 2 * px)) / Math.max(pts.length - 1, 1), y = v => top + (1 - (v - min) / span) * (H - top - bot);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const area = `${line} L${x(pts.length - 1)},${H - bot} L${x(0)},${H - bot} Z`;
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Evolução do saldo"><path d="${area}" style="fill:var(--forest);opacity:.12"/><path d="${line}" fill="none" style="stroke:var(--forest)" stroke-width="2.5" stroke-linejoin="round"/>
  ${pts.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="3.5" style="fill:var(--forest)"/><text x="${x(i)}" y="${H - 6}" text-anchor="middle" class="ax">${p.label}</text>`).join('')}
  <text x="${x(pts.length - 1)}" y="${y(pts[pts.length - 1].v) - 8}" text-anchor="end" class="ax" style="font-weight:600">${eur(pts[pts.length - 1].v)}</text></svg>`;
}
function groupedBars(ms) {
  const W = 340, H = 140, bot = 22, top = 8, max = Math.max(...ms.flatMap(m => [m.inc, m.exp]), 1), bw = 14, gap = (W - 2 * 14) / ms.length;
  const h = v => (v / max) * (H - top - bot);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="Receitas versus despesas">${ms.map((m, i) => {
    const cx = 14 + gap * i + gap / 2;
    return `<rect x="${cx - bw - 1}" y="${H - bot - h(m.inc)}" width="${bw}" height="${h(m.inc)}" rx="3" style="fill:var(--green)"/><rect x="${cx + 1}" y="${H - bot - h(m.exp)}" width="${bw}" height="${h(m.exp)}" rx="3" style="fill:var(--orange)"/><text x="${cx}" y="${H - 6}" text-anchor="middle" class="ax">${m.label}</text>`;
  }).join('')}</svg><div class="legend"><span><i style="background:var(--green)"></i>Receitas</span><span><i style="background:var(--orange)"></i>Despesas</span></div>`;
}

// ---------- Interface ----------
const TABS = [['home', 'Início', '🏠'], ['entries', 'Movimentos', '⇄'], ['budgets', 'Orçamentos', '📊'], ['goals', 'Objetivos', '🎯'], ['accounts', 'Contas', '💳']];
let tab = (() => { try { return localStorage.getItem('poupanca-tab') || 'home'; } catch (e) { return 'home'; } })();
const ui = { f: { month: '', cat: '', acc: '', q: '' }, seg: 'accounts' };
const $ = id => document.getElementById(id);

function render(keepScroll) {
  $('tabs').innerHTML = TABS.map(([k, l, i]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('');
  $('title').textContent = tab === 'home' ? 'Poupança' : TABS.find(t => t[0] === tab)[1];
  $('add').hidden = tab === 'home' || (tab === 'entries' && !db.accounts.length);
  $('view').innerHTML = { home, entries, budgets, goals, accounts }[tab]();
  if (!keepScroll) window.scrollTo(0, 0);
}
const emptyBox = (i, t) => `<div class="empty"><span>${i}</span>${t}</div>`;
const bar = (p, cls = '') => `<div class="bar ${cls}"><i style="width:${Math.min(Math.max(p, 0), 1) * 100}%"></i></div>`;

function entryRow(e) {
  const ico = e.kind === 'income' ? '↙' : e.kind === 'expense' ? CATS[e.category]?.[1] || '📦' : '⇄';
  const name = e.note || (e.kind === 'expense' ? CATS[e.category]?.[0] : ENTRY[e.kind]);
  const a = acc(e.accountId), d = acc(e.destId);
  const where = e.kind === 'transfer' ? `${esc(a?.name || '?')} → ${esc(d?.name || '?')}` : esc(a?.name || '');
  const sg = e.kind === 'expense' ? '−' : e.kind === 'income' ? '+' : '';
  return `<button class="item" data-edit-entry="${e.id}"><div class="ico">${ico}</div><div class="grow"><div>${esc(name)}${e.recId ? ' 🔁' : ''}</div><div class="sub">${fmtDate(e.date)} · ${where}</div></div><div class="amt ${e.kind === 'income' ? 'pos' : ''}">${sg}${eur(e.amount)}</div></button>`;
}

function home() {
  const ym = curMonth(), prev = addMonthKey(ym, -1);
  const inc = sumEntries('income', ym), exp = sumEntries('expense', ym), pInc = sumEntries('income', prev), pExp = sumEntries('expense', prev);
  const rate = inc > 0 ? ((inc - exp) / inc) * 100 : null;
  const delta = (cur, p, goodUp) => {
    if (!p) return '<small class="sub">sem dados do mês anterior</small>';
    const d = cur - p, good = goodUp ? d >= 0 : d <= 0;
    return `<small class="${good ? 'pos' : 'neg'}">${d >= 0 ? '▲' : '▼'} ${eur(Math.abs(d))} vs. mês anterior</small>`;
  };
  const up = upcoming(monthEnd()), fc = spendable() + up.reduce((s, u) => s + sign(u.rec), 0);
  const budgetLeft = db.budgets.reduce((s, b) => s + Math.max(b.limit - sumEntries('expense', ym, b.category), 0), 0);
  const al = alerts().slice(0, 5);
  const pts = monthEnds(6).map(m => ({ label: monthName(m.k), v: db.accounts.reduce((s, a) => s + a.opening, 0) + db.entries.filter(e => e.date <= m.end && e.kind !== 'transfer').reduce((s, e) => s + (e.kind === 'income' ? e.amount : -e.amount), 0) }));
  const ms = monthEnds(6).map(m => ({ label: monthName(m.k), inc: sumEntries('income', m.k), exp: sumEntries('expense', m.k) }));
  const cats = Object.keys(CATS).map(c => [c, sumEntries('expense', ym, c)]).filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]);
  const last = byDate(db.entries).slice(0, 5);

  return `<div class="hero"><small>DISPONÍVEL PARA GASTAR</small><b>${eur(spendable())}</b><div>Património líquido: <strong>${eur(netWorth())}</strong></div></div>
  ${db.accounts.length ? `<div class="row2"><button class="btn main" data-quick="expense">− Adicionar despesa</button><button class="btn main alt" data-quick="income">+ Adicionar receita</button></div>` : ''}
  <div class="row2" style="margin-top:12px">
    <div class="card metric"><span class="pos">↙</span><small>Receitas de ${monthName(ym)}</small><b>${eur(inc)}</b>${delta(inc, pInc, true)}</div>
    <div class="card metric"><span style="color:var(--orange)">↗</span><small>Despesas de ${monthName(ym)}</small><b>${eur(exp)}</b>${delta(exp, pExp, false)}</div>
  </div>
  <div class="card"><div class="between"><b>Taxa de poupança</b><b class="${rate !== null && rate < 0 ? 'neg' : 'pos'}">${rate === null ? '—' : pct(rate)}</b></div>${rate === null ? '' : bar(rate / 100, rate < 0 ? 'over' : '')}
    <div class="sub">${rate === null ? 'Regista uma receita este mês para calcular.' : `Este mês poupaste ${eur(inc - exp)} de ${eur(inc)} recebidos.`}</div></div>
  <div class="card"><div class="between"><b>Previsão do saldo no fim do mês</b><b>${eur(fc)}</b></div>
    <div class="sub">Saldo atual + receitas e despesas recorrentes previstas até ${fmtDate(monthEnd())}${up.length ? ` (${up.length} movimento${up.length > 1 ? 's' : ''})` : ''}.</div>
    ${db.budgets.length ? `<div class="sub" style="margin-top:6px">Ainda tens <strong>${eur(budgetLeft)}</strong> por gastar nos orçamentos deste mês.</div>` : ''}</div>
  ${al.length ? `<h2>Alertas</h2>${al.map(([t, m]) => `<div class="alert ${t}">${m}</div>`).join('')}` : ''}
  <h2>Património</h2>
  <div class="card kv"><div><span>Disponível</span><b>${eur(spendable())}</b></div><div><span>Investido</span><b>${eur(investedAccounts() + assets())}</b></div><div><span>Dívidas</span><b class="${debts() ? 'neg' : ''}">${debts() ? '−' : ''}${eur(debts())}</b></div><div class="tot"><span>Património líquido</span><b>${eur(netWorth())}</b></div></div>
  <h2>Evolução do saldo</h2><div class="card">${db.entries.length || db.accounts.length ? lineChart(pts) : '<p class="sub">Sem dados ainda.</p>'}</div>
  <h2>Receitas vs. despesas</h2><div class="card">${groupedBars(ms)}</div>
  <h2>Despesas por categoria</h2>
  <div class="card">${cats.length ? cats.map(([c, v]) => `<div class="catrow"><span>${CATS[c][1]} ${CATS[c][0]}</span><span class="sub">${eur(v)} · ${Math.round((v / exp) * 100)}%</span></div>${bar(v / cats[0][1])}`).join('') : '<p class="sub">Ainda não há despesas este mês.</p>'}</div>
  ${db.goals.length ? `<h2>Objetivos</h2><div class="card">${db.goals.slice(0, 3).map(g => { const i = goalInfo(g); return `<div class="catrow"><span>${esc(g.name)}</span><span class="sub">${Math.floor(i.p * 100)}%</span></div>${bar(i.p)}`; }).join('')}</div>` : ''}
  <h2>As minhas contas</h2>${db.accounts.length ? `<div class="list">${db.accounts.map(a => `<div class="item"><div class="ico">${KINDS[a.kind][1]}</div><div class="grow"><div>${esc(a.name)}</div><div class="sub">${KINDS[a.kind][0]}</div></div><div class="amt">${eur(balance(a))}</div></div>`).join('')}</div>` : emptyBox('🏦', 'Começa por adicionar uma conta no separador Contas, com o saldo do banco ou dinheiro.')}
  <h2>Últimos movimentos</h2>${last.length ? `<div class="list">${last.map(entryRow).join('')}</div>` : '<p class="note">Ainda não há movimentos.</p>'}`;
}

// --- Movimentos ---
function filtered() {
  const f = ui.f, q = f.q.trim().toLowerCase();
  return byDate(db.entries).filter(e => (!f.month || e.date.startsWith(f.month)) && (!f.cat || e.category === f.cat && e.kind === 'expense') && (!f.acc || e.accountId === f.acc || e.destId === f.acc)
    && (!q || (e.note || '').toLowerCase().includes(q) || (CATS[e.category]?.[0] || '').toLowerCase().includes(q) || String(e.amount).replace('.', ',').includes(q) || (acc(e.accountId)?.name || '').toLowerCase().includes(q)));
}
function entriesList() {
  const l = filtered();
  const inc = l.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0), exp = l.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  if (!l.length) return emptyBox('🔍', db.entries.length ? 'Nenhum movimento com estes filtros.' : 'Ainda não há movimentos. Toca em + para registar.');
  return `<div class="card kv"><div><span>Receitas</span><b class="pos">${eur(inc)}</b></div><div><span>Despesas</span><b>${eur(exp)}</b></div><div><span>Resultado</span><b class="${inc - exp < 0 ? 'neg' : 'pos'}">${eur(inc - exp)}</b></div></div>
  <div class="list">${l.map(entryRow).join('')}</div><p class="note">Toca num movimento para o editar ou apagar. 🔁 = criado por uma regra recorrente.</p>`;
}
function entries() {
  if (!db.accounts.length) return emptyBox('⇄', 'Adiciona primeiro uma conta no separador Contas.');
  const months = [...new Set([curMonth(), ...db.entries.map(e => e.date.slice(0, 7))])].sort().reverse(), f = ui.f;
  return `<input id="q" type="search" placeholder="🔍 Pesquisar por descrição, valor ou categoria" value="${esc(f.q)}">
  <div class="filters"><select data-f="month"><option value="">Todos os meses</option>${months.map(m => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthName(m, true)}</option>`).join('')}</select>
  <select data-f="cat"><option value="">Todas as categorias</option>${opts(CATS, f.cat)}</select>
  <select data-f="acc"><option value="">Todas as contas</option>${accOpts(f.acc)}</select></div>
  <div id="elist">${entriesList()}</div>`;
}

// --- Orçamentos ---
function budgets() {
  const ym = curMonth(), prev = addMonthKey(ym, -1);
  if (!db.budgets.length) {
    return `<div class="card example"><div class="between"><span>🍔 Alimentação</span><span class="sub">180 € / 250 €</span></div>${bar(.72)}<div class="sub">72% · exemplo</div></div>
    <div class="card example"><div class="between"><span>📱 Subscrições</span><span class="sub">105 € / 100 €</span></div>${bar(1, 'over')}<div class="sub neg">Excedido · exemplo</div></div>
    ${emptyBox('📊', 'Define limites mensais por categoria e recebe alertas aos 80% e 100%.')}<button class="btn main" data-act="new">Criar o primeiro orçamento</button>`;
  }
  const tot = db.budgets.reduce((s, b) => s + b.limit, 0), totSpent = db.budgets.reduce((s, b) => s + sumEntries('expense', ym, b.category), 0);
  return `<div class="card"><div class="between"><b>Total em ${monthName(ym, true)}</b><span class="sub">${eur(totSpent)} / ${eur(tot)}</span></div>${bar(totSpent / Math.max(tot, .01), totSpent > tot ? 'over' : '')}</div>
  <div class="list">${db.budgets.map(b => {
    const s = sumEntries('expense', ym, b.category), p = s / Math.max(b.limit, .01), ps = sumEntries('expense', prev, b.category);
    const st = p >= 1 ? ['Excedido', 'neg'] : p >= .8 ? ['Atenção', 'warnt'] : ['Dentro do limite', 'pos'];
    return `<button class="item" data-edit-budget="${b.id}" style="display:block"><div class="between"><span>${CATS[b.category][1]} ${CATS[b.category][0]}</span><span class="sub">${eur(s)} / ${eur(b.limit)}</span></div>${bar(p, p >= 1 ? 'over' : p >= .8 ? 'warn' : '')}
    <div class="between sub"><span class="${st[1]}">${Math.round(p * 100)}% · ${st[0]}</span><span>${ps ? 'Mês anterior: ' + eur(ps) : ''}</span></div></button>`;
  }).join('')}</div><p class="note">Toca num orçamento para o editar.</p>`;
}

// --- Objetivos ---
function goals() {
  if (!db.goals.length) {
    return `<div class="card example"><div class="between"><b>🚴 Bicicleta de triatlo</b><span class="pos">12%</span></div>${bar(.125)}<div class="sub">500 € de 4 000 € · faltam 3 500 €</div><div class="sub">Poupança mensal necessária: 291,67 € (prazo 12 meses) · exemplo</div></div>
    ${emptyBox('🎯', 'Cria um objetivo com prazo e vê quanto precisas de poupar por mês.')}<button class="btn main" data-act="new">Criar o primeiro objetivo</button>`;
  }
  return db.goals.map(g => {
    const i = goalInfo(g);
    return `<div class="card"><div class="between"><b data-edit-goal="${g.id}" class="link">${esc(g.name)} ✎</b><span class="pos">${Math.floor(i.p * 100)}%</span></div>${bar(i.p)}
    <div class="kv2"><div><span>Pretendido</span><b>${eur(g.target)}</b></div><div><span>Já poupado</span><b>${eur(i.saved)}</b></div><div><span>Falta poupar</span><b>${eur(i.remaining)}</b></div>
    <div><span>Prazo</span><b>${g.deadline ? fmtDate(g.deadline) : '—'}</b></div></div>
    ${i.need !== null && i.remaining > 0 ? `<div class="sub">Poupança mensal necessária: <strong>${eur(i.need)}</strong></div>` : ''}
    ${i.status ? `<div class="${i.tone}" style="font-weight:600;margin-top:4px">${i.status}</div>` : ''}
    ${i.contrib ? `<div class="sub">Inclui ${eur(i.contrib)} de movimentos associados.</div>` : ''}
    <div class="step"><button data-goal-step="${g.id}" data-d="-10">−</button><span>Ajuste manual (±10 €)</span><button data-goal-step="${g.id}" data-d="10">+</button></div></div>`;
  }).join('') + '<p class="note">Associa um movimento (transferência ou despesa) a um objetivo e o progresso atualiza sozinho.</p>';
}

// --- Contas / Recorrentes / Investimentos ---
function accounts() {
  const seg = `<div class="seg" id="aseg">${[['accounts', 'Contas'], ['rec', 'Recorrentes'], ['inv', 'Património']].map(([k, l]) => `<button data-seg="${k}" class="${ui.seg === k ? 'on' : ''}">${l}</button>`).join('')}</div><div style="height:12px"></div>`;
  if (ui.seg === 'rec') return seg + recurringView();
  if (ui.seg === 'inv') return seg + investView();
  const list = db.accounts.length
    ? `<div class="list">${db.accounts.map(a => `<button class="item" data-edit-account="${a.id}"><div class="ico">${KINDS[a.kind][1]}</div><div class="grow"><div>${esc(a.name)}</div><div class="sub">${KINDS[a.kind][0]}</div></div><div class="amt">${eur(balance(a))}</div></button>`).join('')}</div>`
    : emptyBox('💳', 'Toca em + para adicionar a primeira conta.');
  return `${seg}${list}<p class="note">Introduz o saldo atual. Transferências entre contas não contam como despesa. Toca numa conta para ver o histórico.</p>
  <h2>Cópia de segurança</h2><div class="card"><p class="sub" style="margin-top:0">Os dados ficam só neste telemóvel. Exporta uma cópia todos os meses e guarda o ficheiro no iCloud ou nos Ficheiros.</p>
  <div class="alert ${backupStatus().tone}" style="margin:8px 0 0">${backupStatus().icon} ${backupStatus().text}</div>
  <div class="btns" style="margin-top:8px"><button class="btn" data-act="export">Exportar</button><button class="btn" data-act="import">Importar</button></div></div><input id="file" type="file" accept=".json,application/json" hidden>
  <h2>Segurança</h2><div class="card"><p class="sub" style="margin-top:0">${getPin() ? '🔒 PIN ativo. A app bloqueia ao abrir e depois de 30 segundos fora dela.' : 'Protege a app com um PIN de 6 dígitos. É um bloqueio de ecrã: impede que outra pessoa abra a app no teu telemóvel.'}</p>
  <div class="btns" style="margin-top:8px">${getPin() ? '<button class="btn" data-act="pin-change">Alterar PIN</button><button class="btn del" data-act="pin-remove">Remover PIN</button>' : '<button class="btn main" data-act="pin-set">Definir PIN</button>'}</div></div>`;
}
function recurringView() {
  const up = upcoming(plusDays(30)), out = up.filter(u => u.rec.kind === 'expense').reduce((s, u) => s + u.rec.amount, 0), inn = up.filter(u => u.rec.kind === 'income').reduce((s, u) => s + u.rec.amount, 0);
  const list = db.recurring.length ? `<div class="list">${db.recurring.map(r => `<button class="item" data-edit-rec="${r.id}"><div class="ico">${r.kind === 'income' ? '↙' : r.kind === 'transfer' ? '⇄' : CATS[r.category]?.[1] || '📦'}</div><div class="grow"><div>${esc(r.name)}${r.active ? '' : ' (pausada)'}</div><div class="sub">${FREQ[r.freq]} · próxima: ${fmtDate(r.next)}</div></div><div class="amt ${r.kind === 'income' ? 'pos' : ''}">${r.kind === 'expense' ? '−' : r.kind === 'income' ? '+' : ''}${eur(r.amount)}</div></button>`).join('')}</div>`
    : emptyBox('🔁', 'Regista salário, renda, ginásio, subscrições, seguros ou prestações. Os movimentos são criados automaticamente nas datas certas.');
  return `<div class="card kv"><div><span>A pagar (30 dias)</span><b>${eur(out)}</b></div><div><span>A receber (30 dias)</span><b class="pos">${eur(inn)}</b></div></div>
  ${up.length ? `<h2>Próximos 30 dias</h2><div class="list">${up.map(u => `<div class="item"><div class="ico">${u.rec.kind === 'income' ? '↙' : '📅'}</div><div class="grow"><div>${esc(u.rec.name)}</div><div class="sub">${fmtDate(u.date)}</div></div><div class="amt ${u.rec.kind === 'income' ? 'pos' : ''}">${u.rec.kind === 'expense' ? '−' : u.rec.kind === 'income' ? '+' : ''}${eur(u.rec.amount)}</div></div>`).join('')}</div>` : ''}
  <h2>Regras recorrentes</h2>${list}<button class="btn main" data-act="new" style="margin-top:8px">+ Nova recorrente</button>`;
}
function investView() {
  const list = db.invest.length ? `<div class="list">${db.invest.map(i => {
    const gain = i.current - i.invested, rp = i.invested ? (gain / i.invested) * 100 : null;
    return `<button class="item" data-edit-inv="${i.id}"><div class="ico">${i.type === 'divida' ? '💳' : '📈'}</div><div class="grow"><div>${esc(i.name)}</div><div class="sub">${INV[i.type]}${i.type !== 'divida' ? ` · investido ${eur(i.invested)}` : ''}</div></div>
    <div style="text-align:right"><div class="amt ${i.type === 'divida' ? 'neg' : ''}">${i.type === 'divida' ? '−' : ''}${eur(i.current)}</div>${i.type !== 'divida' && rp !== null ? `<div class="sub ${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}${pct(rp)}</div>` : ''}</div></button>`;
  }).join('')}</div>` : emptyBox('📈', 'Regista ETFs, ações, cripto, depósitos, certificados de aforro e dívidas.');
  return `<div class="card kv"><div><span>Disponível</span><b>${eur(spendable())}</b></div><div><span>Investido</span><b>${eur(investedAccounts() + assets())}</b></div><div><span>Dívidas</span><b>${eur(debts())}</b></div><div class="tot"><span>Património líquido</span><b>${eur(netWorth())}</b></div></div>
  <h2>Investimentos e dívidas</h2>${list}<button class="btn main" data-act="new" style="margin-top:8px">+ Novo investimento / dívida</button>
  <p class="note">O valor atual é introduzido por ti. O dinheiro investido fica separado do disponível para gastar.</p>`;
}

// ---------- Formulários (folha inferior) ----------
function openSheet(html) { $('sheet').innerHTML = html; $('sheet-bg').hidden = false; }
function closeSheet() { $('sheet-bg').hidden = true; $('sheet').innerHTML = ''; }
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${Array.isArray(v) ? v[1] + ' ' + v[0] : v}</option>`).join('');
const accOpts = (sel, blank) => (blank ? '<option value="">Selecionar</option>' : '') + db.accounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
const goalOpts = sel => '<option value="">Nenhum</option>' + db.goals.map(g => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
const buttons = id => `<div class="btns">${id ? '<button class="btn del" data-act="delete">Apagar</button>' : ''}<button class="btn" data-act="cancel">Cancelar</button><button class="btn main" data-act="save">Guardar</button></div>`;
const val = n => document.querySelector(`#sheet [name=${n}]`).value;
let form = null;

function accountForm(id) {
  const a = id ? acc(id) : null; form = { type: 'account', id };
  openSheet(`<h3>${a ? 'Editar conta' : 'Nova conta'}</h3>
  <label>Nome</label><input name="name" placeholder="ex.: Banco principal" value="${a ? esc(a.name) : ''}">
  <label>Tipo</label><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${a?.kind === k ? 'selected' : ''}>${v[1]} ${v[0]}</option>`).join('')}</select>
  <label>${a ? 'Saldo inicial' : 'Saldo atual'} em €</label><input name="amount" inputmode="decimal" value="${a ? num(a.opening) : ''}">
  ${a ? `<div class="sub" style="margin:10px 4px">Saldo atual: <strong>${eur(balance(a))}</strong></div><button class="btn" data-act="history" style="width:100%">Ver movimentos desta conta</button>` : ''}
  ${buttons(id)}`);
}
function entryForm(id, preset) {
  const e = id ? db.entries.find(x => x.id === id) : null; form = { type: 'entry', id };
  const k = e?.kind || preset || 'expense';
  openSheet(`<h3>${e ? 'Editar movimento' : 'Novo movimento'}</h3>${entryFields(e, k)}${buttons(id)}`);
  form.kind = k; syncKind();
}
function entryFields(e, k, withRec) {
  return `<div class="seg" id="kseg">${Object.entries(ENTRY).map(([key, l]) => `<button data-kind="${key}" class="${key === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  ${withRec ? `<label>Nome</label><input name="name" placeholder="ex.: Ginásio" value="${e ? esc(e.name) : ''}">` : ''}
  <label>Valor em €</label><input name="amount" inputmode="decimal" value="${e ? num(e.amount) : ''}">
  <label>Conta</label><select name="account">${accOpts(e?.accountId || db.accounts[0]?.id)}</select>
  <div id="dest"><label>Conta de destino</label><select name="dest">${accOpts(e?.destId, true)}</select></div>
  <div id="cat"><label>Categoria</label><select name="category">${opts(CATS, e?.category || 'outros')}</select></div>
  <div id="goal"><label>Associar a um objetivo (opcional)</label><select name="goal">${goalOpts(e?.goalId)}</select></div>
  ${withRec ? '' : `<label>Descrição / notas (opcional)</label><input name="note" value="${e ? esc(e.note || '') : ''}">`}
  <label>${withRec ? 'Primeira data' : 'Data'}</label><input name="date" type="date" value="${e?.date || e?.next || today()}">`;
}
function syncKind() {
  $('dest').hidden = form.kind !== 'transfer'; $('cat').hidden = form.kind !== 'expense'; $('goal').hidden = form.kind === 'income';
  document.querySelectorAll('#kseg button').forEach(b => b.classList.toggle('on', b.dataset.kind === form.kind));
}
function budgetForm(id) {
  const b = id ? db.budgets.find(x => x.id === id) : null; form = { type: 'budget', id };
  openSheet(`<h3>${b ? 'Editar orçamento' : 'Novo orçamento'}</h3><label>Categoria</label><select name="category">${opts(CATS, b?.category || 'alimentacao')}</select>
  <label>Limite mensal em €</label><input name="amount" inputmode="decimal" value="${b ? num(b.limit) : ''}">${buttons(id)}`);
}
function goalForm(id) {
  const g = id ? db.goals.find(x => x.id === id) : null; form = { type: 'goal', id };
  openSheet(`<h3>${g ? 'Editar objetivo' : 'Novo objetivo'}</h3><label>Objetivo</label><input name="name" placeholder="ex.: Bicicleta de triatlo" value="${g ? esc(g.name) : ''}">
  <label>Valor pretendido em €</label><input name="target" inputmode="decimal" value="${g ? num(g.target) : ''}">
  <label>Já tenho poupado em €</label><input name="saved" inputmode="decimal" value="${g ? num(g.saved) : '0'}">
  <label>Prazo (opcional)</label><input name="deadline" type="date" value="${g?.deadline || ''}">${buttons(id)}`);
}
function recForm(id) {
  const r = id ? db.recurring.find(x => x.id === id) : null; form = { type: 'rec', id };
  if (!db.accounts.length) return alert('Adiciona primeiro uma conta.');
  openSheet(`<h3>${r ? 'Editar recorrente' : 'Nova recorrente'}</h3>${entryFields(r, r?.kind || 'expense', true)}
  <label>Periodicidade</label><select name="freq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${r?.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <label>Estado</label><select name="active"><option value="1">Ativa</option><option value="0" ${r && !r.active ? 'selected' : ''}>Pausada</option></select>
  <div class="sub" style="margin:8px 4px">O movimento é criado automaticamente em cada data (datas passadas são criadas já).</div>${buttons(id)}`);
  form.kind = r?.kind || 'expense'; syncKind();
}
function invForm(id) {
  const i = id ? db.invest.find(x => x.id === id) : null; form = { type: 'inv', id };
  openSheet(`<h3>${i ? 'Editar' : 'Novo investimento / dívida'}</h3><label>Nome</label><input name="name" placeholder="ex.: ETF Mundo" value="${i ? esc(i.name) : ''}">
  <label>Tipo</label><select name="type">${Object.entries(INV).map(([k, v]) => `<option value="${k}" ${i?.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <label>Capital investido em € (ignora nas dívidas)</label><input name="invested" inputmode="decimal" value="${i ? num(i.invested) : '0'}">
  <label>Valor atual em € (ou valor em dívida)</label><input name="current" inputmode="decimal" value="${i ? num(i.current) : ''}">${buttons(id)}`);
}

function saveForm() {
  const { type, id } = form;
  if (type === 'account') {
    const name = val('name').trim(), amount = parseMoney(val('amount'));
    if (!name || amount === null) return alert('Indica o nome e um saldo válido (ex.: 120,50).');
    if (id) Object.assign(acc(id), { name, kind: val('kind'), opening: amount }); else db.accounts.push({ id: uid(), name, kind: val('kind'), opening: amount });
  } else if (type === 'entry' || type === 'rec') {
    const amount = parseMoney(val('amount')), kind = form.kind, isRec = type === 'rec';
    if (!amount) return alert('Indica um valor maior que zero.');
    if (isRec && !val('name').trim()) return alert('Indica um nome.');
    if (kind === 'transfer' && (!val('dest') || val('dest') === val('account'))) return alert('Escolhe uma conta de destino diferente da conta de origem.');
    const base = { kind, amount, accountId: val('account'), destId: kind === 'transfer' ? val('dest') : null, category: kind === 'expense' ? val('category') : 'outros', goalId: kind !== 'income' && val('goal') ? val('goal') : null };
    if (isRec) {
      const next = val('date') || today(), r = { id: id || uid(), name: val('name').trim(), ...base, freq: val('freq'), next, day: +next.slice(8, 10), active: val('active') === '1' };
      if (id) { const old = db.recurring.find(x => x.id === id); r.day = next === old.next ? old.day : r.day; db.recurring[db.recurring.findIndex(x => x.id === id)] = r; } else db.recurring.push(r);
      applyRecurring();
    } else {
      const old = id ? db.entries.find(x => x.id === id) : null;
      const e = { id: id || uid(), date: val('date') || today(), note: val('note').trim(), recId: old?.recId || null, ...base };
      if (id) db.entries[db.entries.findIndex(x => x.id === id)] = e; else db.entries.push(e);
    }
  } else if (type === 'budget') {
    const limit = parseMoney(val('amount')), category = val('category');
    if (!limit) return alert('Indica um limite maior que zero.');
    db.budgets = db.budgets.filter(b => b.category !== category && b.id !== id); db.budgets.push({ id: id || uid(), category, limit });
  } else if (type === 'goal') {
    const name = val('name').trim(), target = parseMoney(val('target')), saved = parseMoney(val('saved'));
    if (!name || !target || saved === null) return alert('Preenche o nome e valores válidos.');
    const old = id ? db.goals.find(x => x.id === id) : null, s = Math.min(saved, target);
    const g = { id: id || uid(), name, target, saved: s, deadline: val('deadline'), created: old?.created || today(), base: old ? old.base : s };
    if (id) db.goals[db.goals.findIndex(x => x.id === id)] = g; else db.goals.push(g);
  } else if (type === 'inv') {
    const name = val('name').trim(), invested = parseMoney(val('invested')), current = parseMoney(val('current'));
    if (!name || invested === null || current === null) return alert('Preenche o nome e valores válidos.');
    const i = { id: id || uid(), name, type: val('type'), invested, current };
    if (id) db.invest[db.invest.findIndex(x => x.id === id)] = i; else db.invest.push(i);
  }
  save(); closeSheet(); render();
}

function deleteForm() {
  const { type, id } = form;
  if (type === 'account') {
    if (db.entries.some(e => e.accountId === id || e.destId === id) || db.recurring.some(r => r.accountId === id || r.destId === id)) return alert('Esta conta tem movimentos ou regras recorrentes. Apaga ou altera primeiro esses registos.');
    if (!confirm('Apagar esta conta?')) return;
    db.accounts = db.accounts.filter(a => a.id !== id);
  } else {
    if (!confirm('Apagar?')) return;
    const key = { entry: 'entries', budget: 'budgets', goal: 'goals', rec: 'recurring', inv: 'invest' }[type];
    db[key] = db[key].filter(x => x.id !== id);
    if (type === 'goal') { db.entries.forEach(e => { if (e.goalId === id) e.goalId = null; }); db.recurring.forEach(r => { if (r.goalId === id) r.goalId = null; }); }
  }
  save(); closeSheet(); render();
}

// ---------- Cópia de segurança ----------
function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const f = new File([blob], `poupanca-${today()}.json`, { type: 'application/json' });
  // Com a folha de partilha, só conta como cópia se o utilizador a concluir (cancelar rejeita a promessa).
  if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).then(markBackup).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); markBackup();
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = normalize(JSON.parse(r.result));
      if (!confirm(`Importar ${d.accounts.length} conta(s) e ${d.entries.length} movimento(s)? Isto substitui os dados atuais.`)) return;
      db = d; save(); applyRecurring(); render();
    } catch (e) { alert('Ficheiro inválido.'); }
  };
  r.readAsText(file);
}

// ---------- Eventos ----------
function go(t) { tab = t; try { localStorage.setItem('poupanca-tab', tab); } catch (e) {} render(); }
document.addEventListener('click', ev => {
  const t = ev.target.closest('button, b[data-edit-goal]');
  if (!t) { if (ev.target.id === 'sheet-bg') closeSheet(); return; }
  const d = t.dataset, add = () => ({ entries: entryForm, budgets: budgetForm, goals: goalForm, accounts: () => ({ accounts: accountForm, rec: recForm, inv: invForm }[ui.seg])() }[tab])();
  if (d.tab) go(d.tab);
  else if (t.id === 'add') add();
  else if (d.quick) entryForm(null, d.quick);
  else if (d.seg) { ui.seg = d.seg; render(true); }
  else if (d.editEntry) entryForm(d.editEntry);
  else if (d.editBudget) budgetForm(d.editBudget);
  else if (d.editGoal) goalForm(d.editGoal);
  else if (d.editAccount) accountForm(d.editAccount);
  else if (d.editRec) recForm(d.editRec);
  else if (d.editInv) invForm(d.editInv);
  else if (d.goalStep) { const g = db.goals.find(x => x.id === d.goalStep); g.saved = Math.max(g.saved + Number(d.d), 0); save(); render(true); }
  else if (d.kind) { form.kind = d.kind; syncKind(); }
  else if (d.act === 'new') add();
  else if (d.act === 'cancel') closeSheet();
  else if (d.act === 'save') saveForm();
  else if (d.act === 'delete') deleteForm();
  else if (d.act === 'history') { ui.f = { month: '', cat: '', acc: form.id, q: '' }; closeSheet(); go('entries'); }
  else if (d.pin) pinKey(d.pin);
  else if (d.act === 'pin-set') showLock('set1', () => render(true));
  else if (d.act === 'pin-change') showLock('verify', () => showLock('set1', () => render(true)));
  else if (d.act === 'pin-remove') showLock('verify', () => { localStorage.removeItem(PINKEY); render(true); });
  else if (d.act === 'pin-cancel') hideLock();
  else if (d.act === 'pin-forgot') { if (confirm('Esqueceste o PIN? Para entrar tens de apagar TODOS os dados deste telemóvel (só recuperas com uma cópia de segurança). Apagar?')) { [KEY, 'poupanca-v1', PINKEY, LOCKKEY].forEach(k => localStorage.removeItem(k)); location.reload(); } }
  else if (d.act === 'export') exportData();
  else if (d.act === 'import') $('file').click();
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'file' && t.files[0]) importData(t.files[0]);
  else if (t.dataset.f) { ui.f[t.dataset.f] = t.value; render(true); }
});
document.addEventListener('input', ev => { if (ev.target.id === 'q') { ui.f.q = ev.target.value; $('elist').innerHTML = entriesList(); } });
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (getPin() && $('lock').hidden && Date.now() - hiddenAt > 30000) { closeSheet(); showLock('unlock'); }
  applyRecurring(); if ($('sheet-bg').hidden) render(true);
});

// ---------- PIN ----------
const PINKEY = 'poupanca-pin', LOCKKEY = 'poupanca-lockuntil', PINLEN = 6;
function getPin() { try { return JSON.parse(localStorage.getItem(PINKEY)); } catch (e) { return null; } }
async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
}
let L = { mode: '', buf: '', first: '', msg: '', fails: 0, onOk: null, busy: false };
function showLock(mode, onOk) { L = { mode, buf: '', first: '', msg: '', fails: 0, onOk, busy: false }; $('lock').hidden = false; drawLock(); }
function hideLock() { $('lock').hidden = true; $('lock').innerHTML = ''; }
function drawLock() {
  const t = { unlock: 'Introduz o PIN', verify: 'Introduz o PIN atual', set1: 'Escolhe um PIN de 6 dígitos', set2: 'Repete o PIN' }[L.mode];
  $('lock').innerHTML = `<div class="lockbox"><div class="lockico">🔒</div><h2>${t}</h2><div class="dots">${Array.from({ length: PINLEN }, (_, i) => `<i class="${i < L.buf.length ? 'on' : ''}"></i>`).join('')}</div><div class="lockmsg">${L.msg}</div>
  <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-pin="${n}">${n}</button>`).join('')}<span></span><button data-pin="0">0</button><button data-pin="del" aria-label="Apagar">⌫</button></div>
  ${L.mode === 'unlock' ? '<button class="linkbtn" data-act="pin-forgot">Esqueci-me do PIN</button>' : '<button class="linkbtn" data-act="pin-cancel">Cancelar</button>'}</div>`;
}
async function pinKey(k) {
  if (L.busy) return;
  const until = +localStorage.getItem(LOCKKEY) || 0;
  if ((L.mode === 'unlock' || L.mode === 'verify') && until > Date.now()) { L.msg = `Demasiadas tentativas. Espera ${Math.ceil((until - Date.now()) / 1000)} s.`; L.buf = ''; return drawLock(); }
  L.msg = ''; L.buf = k === 'del' ? L.buf.slice(0, -1) : (L.buf + k).slice(0, PINLEN);
  drawLock(); if (L.buf.length < PINLEN) return;
  L.busy = true; const pin = L.buf;
  try {
    if (L.mode === 'set1') { L.first = pin; L.mode = 'set2'; L.buf = ''; }
    else if (L.mode === 'set2') {
      if (pin === L.first) {
        const salt = uid(); localStorage.setItem(PINKEY, JSON.stringify({ salt, hash: await hashPin(pin, salt) }));
        const ok = L.onOk; hideLock(); L.busy = false; return ok && ok();
      }
      L.msg = 'Os PINs não coincidem. Tenta outra vez.'; L.mode = 'set1'; L.buf = '';
    } else {
      const saved = getPin();
      if (saved && (await hashPin(pin, saved.salt)) === saved.hash) { localStorage.removeItem(LOCKKEY); const ok = L.onOk; hideLock(); L.busy = false; return ok && ok(); }
      L.fails++; L.buf = ''; L.msg = 'PIN errado.';
      if (L.fails >= 5) { localStorage.setItem(LOCKKEY, String(Date.now() + 30000)); L.fails = 0; L.msg = 'Demasiadas tentativas. Espera 30 s.'; }
    }
  } catch (e) { L.msg = 'Erro ao verificar o PIN.'; L.buf = ''; }
  L.busy = false; drawLock();
}

// Bloqueia o zoom por pinça no iOS (o toque duplo é tratado por touch-action: manipulation no CSS).
['gesturestart', 'gesturechange', 'gestureend'].forEach(g => document.addEventListener(g, e => e.preventDefault()));

db = load();
if (getPin()) showLock('unlock');
applyRecurring();
render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
