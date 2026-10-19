// タスク ウィジェット（Scriptable用）
// 1. 下の3つを設定する
// 2. Scriptableアプリでこのスクリプトを1回実行し、ログインする
// 3. ホーム画面にScriptableのウィジェット（中 or 大）を置き、このスクリプトを選ぶ

const SUPABASE_URL = "";  // config.js と同じ
const SUPABASE_KEY = "";  // config.js と同じ
const APP_URL = "";       // Web版のURL（例: https://xxxx.github.io/tasktool/）

// ---------------------------------------------
const KC_KEY = "tasktool_refresh_token";
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "tasktool_cache.json");

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const WD = ["日", "月", "火", "水", "木", "金", "土"];

async function auth(body, grant) {
  const req = new Request(`${SUPABASE_URL}/auth/v1/token?grant_type=${grant}`);
  req.method = "POST";
  req.headers = { apikey: SUPABASE_KEY, "Content-Type": "application/json" };
  req.body = JSON.stringify(body);
  const res = await req.loadJSON();
  if (!res.access_token) throw new Error(res.error_description || res.msg || "ログインに失敗しました");
  Keychain.set(KC_KEY, res.refresh_token);
  return res.access_token;
}

async function getToken() {
  if (Keychain.contains(KC_KEY)) {
    try { return await auth({ refresh_token: Keychain.get(KC_KEY) }, "refresh_token"); } catch (e) { }
  }
  if (config.runsInWidget) throw new Error("Scriptableでこのスクリプトを実行してログインしてください");
  const a = new Alert();
  a.title = "タスクにログイン";
  a.message = "Web版と同じメールアドレスとパスワード";
  a.addTextField("メールアドレス");
  a.addSecureTextField("パスワード");
  a.addAction("ログイン");
  a.addCancelAction("キャンセル");
  if (await a.present() === -1) throw new Error("キャンセルしました");
  return await auth({ email: a.textFieldValue(0).trim(), password: a.textFieldValue(1) }, "password");
}

async function rest(path, token) {
  const req = new Request(`${SUPABASE_URL}/rest/v1/${path}`);
  req.headers = { apikey: SUPABASE_KEY, Authorization: `Bearer ${token}` };
  const res = await req.loadJSON();
  if (!Array.isArray(res)) throw new Error(res.message || "読み込みに失敗しました");
  return res;
}

async function loadData() {
  try {
    const token = await getToken();
    const [tasks, genres] = await Promise.all([
      rest("tasks?select=*&completed=eq.false", token),
      rest("genres?select=*", token),
    ]);
    const data = { tasks, genres, at: Date.now() };
    fm.writeString(CACHE, JSON.stringify(data));
    return data;
  } catch (e) {
    if (fm.fileExists(CACHE)) {
      const data = JSON.parse(fm.readString(CACHE));
      data.stale = true;
      return data;
    }
    throw e;
  }
}

// Web版と同じ「今日」のルール
function todayInfo(t, today) {
  if (t.completed) return null;
  const overdue = !!t.due_date && t.due_date < today;
  const dueToday = t.due_date === today;
  const planned = !t.someday && !!t.do_date && t.do_date <= today;
  const manual = !t.someday && !!t.today_added && t.today_added <= today;
  if (!(overdue || dueToday || planned || manual)) return null;
  return { group: overdue ? 0 : dueToday ? 1 : 2, overdue, dueToday };
}

function todayList(tasks, today) {
  return tasks
    .map(t => ({ t, info: todayInfo(t, today) }))
    .filter(x => x.info)
    .sort((a, b) =>
      a.info.group - b.info.group ||
      (a.t.priority || 2) - (b.t.priority || 2) ||
      (a.t.due_date || "9999").localeCompare(b.t.due_date || "9999") ||
      (a.t.created_at || "").localeCompare(b.t.created_at || ""));
}

// ---------- 描画 ----------
const C = {
  bg: Color.dynamic(new Color("#ffffff"), new Color("#1f1f22")),
  text: Color.dynamic(new Color("#1d1d1f"), new Color("#f2f2f3")),
  sub: Color.dynamic(new Color("#6e6e73"), new Color("#a1a1a6")),
  danger: Color.dynamic(new Color("#d93a3a"), new Color("#ff6b6b")),
  accent: Color.dynamic(new Color("#3b6ef5"), new Color("#7393fb")),
};

function build(data) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.setPadding(14, 16, 12, 16);
  if (APP_URL) w.url = APP_URL.replace(/#.*$/, "") + "#today";
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);

  const now = new Date();
  const today = ymd(now);
  const list = todayList(data.tasks, today);
  const overdue = list.filter(x => x.info.overdue).length;
  const genres = {};
  for (const g of data.genres) genres[g.id] = g;

  const fam = config.widgetFamily || "large";
  const max = fam === "small" ? 3 : fam === "medium" ? 4 : 11;

  // 見出し
  const head = w.addStack();
  head.centerAlignContent();
  const t1 = head.addText("今日");
  t1.font = Font.boldSystemFont(15); t1.textColor = C.text;
  head.addSpacer(6);
  const t2 = head.addText(`${list.length}件`);
  t2.font = Font.semiboldSystemFont(15); t2.textColor = C.accent;
  if (overdue) {
    head.addSpacer(6);
    const t3 = head.addText(`期限切れ ${overdue}`);
    t3.font = Font.semiboldSystemFont(12); t3.textColor = C.danger;
  }
  head.addSpacer();
  if (fam !== "small") {
    const d = head.addText(`${now.getMonth() + 1}/${now.getDate()}(${WD[now.getDay()]})`);
    d.font = Font.systemFont(12); d.textColor = C.sub;
  }
  w.addSpacer(8);

  if (!list.length) {
    const e = w.addText("今日のタスクはありません");
    e.font = Font.systemFont(13); e.textColor = C.sub;
  }

  for (const { t, info } of list.slice(0, max)) {
    const row = w.addStack();
    row.centerAlignContent();
    const g = genres[t.genre_id];
    const dot = row.addText("●");
    dot.font = Font.systemFont(9);
    dot.textColor = g ? new Color(g.color) : C.sub;
    row.addSpacer(6);
    const tt = row.addText(t.title);
    tt.font = Font.systemFont(fam === "small" ? 12 : 13.5);
    tt.textColor = info.overdue ? C.danger : C.text;
    tt.lineLimit = 1;
    if (info.dueToday && fam !== "small") {
      row.addSpacer(6);
      const b = row.addText("今日締切");
      b.font = Font.semiboldSystemFont(10.5); b.textColor = C.danger;
    }
    row.addSpacer();
    w.addSpacer(fam === "large" ? 6 : 4);
  }

  if (list.length > max) {
    const more = w.addText(`ほか${list.length - max}件`);
    more.font = Font.systemFont(11.5); more.textColor = C.sub;
  }
  w.addSpacer();
  if (data.stale) {
    const s = w.addText("オフライン（前回のデータ）");
    s.font = Font.systemFont(10); s.textColor = C.sub;
  }
  return w;
}

function errorWidget(msg) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  const t = w.addText("タスク");
  t.font = Font.boldSystemFont(14); t.textColor = C.text;
  w.addSpacer(6);
  const m = w.addText(msg);
  m.font = Font.systemFont(12); m.textColor = C.sub;
  return w;
}

let widget;
try {
  if (!SUPABASE_URL || !SUPABASE_KEY) throw new Error("スクリプト冒頭の SUPABASE_URL と SUPABASE_KEY を設定してください");
  widget = build(await loadData());
} catch (e) {
  widget = errorWidget(e.message);
}

if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();
}
Script.complete();
