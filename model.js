// Pure time and backup rules shared by the UI and the verification suite.
export const VERSION = 2;
export const PLAN_STATUSES = { pending: '未完成', partial: '部分完成', done: '已完成' };
export const REFLECTION_FIELDS = { good: '今天做得好的', improve: '需要改进的', next: '下一步怎么做' };
export const CORE_IDS = ['sleep', 'study', 'leisure'];
export const PALETTE = ['#829987', '#c88869', '#d7a672', '#8196ac', '#9d88a8', '#749d9d'];

export function dateKey(value = Date.now()) {
  const d = new Date(value);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function validDay(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) return false;
  const d = new Date(`${key}T12:00:00`);
  return Number.isFinite(d.getTime()) && dateKey(d) === key;
}

export function addDays(key, count) {
  const d = new Date(`${key}T12:00:00`);
  d.setDate(d.getDate() + count);
  return dateKey(d);
}

export function dayBounds(key) {
  if (!validDay(key)) throw new Error('日期不正确');
  return [new Date(`${key}T00:00:00`).getTime(), new Date(`${addDays(key, 1)}T00:00:00`).getTime()];
}

export function initialState(today = dateKey()) {
  return {
    version: VERSION,
    createdOn: today,
    categories: [
      { id: 'sleep', name: '睡眠', color: PALETTE[0], icon: 'moon', core: true, defaults: [{ from: today, to: null }] },
      { id: 'study', name: '学习', color: PALETTE[1], icon: 'book', core: true, defaults: [{ from: today, to: null }] },
      { id: 'leisure', name: '休闲', color: PALETTE[2], icon: 'coffee', core: true, defaults: [{ from: today, to: null }] },
    ],
    dayCategories: {},
    goals: {},
    notes: {},
    plans: {},
    reflections: {},
    sessions: [],
    active: null,
  };
}

export function uid() {
  return crypto.randomUUID();
}

// Plans belong to the day on which they were made. The following day's review
// reads those same items, so edits never create a second, divergent copy.
export function migrateState(state) {
  if (![1, VERSION].includes(state.version)) throw new Error('不支持的数据版本');
  state.plans ??= {};
  state.reflections ??= {};
  state.version = VERSION;
  return state;
}

export function plansForReview(state, day) {
  return state.plans?.[addDays(day, -1)] || [];
}

