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
// Se os dados guardados estiverem danificados, a app não os substitui em silêncio:
// guarda uma cópia à parte, avisa, e permite exportá-la para tentar recuperar.
let corruptRaw = null;
let lastRaw = null; // último conteúdo lido ou gravado por esta janela
const BACKUP_KEYS = ['accounts', 'entries', 'budgets', 'goals', 'recurring', 'invest'];
const UNDOKEY = 'poupanca-before-import';
function quarantine(raw) {
  corruptRaw = raw;
  try {
    localStorage.setItem('poupanca-corrupt-' + Date.now(), raw);
    Object.keys(localStorage).filter(k => k.startsWith('poupanca-corrupt-')).sort().slice(0, -3).forEach(k => localStorage.removeItem(k)); // guarda as 3 mais recentes
  } catch (e) {}
}
function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); if (raw === null) raw = localStorage.getItem('poupanca-v1'); } catch (e) {}
  if (raw === null) return empty();
  try {
    const d = JSON.parse(raw);
    if (d && typeof d === 'object' && Array.isArray(d.accounts)) { lastRaw = raw; return normalize(d); }
  } catch (e) {}
  quarantine(raw);
  return empty();
}
function save() { try { const raw = JSON.stringify(db); localStorage.setItem(KEY, raw); lastRaw = raw; } catch (e) { toast('Não foi possível guardar os dados.'); } }
// Se outra janela/separador gravou entretanto, lê o que lá está (senão a próxima gravação apagava essas alterações).
function syncFromStorage() {
  let raw = null; try { raw = localStorage.getItem(KEY); } catch (e) { return; }
  if (raw === null || raw === lastRaw) return;
  try { const d = JSON.parse(raw); if (d && typeof d === 'object' && Array.isArray(d.accounts)) { db = normalize(d); lastRaw = raw; render(true); } } catch (e) {}
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// Aceita dados da versão anterior e o financas.json da app Swift (datas em segundos desde 2001, nomes em português).
let normFixes = 0; // datas inválidas corrigidas na última normalização
function normalize(d) {
  normFixes = 0;
  // tipos de conta: aceita as chaves, os nomes em português e variantes (maiúsculas, acentos); o resto vira conta à ordem
  const kindWords = { ordem: 'ordem', 'conta a ordem': 'ordem', banco: 'ordem', poupanca: 'poupanca', carteira: 'carteira', dinheiro: 'carteira', 'dinheiro fisico': 'carteira', investimento: 'investimento', investimentos: 'investimento' };
  const kindMap = new Proxy({}, { get: (_, k) => kindWords[norm(String(k)).trim()] });
  const entryMap = { Entrada: 'income', Despesa: 'expense', 'Transferência': 'transfer' };
  const catMap = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [v[0], k])); catMap.Casa = 'habitacao'; catMap.casa = 'habitacao';
  const cat = c => (CATS[c] ? c : catMap[c] || 'outros');
  const num0 = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  // ids só com letras, números, _ e - (impede código injetado através de um ficheiro alterado)
  const sid = v => String(v ?? '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64) || null;
  const id = v => sid(v) || uid();
  // só datas reais do calendário: dia a mais no mês (30/02) passa ao último dia do mês; o resto é inválido
  const dateOk = x => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x));
    const y = m ? +m[1] : 0, mo = m ? +m[2] : 0, dd = m ? +m[3] : 0;
    if (!m || y < 1900 || y > 2200 || mo < 1 || mo > 12 || dd < 1) { if (x) normFixes++; return ''; }
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    if (dd > last) { normFixes++; return `${m[1]}-${m[2]}-${String(last).padStart(2, '0')}`; }
    return String(x);
  };
  // datas da app Swift (segundos desde 2001): converte para o dia no fuso do telemóvel
  const date = x => (typeof x === 'number' ? ymd(new Date((x + 978307200) * 1000)) : dateOk(String(x).slice(0, 10)) || today());
  const str = (v, d) => String(v ?? '').slice(0, 200) || d;
  const t = today();
  const objs = v => (Array.isArray(v) ? v : []).filter(x => x && typeof x === 'object' && !Array.isArray(x)); // ignora itens que não são objetos (ex.: null)
  const pick = (v, table, dflt) => (table[v] ? v : dflt);
  return {
    accounts: objs(d.accounts).map(a => ({ id: id(a.id), name: str(a.name, 'Conta'), kind: pick(kindMap[a.kind] || a.kind, KINDS, 'ordem'), opening: num0(a.opening ?? a.openingBalance) })),
    entries: objs(d.entries).map(e => ({ id: id(e.id), date: date(e.date), kind: pick(entryMap[e.kind] || e.kind, ENTRY, 'expense'), amount: Math.abs(num0(e.amount)), accountId: sid(e.accountId ?? e.accountID), destId: sid(e.destId ?? e.destinationID), category: cat(e.category), note: str(e.note, ''), goalId: sid(e.goalId), recId: sid(e.recId) })),
    budgets: objs(d.budgets).map(b => ({ id: id(b.id), category: cat(b.category), limit: Math.abs(num0(b.limit ?? b.monthlyLimit)) })),
    goals: objs(d.goals).map(g => ({ id: id(g.id), name: str(g.name, 'Objetivo'), target: Math.abs(num0(g.target)), saved: Math.abs(num0(g.saved)), deadline: dateOk(g.deadline), created: dateOk(g.created) || t, base: Math.abs(num0(g.base ?? g.saved)) })),
    recurring: objs(d.recurring).map(r => { const next = dateOk(r.next) || t; return { id: id(r.id), name: str(r.name, 'Recorrente'), kind: pick(r.kind, ENTRY, 'expense'), amount: Math.abs(num0(r.amount)), accountId: sid(r.accountId), destId: sid(r.destId), category: cat(r.category), goalId: sid(r.goalId), freq: pick(r.freq, FREQ, 'monthly'), next, day: Math.min(Math.max(Math.round(num0(r.day)) || +next.slice(8, 10), 1), 31), active: r.active !== false }; }),
    invest: objs(d.invest).map(i => ({ id: id(i.id), name: str(i.name, 'Investimento'), type: pick(i.type, INV, 'outro'), invested: Math.abs(num0(i.invested)), current: Math.abs(num0(i.current)) })),
  };
}

