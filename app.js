'use strict';

// ---------- Dados ----------
const KEY = 'poupanca-v1';
const KINDS = { banco: ['Banco', '🏦'], carteira: ['Dinheiro', '💵'], poupanca: ['Poupança', '🔒'] };
const ENTRY = { income: 'Entrada', expense: 'Despesa', transfer: 'Transferência' };
const CATS = { alimentacao: ['Alimentação', '🍽️'], casa: ['Casa', '🏠'], transportes: ['Transportes', '🚗'], compras: ['Compras', '🛍️'], lazer: ['Lazer', '🎮'], saude: ['Saúde', '🩺'], outros: ['Outros', '▦'] };

let db = load();
function load() {
  try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.accounts) return d; } catch (e) {}
  return { accounts: [], entries: [], budgets: [], goals: [] };
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { alert('Não foi possível guardar os dados.'); }
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const eur = n => new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(n);
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = s => new Date(s + 'T12:00:00').toLocaleDateString('pt-PT', { day: 'numeric', month: 'short', year: 'numeric' });

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
const total = () => db.accounts.reduce((s, a) => s + balance(a), 0);
const month = () => today().slice(0, 7);
const sumMonth = (kind, cat) => db.entries.filter(e => e.kind === kind && e.date.startsWith(month()) && (!cat || e.category === cat)).reduce((s, e) => s + e.amount, 0);
const byDate = () => [...db.entries].sort((a, b) => b.date.localeCompare(a.date));

// ---------- Interface ----------
const TABS = [
  ['home', 'Início', '🏠'], ['entries', 'Movimentos', '⇄'], ['budgets', 'Orçamentos', '📊'], ['goals', 'Objetivos', '🎯'], ['accounts', 'Contas', '💳'],
];
let tab = (() => { try { return localStorage.getItem('poupanca-tab') || 'home'; } catch (e) { return 'home'; } })();
const $ = id => document.getElementById(id);

