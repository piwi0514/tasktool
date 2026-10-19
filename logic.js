// 日付・「今日」判定・繰り返しの共通ロジック
(function (root) {
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const parseYmd = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
  const diffDays = (a, b) => Math.round((parseYmd(a) - parseYmd(b)) / 864e5);
  const WD = ['日', '月', '火', '水', '木', '金', '土'];

  function addMonth(s, anchorDay) {
    const d = parseYmd(s);
    let y = d.getFullYear(), m = d.getMonth() + 1;
    if (m > 11) { y++; m = 0; }
    const dim = new Date(y, m + 1, 0).getDate();
    return ymd(new Date(y, m, Math.min(anchorDay, dim)));
  }

  function stepDate(s, t, anchorDay) {
    switch (t.repeat_type) {
      case 'daily': return addDays(s, 1);
      case 'weekly': return addDays(s, 7);
      case 'weekdays': {
        const days = (t.repeat_days || []).map(Number);
        if (!days.length) return addDays(s, 7);
        for (let i = 1; i <= 7; i++) {
          const c = addDays(s, i);
          if (days.includes(parseYmd(c).getDay())) return c;
        }
        return addDays(s, 7);
      }
      case 'monthly': return addMonth(s, anchorDay);
      default: return null;
    }
  }

  // 繰り返しタスクを完了したときの「次の回」を作る（日付は今日より後になるまで進める）
  function nextInstance(t, today, newId) {
    const base = t.do_date || t.due_date || today;
    const anchorDay = parseYmd(base).getDate();
    let next = stepDate(base, t, anchorDay);
    let guard = 0;
    while (next <= today && guard++ < 2000) next = stepDate(next, t, anchorDay);
    const delta = diffDays(next, base);
    return {
      id: newId,
      title: t.title,
      genre_id: t.genre_id,
      priority: t.priority,
      memo: t.memo || '',
      repeat_type: t.repeat_type,
      repeat_days: t.repeat_days || [],
      someday: !!t.someday,
      do_date: t.do_date ? addDays(t.do_date, delta) : (t.due_date ? null : next),
      due_date: t.due_date ? addDays(t.due_date, delta) : null,
      today_added: null,
      completed: false,
      completed_at: null,
      spawned_id: null,
    };
  }

  // 「今日」に出すか。出すなら group 0=期限切れ 1=今日締め切り 2=今日やる
  function todayInfo(t, today) {
    if (t.completed) return null;
    const overdue = !!t.due_date && t.due_date < today;
    const dueToday = t.due_date === today;
    const planned = !t.someday && !!t.do_date && t.do_date <= today;
    const manual = !t.someday && !!t.today_added && t.today_added <= today;
    if (!(overdue || dueToday || planned || manual)) return null;
    return {
      group: overdue ? 0 : dueToday ? 1 : 2,
      overdue, dueToday,
      manualOnly: manual && !overdue && !dueToday && !planned,
    };
  }

  function todayList(tasks, today) {
    return tasks
      .map(t => ({ t, info: todayInfo(t, today) }))
      .filter(x => x.info)
      .sort((a, b) =>
        a.info.group - b.info.group ||
        (a.t.priority || 2) - (b.t.priority || 2) ||
        (a.t.due_date || '9999').localeCompare(b.t.due_date || '9999') ||
        (a.t.created_at || '').localeCompare(b.t.created_at || ''));
  }

  function repeatLabel(t) {
    const base = t.do_date || t.due_date;
    switch (t.repeat_type) {
      case 'daily': return '毎日';
      case 'weekly': return base ? `毎週${WD[parseYmd(base).getDay()]}曜` : '毎週';
      case 'weekdays': return '毎週 ' + (t.repeat_days || []).slice().sort((a, b) => a - b).map(d => WD[d]).join('・');
      case 'monthly': return base ? `毎月${parseYmd(base).getDate()}日` : '毎月';
      default: return '';
    }
  }

  function dateLabel(s, today) {
    if (!s) return '';
    const d = diffDays(s, today);
    if (d === 0) return '今日';
    if (d === 1) return '明日';
    if (d === -1) return '昨日';
    const x = parseYmd(s);
    const y = x.getFullYear() !== parseYmd(today).getFullYear() ? `${x.getFullYear()}/` : '';
    return `${y}${x.getMonth() + 1}/${x.getDate()}(${WD[x.getDay()]})`;
  }

  const api = { pad, ymd, todayStr, parseYmd, addDays, diffDays, addMonth, nextInstance, todayInfo, todayList, repeatLabel, dateLabel, WD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TaskLogic = api;
})(typeof window !== 'undefined' ? window : globalThis);