// ---------- Utilitários ----------
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const VERSION = 'v22';
const fmtEur = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
// Modo privado: valores escondidos; só aparecem enquanto manténs o dedo premido no olho.
// Assim, ao sair da app (e o iOS tirar a imagem do seletor de apps) nunca há valores à vista.
const PRIVKEY = 'poupanca-privacy';
let reveal = false;
const privacyOn = () => { try { return localStorage.getItem(PRIVKEY) !== '0'; } catch (e) { return true; } };
const masked = () => privacyOn() && !reveal;
const eur = n => (masked() ? '••••' : fmtEur.format(n).replace(/\u2212/g, '-'));
function setReveal(on) { if (reveal === on) return; reveal = on; render(true); }
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => ymd(new Date());
const parseD = s => new Date(s + 'T12:00:00');
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = s => parseD(s).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });
const monthName = (ym, long) => new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1).toLocaleDateString('pt-PT', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
const addMonthKey = (ym, n) => { const d = new Date(+ym.slice(0, 4), +ym.slice(5, 7) - 1 + n, 1); return ymd(d).slice(0, 7); };
const num = n => String(n).replace('.', ',');
const pct = n => `${(Math.round(n * 10) / 10).toString().replace('.', ',')}%`;

// Aceita 12,50, 12.50 e 1.600,50 (ponto dos milhares); sem negativos, salvo se allowNeg.
function parseMoney(raw, allowNeg = false) {
  let t = String(raw).replace(/\s/g, ''), sgn = 1;
  if (allowNeg && /^[-−]/.test(t)) { sgn = -1; t = t.slice(1); }
  let n = null;
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.')); // 1.600 ou 1.600,50
  else if (/^\d+([.,]\d{1,2})?$/.test(t)) n = Number(t.replace(',', '.')); // 12,50 ou 12.50
  return n === null || !Number.isFinite(n) ? null : sgn * n;
}

const acc = id => db.accounts.find(a => a.id === id);
function balance(a) {
  const t = today();
  return db.entries.reduce((b, e) => {
    if (e.date > t) return b; // movimentos agendados só contam a partir da data
    if (e.kind === 'transfer') return e.accountId === a.id ? b - e.amount : e.destId === a.id ? b + e.amount : b;
    if (e.accountId !== a.id) return b;
    return b + (e.kind === 'income' ? e.amount : -e.amount);
  }, a.opening);
}
const sumKinds = kinds => db.accounts.filter(a => kinds.includes(a.kind)).reduce((s, a) => s + balance(a), 0);
const isSpend = id => ['ordem', 'carteira'].includes(acc(id)?.kind);
const spendable = () => sumKinds(['ordem', 'carteira']);
const savingsTotal = () => sumKinds(['poupanca']);
const investedAccounts = () => sumKinds(['investimento']);
const assets = () => db.invest.filter(i => i.type !== 'divida').reduce((s, i) => s + i.current, 0);
const debts = () => db.invest.filter(i => i.type === 'divida').reduce((s, i) => s + i.current, 0);
const netWorth = () => spendable() + savingsTotal() + investedAccounts() + assets() - debts();

const curMonth = () => today().slice(0, 7);
// só conta movimentos até hoje (os agendados entram na previsão, não no que já aconteceu)
const sumEntries = (kind, ym, cat, upToDay, t = today()) => db.entries
  .filter(e => e.kind === kind && e.date <= t && e.date.startsWith(ym) && (!cat || e.category === cat) && (!upToDay || +e.date.slice(8, 10) <= upToDay))
  .reduce((s, e) => s + e.amount, 0);
// mais recente primeiro; no mesmo dia, o último registado aparece em cima
const pctOf = p => (p < 1 ? Math.min(99, Math.round(p * 100)) : Math.round(p * 100));
const byDate = list => list.map((e, i) => [e, i]).sort((a, b) => b[0].date.localeCompare(a[0].date) || b[1] - a[1]).map(x => x[0]);

// ---------- Recorrentes ----------
function advance(rec) {
  const d = parseD(rec.next);
  if (rec.freq === 'weekly') { d.setDate(d.getDate() + 7); return ymd(d); }
  const y = d.getFullYear(), m = d.getMonth() + (rec.freq === 'yearly' ? 12 : 1);
  return ymd(new Date(y, m, Math.min(rec.day, new Date(y, m + 1, 0).getDate()), 12));
}
function applyRecurring() {
  let changed = false;
  // datas já lançadas por cada regra: ao editar a data de uma regra para trás não se duplicam movimentos
  const done = new Set(db.entries.filter(e => e.recId).map(e => e.recId + '|' + e.date));
  for (const r of db.recurring) {
    if (!r.active || !acc(r.accountId)) continue;
    let guard = 0;
    while (r.next <= today() && guard++ < 400) {
      if (!done.has(r.id + '|' + r.next)) db.entries.push({ id: uid(), date: r.next, kind: r.kind, amount: r.amount, accountId: r.accountId, destId: r.destId || null, category: r.category || 'outros', note: r.name, goalId: r.goalId || null, recId: r.id });
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
  // Transferência associada soma ao objetivo; despesa associada retira (gasto a partir do que estava poupado).
  const contrib = db.entries.filter(e => e.goalId === g.id && e.date <= today()).reduce((s, e) => s + (e.kind === 'expense' ? -e.amount : e.amount), 0);
  const saved = Math.max(g.saved + contrib, 0), remaining = Math.max(g.target - saved, 0), p = Math.min(saved / Math.max(g.target, .01), 1);
  const info = { saved, remaining, p, contrib, need: null, status: '', tone: '' };
  if (remaining === 0) { info.status = 'Concluído ✅'; info.tone = 'pos'; return info; }
  if (g.deadline) {
    const days = (parseD(g.deadline) - parseD(today())) / 864e5;
    if (days < 0) { info.status = 'Prazo ultrapassado'; info.tone = 'neg'; return info; } // sem «poupança mensal necessária»: já não há meses
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
    else if (p >= .8) out.push(['warn', `Já gastaste ${pctOf(p)}% do teu orçamento de ${CATS[b.category][0]}.`]);
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
const ui = { f: { month: '', cat: '', acc: '', q: '' }, seg: 'accounts', view: 'list' };
const $ = id => document.getElementById(id);

function render(keepScroll) {
  $('tabs').innerHTML = TABS.map(([k, l, i]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('');
  $('title').textContent = tab === 'home' ? 'Poupança' : TABS.find(t => t[0] === tab)[1];
  $('eye').hidden = !privacyOn(); $('eye').textContent = reveal ? '🙈' : '👁️'; $('eye').setAttribute('aria-pressed', String(reveal));
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
  const sg = e.kind === 'expense' ? '-' : e.kind === 'income' ? '+' : '';
  return `<button class="item" data-edit-entry="${e.id}"><div class="ico">${ico}</div><div class="grow"><div>${esc(name)}${e.recId ? ' 🔁' : ''}</div><div class="sub">${fmtDate(e.date)}${e.date > today() ? ' · agendado' : ''} · ${where}</div></div><div class="amt ${e.kind === 'income' ? 'pos' : ''}">${sg}${eur(e.amount)}</div></button>`;
}

function home() {
  const ym = curMonth(), prev = addMonthKey(ym, -1);
  const inc = sumEntries('income', ym), exp = sumEntries('expense', ym), day0 = +today().slice(8, 10), pInc = sumEntries('income', prev, null, day0), pExp = sumEntries('expense', prev, null, day0);
  const rate = inc > 0 ? ((inc - exp) / inc) * 100 : null;
  const delta = (cur, p, goodUp) => {
    if (!p) return '<small class="sub">sem dados do mês anterior</small>';
    const d = cur - p, good = goodUp ? d >= 0 : d <= 0;
    return `<small class="${good ? 'pos' : 'neg'}">${d >= 0 ? '▲' : '▼'} ${eur(Math.abs(d))} vs. mesmo período do mês anterior</small>`;
  };
  // efeito de um movimento no disponível: transferências para/da Poupança ou Investimento também contam
  const spendFx = x => x.kind === 'transfer' ? (isSpend(x.destId) ? x.amount : 0) - (isSpend(x.accountId) ? x.amount : 0) : isSpend(x.accountId) ? (x.kind === 'income' ? x.amount : -x.amount) : 0;
  const up = upcoming(monthEnd()).filter(u => spendFx(u.rec));
  const sched = db.entries.filter(e => e.date > today() && e.date <= monthEnd() && spendFx(e));
  const fc = spendable() + up.reduce((s, u) => s + spendFx(u.rec), 0) + sched.reduce((s, e) => s + spendFx(e), 0);
  const budgetLeft = db.budgets.reduce((s, b) => s + Math.max(b.limit - sumEntries('expense', ym, b.category), 0), 0);
  const al = alerts().slice(0, 5);
  const pts = monthEnds(6).map(m => ({ label: monthName(m.k), v: db.accounts.reduce((s, a) => s + a.opening, 0) + db.entries.filter(e => e.date <= m.end && e.kind !== 'transfer').reduce((s, e) => s + (e.kind === 'income' ? e.amount : -e.amount), 0) }));
  const ms = monthEnds(6).map(m => ({ label: monthName(m.k), inc: sumEntries('income', m.k), exp: sumEntries('expense', m.k) }));
  const cats = Object.keys(CATS).map(c => [c, sumEntries('expense', ym, c)]).filter(c => c[1] > 0).sort((a, b) => b[1] - a[1]);
  const last = byDate(db.entries).slice(0, 5);

  return `<div class="hero"><small>DISPONÍVEL PARA GASTAR</small><b>${eur(spendable())}</b><div>Património líquido: <strong>${eur(netWorth())}</strong></div></div>
  ${db.accounts.length ? `<div class="card qa"><div class="qarow"><input id="qa" aria-label="Registo rápido" placeholder="Registo rápido: 12,50 café" enterkeyhint="done" autocomplete="off"><button class="btn main" data-act="qa">Registar</button></div><div class="sub" style="margin-top:6px">Ex.: «gastei 30 no supermercado», «recebi 1500 salário», «transferi 100 para Poupança». Confirmas antes de guardar.</div></div>` : ''}
  ${db.accounts.length ? `<div class="row2"><button class="btn main" data-quick="expense">- Adicionar despesa</button><button class="btn main alt" data-quick="income">+ Adicionar receita</button></div>` : ''}
  <div class="row2" style="margin-top:12px">
    <div class="card metric"><span class="pos">↙</span><small>Receitas de ${monthName(ym)}</small><b>${eur(inc)}</b>${delta(inc, pInc, true)}</div>
    <div class="card metric"><span style="color:var(--orange)">↗</span><small>Despesas de ${monthName(ym)}</small><b>${eur(exp)}</b>${delta(exp, pExp, false)}</div>
  </div>
  <div class="card"><div class="between"><b>Taxa de poupança</b><b class="${rate !== null && rate < 0 ? 'neg' : 'pos'}">${rate === null ? '-' : pct(rate)}</b></div>${rate === null ? '' : bar(rate / 100, rate < 0 ? 'over' : '')}
    <div class="sub">${rate === null ? 'Regista uma receita este mês para calcular.' : `Este mês poupaste ${eur(inc - exp)} de ${eur(inc)} recebidos.`}</div></div>
  <div class="card"><div class="between"><b>Previsão do saldo no fim do mês</b><b>${eur(fc)}</b></div>
    <div class="sub">Saldo atual + recorrentes e movimentos agendados até ${fmtDate(monthEnd())}${up.length + sched.length ? ` (${up.length + sched.length} movimento${up.length + sched.length > 1 ? 's' : ''})` : ''}.</div>
    ${db.budgets.length ? `<div class="sub" style="margin-top:6px">Ainda tens <strong>${eur(budgetLeft)}</strong> por gastar nos orçamentos deste mês.</div>` : ''}</div>
  ${al.length ? `<h2>Alertas</h2>${al.map(([t, m]) => `<div class="alert ${t}">${m}</div>`).join('')}` : ''}
  <h2>Património</h2>
  <div class="card kv"><div><span>Disponível</span><b>${eur(spendable())}</b></div><div><span>Poupança</span><b>${eur(savingsTotal())}</b></div><div><span>Investido</span><b>${eur(investedAccounts() + assets())}</b></div><div><span>Dívidas</span><b class="${debts() ? 'neg' : ''}">${debts() ? '-' : ''}${eur(debts())}</b></div><div class="tot"><span>Património líquido</span><b>${eur(netWorth())}</b></div></div>
  <h2>Evolução do saldo</h2><div class="card">${db.entries.length || db.accounts.length ? lineChart(pts) : '<p class="sub">Sem dados ainda.</p>'}</div>
  ${db.accounts.length ? '<button class="item linkcard" data-act="open-analysis"><div class="ico">📈</div><div class="grow"><div>Ver análise completa</div><div class="sub">Saldo dia a dia, receitas, despesas e categorias</div></div><span aria-hidden="true">›</span></button>' : ''}
  <h2>Receitas vs. despesas</h2><div class="card">${groupedBars(ms)}</div>
  <h2>Despesas por categoria</h2>
  <div class="card">${cats.length ? cats.map(([c, v]) => `<div class="catrow"><span>${CATS[c][1]} ${CATS[c][0]}</span><span class="sub">${eur(v)} · ${Math.round((v / exp) * 100)}%</span></div>${bar(v / cats[0][1])}`).join('') : '<p class="sub">Ainda não há despesas este mês.</p>'}</div>
  ${db.goals.length ? `<h2>Objetivos</h2><div class="card">${db.goals.slice(0, 3).map(g => { const i = goalInfo(g); return `<div class="catrow"><span>${esc(g.name)}</span><span class="sub">${Math.floor(i.p * 100)}%</span></div>${bar(i.p)}`; }).join('')}</div>` : ''}
  <h2>As minhas contas</h2>${db.accounts.length ? `<div class="list">${db.accounts.map(a => `<div class="item"><div class="ico">${KINDS[a.kind][1]}</div><div class="grow"><div>${esc(a.name)}</div><div class="sub">${KINDS[a.kind][0]}</div></div><div class="amt">${eur(balance(a))}</div></div>`).join('')}</div>` : emptyBox('🏦', 'Começa por adicionar uma conta no separador Contas, com o saldo do banco ou dinheiro.')}
  <h2>Últimos movimentos</h2>${last.length ? `<div class="list">${last.map(entryRow).join('')}</div>` : '<p class="note">Ainda não há movimentos.</p>'}`;
}

// --- Movimentos ---
function filtered() {
  const f = ui.f, q = norm(f.q.trim()), qn = f.q.trim().replace(/\s/g, '').replace(/\.(?=\d{3}(,|$))/g, '').replace('.', ',');
  const numQ = /^\d+(,\d*)?$/.test(qn);
  return byDate(db.entries).filter(e => (!f.month || e.date.startsWith(f.month)) && (!f.cat || e.category === f.cat && e.kind === 'expense') && (!f.acc || e.accountId === f.acc || e.destId === f.acc)
    && (!q || norm(e.note || '').includes(q) || norm(CATS[e.category]?.[0] || '').includes(q) || norm(acc(e.accountId)?.name || '').includes(q)
      || (numQ && [String(e.amount).replace('.', ','), e.amount.toFixed(2).replace('.', ',')].some(a => a.includes(qn)))));
}
function entriesList() {
  const l = filtered(), T = today(), past = l.filter(e => e.date <= T), future = l.length - past.length; // os agendados não entram nos totais
  const inc = past.filter(e => e.kind === 'income').reduce((s, e) => s + e.amount, 0), exp = past.filter(e => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  if (!l.length) return emptyBox('🔍', db.entries.length ? 'Nenhum movimento com estes filtros.' : 'Ainda não há movimentos. Toca em + para registar.');
  return `<div class="card kv"><div><span>Receitas</span><b class="pos">${eur(inc)}</b></div><div><span>Despesas</span><b>${eur(exp)}</b></div><div><span>Resultado</span><b class="${inc - exp < 0 ? 'neg' : 'pos'}">${eur(inc - exp)}</b></div></div>
  <div class="list">${l.map(entryRow).join('')}</div><p class="note">Toca num movimento para o editar ou apagar. 🔁 = criado por uma regra recorrente.${future ? ` ${future} movimento(s) agendado(s) (data futura) não entram nos totais.` : ''}</p>`;
}
function entries() {
  if (!db.accounts.length) return emptyBox('⇄', 'Adiciona primeiro uma conta no separador Contas.');
  const vseg = `<div class="seg" id="vseg" role="group" aria-label="Vista" style="margin-bottom:12px">${[['list', 'Movimentos'], ['analysis', 'Análise']].map(([k, l]) => `<button data-view="${k}" class="${ui.view === k ? 'on' : ''}" aria-pressed="${ui.view === k}">${l}</button>`).join('')}</div>`;
  if (ui.view === 'analysis') return vseg + (typeof analysisView === 'function' ? analysisView() : '<p class="note">Falta o ficheiro analise.js. Carrega-o junto com os restantes ficheiros da app.</p>');
  const months = [...new Set([curMonth(), ...db.entries.map(e => e.date.slice(0, 7))])].sort().reverse(), f = ui.f;
  return vseg + `<input id="q" type="search" aria-label="Pesquisar movimentos" placeholder="🔍 Pesquisar por descrição, valor ou categoria" value="${esc(f.q)}">
  <div class="filters"><select data-f="month" aria-label="Filtrar por mês"><option value="">Todos os meses</option>${months.map(m => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${monthName(m, true)}</option>`).join('')}</select>
  <select data-f="cat" aria-label="Filtrar por categoria"><option value="">Todas as categorias</option>${opts(CATS, f.cat)}</select>
  <select data-f="acc" aria-label="Filtrar por conta"><option value="">Todas as contas</option>${accOpts(f.acc)}</select></div>
  <div id="elist">${entriesList()}</div>`;
}

// --- Orçamentos ---
function budgets() {
  const ym = curMonth(), prev = addMonthKey(ym, -1);
  if (!db.budgets.length) {
    return `${emptyBox('📊', 'Define limites mensais por categoria e recebe alertas aos 80% e 100%.')}<button class="btn main" data-act="new">Criar o primeiro orçamento</button>`;
  }
  const tot = db.budgets.reduce((s, b) => s + b.limit, 0), totSpent = db.budgets.reduce((s, b) => s + sumEntries('expense', ym, b.category), 0);
  return `<div class="card"><div class="between"><b>Total em ${monthName(ym, true)}</b><span class="sub">${eur(totSpent)} / ${eur(tot)}</span></div>${bar(totSpent / Math.max(tot, .01), totSpent >= tot ? 'over' : totSpent >= tot * 0.8 ? 'warn' : '')}${totSpent >= tot * 0.8 ? `<div class="sub ${totSpent >= tot ? 'neg' : 'warnt'}">${pctOf(totSpent / Math.max(tot, .01))}% · ${totSpent >= tot ? 'Excedido' : 'Atenção'}</div>` : ''}</div>
  <div class="list">${db.budgets.map(b => {
    const s = sumEntries('expense', ym, b.category), p = s / Math.max(b.limit, .01), ps = sumEntries('expense', prev, b.category);
    const st = p >= 1 ? ['Excedido', 'neg'] : p >= .8 ? ['Atenção', 'warnt'] : ['Dentro do limite', 'pos'];
    return `<button class="item" data-edit-budget="${b.id}" style="display:block"><div class="between"><span>${CATS[b.category][1]} ${CATS[b.category][0]}</span><span class="sub">${eur(s)} / ${eur(b.limit)}</span></div>${bar(p, p >= 1 ? 'over' : p >= .8 ? 'warn' : '')}
    <div class="between sub"><span class="${st[1]}">${pctOf(p)}% · ${st[0]}</span><span>${ps ? 'Mês anterior: ' + eur(ps) : ''}</span></div></button>`;
  }).join('')}</div><p class="note">Toca num orçamento para o editar.</p>`;
}

// --- Objetivos ---
function goals() {
  if (!db.goals.length) {
    return `${emptyBox('🎯', 'Cria um objetivo com prazo e vê quanto precisas de poupar por mês.')}<button class="btn main" data-act="new">Criar o primeiro objetivo</button>`;
  }
  return db.goals.map(g => {
    const i = goalInfo(g);
    return `<div class="card"><div class="between"><b data-edit-goal="${g.id}" class="link">${esc(g.name)} ✎</b><span class="pos">${Math.floor(i.p * 100)}%</span></div>${bar(i.p)}
    <div class="kv2"><div><span>Pretendido</span><b>${eur(g.target)}</b></div><div><span>Já poupado</span><b>${eur(i.saved)}</b></div><div><span>Falta poupar</span><b>${eur(i.remaining)}</b></div>
    <div><span>Prazo</span><b>${g.deadline ? fmtDate(g.deadline) : '-'}</b></div></div>
    ${i.need !== null && i.remaining > 0 ? `<div class="sub">Poupança mensal necessária: <strong>${eur(i.need)}</strong></div>` : ''}
    ${i.status ? `<div class="${i.tone}" style="font-weight:600;margin-top:4px">${i.status}</div>` : ''}
    ${i.contrib ? `<div class="sub">Movimentos associados: ${i.contrib < 0 ? '-' : '+'}${eur(Math.abs(i.contrib))}</div>` : ''}
    <div class="step"><button data-goal-step="${g.id}" data-d="-10">-</button><span>Ajuste manual (±10 €)</span><button data-goal-step="${g.id}" data-d="10">+</button></div></div>`;
  }).join('') + '<p class="note">Uma transferência associada soma ao objetivo; uma despesa associada retira. O progresso atualiza sozinho.</p>';
}

// --- Contas / Recorrentes / Investimentos ---
function accounts() {
  const seg = `<div class="seg" id="aseg">${[['accounts', 'Contas'], ['rec', 'Recorrentes'], ['inv', 'Património']].map(([k, l]) => `<button data-seg="${k}" class="${ui.seg === k ? 'on' : ''}">${l}</button>`).join('')}</div><div style="height:12px"></div>`;
  if (ui.seg === 'rec') return seg + recurringView();
  if (ui.seg === 'inv') return seg + investView();
  const list = db.accounts.length
    ? `<div class="list">${db.accounts.map(a => `<button class="item" data-edit-account="${a.id}"><div class="ico">${KINDS[a.kind][1]}</div><div class="grow"><div>${esc(a.name)}</div><div class="sub">${KINDS[a.kind][0]}</div></div><div class="amt">${eur(balance(a))}</div></button>`).join('')}</div>`
    : emptyBox('💳', 'Toca em + para adicionar a primeira conta.');
  return `${seg}${list}<p class="note">Ao criar uma conta, escreve o saldo que tens hoje; depois o saldo muda com os movimentos. Para o acertar, edita o «saldo inicial» da conta (isto também muda o histórico). Transferências entre contas não contam como despesa. Toca numa conta para ver o histórico.</p>
  <h2>Cópia de segurança</h2><div class="card"><p class="sub" style="margin-top:0">Os dados ficam só neste telemóvel. Exporta uma cópia todos os meses e guarda o ficheiro num sítio seguro fora da app (iCloud ou Ficheiros no iPhone, Google Drive ou Ficheiros no Android).</p>
  <div class="alert ${backupStatus().tone}" style="margin:8px 0 0">${backupStatus().icon} ${backupStatus().text}</div>
  <div class="btns" style="margin-top:8px"><button class="btn" data-act="export">Exportar</button><button class="btn" data-act="import">Importar</button></div>${(() => { try { return localStorage.getItem(UNDOKEY) ? '<button class="btn" data-act="undo-import" style="width:100%;margin-top:8px">Desfazer a última importação</button>' : ''; } catch (e) { return ''; } })()}</div><input id="file" type="file" accept=".json,application/json" hidden>
  <h2>Segurança</h2><div class="card"><div class="between" style="margin-bottom:10px"><div><b>Modo privado</b><div class="sub">Esconde os valores (••••). Mantém o dedo premido no 👁️ para os ver; ao largares, escondem-se logo.</div></div><button class="btn ${privacyOn() ? 'main' : ''}" data-act="privacy" style="flex:none;padding:8px 14px">${privacyOn() ? 'Ligado' : 'Desligado'}</button></div>
  <div style="border-top:1px solid var(--line);padding-top:10px"></div><p class="sub" style="margin-top:0">${getPin() ? '🔒 PIN ativo. A app bloqueia ao abrir e depois de 30 segundos fora dela.' : 'Protege a app com um PIN de 6 dígitos. É um bloqueio de ecrã: impede que outra pessoa abra a app no teu telemóvel.'}</p>
  <div class="btns" style="margin-top:8px">${getPin() ? '<button class="btn" data-act="pin-change">Alterar PIN</button><button class="btn del" data-act="pin-remove">Remover PIN</button>' : '<button class="btn main" data-act="pin-set">Definir PIN</button>'}</div></div>
  <h2>Ajuda</h2><div class="card"><button class="btn" data-act="welcome" style="width:100%">Ver as boas-vindas e as dicas</button></div>
  <p class="note" style="text-align:center">Poupança ${VERSION}</p>`;
}
function recurringView() {
  // Recorrentes previstas + movimentos agendados (data futura) dos próximos 30 dias: os mesmos que a previsão do Início já conta.
  const prev = upcoming(plusDays(30)).map(u => ({ date: u.date, kind: u.rec.kind, name: u.rec.name, amount: u.rec.amount, tag: '' }));
  const ag = db.entries.filter(e => e.date > today() && e.date <= plusDays(30) && e.kind !== 'transfer').map(e => ({ date: e.date, kind: e.kind, name: e.note || (e.kind === 'expense' ? CATS[e.category]?.[0] : ENTRY[e.kind]), amount: e.amount, tag: ' · agendado' }));
  const prox = [...prev, ...ag].sort((a, b) => a.date.localeCompare(b.date)), out = prox.filter(u => u.kind === 'expense').reduce((s, u) => s + u.amount, 0), inn = prox.filter(u => u.kind === 'income').reduce((s, u) => s + u.amount, 0);
  const list = db.recurring.length ? `<div class="list">${db.recurring.map(r => `<button class="item" data-edit-rec="${r.id}"><div class="ico">${r.kind === 'income' ? '↙' : r.kind === 'transfer' ? '⇄' : CATS[r.category]?.[1] || '📦'}</div><div class="grow"><div>${esc(r.name)}${r.active ? '' : ' (pausada)'}</div><div class="sub">${FREQ[r.freq]} · próxima: ${fmtDate(r.next)}</div></div><div class="amt ${r.kind === 'income' ? 'pos' : ''}">${r.kind === 'expense' ? '-' : r.kind === 'income' ? '+' : ''}${eur(r.amount)}</div></button>`).join('')}</div>`
    : emptyBox('🔁', 'Regista salário, renda, ginásio, subscrições, seguros ou prestações. Os movimentos são criados automaticamente nas datas certas.');
  return `<div class="card kv"><div><span>A pagar (30 dias)</span><b>${eur(out)}</b></div><div><span>A receber (30 dias)</span><b class="pos">${eur(inn)}</b></div></div>
  ${prox.length ? `<h2>Próximos 30 dias</h2><div class="list">${prox.map(u => `<div class="item"><div class="ico">${u.kind === 'income' ? '↙' : '📅'}</div><div class="grow"><div>${esc(u.name)}</div><div class="sub">${fmtDate(u.date)}${u.tag}</div></div><div class="amt ${u.kind === 'income' ? 'pos' : ''}">${u.kind === 'expense' ? '-' : u.kind === 'income' ? '+' : ''}${eur(u.amount)}</div></div>`).join('')}</div>` : ''}
  <h2>Regras recorrentes</h2>${list}<button class="btn main" data-act="new" style="margin-top:8px">+ Nova recorrente</button>`;
}
function investView() {
  const list = db.invest.length ? `<div class="list">${db.invest.map(i => {
    const gain = i.current - i.invested, rp = i.invested ? (gain / i.invested) * 100 : null;
    return `<button class="item" data-edit-inv="${i.id}"><div class="ico">${i.type === 'divida' ? '💳' : '📈'}</div><div class="grow"><div>${esc(i.name)}</div><div class="sub">${INV[i.type]}${i.type !== 'divida' ? ` · investido ${eur(i.invested)}` : ''}</div></div>
    <div style="text-align:right"><div class="amt ${i.type === 'divida' ? 'neg' : ''}">${i.type === 'divida' ? '-' : ''}${eur(i.current)}</div>${i.type !== 'divida' && rp !== null ? `<div class="sub ${gain >= 0 ? 'pos' : 'neg'}">${gain >= 0 ? '+' : ''}${pct(rp)}</div>` : ''}</div></button>`;
  }).join('')}</div>` : emptyBox('📈', 'Regista ETFs, ações, cripto, depósitos, certificados de aforro e dívidas.');
  return `<div class="card kv"><div><span>Disponível</span><b>${eur(spendable())}</b></div><div><span>Poupança</span><b>${eur(savingsTotal())}</b></div><div><span>Investido</span><b>${eur(investedAccounts() + assets())}</b></div><div><span>Dívidas</span><b class="${debts() ? 'neg' : ''}">${debts() ? '-' : ''}${eur(debts())}</b></div><div class="tot"><span>Património líquido</span><b>${eur(netWorth())}</b></div></div>
  <h2>Investimentos e dívidas</h2>${list}<button class="btn main" data-act="new" style="margin-top:8px">+ Novo investimento / dívida</button>
  <p class="note">O valor atual é introduzido por ti. O dinheiro investido fica separado do disponível para gastar.</p>`;
}


// ---------- Registo rápido por texto (interpretado no telemóvel, nada sai daqui) ----------
const norm = t => t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/['’`´]/g, '');
const QKEYS = {
  restaurantes: ['cafe', 'restaurante', 'jantar', 'almoco', 'pizza', 'hamburguer', 'pastelaria', 'snack', 'sushi', 'bifana', 'pequeno almoco', 'lanche', 'gelado', 'cerveja', 'tasca', 'mcdonalds'],
  alimentacao: ['supermercado', 'mercearia', 'talho', 'peixaria', 'mercado', 'lidl', 'continente', 'aldi', 'minipreco', 'pingo doce', 'intermarche', 'padaria', 'fruta', 'compras do mes'],
  transportes: ['gasolina', 'gasoleo', 'combustivel', 'uber', 'bolt', 'comboio', 'metro', 'autocarro', 'passe', 'portagem', 'portagens', 'via verde', 'estacionamento', 'taxi', 'cp', 'carregamento'],
  habitacao: ['renda', 'condominio', 'luz', 'agua', 'gas', 'internet', 'eletricidade', 'casa', 'ikea', 'obras', 'seguro casa'],
  desporto: ['ginasio', 'futebol', 'padel', 'treino', 'desporto', 'piscina', 'corrida', 'inscricao', 'bicicleta', 'strava'],
  subscricoes: ['netflix', 'spotify', 'subscricao', 'disney', 'hbo', 'youtube', 'icloud', 'prime', 'chatgpt', 'claude', 'telemovel', 'mensalidade'],
  viagens: ['viagem', 'hotel', 'voo', 'aviao', 'booking', 'airbnb', 'ferias', 'hostel', 'ryanair'],
  lazer: ['cinema', 'bar', 'discoteca', 'jogo', 'jogos', 'concerto', 'lazer', 'festa', 'bilhete', 'livro', 'steam', 'playstation'],
  saude: ['farmacia', 'medico', 'dentista', 'consulta', 'saude', 'oculista', 'analises', 'medicamentos'],
  compras: ['zara', 'roupa', 'sapatos', 'amazon', 'aliexpress', 'compras', 'presente', 'prenda', 'worten', 'fnac'],
  investimentos: ['etf', 'acoes', 'cripto', 'bitcoin', 'investimento'],
};
// Raízes dos verbos, para apanhar todas as formas (transferi, transferir, transferência…).
const INCOME_RE = /(^|[^a-z0-9])(receb\w*|ganh\w*|vend\w*|salario|ordenado|reembols\w*|devolu\w*|mesada|premio|subsidio|rendimento|bonus)([^a-z0-9]|$)/;
const TRANSFER_RE = /(^|[^a-z0-9])(transfer\w*|pass(ei|ar|o)|mand(ei|ar)|deposit(ei|ar)|levant(ei|ar)|poup(ei|ar)|guard(ei|ar)|envi(ei|ar))([^a-z0-9]|$)/;
const FILLER = new Set(['quero', 'queria', 'vou', 'preciso', 'transferir', 'transferencia', 'transferencias', 'passar', 'mandar', 'depositar', 'levantar', 'poupar', 'poupei', 'guardar', 'guardei', 'enviar', 'enviei', 'receber', 'recebimento', 'gastar', 'pagar', 'comprar', 'gastei', 'gasto', 'gastos', 'paguei', 'pago', 'comprei', 'recebi', 'ganhei', 'transferi', 'passei', 'mandei', 'depositei', 'levantei', 'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas', 'em', 'num', 'numa', 'um', 'uma', 'para', 'com', 'a', 'o', 'as', 'os', 'por', 'euro', 'euros', 'eur', '+', '-', 'ontem', 'anteontem', 'hoje']);
const hasWord = (n, k) => new RegExp('(^|[^a-z0-9])' + k + 's?([^a-z0-9]|$)').test(n); // aceita o plural («cafés»)

function parseQuick(raw) {
  const text = raw.trim(), n = norm(text);
  const re = /\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?/g;
  const cands = [...text.matchAll(re)].map(x => ({ str: x[0], i: x.index, val: Number(x[0].replace(/\.(?=\d{3}(,|$))/g, '').replace(',', '.')) })).filter(c => Number.isFinite(c.val) && c.val > 0);
  if (!cands.length) return null;
  // vários números («2 cafés 3,50»): o que tem € ou «euros», senão o que tem decimais, senão o maior
  const near = c => /^\s*(€|eur\b|euro)/i.test(text.slice(c.i + c.str.length)) || /€\s*$/.test(text.slice(0, c.i));
  const chosen = cands.find(near) || cands.find(c => /[.,]\d{1,2}$/.test(c.str)) || cands.reduce((a, c) => (c.val > a.val ? c : a));
  const amount = chosen.val;
  const rx = a => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // contas mencionadas (palavra inteira), pela ordem em que aparecem
  const mentioned = db.accounts.map(a => { const m = new RegExp('(^|[^a-z0-9])' + rx(norm(a.name)) + '([^a-z0-9]|$)').exec(n); return { a, i: m ? m.index + m[1].length : -1 }; })
    .filter(x => x.i >= 0).sort((x, y) => x.i - y.i).map(x => x.a);
  const toAccount = mentioned.some(a => new RegExp('(^|[^a-z0-9])para (a |o |a minha |o meu )?' + rx(norm(a.name)) + '([^a-z0-9]|$)').test(n));
  let kind = 'expense';
  if (TRANSFER_RE.test(n)) kind = 'transfer';
  else if (/^\s*\+/.test(text) || INCOME_RE.test(n)) kind = 'income';
  // «receita» sozinha é ambígua (receita médica): só conta como entrada de dinheiro sem categoria de despesa à vista
  else if (/(^|[^a-z0-9])receitas?([^a-z0-9]|$)/.test(n) && !/medic/.test(n) && !Object.values(QKEYS).some(ks => ks.some(k => hasWord(n, k)))) kind = 'income';
  else if (toAccount) kind = 'transfer'; // «100 para poupança»
  let category = 'outros';
  if (kind === 'expense') for (const [c, ks] of Object.entries(QKEYS)) if (ks.some(k => hasWord(n, k))) { category = c; break; }
  const lastId = (() => { try { return localStorage.getItem('poupanca-lastacc'); } catch (e) { return null; } })();
  const dflt = acc(lastId) || db.accounts.find(a => a.kind !== 'investimento') || db.accounts[0];
  let accountId = dflt.id, destId = null;
  if (kind === 'transfer') {
    if (mentioned.length >= 2) { accountId = mentioned[0].id; destId = mentioned[1].id; }
    else if (mentioned.length === 1) { destId = mentioned[0].id; if (accountId === destId) accountId = (db.accounts.find(a => a.id !== destId) || dflt).id; }
  } else if (mentioned.length) accountId = mentioned[0].id;
  let date = today();
  if (hasWord(n, 'anteontem')) date = plusDays(-2); else if (hasWord(n, 'ontem')) date = plusDays(-1);
  let toks = (text.slice(0, chosen.i) + ' ' + text.slice(chosen.i + chosen.str.length)).replace(/€/g, ' ').split(/\s+/).filter(Boolean);
  toks = toks.filter(t => !['ontem', 'anteontem', 'hoje'].includes(norm(t)));
  const accWords = new Set(mentioned.flatMap(a => norm(a.name).split(/\s+/)));
  toks = toks.filter(t => !accWords.has(norm(t)));
  while (toks.length && FILLER.has(norm(toks[0]))) toks.shift();
  while (toks.length && FILLER.has(norm(toks[toks.length - 1]))) toks.pop();
  let note = toks.join(' ');
  note = note ? note[0].toUpperCase() + note.slice(1) : '';
  return { kind, amount, accountId, destId, category, note, date };
}
function quickAdd() {
  const input = $('qa'); if (!input) return;
  if (!db.accounts.length) return toast('Adiciona primeiro uma conta.');
  const r = parseQuick(input.value);
  if (!r) return toast('Não percebi o valor. Exemplo: 12,50 café');
  input.value = ''; entryForm(null, r.kind, r);
}

// ---------- Formulários (folha inferior) ----------
function openSheet(html) {
  $('sheet').innerHTML = html; $('sheet-bg').hidden = false;
  // nome do diálogo e etiquetas ligadas aos campos (leitores de ecrã)
  const h = $('sheet').querySelector('h2'); if (h) { h.id = 'sheet-title'; $('sheet').setAttribute('aria-labelledby', 'sheet-title'); }
  $('sheet').querySelectorAll('label').forEach((l, i) => { const c = l.nextElementSibling; if (c && /^(INPUT|SELECT|TEXTAREA)$/.test(c.tagName)) { c.id = c.id || 'campo' + i; l.htmlFor = c.id; } });
  if (masked()) $('sheet').querySelectorAll('input[inputmode=decimal]').forEach(i => { if (i.value) { i.classList.add('sec'); i.addEventListener('focus', () => i.classList.remove('sec'), { once: true }); } });
}
function closeSheet() { $('sheet-bg').hidden = true; $('sheet').innerHTML = ''; }
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${Array.isArray(v) ? v[1] + ' ' + v[0] : v}</option>`).join('');
const accOpts = (sel, blank) => (blank ? '<option value="">Selecionar</option>' : '') + db.accounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
const goalOpts = sel => '<option value="">Nenhum</option>' + db.goals.map(g => `<option value="${g.id}" ${g.id === sel ? 'selected' : ''}>${esc(g.name)}</option>`).join('');
function toast(m) {
  let t = document.getElementById('toast'); if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = m; t.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 3500);
}
const showErr = m => { const e = document.getElementById('err'); if (e) { e.textContent = m; e.scrollIntoView({ block: 'nearest' }); } };
const buttons = id => `<div class="actionbar"><div id="err" class="formerr"></div><div class="btns">${id ? '<button class="btn del" data-act="delete">Apagar</button>' : ''}<button class="btn" data-act="cancel">Cancelar</button><button class="btn main" data-act="save">Guardar</button></div></div></div>`;
const val = n => document.querySelector(`#sheet [name=${n}]`).value;
let form = null;

function accountForm(id) {
  const a = id ? acc(id) : null; form = { type: 'account', id };
  openSheet(`<h2>${a ? 'Editar conta' : 'Nova conta'}</h2>
  <label>Nome</label><input name="name" placeholder="ex.: Banco principal" value="${a ? esc(a.name) : ''}">
  <label>Tipo</label><select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${a?.kind === k ? 'selected' : ''}>${v[1]} ${v[0]}</option>`).join('')}</select>
  <label>${a ? 'Saldo inicial' : 'Saldo atual'} em €</label><input name="amount" inputmode="decimal" value="${a ? num(a.opening) : ''}">
  ${a ? `<div class="sub" style="margin:10px 4px">Saldo atual: <strong>${eur(balance(a))}</strong></div><button class="btn" data-act="history" style="width:100%">Ver movimentos desta conta</button>` : ''}
  ${buttons(id)}`);
}
function entryForm(id, preset, prefill) {
  const e = id ? db.entries.find(x => x.id === id) : prefill || null; form = { type: 'entry', id };
  const k = e?.kind || preset || 'expense';
  openSheet(`<h2>${id ? 'Editar movimento' : 'Novo movimento'}</h2>${entryFields(e, k)}${buttons(id)}`);
  form.kind = k; syncKind();
}
function entryFields(e, k, withRec) {
  return `<div class="seg" id="kseg">${Object.entries(ENTRY).map(([key, l]) => `<button data-kind="${key}" class="${key === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  ${withRec ? `<label>Nome</label><input name="name" placeholder="ex.: Ginásio" value="${e ? esc(e.name) : ''}">` : ''}
  <label>Valor em €</label><input name="amount" inputmode="decimal" value="${e ? num(e.amount) : ''}">
  <label>Conta</label><select name="account">${accOpts(e?.accountId || db.accounts[0]?.id)}</select>
  <div id="dest"><label>Conta de destino</label><select name="dest">${accOpts(e?.destId, true)}</select></div>
  <div id="cat"><label>Categoria</label><select name="category">${opts(CATS, e?.category || 'outros')}</select></div>
  <div id="goal"><label id="goallabel">Associar a um objetivo (opcional)</label><select name="goal">${goalOpts(e?.goalId)}</select></div>
  ${withRec ? '' : `<label>Descrição / notas (opcional)</label><input name="note" value="${e ? esc(e.note || '') : ''}">`}
  <label>${withRec ? 'Primeira data' : 'Data'}</label><input name="date" type="date" value="${e?.date || e?.next || today()}">`;
}
function syncKind() {
  $('dest').hidden = form.kind !== 'transfer'; $('cat').hidden = form.kind !== 'expense'; $('goal').hidden = form.kind === 'income';
  $('goallabel').textContent = form.kind === 'expense' ? 'Retirar de um objetivo (opcional): a despesa desconta ao objetivo' : 'Associar a um objetivo (opcional): a transferência soma ao objetivo';
  document.querySelectorAll('#kseg button').forEach(b => b.classList.toggle('on', b.dataset.kind === form.kind));
}
function budgetForm(id) {
  const b = id ? db.budgets.find(x => x.id === id) : null; form = { type: 'budget', id };
  openSheet(`<h2>${b ? 'Editar orçamento' : 'Novo orçamento'}</h2><label>Categoria</label><select name="category">${opts(CATS, b?.category || 'alimentacao')}</select>
  <label>Limite mensal em €</label><input name="amount" inputmode="decimal" value="${b ? num(b.limit) : ''}">${buttons(id)}`);
}
function goalForm(id) {
  const g = id ? db.goals.find(x => x.id === id) : null; form = { type: 'goal', id };
  openSheet(`<h2>${g ? 'Editar objetivo' : 'Novo objetivo'}</h2><label>Objetivo</label><input name="name" placeholder="ex.: Viagem" value="${g ? esc(g.name) : ''}">
  <label>Valor pretendido em €</label><input name="target" inputmode="decimal" value="${g ? num(g.target) : ''}">
  <label>Já tenho poupado (à mão) em €</label><input name="saved" inputmode="decimal" placeholder="0" value="${g ? num(g.saved) : ''}">
  ${g && goalInfo(g).contrib ? `<p class="note" style="margin:4px 4px 0">Além deste valor, há <b>${goalInfo(g).contrib < 0 ? '-' : '+'}${fmtEur.format(Math.abs(goalInfo(g).contrib)).replace(/−/g, '-')}</b> de movimentos associados ao objetivo (por isso o cartão mostra ${fmtEur.format(goalInfo(g).saved)}). Aqui só editas o que poupaste à mão.</p>` : ''}
  <label>Prazo (opcional)</label><input name="deadline" type="date" value="${g?.deadline || ''}">${buttons(id)}`);
}
function recForm(id) {
  const r = id ? db.recurring.find(x => x.id === id) : null; form = { type: 'rec', id };
  if (!db.accounts.length) return toast('Adiciona primeiro uma conta.');
  openSheet(`<h2>${r ? 'Editar recorrente' : 'Nova recorrente'}</h2>${entryFields(r, r?.kind || 'expense', true)}
  <label>Periodicidade</label><select name="freq">${Object.entries(FREQ).map(([k, v]) => `<option value="${k}" ${r?.freq === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <label>Estado</label><select name="active"><option value="1">Ativa</option><option value="0" ${r && !r.active ? 'selected' : ''}>Pausada</option></select>
  <div class="sub" style="margin:8px 4px">O movimento é criado automaticamente em cada data (datas passadas são criadas já).</div>${buttons(id)}`);
  form.kind = r?.kind || 'expense'; syncKind();
}
function invForm(id) {
  const i = id ? db.invest.find(x => x.id === id) : null; form = { type: 'inv', id };
  openSheet(`<h2>${i ? 'Editar' : 'Novo investimento / dívida'}</h2><label>Nome</label><input name="name" placeholder="ex.: ETF Mundo" value="${i ? esc(i.name) : ''}">
  <label>Tipo</label><select name="type">${Object.entries(INV).map(([k, v]) => `<option value="${k}" ${i?.type === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
  <label>Capital investido em € (ignora nas dívidas)</label><input name="invested" inputmode="decimal" placeholder="0" value="${i ? num(i.invested) : ''}">
  <label>Valor atual em € (ou valor em dívida)</label><input name="current" inputmode="decimal" value="${i ? num(i.current) : ''}">${buttons(id)}`);
}

const optMoney = raw => (raw.trim() === '' ? 0 : parseMoney(raw));
// Dinheiro físico e poupança não costumam ficar negativos: avisa (sem impedir) se este movimento deixar a conta de origem abaixo de zero.
// Contas à ordem podem ficar a descoberto, por isso não avisam.
function avisoNegativo(e, old) {
  if (e.kind === 'income' || e.date > today()) return '';
  const a = acc(e.accountId); if (!a || !['carteira', 'poupanca'].includes(a.kind)) return '';
  const antes = balance(a), guardadas = db.entries;
  db.entries = old ? guardadas.map(x => (x.id === old.id ? e : x)) : [...guardadas, e];
  const depois = balance(a); db.entries = guardadas;
  if (depois >= 0 || depois >= antes - 1e-9) return '';
  return `«${a.name}» ficaria com saldo negativo (${fmtEur.format(depois).replace(/−/g, '-')}). Em dinheiro físico ou poupança isso normalmente não é possível: confirma o saldo inicial e os movimentos. Guardar mesmo assim?`;
}
// Mensagem certa para cada erro: texto que não é número («abc», «12.5.3») ou número que não é maior que zero.
const msgValor = (raw, nome) => (parseMoney(raw) === null ? `O ${nome} não é válido. Usa só números, por exemplo 12,50.` : `Indica um ${nome} maior que zero.`);
function saveForm() {
  const { type, id } = form;
  if (type === 'account') {
    const name = val('name').trim(), amount = parseMoney(val('amount'), true);
    if (!name || amount === null) return showErr('Indica o nome e um saldo válido (ex.: 120,50). Para uma conta a descoberto ou cartão, usa um valor negativo (ex.: -80).');
    if (id) Object.assign(acc(id), { name, kind: val('kind'), opening: amount }); else db.accounts.push({ id: uid(), name, kind: val('kind'), opening: amount });
  } else if (type === 'entry' || type === 'rec') {
    const amount = parseMoney(val('amount')), kind = form.kind, isRec = type === 'rec';
    if (!amount) return showErr(msgValor(val('amount'), 'valor'));
    if (isRec && !val('name').trim()) return showErr('Indica um nome.');
    if (kind === 'transfer' && (!val('dest') || val('dest') === val('account'))) return showErr('Escolhe uma conta de destino diferente da conta de origem.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val('date'))) return showErr('Indica uma data válida.');
    const base = { kind, amount, accountId: val('account'), destId: kind === 'transfer' ? val('dest') : null, category: kind === 'expense' ? val('category') : 'outros', goalId: kind !== 'income' && val('goal') ? val('goal') : null };
    if (isRec) {
      const next = val('date') || today(), r = { id: id || uid(), name: val('name').trim(), ...base, freq: val('freq'), next, day: +next.slice(8, 10), active: val('active') === '1' };
      if (id) { const old = db.recurring.find(x => x.id === id); r.day = next === old.next ? old.day : r.day;
        // ao reativar uma regra pausada, salta o tempo parado em vez de criar todas as cobranças em atraso
        if (!old.active && r.active) { let g = 0; while (r.next < today() && g++ < 1000) r.next = advance(r); } db.recurring[db.recurring.findIndex(x => x.id === id)] = r; } else db.recurring.push(r);
      applyRecurring();
    } else {
      const old = id ? db.entries.find(x => x.id === id) : null;
      const e = { id: id || uid(), date: val('date') || today(), note: val('note').trim(), recId: old?.recId || null, ...base };
      const aviso = avisoNegativo(e, old); if (aviso && !confirm(aviso)) return; // só avisa: quem escolhe és tu
      if (id) db.entries[db.entries.findIndex(x => x.id === id)] = e; else { db.entries.push(e); try { localStorage.setItem('poupanca-lastacc', e.accountId); } catch (x) {} }
    }
  } else if (type === 'budget') {
    const limit = parseMoney(val('amount')), category = val('category');
    if (!limit) return showErr(msgValor(val('amount'), 'limite'));
    if (db.budgets.some(b => b.category === category && b.id !== id)) return showErr('Já existe um orçamento para esta categoria. Edita esse ou escolhe outra.');
    db.budgets = db.budgets.filter(b => b.category !== category && b.id !== id); db.budgets.push({ id: id || uid(), category, limit });
  } else if (type === 'goal') {
    const name = val('name').trim(), target = parseMoney(val('target')), saved = optMoney(val('saved'));
    if (!name || !target || saved === null) return showErr('Preenche o nome e o valor pretendido (maior que zero). Os outros campos aceitam números como 120,50.');
    // O valor poupado à mão guarda-se como foi escrito: não se corta ao valor pretendido (baixar o alvo e voltar a subir não pode fazer perder dinheiro).
    const old = id ? db.goals.find(x => x.id === id) : null, s = saved;
    const g = { id: id || uid(), name, target, saved: s, deadline: val('deadline'), created: old?.created || today(), base: old ? old.base : s };
    if (id) db.goals[db.goals.findIndex(x => x.id === id)] = g; else db.goals.push(g);
  } else if (type === 'inv') {
    const name = val('name').trim(), invested = optMoney(val('invested')), current = parseMoney(val('current'));
    if (!name || invested === null || current === null) return showErr('Preenche o nome e valores válidos.');
    const i = { id: id || uid(), name, type: val('type'), invested, current };
    if (id) db.invest[db.invest.findIndex(x => x.id === id)] = i; else db.invest.push(i);
  }
  save(); closeSheet(); render();
}

// A confirmação diz o que vai ser apagado e que não se pode desfazer.
function msgApagar(type, id) {
  const eurTxt = n => fmtEur.format(n).replace(/−/g, '-');
  if (type === 'entry') { const e = db.entries.find(x => x.id === id); return e ? `Apagar o movimento «${e.note || (e.kind === 'expense' ? CATS[e.category]?.[0] : ENTRY[e.kind])}» de ${eurTxt(e.amount)} (${fmtDate(e.date)})? O saldo da conta volta ao que era sem ele. Não dá para desfazer.` : 'Apagar este movimento? Não dá para desfazer.'; }
  if (type === 'goal') return `Apagar o objetivo «${db.goals.find(x => x.id === id)?.name || ''}»? Os movimentos associados mantêm-se, mas deixam de contar para ele. Não dá para desfazer.`;
  if (type === 'budget') return `Apagar o orçamento de ${CATS[db.budgets.find(x => x.id === id)?.category]?.[0] || 'esta categoria'}? Não dá para desfazer.`;
  if (type === 'rec') return `Apagar a regra recorrente «${db.recurring.find(x => x.id === id)?.name || ''}»? Os movimentos que já criou mantêm-se. Não dá para desfazer.`;
  return `Apagar «${db.invest.find(x => x.id === id)?.name || ''}»? Não dá para desfazer.`;
}
function deleteForm() {
  const { type, id } = form;
  if (type === 'account') {
    if (db.entries.some(e => e.accountId === id || e.destId === id) || db.recurring.some(r => r.accountId === id || r.destId === id)) return toast('Esta conta tem movimentos ou regras recorrentes. Apaga ou altera primeiro esses registos.');
    if (!confirm(`Apagar a conta «${acc(id)?.name || ''}»? Não dá para desfazer.`)) return;
    db.accounts = db.accounts.filter(a => a.id !== id);
  } else {
    if (!confirm(msgApagar(type, id))) return;
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
function validBackup(d) {
  if (!d || typeof d !== 'object' || Array.isArray(d) || !Array.isArray(d.accounts)) return false;
  return BACKUP_KEYS.every(k => !(k in d) || Array.isArray(d[k]));
}
function importData(file) {
  const r = new FileReader();
  r.onerror = () => toast('Não foi possível ler o ficheiro.');
  r.onload = () => {
    let parsed;
    try { parsed = JSON.parse(r.result); } catch (e) { return toast('Este ficheiro não é uma cópia de segurança válida.'); }
    if (!validBackup(parsed)) return toast('Este ficheiro não parece uma cópia de segurança da Poupança.');
    if (!BACKUP_KEYS.some(k => (parsed[k] || []).length)) return toast('O ficheiro está vazio (sem contas nem movimentos). Não foi importado.');
    if (!parsed.accounts.length && (parsed.entries || []).length) return toast('O ficheiro tem movimentos mas nenhuma conta. Não foi importado.');
    let d;
    try { d = normalize(parsed); } catch (e) { return toast('Ficheiro inválido ou com dados que a app não percebe.'); }
    const fixes = normFixes;
    if (!confirm(`Importar ${d.accounts.length} conta(s), ${d.entries.length} movimento(s), ${d.budgets.length} orçamento(s) e ${d.goals.length} objetivo(s)? Isto substitui os dados atuais (podes desfazer a seguir em Contas).${fixes ? `\n\nAtenção: ${fixes} data(s) impossíveis (ex.: 30/02) serão corrigidas: o dia passa ao último dia do mês, ou a hoje se o resto da data não fizer sentido.` : ''}`)) return;
    const prevDb = db;
    if (prevDb.accounts.length || prevDb.entries.length || prevDb.goals.length) { try { localStorage.setItem(UNDOKEY, JSON.stringify(prevDb)); } catch (e) {} }
    db = d;
    try { render(true); save(); applyRecurring(); render(true); } catch (err) { db = prevDb; render(true); return toast('Ficheiro inválido ou com dados que a app não percebe.'); }
    toast(fixes ? `Cópia importada. ${fixes} data(s) impossíveis foram corrigidas.` : 'Cópia importada.');
  };
  r.readAsText(file);
}
function undoImport() {
  let raw = null; try { raw = localStorage.getItem(UNDOKEY); } catch (e) {}
  if (!raw) return;
  if (!confirm('Repor os dados que tinhas antes da última importação? Os dados atuais serão substituídos.')) return;
  try { db = normalize(JSON.parse(raw)); localStorage.removeItem(UNDOKEY); save(); render(true); toast('Dados anteriores repostos.'); } catch (e) { toast('Não foi possível repor.'); }
}
function saveText(name, text) {
  const f = new File([text], name, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function corruptNotice() {
  openSheet(`<h2>⚠️ Dados danificados</h2>
  <p class="sub" style="font-size:15px">Os dados guardados neste telemóvel não puderam ser lidos. <b>Não foram apagados</b>: ficou uma cópia à parte. Exporta-a agora, para a poderes recuperar, e depois podes importar uma cópia de segurança em Contas.</p>
  <button class="btn main" data-act="export-corrupt" style="width:100%;margin-top:12px">Exportar os dados danificados</button>
  <button class="btn" data-act="welcome-close" style="width:100%;margin:10px 0 calc(env(safe-area-inset-bottom) + 20px)">Continuar com a app vazia</button>`);
}

// ---------- Eventos ----------
function go(t) { tab = t; try { localStorage.setItem('poupanca-tab', tab); } catch (e) {} render(); }
document.addEventListener('click', ev => {
  const t = ev.target.closest('button, b[data-edit-goal]');
  if (!t) { if (ev.target.id === 'sheet-bg') closeSheet(); return; }
  const d = t.dataset, add = () => ({ entries: entryForm, budgets: budgetForm, goals: goalForm, accounts: () => ({ accounts: accountForm, rec: recForm, inv: invForm }[ui.seg])() }[tab])();
  if (t.id === 'eye') return;
  if (d.tab) go(d.tab);
  else if (t.id === 'add') add();
  else if (d.quick) entryForm(null, d.quick);
  else if (d.view) { ui.view = d.view; render(true); }
  else if (d.act === 'open-analysis') { ui.view = 'analysis'; go('entries'); }
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
  else if (d.act === 'qa') quickAdd();
  else if (d.act === 'welcome') welcome();
  else if (d.act === 'welcome-close') closeSheet();
  else if (d.act === 'pin-cancel') hideLock();
  else if (d.act === 'privacy') { try { localStorage.setItem(PRIVKEY, privacyOn() ? '0' : '1'); } catch (e) {} reveal = false; render(true); }
  else if (d.act === 'pin-forgot') { if (confirm('Esqueceste o PIN? Para entrar tens de apagar TODOS os dados deste telemóvel (só recuperas com uma cópia de segurança). Apagar?')) { [KEY, 'poupanca-v1', PINKEY, LOCKKEY].forEach(k => localStorage.removeItem(k)); location.reload(); } }
  else if (d.act === 'export') exportData();
  else if (d.act === 'export-corrupt') saveText(`poupanca-danificado-${today()}.json`, corruptRaw || '');
  else if (d.act === 'undo-import') undoImport();
  else if (d.act === 'import') $('file').click();
});
document.addEventListener('change', ev => {
  const t = ev.target;
  if (t.id === 'file') { const f = t.files[0]; t.value = ''; if (f) importData(f); } // limpa o campo: permite escolher o mesmo ficheiro outra vez
  else if (t.dataset.f) { ui.f[t.dataset.f] = t.value; render(true); }
});
document.addEventListener('keydown', ev => { if (ev.key === 'Enter' && ev.target.id === 'qa') { ev.preventDefault(); quickAdd(); } });
document.addEventListener('input', ev => { if (ev.target.id === 'q') { ui.f.q = ev.target.value; $('elist').innerHTML = entriesList(); } });
// Cortina de privacidade: tapa o ecrã quando a app perde o foco, para o seletor de apps não mostrar saldos.
const cover = on => { $('cover').classList.toggle('on', on); if (on && reveal) setReveal(false); };
window.addEventListener('blur', () => cover(true));
window.addEventListener('pagehide', () => cover(true));
window.addEventListener('focus', () => cover(false));
window.addEventListener('pageshow', () => cover(false));
$('cover').addEventListener('click', () => { if (!document.hidden) cover(false); });
const eye = $('eye');
let ptrSinceClick = false, assist = false, assistTimer = null;
eye.addEventListener('pointerdown', e => { ptrSinceClick = true; e.preventDefault(); assist = false; clearTimeout(assistTimer); setReveal(true); });
eye.addEventListener('contextmenu', e => e.preventDefault());
['pointerup', 'pointercancel', 'touchend', 'touchcancel', 'mouseup'].forEach(t => document.addEventListener(t, () => { if (!assist) setReveal(false); }));
// O clique que o navegador gera ao largar o dedo/rato não conta. Só o teclado (Enter/Espaço), que não passa por
// «dedo premido», mostra os valores durante 15 s. Quem usa leitor de ecrã pode desligar o Modo privado em Contas → Segurança.
eye.addEventListener('click', () => {
  if (ptrSinceClick) { ptrSinceClick = false; return; }
  clearTimeout(assistTimer); assist = !reveal;
  if (assist) assistTimer = setTimeout(() => { assist = false; setReveal(false); }, 15000);
  setReveal(assist);
});
document.addEventListener('keydown', ev => {
  if ($('lock').hidden) return;
  if (/^\d$/.test(ev.key)) pinKey(ev.key); else if (ev.key === 'Backspace') pinKey('del');
});
let hiddenAt = 0;
window.addEventListener('storage', e => { if (e.key === KEY) syncFromStorage(); });
window.addEventListener('focus', syncFromStorage);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); cover(true); if (privacyOn() && !$('sheet-bg').hidden) closeSheet(); return; }
  cover(false); syncFromStorage();
  if (getPin() && $('lock').hidden && Date.now() - hiddenAt > 30000) { closeSheet(); showLock('unlock'); }
  applyRecurring(); if ($('sheet-bg').hidden) render(true);
});


// ---------- Boas-vindas ----------
const WELCOME_KEY = 'poupanca-welcome';
function welcome() {
  const standalone = (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  const ua = navigator.userAgent;
  const install = standalone ? '' : /iPhone|iPad|iPod/.test(ua) ? 'Abre este link no <b>Safari</b>, toca em <b>Partilhar</b> e depois em <b>Adicionar ao ecrã principal</b>.'
    : /Android/.test(ua) ? 'No <b>Chrome</b>, toca nos três pontos (⋮) e depois em <b>Instalar aplicação</b>.' : 'Podes instalá-la no telemóvel pelo menu do browser (Adicionar ao ecrã principal).';
  try { localStorage.setItem(WELCOME_KEY, '1'); } catch (e) {}
  openSheet(`<h2>Bem-vindo à Poupança 👋</h2>
  <div class="wl"><span>🏦</span><div><b>Começa por uma conta.</b> Em <i>Contas</i>, cria uma conta com o saldo atual.</div></div>
  <div class="wl"><span>⚡</span><div><b>Regista depressa.</b> Na página inicial, escreve «12,50 café» e confirma.</div></div>
  <div class="wl"><span>💾</span><div><b>Os dados ficam só neste telemóvel.</b> Não há servidor nem conta. Se apagares a app ou mudares de telemóvel sem exportar, perdes tudo. Exporta uma cópia todos os meses (Contas → Cópia de segurança).</div></div>
  <div class="wl"><span>👁️</span><div><b>Modo privado.</b> Os valores estão escondidos (••••). Mantém o dedo premido no olho para os ver.</div></div>
  ${install ? `<div class="wl"><span>📲</span><div><b>Instalar.</b> ${install}</div></div>` : ''}
  <div class="wl"><span>⚠️</span><div><b>Uma app pessoal.</b> Não é aconselhamento financeiro nem tem segurança profissional. O PIN só bloqueia o ecrã. Não guardes aqui palavras-passe nem números de cartões.</div></div>
  <button class="btn main" data-act="welcome-close" style="width:100%;margin:16px 0 calc(env(safe-area-inset-bottom) + 20px)">Começar</button>`);
}
const needsWelcome = () => { try { return corruptRaw === null && !localStorage.getItem(WELCOME_KEY) && !db.accounts.length && !db.entries.length; } catch (e) { return false; } };

// ---------- PIN ----------
const PINKEY = 'poupanca-pin', LOCKKEY = 'poupanca-lockuntil', PINLEN = 6;
function getPin() { try { return JSON.parse(localStorage.getItem(PINKEY)); } catch (e) { return null; } }
async function hashPin(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
  return [...new Uint8Array(bits)].map(x => x.toString(16).padStart(2, '0')).join('');
}
let L = { mode: '', buf: '', first: '', msg: '', fails: 0, onOk: null, busy: false };
function showLock(mode, onOk) { L = { mode, buf: '', first: '', msg: '', fails: 0, onOk, busy: false }; $('lock').hidden = false; ['top', 'view', 'tabs', 'sheet-bg'].forEach(i => { $(i).inert = true; }); drawLock(); }
function hideLock() {
  $('lock').hidden = true; $('lock').innerHTML = ''; ['top', 'view', 'tabs', 'sheet-bg'].forEach(i => { $(i).inert = false; });
  if (corruptRaw !== null && L.mode === 'unlock' && $('sheet-bg').hidden) corruptNotice(); // aviso de dados danificados depois de desbloquear
}
function drawLock() {
  const had = document.activeElement && $('lock').contains(document.activeElement) ? document.activeElement.dataset.pin || document.activeElement.dataset.act : null;
  const t = { unlock: 'Introduz o PIN', verify: 'Introduz o PIN atual', set1: 'Escolhe um PIN de 6 dígitos', set2: 'Repete o PIN' }[L.mode];
  $('lock').innerHTML = `<div class="lockbox"><div class="lockico">🔒</div><h2>${t}</h2><div class="dots">${Array.from({ length: PINLEN }, (_, i) => `<i class="${i < L.buf.length ? 'on' : ''}"></i>`).join('')}</div><div class="lockmsg">${L.msg}</div>
  <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-pin="${n}">${n}</button>`).join('')}<span></span><button data-pin="0">0</button><button data-pin="del" aria-label="Apagar">⌫</button></div>
  ${L.mode === 'unlock' ? '<button class="linkbtn" data-act="pin-forgot">Esqueci-me do PIN</button>' : '<button class="linkbtn" data-act="pin-cancel">Cancelar</button>'}</div>`;
  const again = had && $('lock').querySelector(`[data-pin="${had}"],[data-act="${had}"]`);
  (again || $('lock').querySelector('[data-pin="1"]')).focus();
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


db = load();
if (getPin()) showLock('unlock');
applyRecurring();
render();
if (corruptRaw !== null && $('lock').hidden) corruptNotice();
else if (needsWelcome() && $('lock').hidden) welcome();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

// Com o teclado aberto, o formulário ocupa só a parte visível do ecrã (os botões ficam à vista).
if (window.visualViewport) {
  const fit = () => { const v = window.visualViewport, bg = $('sheet-bg'); bg.style.top = v.offsetTop + 'px'; bg.style.bottom = 'auto'; bg.style.height = v.height + 'px'; };
  window.visualViewport.addEventListener('resize', fit); window.visualViewport.addEventListener('scroll', fit); fit();
}