function render() {
  $('tabs').innerHTML = TABS.map(([k, l, i]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}"><span>${i}</span>${l}</button>`).join('');
  $('title').textContent = tab === 'home' ? 'Poupança' : TABS.find(t => t[0] === tab)[1];
  $('add').hidden = tab === 'home' || (tab === 'entries' && !db.accounts.length);
  $('view').innerHTML = { home, entries, budgets, goals, accounts }[tab]();
  window.scrollTo(0, 0);
}

function entryRow(e) {
  const ico = e.kind === 'income' ? '↙' : e.kind === 'expense' ? CATS[e.category][1] : '⇄';
  const name = e.note || (e.kind === 'expense' ? CATS[e.category][0] : ENTRY[e.kind]);
  const sign = e.kind === 'expense' ? '−' : e.kind === 'income' ? '+' : '';
  return `<button class="item" data-edit-entry="${e.id}"><div class="ico">${ico}</div><div class="grow"><div>${esc(name)}</div><div class="sub">${fmtDate(e.date)}${e.kind === 'transfer' && acc(e.destId) ? ' · ' + esc(acc(e.accountId)?.name || '') + ' → ' + esc(acc(e.destId).name) : ''}</div></div><div class="amt ${e.kind === 'income' ? 'pos' : ''}">${sign}${eur(e.amount)}</div></button>`;
}
const empty = (i, t) => `<div class="empty"><span>${i}</span>${t}</div>`;

function home() {
  const accs = db.accounts.length
    ? `<div class="list">${db.accounts.map(a => `<div class="item"><div class="ico">${KINDS[a.kind][1]}</div><div class="grow"><div>${esc(a.name)}</div><div class="sub">${KINDS[a.kind][0]}</div></div><div class="amt">${eur(balance(a))}</div></div>`).join('')}</div>`
    : empty('🏦', 'Começa por adicionar uma conta no separador Contas, com o saldo do banco ou dinheiro.');
  const last = byDate().slice(0, 5);
  return `<div class="hero"><small>SALDO TOTAL</small><b>${eur(total())}</b><div>Todas as tuas contas</div></div>
  <div class="row2">
    <div class="card metric"><span class="pos">↙</span><small>Entradas do mês</small><b>${eur(sumMonth('income'))}</b></div>
    <div class="card metric"><span style="color:var(--orange)">↗</span><small>Despesas do mês</small><b>${eur(sumMonth('expense'))}</b></div>
  </div>
  <h2>As minhas contas</h2>${accs}
  <h2>Últimos movimentos</h2>${last.length ? `<div class="list">${last.map(entryRow).join('')}</div>` : '<p class="note">Ainda não há movimentos.</p>'}`;
}

function entries() {
  if (!db.accounts.length) return empty('⇄', 'Adiciona primeiro uma conta.');
  if (!db.entries.length) return empty('⇄', 'Ainda não há movimentos. Toca em + para registar.');
  return `<div class="list">${byDate().map(entryRow).join('')}</div><p class="note">Toca num movimento para o editar ou apagar.</p>`;
}

function budgets() {
  if (!db.budgets.length) return empty('📊', 'Define os teus limites mensais com o botão +.');
  return `<div class="list">${db.budgets.map(b => {
    const s = sumMonth('expense', b.category), over = s > b.limit, pct = Math.min(s / Math.max(b.limit, .01), 1) * 100;
    return `<button class="item" data-edit-budget="${b.id}" style="display:block"><div style="display:flex;justify-content:space-between"><span>${CATS[b.category][1]} ${CATS[b.category][0]}</span><span class="sub">${eur(s)} / ${eur(b.limit)}</span></div><div class="bar ${over ? 'over' : ''}"><i style="width:${pct}%"></i></div></button>`;
  }).join('')}</div>`;
}

function goals() {
  if (!db.goals.length) return empty('🎯', 'Cria o teu primeiro objetivo com o botão +.');
  return db.goals.map(g => {
    const p = Math.min(g.saved / Math.max(g.target, .01), 1);
    return `<div class="card"><div style="display:flex;justify-content:space-between"><b data-edit-goal="${g.id}">${esc(g.name)} ✎</b><span style="color:var(--forest)">${Math.floor(p * 100)}%</span></div>
    <div class="bar"><i style="width:${p * 100}%"></i></div><div class="sub">${eur(g.saved)} de ${eur(g.target)}</div>
    <div class="step"><button data-goal-step="${g.id}" data-d="-10">−</button><span>Poupado: ${eur(g.saved)}</span><button data-goal-step="${g.id}" data-d="10">+</button></div></div>`;
  }).join('') + '<p class="note">O progresso dos objetivos é um registo separado: não altera os saldos das contas.</p>';
}

function accounts() {
  const list = db.accounts.length
    ? `<div class="list">${db.accounts.map(a => `<button class="item" data-edit-account="${a.id}"><div class="ico">${KINDS[a.kind][1]}</div><div class="grow">${esc(a.name)}</div><div class="amt">${eur(balance(a))}</div></button>`).join('')}</div>`
    : empty('💳', 'Toca em + para adicionar a primeira conta.');
  return `${list}<p class="note">Introduz o saldo atual. Os movimentos atualizam o saldo automaticamente. Não precisas de ligar o banco.</p>
  <h2>Cópia de segurança</h2>
  <div class="card"><p class="sub" style="margin-top:0">Os dados ficam só neste telemóvel. Guarda uma cópia de vez em quando (ex.: nos Ficheiros ou iCloud).</p>
  <div class="btns" style="margin-top:8px"><button class="btn" data-act="export">Exportar</button><button class="btn" data-act="import">Importar</button></div></div>
  <input id="file" type="file" accept=".json,application/json" hidden>`;
}

// ---------- Formulários (folha inferior) ----------
function openSheet(html) { $('sheet').innerHTML = html; $('sheet-bg').hidden = false; }
function closeSheet() { $('sheet-bg').hidden = true; $('sheet').innerHTML = ''; }
const opts = (obj, sel) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${Array.isArray(v) ? v[0] : v}</option>`).join('');
const accOpts = (sel, blank) => (blank ? '<option value="">Selecionar</option>' : '') + db.accounts.map(a => `<option value="${a.id}" ${a.id === sel ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
const buttons = (id, ok = 'Guardar') => `<div class="btns">${id ? '<button class="btn del" data-act="delete">Apagar</button>' : ''}<button class="btn" data-act="cancel">Cancelar</button><button class="btn main" data-act="save" id="ok">${ok}</button></div>`;
const val = n => document.querySelector(`#sheet [name=${n}]`).value;
let form = null; // { type, id }

function accountForm(id) {
  const a = id ? acc(id) : null; form = { type: 'account', id };
  openSheet(`<h3>${a ? 'Editar conta' : 'Nova conta'}</h3>
  <label>Nome</label><input name="name" placeholder="ex.: Banco principal" value="${a ? esc(a.name) : ''}">
  <label>Tipo</label><select name="kind">${opts(KINDS, a?.kind)}</select>
  <label>${a ? 'Saldo inicial' : 'Saldo atual'} em €</label><input name="amount" inputmode="decimal" value="${a ? String(a.opening).replace('.', ',') : ''}">
  ${buttons(id)}`);
}
function entryForm(id) {
  const e = id ? db.entries.find(x => x.id === id) : null; form = { type: 'entry', id };
  const k = e?.kind || 'expense';
  openSheet(`<h3>${e ? 'Editar movimento' : 'Novo movimento'}</h3>
  <div class="seg" id="kseg">${Object.entries(ENTRY).map(([key, l]) => `<button data-kind="${key}" class="${key === k ? 'on' : ''}">${l}</button>`).join('')}</div>
  <label>Valor em €</label><input name="amount" inputmode="decimal" value="${e ? String(e.amount).replace('.', ',') : ''}">
  <label>Conta</label><select name="account">${accOpts(e?.accountId || db.accounts[0]?.id)}</select>
  <div id="dest"><label>Conta de destino</label><select name="dest">${accOpts(e?.destId, true)}</select></div>
  <div id="cat"><label>Categoria</label><select name="category">${opts(CATS, e?.category || 'outros')}</select></div>
  <label>Descrição (opcional)</label><input name="note" value="${e ? esc(e.note || '') : ''}">
  <label>Data</label><input name="date" type="date" value="${e?.date || today()}">
  ${buttons(id)}`);
  form.kind = k; syncEntryForm();
}
function syncEntryForm() {
  $('dest').hidden = form.kind !== 'transfer'; $('cat').hidden = form.kind !== 'expense';
  document.querySelectorAll('#kseg button').forEach(b => b.classList.toggle('on', b.dataset.kind === form.kind));
}
function budgetForm(id) {
  const b = id ? db.budgets.find(x => x.id === id) : null; form = { type: 'budget', id };
  openSheet(`<h3>${b ? 'Editar orçamento' : 'Novo orçamento'}</h3>
  <label>Categoria</label><select name="category">${opts(CATS, b?.category || 'alimentacao')}</select>
  <label>Limite mensal em €</label><input name="amount" inputmode="decimal" value="${b ? String(b.limit).replace('.', ',') : ''}">
  ${buttons(id)}`);
}
function goalForm(id) {
  const g = id ? db.goals.find(x => x.id === id) : null; form = { type: 'goal', id };
  openSheet(`<h3>${g ? 'Editar objetivo' : 'Novo objetivo'}</h3>
  <label>Objetivo</label><input name="name" placeholder="ex.: Viagem" value="${g ? esc(g.name) : ''}">
  <label>Valor pretendido em €</label><input name="target" inputmode="decimal" value="${g ? String(g.target).replace('.', ',') : ''}">
  <label>Já tenho poupado em €</label><input name="saved" inputmode="decimal" value="${g ? String(g.saved).replace('.', ',') : '0'}">
  ${buttons(id)}`);
}

function saveForm() {
  const { type, id } = form;
  if (type === 'account') {
    const name = val('name').trim(), amount = parseMoney(val('amount'));
    if (!name || amount === null) return alert('Indica o nome e um saldo válido (ex.: 120,50).');
    if (id) Object.assign(acc(id), { name, kind: val('kind'), opening: amount });
    else db.accounts.push({ id: uid(), name, kind: val('kind'), opening: amount });
  } else if (type === 'entry') {
    const amount = parseMoney(val('amount')), kind = form.kind;
    if (!amount) return alert('Indica um valor maior que zero.');
    if (kind === 'transfer' && (!val('dest') || val('dest') === val('account'))) return alert('Escolhe uma conta de destino diferente da conta de origem.');
    const e = { id: id || uid(), date: val('date') || today(), kind, amount, accountId: val('account'), destId: kind === 'transfer' ? val('dest') : null, category: kind === 'expense' ? val('category') : 'outros', note: val('note').trim() };
    if (id) db.entries[db.entries.findIndex(x => x.id === id)] = e; else db.entries.push(e);
  } else if (type === 'budget') {
    const limit = parseMoney(val('amount')), category = val('category');
    if (!limit) return alert('Indica um limite maior que zero.');
    db.budgets = db.budgets.filter(b => b.category !== category && b.id !== id);
    db.budgets.push({ id: id || uid(), category, limit });
  } else if (type === 'goal') {
    const name = val('name').trim(), target = parseMoney(val('target')), saved = parseMoney(val('saved'));
    if (!name || !target || saved === null) return alert('Preenche o nome e valores válidos.');
    const g = { id: id || uid(), name, target, saved: Math.min(saved, target) };
    if (id) db.goals[db.goals.findIndex(x => x.id === id)] = g; else db.goals.push(g);
  }
  save(); closeSheet(); render();
}

function deleteForm() {
  const { type, id } = form;
  if (type === 'account') {
    if (db.entries.some(e => e.accountId === id || e.destId === id)) return alert('Esta conta tem movimentos. Apaga ou altera primeiro esses movimentos.');
    if (!confirm('Apagar esta conta?')) return;
    db.accounts = db.accounts.filter(a => a.id !== id);
  } else {
    if (!confirm('Apagar?')) return;
    const key = { entry: 'entries', budget: 'budgets', goal: 'goals' }[type];
    db[key] = db[key].filter(x => x.id !== id);
  }
  save(); closeSheet(); render();
}

// ---------- Backup ----------
function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: 'application/json' });
  const f = new File([blob], `poupanca-${today()}.json`, { type: 'application/json' });
  if (navigator.canShare && navigator.canShare({ files: [f] })) { navigator.share({ files: [f] }).catch(() => {}); return; }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// Converte também o financas.json da app Swift original (datas em segundos desde 2001, nomes em português).
