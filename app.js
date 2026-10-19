(function () {
  'use strict';
  const L = window.TaskLogic;
  const CFG = window.TASK_CONFIG || {};
  const DEMO = !CFG.SUPABASE_URL || !CFG.SUPABASE_KEY || !window.supabase;

  const DEFAULT_GENRES = [
    ['事務', '#5b7cfa'], ['運動', '#2fb37c'], ['家事', '#f2994a'],
    ['お出かけ', '#9b6bdf'], ['買い物', '#e5577a'], ['その他', '#8e8e93'],
  ];
  const PRI = { 1: '高', 2: '中', 3: '低' };

  const uuid = () => (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16);
    });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 保存先 ----------
  function localStore() {
    const KEY = 'tasktool-demo-v1';
    let mem = { genres: [], tasks: [] };
    try { const raw = localStorage.getItem(KEY); if (raw) mem = JSON.parse(raw); } catch (e) { /* 使えない環境ではメモリのみ */ }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(mem)); } catch (e) { } };
    const clone = o => JSON.parse(JSON.stringify(o));
    return {
      async session() { return { user: { email: 'デモ' } }; },
      async loadAll() { return { genres: clone(mem.genres), tasks: clone(mem.tasks.filter(t => !t.completed)) }; },
      async insert(table, row) { mem[table].push(clone(row)); save(); },
      async update(table, id, patch) {
        const r = mem[table].find(x => x.id === id); if (r) Object.assign(r, clone(patch));
        save();
      },
      async remove(table, id) {
        mem[table] = mem[table].filter(x => x.id !== id);
        if (table === 'genres') mem.tasks.forEach(t => { if (t.genre_id === id) t.genre_id = null; });
        save();
      },
      async signOut() { },
    };
  }

  function supaStore() {
    const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
    const chk = ({ error }) => { if (error) throw error; };
    return {
      sb,
      async session() { const { data } = await sb.auth.getSession(); return data.session; },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error; return data.session;
      },
      async loadAll() {
        const [g, t] = await Promise.all([
          sb.from('genres').select('*').order('sort_order'),
          sb.from('tasks').select('*').eq('completed', false),
        ]);
        if (g.error) throw g.error; if (t.error) throw t.error;
        return { genres: g.data, tasks: t.data };
      },
      async insert(table, row) { chk(await sb.from(table).insert(row)); },
      async update(table, id, patch) { chk(await sb.from(table).update(patch).eq('id', id)); },
      async remove(table, id) { chk(await sb.from(table).delete().eq('id', id)); },
      async signOut() { await sb.auth.signOut(); },
    };
  }

  const store = DEMO ? localStore() : supaStore();

  // ---------- 状態 ----------
  const S = {
    ready: false, loggedIn: false, loginErr: '',
    genres: [], tasks: [],
    view: 'today', genreId: null,
    editor: null, toast: null, lastLoad: 0,
  };
  let queue = Promise.resolve();
  function persist(fn) {
    queue = queue.then(fn).catch(err => {
      console.error(err);
      showToast('保存に失敗しました。再読み込みします');
      reload();
    });
    return queue;
  }

  const today = () => L.todayStr();
  const genreOf = id => S.genres.find(g => g.id === id);
  const sortedGenres = () => S.genres.slice().sort((a, b) => a.sort_order - b.sort_order);
  const openTasks = () => S.tasks.filter(t => !t.completed);

  async function reload() {
    try {
      const data = await store.loadAll();
      S.genres = data.genres;
      // 完了の取り消し用に、手元の完了済みタスクは残しておく
      const doneLocal = S.tasks.filter(t => t.completed);
      S.tasks = data.tasks.concat(doneLocal.filter(d => !data.tasks.some(t => t.id === d.id)));
      S.lastLoad = Date.now();
      if (!S.genres.length) await seedGenres();
    } catch (e) {
      console.error(e);
      showToast('読み込みに失敗しました');
    }
    render();
  }

  async function seedGenres() {
    const rows = DEFAULT_GENRES.map(([name, color], i) => ({ id: uuid(), name, color, sort_order: i }));
    S.genres = rows;
    for (const r of rows) await store.insert('genres', r);
  }

  // ---------- タスク操作 ----------
  function addTask(fields) {
    const t = Object.assign({
      id: uuid(), title: '', genre_id: null, do_date: null, due_date: null, priority: 2, memo: '',
      repeat_type: 'none', repeat_days: [], someday: false, today_added: null,
      completed: false, completed_at: null, spawned_id: null, created_at: new Date().toISOString(),
    }, fields);
    S.tasks.push(t);
    const row = Object.assign({}, t); delete row.created_at;
    persist(() => store.insert('tasks', row));
    return t;
  }

  function patchTask(t, patch) {
    Object.assign(t, patch);
    persist(() => store.update('tasks', t.id, patch));
  }

  function completeTask(t) {
    const patch = { completed: true, completed_at: new Date().toISOString() };
    if (t.repeat_type && t.repeat_type !== 'none') {
      const next = addTask(L.nextInstance(t, today(), uuid()));
      patch.spawned_id = next.id;
    }
    patchTask(t, patch);
    render();
    showToast(`「${t.title}」を完了しました`, () => uncompleteTask(t));
  }

  function uncompleteTask(t) {
    if (t.spawned_id) {
      const sp = S.tasks.find(x => x.id === t.spawned_id);
      if (sp && !sp.completed) {
        S.tasks = S.tasks.filter(x => x !== sp);
        persist(() => store.remove('tasks', sp.id));
      }
    }
    patchTask(t, { completed: false, completed_at: null, spawned_id: null });
    render();
  }

  function deleteTask(t) {
    S.tasks = S.tasks.filter(x => x !== t);
    persist(() => store.remove('tasks', t.id));
  }

  // ---------- 表示用 ----------
  const ICON = {
    today: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></svg>',
    upcoming: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
    genre: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.8"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.8"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.8"/></svg>',
    someday: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"><path d="M4 8.5h16v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><path d="M3 4.5h18v4H3zM10 12.5h4"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/></svg>',
  };
  const VIEWS = [['today', '今日'], ['upcoming', '予定'], ['genre', 'ジャンル'], ['someday', 'いつかやる'], ['settings', '設定']];

  function counts() {
    const td = L.todayList(openTasks(), today());
    return { today: td.length, overdue: td.filter(x => x.info.overdue).length };
  }

  function taskRow(t, opts = {}) {
    const td = today();
    const info = L.todayInfo(t, td);
    const g = genreOf(t.genre_id);
    const meta = [];
    if (opts.showGenre !== false) meta.push(g
      ? `<span><i class="dot" style="background:${esc(g.color)}"></i>${esc(g.name)}</span>`
      : '<span class="muted">未分類</span>');
    if (t.do_date) meta.push(`<span>やる日 ${L.dateLabel(t.do_date, td)}</span>`);
    if (t.due_date) {
      if (t.due_date < td) meta.push(`<span class="badge">期限切れ ${L.dateLabel(t.due_date, td)}</span>`);
      else if (t.due_date === td) meta.push('<span class="badge">今日締め切り</span>');
      else meta.push(`<span>締め切り ${L.dateLabel(t.due_date, td)}</span>`);
    }
    if (t.repeat_type && t.repeat_type !== 'none') meta.push(`<span>↻ ${esc(L.repeatLabel(t))}</span>`);
    if (t.memo) meta.push('<span>メモあり</span>');
    let mini = '';
    if (opts.view === 'today') {
      if (info && info.manualOnly) mini = `<button class="mini" data-act="offToday" data-id="${t.id}">外す</button>`;
    } else if (!info) {
      mini = `<button class="mini" data-act="toToday" data-id="${t.id}">今日へ</button>`;
    } else {
      mini = '<span class="badge today">今日</span>';
    }
    return `<div class="task${info && info.overdue ? ' overdue' : ''}" data-act="open" data-id="${t.id}">
      <button class="check p${t.priority || 2}" data-act="done" data-id="${t.id}" aria-label="完了にする" title="完了にする（優先度 ${PRI[t.priority || 2]}）"></button>
      <div class="body"><div class="title">${esc(t.title)}</div>${meta.length ? `<div class="meta">${meta.join('')}</div>` : ''}</div>
      ${mini}</div>`;
  }

  function listBlock(tasks, opts) {
    return `<div class="list">${tasks.map(t => taskRow(t, opts)).join('')}</div>`;
  }

  function quickAdd(placeholder) {
    const def = defaultGenreId();
    const opts = sortedGenres().map(g => `<option value="${g.id}"${g.id === def ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
    return `<form class="quick" data-form="quick">
      <input type="text" id="qa-input" placeholder="${esc(placeholder)}" autocomplete="off" enterkeyhint="done">
      <select id="qa-genre" aria-label="ジャンル">${opts}</select>
      <button class="btn" type="submit">追加</button></form>`;
  }

  function defaultGenreId() {
    if (S.view === 'genre' && S.genreId && genreOf(S.genreId)) return S.genreId;
    const other = S.genres.find(g => g.name === 'その他');
    return other ? other.id : (sortedGenres()[0] || {}).id;
  }

  function header(title, sub) {
    return `<header class="top"><h1>${esc(title)}</h1>${sub ? `<span class="sub">${sub}</span>` : ''}</header>
      ${DEMO ? '<div class="banner">デモモードです。データはこのブラウザだけに保存されます（config.js を設定すると同期されます）。</div>' : ''}`;
  }

  function viewToday() {
    const td = today();
    const d = L.parseYmd(td);
    const list = L.todayList(openTasks(), td);
    const groups = [
      [0, '期限切れ', true], [1, '今日締め切り', false], [2, '今日やる', false],
    ];
    let body = '';
    for (const [g, label, bad] of groups) {
      const items = list.filter(x => x.info.group === g).map(x => x.t);
      if (!items.length) continue;
      body += `<div class="section-h${bad ? ' bad' : ''}">${label}<span class="n">${items.length}</span></div>` + listBlock(items, { view: 'today' });
    }
    if (!body) body = '<div class="empty">今日のタスクはありません</div>';
    return header('今日', `${d.getMonth() + 1}月${d.getDate()}日（${L.WD[d.getDay()]}）`) + quickAdd('今日やること') + body;
  }

  function viewUpcoming() {
    const td = today();
    const items = openTasks().filter(t => !t.someday && !L.todayInfo(t, td) &&
      ((t.do_date && t.do_date > td) || (t.due_date && t.due_date > td)));
    const key = t => (t.do_date && t.do_date > td) ? t.do_date : t.due_date;
    items.sort((a, b) => key(a).localeCompare(key(b)) || a.priority - b.priority);
    const byDate = new Map();
    for (const t of items) { const k = key(t); if (!byDate.has(k)) byDate.set(k, []); byDate.get(k).push(t); }
    let body = '';
    for (const [k, ts] of byDate) body += `<div class="section-h">${L.dateLabel(k, td)}<span class="n">${ts.length}</span></div>` + listBlock(ts, { view: 'upcoming' });
    if (!body) body = '<div class="empty">明日以降の予定はありません</div>';
    return header('予定', '明日以降') + quickAdd('明日やること') + body;
  }

  function viewGenre() {
    const gs = sortedGenres();
    const hasNone = openTasks().some(t => !t.genre_id || !genreOf(t.genre_id));
    if (!S.genreId || (S.genreId !== 'none' && !genreOf(S.genreId))) S.genreId = gs[0] ? gs[0].id : 'none';
    const cnt = id => openTasks().filter(t => id === 'none' ? (!t.genre_id || !genreOf(t.genre_id)) : t.genre_id === id).length;
    const chips = gs.map(g => `<button class="chip${g.id === S.genreId ? ' active' : ''}" data-act="pickGenre" data-id="${g.id}"><i class="dot" style="background:${esc(g.color)}"></i>${esc(g.name)} <span class="muted">${cnt(g.id)}</span></button>`).join('')
      + (hasNone ? `<button class="chip${S.genreId === 'none' ? ' active' : ''}" data-act="pickGenre" data-id="none">未分類 <span class="muted">${cnt('none')}</span></button>` : '');
    const td = today();
    const items = openTasks().filter(t => S.genreId === 'none' ? (!t.genre_id || !genreOf(t.genre_id)) : t.genre_id === S.genreId);
    const k = t => [t.someday ? 1 : 0, (L.todayInfo(t, td) ? '0' : '1') + (t.due_date || t.do_date || '9999')];
    items.sort((a, b) => k(a)[0] - k(b)[0] || k(a)[1].localeCompare(k(b)[1]) || a.priority - b.priority);
    const g = genreOf(S.genreId);
    const body = items.length ? listBlock(items, { view: 'genre', showGenre: false }) : '<div class="empty">このジャンルのタスクはありません</div>';
    return header(g ? g.name : '未分類', `${items.length}件`) + `<div class="chips">${chips}</div>` + quickAdd(`${g ? g.name : 'タスク'}を追加`) + body;
  }

  function viewSomeday() {
    const items = openTasks().filter(t => t.someday);
    items.sort((a, b) => a.priority - b.priority || (a.created_at || '').localeCompare(b.created_at || ''));
    const body = items.length ? listBlock(items, { view: 'someday' }) : '<div class="empty">日付を決めていないアイデアをここに置けます</div>';
    return header('いつかやる', `${items.length}件`) + quickAdd('いつかやりたいこと') + body;
  }

  function viewSettings() {
    const gs = sortedGenres();
    const rows = gs.map((g, i) => `<div class="genre-row">
      <input type="color" value="${esc(g.color)}" data-change="genreColor" data-id="${g.id}" aria-label="色">
      <input type="text" value="${esc(g.name)}" data-change="genreName" data-id="${g.id}" aria-label="ジャンル名">
      <button class="icon-btn" data-act="genreUp" data-id="${g.id}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button class="icon-btn" data-act="genreDown" data-id="${g.id}" ${i === gs.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button class="icon-btn" data-act="genreDel" data-id="${g.id}" aria-label="削除">×</button></div>`).join('');
    return header('設定') +
      `<div class="section-h">ジャンル</div><div class="list">${rows}</div>
      <form class="quick" data-form="addGenre" style="margin-top:12px"><input type="text" id="ng-input" placeholder="新しいジャンル名" autocomplete="off"><button class="btn" type="submit">追加</button></form>
      <div class="section-h">アカウント</div>
      <div class="list" style="padding:14px;display:flex;align-items:center;gap:12px;justify-content:space-between">
        <span class="muted">${DEMO ? 'デモモード（同期なし）' : 'Supabaseに保存中'}</span>
        ${DEMO ? '' : '<button class="btn ghost" data-act="logout">ログアウト</button>'}
      </div>`;
  }

  function sidebar(c) {
    const nav = (v, label, extra = '') => `<button class="nav-item${S.view === v ? ' active' : ''}" data-act="nav" data-view="${v}">${ICON[v]}${label}${extra}</button>`;
    const gl = sortedGenres().map(g => {
      const n = openTasks().filter(t => t.genre_id === g.id).length;
      return `<button class="nav-item${S.view === 'genre' && S.genreId === g.id ? ' active' : ''}" data-act="nav" data-view="genre" data-id="${g.id}"><i class="dot" style="background:${esc(g.color)}"></i>${esc(g.name)}<span class="count">${n || ''}</span></button>`;
    }).join('');
    return `<aside class="side"><div class="brand">タスク</div>
      ${nav('today', '今日', `<span class="count${c.overdue ? ' bad' : ''}">${c.today || ''}</span>`)}
      ${nav('upcoming', '予定')}${nav('someday', 'いつかやる')}
      <div class="nav-label">ジャンル</div>${gl}
      <div class="nav-label"></div>${nav('settings', '設定')}</aside>`;
  }

  function tabbar(c) {
    return `<nav class="tabbar">${VIEWS.map(([v, label]) =>
      `<button class="tab${S.view === v ? ' active' : ''}" data-act="nav" data-view="${v}">${ICON[v]}${label}${v === 'today' && c.today ? `<span class="bdg">${c.today}</span>` : ''}</button>`).join('')}</nav>`;
  }

  function loginView() {
    return `<div class="login"><h1>タスク</h1>
      <form data-form="login">
        <div class="field"><label>メールアドレス</label><input type="email" id="lg-email" autocomplete="username" required></div>
        <div class="field"><label>パスワード</label><input type="password" id="lg-pass" autocomplete="current-password" required></div>
        <button class="btn" type="submit" style="width:100%">ログイン</button>
        ${S.loginErr ? `<div class="err">${esc(S.loginErr)}</div>` : ''}
      </form></div>`;
  }

  function render() {
    const app = document.getElementById('app');
    if (!S.ready) { app.innerHTML = ''; return; }
    if (!S.loggedIn) { app.innerHTML = loginView(); return; }
    const c = counts();
    const view = { today: viewToday, upcoming: viewUpcoming, genre: viewGenre, someday: viewSomeday, settings: viewSettings }[S.view] || viewToday;
    app.innerHTML = `<div class="layout">${sidebar(c)}<main class="main"><div class="main-inner">${view()}</div></main></div>${tabbar(c)}`;
    document.title = c.today ? `タスク（今日 ${c.today}）` : 'タスク';
  }

  // ---------- 編集画面 ----------
  function openEditor(t) {
    S.editor = t ? {
      id: t.id, title: t.title, genre_id: t.genre_id, do_date: t.do_date, due_date: t.due_date, priority: t.priority || 2,
      memo: t.memo || '', repeat_type: t.repeat_type || 'none', repeat_days: (t.repeat_days || []).map(Number),
      someday: !!t.someday, today: !!t.today_added,
    } : {
      id: null, title: '', genre_id: defaultGenreId(), do_date: null, due_date: null, priority: 2, memo: '',
      repeat_type: 'none', repeat_days: [], someday: S.view === 'someday', today: S.view === 'today',
    };
    renderEditor();
    setTimeout(() => { const el = document.getElementById('ed-title'); if (el && !t) el.focus(); }, 30);
  }

  function readEditorForm() {
    const e = S.editor; if (!e) return;
    const v = id => document.getElementById(id);
    if (!v('ed-title')) return;
    e.title = v('ed-title').value;
    e.genre_id = v('ed-genre').value || null;
    e.do_date = v('ed-do').value || null;
    e.due_date = v('ed-due').value || null;
    e.repeat_type = v('ed-repeat').value;
    e.someday = v('ed-someday').checked;
    e.today = v('ed-today').checked;
    e.memo = v('ed-memo').value;
  }

  function renderEditor() {
    const m = document.getElementById('modal');
    const e = S.editor;
    if (!e) { m.innerHTML = ''; return; }
    const gopts = sortedGenres().map(g => `<option value="${g.id}"${g.id === e.genre_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('')
      + `<option value=""${!e.genre_id ? ' selected' : ''}>未分類</option>`;
    const rep = [['none', 'なし'], ['daily', '毎日'], ['weekly', '毎週（同じ曜日）'], ['weekdays', '毎週（曜日を指定）'], ['monthly', '毎月（同じ日）']]
      .map(([v, l]) => `<option value="${v}"${v === e.repeat_type ? ' selected' : ''}>${l}</option>`).join('');
    const wd = e.repeat_type === 'weekdays'
      ? `<div class="wd">${[1, 2, 3, 4, 5, 6, 0].map(d => `<button type="button" class="${e.repeat_days.includes(d) ? 'on' : ''}" data-act="edWd" data-d="${d}">${L.WD[d]}</button>`).join('')}</div>` : '';
    const repHint = (e.repeat_type !== 'none' && !e.do_date && !e.due_date) ? '<div class="muted" style="margin-top:6px">日付がない場合は、完了した翌日以降の日付で次の回を作ります</div>' : '';
    m.innerHTML = `<div class="overlay" data-act="edCloseBg"><div class="sheet" role="dialog" aria-modal="true">
      <h2>${e.id ? 'タスクを編集' : '新しいタスク'}</h2>
      <form data-form="editor">
        <div class="field"><input type="text" id="ed-title" value="${esc(e.title)}" placeholder="タスク名" autocomplete="off" required></div>
        <div class="field"><label>ジャンル</label><select id="ed-genre">${gopts}</select></div>
        <div class="row2">
          <div class="field"><label>やる日</label><div class="datewrap"><input type="date" id="ed-do" value="${e.do_date || ''}"><button type="button" data-act="edClear" data-f="ed-do" aria-label="やる日を消す">×</button></div></div>
          <div class="field"><label>締め切り</label><div class="datewrap"><input type="date" id="ed-due" value="${e.due_date || ''}"><button type="button" data-act="edClear" data-f="ed-due" aria-label="締め切りを消す">×</button></div></div>
        </div>
        <div class="field"><span class="lbl">優先度</span><div class="seg">${[1, 2, 3].map(p => `<button type="button" class="${e.priority === p ? 'on' : ''}" data-act="edPri" data-p="${p}">${PRI[p]}</button>`).join('')}</div></div>
        <div class="field"><label>繰り返し</label><select id="ed-repeat" data-change="edRepeat">${rep}</select>${wd}${repHint}</div>
        <div class="toggle"><span>今日のリストに入れる</span><input type="checkbox" id="ed-today" ${e.today ? 'checked' : ''}></div>
        <div class="toggle" style="margin-bottom:12px"><span>いつかやる</span><input type="checkbox" id="ed-someday" ${e.someday ? 'checked' : ''}></div>
        <div class="field"><label>メモ</label><textarea id="ed-memo" rows="3">${esc(e.memo)}</textarea></div>
        <div class="actions">
          ${e.id ? '<button type="button" class="btn danger" data-act="edDelete">削除</button>' : ''}
          <span class="spacer"></span>
          <button type="button" class="btn ghost" data-act="edClose">キャンセル</button>
          <button type="submit" class="btn">保存</button>
        </div>
      </form></div></div>`;
  }

  function saveEditor() {
    readEditorForm();
    const e = S.editor;
    const title = e.title.trim();
    if (!title) { document.getElementById('ed-title').focus(); return; }
    if (e.repeat_type === 'weekdays' && !e.repeat_days.length) { showToast('曜日を1つ以上選んでください'); return; }
    const fields = {
      title, genre_id: e.genre_id, do_date: e.do_date, due_date: e.due_date, priority: e.priority, memo: e.memo,
      repeat_type: e.repeat_type, repeat_days: e.repeat_type === 'weekdays' ? e.repeat_days.slice().sort() : [],
      someday: e.someday,
    };
    if (e.id) {
      const t = S.tasks.find(x => x.id === e.id);
      if (t) { fields.today_added = e.today ? (t.today_added || today()) : null; patchTask(t, fields); }
    } else {
      fields.today_added = e.today ? today() : null;
      addTask(fields);
    }
    S.editor = null; renderEditor(); render();
  }

  // ---------- トースト ----------
  let toastTimer = null;
  function showToast(msg, undo) {
    S.toast = { msg, undo };
    const el = document.getElementById('toast');
    el.innerHTML = `<div class="toast"><span>${esc(msg)}</span>${undo ? '<button data-act="undo">元に戻す</button>' : ''}</div>`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { S.toast = null; el.innerHTML = ''; }, 5000);
  }

  // ---------- 画面遷移 ----------
  function go(view, id) {
    S.view = view;
    if (view === 'genre' && id) S.genreId = id;
    const hash = view === 'genre' && S.genreId ? `#genre/${S.genreId}` : `#${view}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
    render();
    window.scrollTo(0, 0);
  }
  function fromHash() {
    const [v, id] = location.hash.replace('#', '').split('/');
    if (VIEWS.some(x => x[0] === v)) { S.view = v; if (v === 'genre' && id) S.genreId = id; }
  }

  // ---------- イベント ----------
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const id = el.dataset.id;
    const t = id ? S.tasks.find(x => x.id === id) : null;
    switch (act) {
      case 'nav': go(el.dataset.view, id); break;
      case 'pickGenre': go('genre', id); break;
      case 'done': ev.stopPropagation(); if (t) completeTask(t); break;
      case 'toToday': ev.stopPropagation(); if (t) { patchTask(t, { today_added: today(), someday: false }); render(); } break;
      case 'offToday': ev.stopPropagation(); if (t) { patchTask(t, { today_added: null }); render(); } break;
      case 'open': if (t) openEditor(t); break;
      case 'undo': if (S.toast && S.toast.undo) { const u = S.toast.undo; S.toast = null; document.getElementById('toast').innerHTML = ''; u(); } break;
      case 'edCloseBg': if (ev.target === el) { S.editor = null; renderEditor(); } break;
      case 'edClose': S.editor = null; renderEditor(); break;
      case 'edClear': document.getElementById(el.dataset.f).value = ''; break;
      case 'edPri': readEditorForm(); S.editor.priority = Number(el.dataset.p); renderEditor(); break;
      case 'edWd': {
        readEditorForm();
        const d = Number(el.dataset.d), ds = S.editor.repeat_days;
        S.editor.repeat_days = ds.includes(d) ? ds.filter(x => x !== d) : ds.concat(d);
        renderEditor(); break;
      }
      case 'edDelete': {
        const tt = S.tasks.find(x => x.id === S.editor.id);
        if (tt && confirm(`「${tt.title}」を削除しますか？`)) { deleteTask(tt); S.editor = null; renderEditor(); render(); }
        break;
      }
      case 'genreUp': case 'genreDown': {
        const gs = sortedGenres(); const i = gs.findIndex(g => g.id === id); const j = act === 'genreUp' ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= gs.length) break;
        [gs[i], gs[j]] = [gs[j], gs[i]];
        gs.forEach((g, k) => { if (g.sort_order !== k) { g.sort_order = k; persist(() => store.update('genres', g.id, { sort_order: k })); } });
        render(); break;
      }
      case 'genreDel': {
        const g = genreOf(id); if (!g) break;
        const n = openTasks().filter(x => x.genre_id === id).length;
        if (!confirm(`ジャンル「${g.name}」を削除しますか？${n ? `\nこのジャンルのタスク${n}件は「未分類」になります。` : ''}`)) break;
        S.genres = S.genres.filter(x => x !== g);
        S.tasks.forEach(x => { if (x.genre_id === id) x.genre_id = null; });
        persist(() => store.remove('genres', id));
        render(); break;
      }
      case 'logout': if (confirm('ログアウトしますか？')) { store.signOut().then(() => { S.loggedIn = false; S.tasks = []; S.genres = []; render(); }); } break;
    }
  });

  document.addEventListener('change', ev => {
    const el = ev.target.closest('[data-change]');
    if (!el) return;
    const g = genreOf(el.dataset.id);
    switch (el.dataset.change) {
      case 'genreName': {
        const name = el.value.trim();
        if (!g) break;
        if (!name) { el.value = g.name; break; }
        g.name = name; persist(() => store.update('genres', g.id, { name })); render(); break;
      }
      case 'genreColor': if (g) { g.color = el.value; persist(() => store.update('genres', g.id, { color: el.value })); render(); } break;
      case 'edRepeat': readEditorForm(); renderEditor(); break;
    }
  });

  document.addEventListener('submit', async ev => {
    const f = ev.target.closest('[data-form]');
    if (!f) return;
    ev.preventDefault();
    switch (f.dataset.form) {
      case 'quick': {
        const input = document.getElementById('qa-input');
        const title = input.value.trim();
        if (!title) return;
        const fields = { title, genre_id: document.getElementById('qa-genre').value || null };
        if (S.view === 'today') fields.today_added = today();
        if (S.view === 'upcoming') fields.do_date = L.addDays(today(), 1);
        if (S.view === 'someday') fields.someday = true;
        addTask(fields);
        render();
        const again = document.getElementById('qa-input'); if (again) again.focus();
        break;
      }
      case 'addGenre': {
        const input = document.getElementById('ng-input');
        const name = input.value.trim(); if (!name) return;
        const g = { id: uuid(), name, color: '#8e8e93', sort_order: S.genres.reduce((m, x) => Math.max(m, x.sort_order), -1) + 1 };
        S.genres.push(g); persist(() => store.insert('genres', g)); render();
        const again = document.getElementById('ng-input'); if (again) again.focus();
        break;
      }
      case 'editor': saveEditor(); break;
      case 'login': {
        const email = document.getElementById('lg-email').value.trim();
        const pass = document.getElementById('lg-pass').value;
        try {
          await store.signIn(email, pass);
          S.loggedIn = true; S.loginErr = '';
          render(); await reload();
        } catch (e) {
          S.loginErr = 'ログインできませんでした。メールアドレスとパスワードを確認してください。';
          render();
        }
        break;
      }
    }
  });

  document.addEventListener('keydown', ev => {
    if (ev.key === 'Escape' && S.editor) { S.editor = null; renderEditor(); }
  });

  // 他の端末での変更を取り込む
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && S.loggedIn && !S.editor && Date.now() - S.lastLoad > 20000) reload();
  });
  // 日付が変わったら表示を更新
  let lastDay = today();
  setInterval(() => { if (today() !== lastDay) { lastDay = today(); render(); } }, 60000);

  window.addEventListener('hashchange', () => { fromHash(); render(); });

  // ---------- 起動 ----------
  (async function start() {
    fromHash();
    let session = null;
    try { session = await store.session(); } catch (e) { console.error(e); }
    S.ready = true;
    S.loggedIn = !!session;
    render();
    if (S.loggedIn) await reload();
    if (!DEMO && store.sb) {
      store.sb.auth.onAuthStateChange((evt, s) => {
        if (evt === 'SIGNED_OUT') { S.loggedIn = false; render(); }
      });
    }
  })();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => { });
  }
})();