export function addPlan(state, day, text) {
  if (!validDay(day) || typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('请填写1至1000字的计划');
  const items = state.plans[day] || [];
  if (items.length >= 200) throw new Error('每天最多200项计划');
  const item = { id: uid(), text: text.trim(), status: 'pending', reason: '' };
  state.plans[day] = [...items, item];
  return item;
}

export function updatePlan(state, day, id, changes) {
  const item = state.plans[day]?.find(p => p.id === id);
  if (!item) throw new Error('这项计划已被删除，请重新打开');
  if (Object.hasOwn(changes, 'text')) {
    if (typeof changes.text !== 'string' || changes.text.length > 1000) throw new Error('计划最多1000字');
    item.text = changes.text;
  }
  if (Object.hasOwn(changes, 'status')) {
    if (!Object.hasOwn(PLAN_STATUSES, changes.status)) throw new Error('完成状态不正确');
    item.status = changes.status;
  }
  if (Object.hasOwn(changes, 'reason')) {
    if (typeof changes.reason !== 'string' || changes.reason.length > 10000) throw new Error('完成说明最多10000字');
    item.reason = changes.reason;
  }
}

export function deletePlan(state, day, id) {
  state.plans[day] = (state.plans[day] || []).filter(p => p.id !== id);
}

export function saveReflection(state, day, field, text) {
  if (!validDay(day) || !Object.hasOwn(REFLECTION_FIELDS, field) || typeof text !== 'string' || text.length > 200000) throw new Error('反思内容不正确或过长');
  state.reflections[day] ||= { good: '', improve: '', next: '' };
  state.reflections[day][field] = text;
}

export function isDefault(category, day) {
  return category.core || category.defaults.some(p => p.from <= day && (p.to === null || p.to >= day));
}

export function isOngoingDefault(category) {
  return category.core || category.defaults.some(p => p.to === null);
}

export function touchCategory(state, day, id) {
  const ids = state.dayCategories[day] || [];
  if (!ids.includes(id)) state.dayCategories[day] = [...ids, id];
}

export function categoryVisible(state, category, day, now = Date.now()) {
  if (isDefault(category, day)) return true;
  if ((state.dayCategories[day] || []).includes(category.id)) return true;
  if (Object.hasOwn(state.notes[day] || {}, category.id)) return true;
  if (Object.hasOwn(state.goals[day] || {}, category.id)) return true;
  const [start, end] = dayBounds(day);
  return state.sessions.some(s => s.categoryId === category.id && s.start < end && s.end > start) ||
    Boolean(state.active && state.active.categoryId === category.id && state.active.start < end && now > start);
}

export function visibleCategories(state, day, now = Date.now()) {
  return state.categories.filter(c => categoryVisible(state, c, day, now));
}

export function daySegments(state, day, now = Date.now()) {
  const [start, end] = dayBounds(day);
  const all = [...state.sessions];
  if (state.active) all.push({ ...state.active, end: Math.max(now, state.active.start), running: true });
  return all.filter(s => s.start < end && s.end > start).map(s => ({
    ...s, clippedStart: Math.max(s.start, start), clippedEnd: Math.min(s.end, end),
    duration: Math.max(0, Math.min(s.end, end) - Math.max(s.start, start)),
  })).sort((a, b) => b.clippedStart - a.clippedStart);
}

export function totalsForDay(state, day, now = Date.now()) {
  const totals = {};
  for (const s of daySegments(state, day, now)) totals[s.categoryId] = (totals[s.categoryId] || 0) + s.duration;
  return totals;
}

export function completion(state, day, now = Date.now()) {
  const totals = totalsForDay(state, day, now);
  const goals = state.goals[day] || {};
  const ids = Object.keys(goals);
  const target = ids.reduce((n, id) => n + goals[id], 0);
  const achieved = ids.reduce((n, id) => n + Math.min(totals[id] || 0, goals[id]), 0);
  return { count: ids.length, completed: ids.filter(id => (totals[id] || 0) >= goals[id]).length, progress: target ? achieved / target : null };
}

export function overlaps(state, start, end, ignoreId = null, now = Date.now()) {
  const all = [...state.sessions];
  if (state.active) all.push({ ...state.active, end: Math.max(now, state.active.start), running: true });
  return all.filter(s => s.id !== ignoreId && s.start < end && s.end > start);
}

export function startTimer(state, categoryId, now = Date.now()) {
  if (state.active) throw new Error('请先结束当前计时，再开始其他类别');
  if (!state.categories.some(c => c.id === categoryId)) throw new Error('类别不存在');
  if (overlaps(state, now, now + 1, null, now).length) throw new Error('当前时间与已有记录重叠，请先修改记录');
  touchCategory(state, dateKey(now), categoryId);
  state.active = { id: uid(), categoryId, start: now };
}

export function stopTimer(state, now = Date.now()) {
  if (!state.active) throw new Error('当前没有正在进行的计时');
  if (now < state.active.start) throw new Error('设备时间早于开始时间，请校准系统时间后重试');
  if (now > state.active.start) state.sessions.push({ ...state.active, end: now });
  state.active = null;
}

export function setDefault(state, categoryId, enabled, today = dateKey()) {
  const category = state.categories.find(c => c.id === categoryId);
  if (!category || category.core) return;
  touchCategory(state, today, categoryId);
  if (enabled && !isOngoingDefault(category)) category.defaults.push({ from: today, to: null });
  if (!enabled) category.defaults.forEach(p => { if (p.to === null) p.to = today; });
}

// Replace only the overlapping portion; preserve both unaffected ends of old sessions.
export function saveSession(state, session, replace = false, now = Date.now()) {
  const { start, end, categoryId } = session;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('结束时间必须晚于开始时间');
  if (end > now) throw new Error('不能补记未来时间');
  if (!state.categories.some(c => c.id === categoryId)) throw new Error('请选择有效类别');
  const conflicts = overlaps(state, start, end, session.id, now);
  if (conflicts.some(c => c.running)) throw new Error('与正在进行的计时重叠，请先结束计时');
  if (conflicts.length && !replace) {
    const error = new Error('这段时间与已有记录重叠');
    error.conflicts = conflicts;
    throw error;
  }
  const conflictIds = new Set(conflicts.map(c => c.id));
  const next = [];
  for (const old of state.sessions) {
    if (old.id === session.id) continue;
    if (!conflictIds.has(old.id)) { next.push(old); continue; }
    if (old.start < start) next.push({ ...old, id: uid(), end: start });
    if (old.end > end) next.push({ ...old, id: uid(), start: end });
  }
  next.push({ id: session.id || uid(), categoryId, start, end });
  state.sessions = next;
  touchCategory(state, dateKey(start), categoryId);
}

export function formatDuration(ms, seconds = false) {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), s = total % 60;
  return seconds ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${h}小时 ${String(m).padStart(2, '0')}分`;
}

export function shortDuration(ms) {
  if (!ms) return '—';
  const m = Math.floor(ms / 60000);
  if (!m) return '<1分';
  return m >= 60 ? `${Math.floor(m / 60)}时${m % 60 ? `${m % 60}分` : ''}` : `${m}分`;
}

export function makeBackup(state) {
  return { app: 'time-balance', formatVersion: VERSION, exportedAt: new Date().toISOString(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, data: state };
}

function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function assert(condition, message) { if (!condition) throw new Error(`备份无效：${message}`); }
function safeMap(value, label) {
  assert(record(value), `${label}格式不正确`);
  assert(!Object.keys(value).some(k => ['__proto__', 'constructor', 'prototype'].includes(k)), `${label}含非法字段`);
}

export function validateBackup(input) {
  assert(record(input) && input.app === 'time-balance' && [1, VERSION].includes(input.formatVersion), '不是时光簿支持的备份文件');
  const d = input.data;
  assert(record(d) && d.version === input.formatVersion && validDay(d.createdOn), '数据版本或创建日期不正确');
  assert(Array.isArray(d.categories) && d.categories.length >= 3 && d.categories.length <= 300, '类别数量不正确');
  const ids = new Set();
  const categories = d.categories.map(c => {
    assert(record(c) && typeof c.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(c.id) && !ids.has(c.id), '类别标识不正确或重复');
    assert(!['__proto__', 'constructor', 'prototype'].includes(c.id), '类别标识不正确');
    ids.add(c.id);
    assert(typeof c.name === 'string' && c.name.trim().length > 0 && c.name.length <= 40, '类别名称不正确');
    assert(typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color), '类别颜色不正确');
    assert(Array.isArray(c.defaults) && c.defaults.length <= 10000, '默认类别规则不正确');
    const defaults = c.defaults.map(p => {
      assert(record(p) && validDay(p.from) && (p.to === null || validDay(p.to) && p.to >= p.from), '默认类别日期不正确');
      return { from: p.from, to: p.to };
    });
    assert(defaults.filter(p => p.to === null).length <= 1, '默认类别规则重复');
    return { id: c.id, name: c.name, color: c.color, icon: ['moon', 'book', 'coffee', 'activity', 'sparkles', 'music'].includes(c.icon) ? c.icon : 'activity', core: CORE_IDS.includes(c.id), defaults };
  });
  assert(CORE_IDS.every(id => ids.has(id)), '缺少基础类别');
  for (const field of ['notes', 'goals', 'dayCategories']) safeMap(d[field], field);
  const notes = {}, goals = {}, dayCategories = {};
  for (const [day, entries] of Object.entries(d.notes)) {
    assert(validDay(day), '笔记日期不正确'); safeMap(entries, '笔记'); notes[day] = {};
    for (const [id, value] of Object.entries(entries)) {
      assert(ids.has(id) && record(value) && typeof value.text === 'string' && value.text.length <= 200000 && typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt)), '笔记内容不正确');
      notes[day][id] = { text: value.text, updatedAt: value.updatedAt };
    }
  }
  for (const [day, entries] of Object.entries(d.goals)) {
    assert(validDay(day), '目标日期不正确'); safeMap(entries, '目标'); goals[day] = {};
    for (const [id, value] of Object.entries(entries)) {
      assert(ids.has(id) && Number.isFinite(value) && value > 0 && value <= 86400000, '单个目标须在24小时内');
      goals[day][id] = value;
    }
  }
  for (const [day, entries] of Object.entries(d.dayCategories)) {
    assert(validDay(day) && Array.isArray(entries) && entries.length <= 300 && entries.every(id => ids.has(id)), '当日类别不正确');
    dayCategories[day] = [...new Set(entries)];
  }
  assert(Array.isArray(d.sessions) && d.sessions.length <= 200000, '时间记录数量不正确');
  const sessionIds = new Set();
  const timestampValid = n => Number.isFinite(n) && n >= 0 && n <= 4102444800000;
  const sessions = d.sessions.map(s => {
    assert(record(s) && typeof s.id === 'string' && s.id.length <= 100 && !sessionIds.has(s.id) && ids.has(s.categoryId), '时间记录标识不正确');
    sessionIds.add(s.id);
    assert(timestampValid(s.start) && timestampValid(s.end) && s.end > s.start, '时间记录起止不正确');
    return { id: s.id, categoryId: s.categoryId, start: s.start, end: s.end };
  }).sort((a, b) => a.start - b.start);
  assert(sessions.every((s, i) => !i || sessions[i - 1].end <= s.start), '含有重叠时间记录');
  let active = null;
  if (d.active !== null) {
    const a = d.active;
    assert(record(a) && typeof a.id === 'string' && a.id.length <= 100 && !sessionIds.has(a.id) && ids.has(a.categoryId) && timestampValid(a.start), '正在计时的数据不正确');
    assert(!sessions.some(s => s.end > a.start), '正在计时与其他记录重叠');
    active = { id: a.id, categoryId: a.categoryId, start: a.start };
  }
  const plans = {}, reflections = {};
  // A v2 backup must contain both fields. Only original v1 backups may omit them.
  for (const field of ['plans', 'reflections']) safeMap(d[field] === undefined && d.version === 1 ? {} : d[field], field);
  for (const [day, items] of Object.entries(d.plans || {})) {
    assert(validDay(day) && Array.isArray(items) && items.length <= 200, '计划日期或数量不正确');
    const itemIds = new Set();
    plans[day] = items.map(p => {
      assert(record(p) && typeof p.id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(p.id) && !itemIds.has(p.id), '计划标识不正确或重复');
      itemIds.add(p.id);
      assert(typeof p.text === 'string' && p.text.length <= 1000 && Object.hasOwn(PLAN_STATUSES, p.status) && typeof p.reason === 'string' && p.reason.length <= 10000, '计划内容或完成情况不正确');
      return { id: p.id, text: p.text, status: p.status, reason: p.reason };
    });
  }
  for (const [day, entry] of Object.entries(d.reflections || {})) {
    assert(validDay(day), '反思日期不正确'); safeMap(entry, '反思');
    reflections[day] = {};
    for (const field of Object.keys(REFLECTION_FIELDS)) {
      assert(typeof entry[field] === 'string' && entry[field].length <= 200000, '反思内容不正确');
      reflections[day][field] = entry[field];
    }
  }
  return { version: VERSION, createdOn: d.createdOn, categories, notes, goals, dayCategories, sessions, active, plans, reflections };
}