function normalize(d) {
  const kindMap = { Banco: 'banco', Dinheiro: 'carteira', 'Poupança': 'poupanca' };
  const entryMap = { Entrada: 'income', Despesa: 'expense', 'Transferência': 'transfer' };
  const catMap = Object.fromEntries(Object.entries(CATS).map(([k, v]) => [v[0], k]));
  const date = x => typeof x === 'number' ? new Date((x + 978307200) * 1000).toISOString().slice(0, 10) : String(x).slice(0, 10);
  return {
    accounts: (d.accounts || []).map(a => ({ id: a.id, name: a.name, kind: kindMap[a.kind] || a.kind, opening: a.opening ?? a.openingBalance ?? 0 })),
    entries: (d.entries || []).map(e => ({ id: e.id, date: date(e.date), kind: entryMap[e.kind] || e.kind, amount: e.amount, accountId: e.accountId ?? e.accountID, destId: e.destId ?? e.destinationID ?? null, category: catMap[e.category] || e.category || 'outros', note: e.note || '' })),
    budgets: (d.budgets || []).map(b => ({ id: b.id, category: catMap[b.category] || b.category, limit: b.limit ?? b.monthlyLimit })),
    goals: (d.goals || []).map(g => ({ id: g.id, name: g.name, target: g.target, saved: g.saved })),
  };
}
function importData(file) {
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = normalize(JSON.parse(r.result));
      if (!confirm(`Importar ${d.accounts.length} conta(s) e ${d.entries.length} movimento(s)? Isto substitui os dados atuais.`)) return;
      db = d; save(); render();
    } catch (e) { alert('Ficheiro inválido.'); }
  };
  r.readAsText(file);
}

// ---------- Eventos ----------
document.addEventListener('click', ev => {
  const t = ev.target.closest('button, b[data-edit-goal]'); if (!t) { if (ev.target.id === 'sheet-bg') closeSheet(); return; }
  const d = t.dataset;
  if (d.tab) { tab = d.tab; try { localStorage.setItem('poupanca-tab', tab); } catch (e) {} render(); }
  else if (t.id === 'add') ({ entries: entryForm, budgets: budgetForm, goals: goalForm, accounts: accountForm }[tab])();
  else if (d.editEntry) entryForm(d.editEntry);
  else if (d.editBudget) budgetForm(d.editBudget);
  else if (d.editGoal) goalForm(d.editGoal);
  else if (d.editAccount) accountForm(d.editAccount);
  else if (d.goalStep) { const g = db.goals.find(x => x.id === d.goalStep); g.saved = Math.min(Math.max(g.saved + Number(d.d), 0), g.target); save(); render(); }
  else if (d.kind) { form.kind = d.kind; syncEntryForm(); }
  else if (d.act === 'cancel') closeSheet();
  else if (d.act === 'save') saveForm();
  else if (d.act === 'delete') deleteForm();
  else if (d.act === 'export') exportData();
  else if (d.act === 'import') $('file').click();
});
document.addEventListener('change', ev => { if (ev.target.id === 'file' && ev.target.files[0]) importData(ev.target.files[0]); });

render();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
