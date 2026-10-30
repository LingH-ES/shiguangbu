import {
  PALETTE, dateKey, addDays, dayBounds, visibleCategories, daySegments, totalsForDay,
  completion, isOngoingDefault, touchCategory, startTimer, stopTimer, setDefault,
  saveSession, formatDuration, shortDuration, uid, makeBackup, validateBackup,
  PLAN_STATUSES, REFLECTION_FIELDS, plansForReview, addPlan, updatePlan, deletePlan, saveReflection,
} from './model.js';
import { openStorage, updateState, readState, onExternalChange } from './storage.js';

const $ = (selector, root = document) => root.querySelector(selector);
const app = $('#app');
const modalRoot = $('#modal-root');
let state;
let tab = 'today';
let selectedDay = dateKey();
let calendarMonth = selectedDay.slice(0, 7);
let lastToday = selectedDay;
let busy = false;
let toastTimeout;
let modalContext = null;
let noteWrites = Promise.resolve();
let noteSequence = 0;
let installPrompt;
let recoveryAvailable = false;
let monthCache = null;
const paths = {
  today: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h1M12 14h1M16 14h1M8 17h1M12 17h1"/>',
  settings: '<path d="m9.5 3-.5 2a7 7 0 0 0-1.8 1L5.3 5.5l-2 3.5 1.5 1.5a7 7 0 0 0 0 2L3.3 14l2 3.5 1.9-.5a7 7 0 0 0 1.8 1l.5 2h4l.5-2a7 7 0 0 0 1.8-1l1.9.5 2-3.5-1.5-1.5a7 7 0 0 0 0-2L20.2 9l-2-3.5-1.9.5a7 7 0 0 0-1.8-1L14 3z"/><circle cx="11.7" cy="11.5" r="3"/>',
  moon: '<path d="M20.5 13a8.6 8.6 0 1 1-9.5-9.5A6.6 6.6 0 0 0 20.5 13Z"/><path d="m17 3 .5 1.5L19 5l-1.5.5L17 7l-.5-1.5L15 5l1.5-.5Z"/>',
  book: '<path d="M12 6c-3-2-6-2-9-1v14c3-1 6-1 9 1 3-2 6-2 9-1V5c-3-1-6-1-9 1Zm0 0v14M6 9h3M6 12h3M15 9h3M15 12h3"/>',
  coffee: '<path d="M4 8h12v7a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V8Zm12 1h2a3 3 0 0 1 0 6h-2M7 3v2M11 3v2M3 21h15"/>',
  activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
  sparkles: '<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2ZM20 2v4M18 4h4"/>',
  music: '<path d="M9 18V5l11-2v13M9 9l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  right: '<path d="m10 6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  edit: '<path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-5-5L4 14z"/>',
  note: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8M8 17h5"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r=".5"/>',
  play: '<path d="m9 5 10 7-10 7Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};

function icon(name, size = 18) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.activity}</svg>`;
}
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function category(id) { return state.categories.find(c => c.id === id); }
function totalFor(day, now = Date.now()) { return Object.values(totalsForDay(state, day, now)).reduce((n, ms) => n + ms, 0); }
function dailyBackupSummary(data) {
  const plans = Object.values(data.plans || {}).reduce((n, items) => n + items.length, 0);
  const reflections = Object.values(data.reflections || {}).filter(entry => Object.values(entry).some(text => text.trim())).length;
  return `${plans} 项计划 · ${reflections} 天反思`;
}
function clock(value) { return new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }); }
function dateTitle(day) { return new Date(`${day}T12:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }); }
function fullDate(day) { return new Date(`${day}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }); }
function localDateTime(value) {
  const d = new Date(value);
  return `${dateKey(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function toast(message) {
  clearTimeout(toastTimeout);
  $('#toast').textContent = message;
  $('#toast').classList.add('is-visible');
  toastTimeout = setTimeout(() => $('#toast').classList.remove('is-visible'), 3200);
}

async function mutate(change, options) {
  state = await updateState(change, options);
  monthCache = null;
}

function categoryCards(day, { timers = true } = {}) {
  const now = Date.now();
  const totals = totalsForDay(state, day, now);
  return `<div class="category-list">${visibleCategories(state, day, now).map(c => {
    const active = state.active?.categoryId === c.id;
    const goal = state.goals[day]?.[c.id];
    const duration = totals[c.id] || 0;
    const hasNote = Boolean(state.notes[day]?.[c.id]?.text);
    const progress = goal ? Math.min(100, duration / goal * 100) : 0;
    return `<article class="category-card" style="--category:${c.color}" data-category="${c.id}">
      <div class="category-main">
        <div class="category-icon">${icon(c.icon, 21)}</div>
        <div class="category-copy">
          <div class="category-title-line"><span class="category-title">${esc(c.name)}</span>${active && day === dateKey() ? '<span class="running-pill">计时中</span>' : ''}</div>
          <div class="category-meta">${goal ? `目标 ${formatDuration(goal)}` : '按自己的节奏，不设目标也很好'}</div>
        </div>
        <div class="category-duration"><strong data-duration="${c.id}">${formatDuration(duration, true)}</strong><span data-goal-status="${c.id}">${goal ? `${Math.floor(duration / goal * 100)}% 已完成` : '累计时长'}</span></div>
      </div>
      ${goal ? `<div class="category-progress" role="progressbar" aria-label="${esc(c.name)}目标进度" aria-valuenow="${Math.floor(progress)}" aria-valuemin="0" aria-valuemax="100" style="--progress:${progress}%"><span></span></div>` : ''}
      <div class="category-actions">
        <button class="text-action goal-action" data-action="goal" data-id="${c.id}" data-day="${day}" aria-label="设置${esc(c.name)}目标">${icon('target', 12)}目标</button>
        <button class="text-action goal-action" data-action="memo" data-id="${c.id}" data-day="${day}">${icon('note', 12)}记录${hasNote ? ' ·' : ''}</button>
        ${timers && day === dateKey() ? `<button class="timer-button ${active ? 'is-stop' : state.active ? 'is-disabled' : ''}" data-action="${active ? 'stop' : 'start'}" data-id="${c.id}" ${state.active && !active ? 'disabled title="先结束当前计时"' : ''}>${active ? '■　结束' : '▷　开始'}</button>` : ''}
      </div>
    </article>`;
  }).join('')}</div>`;
}

function timeline(day) {
  const segments = daySegments(state, day);
  return `<div class="timeline-card">${segments.length ? segments.map(s => {
    const c = category(s.categoryId);
    const crossDay = dateKey(s.start) !== dateKey(s.end - 1);
    return `<div class="timeline-row" style="--category:${c.color}">
      <span class="timeline-dot"></span>
      <div class="timeline-label"><strong>${esc(c.name)}${s.running ? ' · 正在计时' : ''}</strong><span>${clock(s.clippedStart)} — ${s.running ? '现在' : clock(s.clippedEnd)}${crossDay ? ' · 跨日已拆分' : ''}</span></div>
      <span class="timeline-length" ${s.running ? 'data-active-duration' : ''}>${shortDuration(s.duration)}</span>
      ${!s.running ? `<button class="icon-button" data-action="edit-session" data-id="${esc(s.id)}" aria-label="修改${esc(c.name)}时间">${icon('edit', 13)}</button>` : '<span style="width:31px"></span>'}
    </div>`;
  }).join('') : '<div class="timeline-empty">还没有时间片段，从一次「开始」记录今天。</div>'}</div>`;
}

function dayPage() {
  const day = selectedDay;
  const isToday = day === dateKey();
  const total = totalFor(day);
  const completed = completion(state, day);
  const [dayStart, dayEnd] = dayBounds(day);
  const ratio = Math.min(100, total / (dayEnd - dayStart) * 100);
  return `<section class="page" data-page="today">
    <div class="heading-row"><div><p class="eyebrow">A LITTLE TIME, WELL LIVED</p><h1 class="page-heading">${isToday ? '把时间，留给自己。' : '回看平凡而珍贵的一天。'}</h1><p class="page-subtitle">${isToday ? '不必填满每一天，记下值得的每一刻。' : '时间与文字，都好好留在这里。'}</p></div></div>
    <div class="date-switch">
      <button data-action="day-prev" aria-label="前一天">${icon('left', 15)}</button>
      <div class="date-copy"><strong>${dateTitle(day)}</strong><span>${day.slice(0, 4)} · ${isToday ? 'TODAY' : 'YOUR DAY'}</span></div>
      <button data-action="day-next" aria-label="后一天">${icon('right', 15)}</button>
      ${!isToday ? '<button class="today-chip" data-action="go-today">回到今天</button>' : ''}
    </div>
    <div class="overview-card">
      <div><div class="overview-label">${isToday ? '今天' : '当天'}，已经记录</div><div class="overview-total"><strong id="daily-total">${formatDuration(total, true)}</strong><span>小时</span></div><div class="overview-foot" id="overview-foot">${completed.count ? `${completed.completed} / ${completed.count} 个目标已完成 · 不必着急，慢慢来` : '没有必须达到的数字，只有属于你的节奏。'}</div></div>
      <div class="day-progress" id="day-progress" style="--day-progress:${ratio}%"><div class="day-progress-inner"><strong id="day-percentage">${Math.floor(ratio)}%</strong><span>一天的足迹</span></div></div>
    </div>
    ${state.active && !isToday ? `<div class="quick-note"><p>${esc(category(state.active.categoryId).name)}正在计时，历史页面不影响计时。</p><button data-action="go-today">回到今天</button></div>` : ''}
    <div class="section-heading"><h2>我的时间</h2><button class="text-action goal-action" data-action="add-category">${icon('plus', 12)}添加类别</button></div>
    ${categoryCards(day)}
    ${dailyModules(day)}
    <div class="section-heading"><h2>时间足迹</h2><button class="text-action goal-action" data-action="manual">${icon('plus', 12)}手动补记</button></div>
    ${timeline(day)}
    <div class="quick-note"><p>小小的坚持，也值得被看见。<br>用类别旁的「记录」，写下今天的收获。</p>${icon('sparkles', 23)}</div>
  </section>`;
}

function dailyModules(day) {
  const plans = state.plans[day] || [];
  const review = plansForReview(state, day);
  const reflection = state.reflections[day] || {};
  const written = Object.values(reflection).filter(text => text.trim()).length;
  function card(kind, title, subtitle, summary, preview) {
    return `<article class="daily-card"><button class="daily-card-open" data-action="daily-module" data-kind="${kind}" data-day="${day}" aria-label="打开${title}"><span class="daily-card-heading"><span>${icon(kind === 'reflection' ? 'note' : kind === 'review' ? 'check' : 'calendar', 20)}<strong>${title}</strong></span>${icon('right', 16)}</span><span class="daily-card-subtitle">${subtitle}</span><span class="daily-card-summary">${summary}</span>${preview ? `<span class="daily-card-preview">${esc(preview)}</span>` : ''}</button></article>`;
  }
  return `<div class="section-heading"><h2>计划与回想</h2><span class="field-note">点开记录 · 自动保存</span></div><div class="daily-modules">
    ${card('plans', '明日计划', `为 ${fullDate(addDays(day, 1))} 留一点期待`, plans.length ? `${plans.length} 项计划` : '写下明天想做的事', plans.slice(0, 3).map(p => p.text || '（待填写）').join(' · '))}
    ${card('review', '昨日计划完成情况', `${fullDate(addDays(day, -1))} 制定 · ${fullDate(day)} 执行`, review.length ? `${review.filter(p => p.status === 'done').length} / ${review.length} 项已完成 · ${review.filter(p => p.status === 'partial').length} 项部分完成` : '前一天还没有为这天制定计划', review.slice(0, 3).map(p => `${PLAN_STATUSES[p.status]}：${p.text || '（待填写）'}`).join(' · '))}
    ${card('reflection', '今日反思', `${fullDate(day)} · 留给自己的三句话`, written ? `已记录 ${written} / 3 个方面` : '做得好的、需要改进的、下一步', Object.values(reflection).find(text => text.trim()))}
  </div>`;
}

function dailySaveFooter() {
  return '<div class="daily-save"><span class="autosave-status" id="save-status" role="status">已保存在本机</span><button class="text-action" id="retry-daily" data-action="retry-daily" hidden>重试保存</button></div>';
}

function showDailyModule(kind, day) {
  const planningDay = kind === 'review' ? addDays(day, -1) : day;
  const items = state.plans[planningDay] || [];
  let body;
  if (kind === 'reflection') {
    body = `<div class="form-grid">${Object.entries(REFLECTION_FIELDS).map(([field, label]) => `<label class="field"><span>${label}（选填）</span><textarea data-reflection="${field}" maxlength="200000" placeholder="${field === 'good' ? '再小的进步，也值得记下来。' : field === 'improve' ? '哪里可以换一种做法？' : '给下一次的自己一个具体建议。'}">${esc(state.reflections[day]?.[field] || '')}</textarea></label>`).join('')}</div>`;
  } else {
    body = `<div class="plan-items">${items.map((p, i) => `<section class="plan-item" data-plan="${p.id}">${kind === 'plans' ? `<div class="plan-item-top"><label class="field"><span>计划 ${i + 1}</span><textarea data-plan-field="text" maxlength="1000" aria-label="计划 ${i + 1}">${esc(p.text)}</textarea></label><button class="icon-button danger-button" data-action="delete-plan" data-id="${p.id}" aria-label="删除计划 ${i + 1}">${icon('close', 16)}</button></div>` : `<h3>${i + 1}. ${esc(p.text || '（待填写的计划）')}</h3><label class="field"><span>完成情况</span><select data-plan-field="status" aria-label="计划 ${i + 1} 完成情况">${Object.entries(PLAN_STATUSES).map(([value, label]) => `<option value="${value}" ${p.status === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label class="field"><span>原因或补充（选填）</span><textarea data-plan-field="reason" maxlength="10000" placeholder="记录进展、原因或收获">${esc(p.reason)}</textarea></label>`}</section>`).join('') || `<p class="daily-empty">${kind === 'plans' ? '还没有计划，先添加一件想做的事。' : '前一天没有为这天制定计划。可以回到前一天，在「明日计划」中补写。'}</p>`}</div>${kind === 'plans' ? '<form id="plan-form" class="form-grid"><label class="field"><span>添加一项计划</span><textarea name="text" maxlength="1000" required placeholder="例如：练习小号 30 分钟"></textarea></label><p class="form-error" id="form-error" role="alert"></p><button type="submit" class="primary-button">添加计划</button><p class="field-note">输入后点「添加计划」加入清单，已添加的事项修改后自动保存。</p></form>' : ''}`;
  }
  showModal(kind === 'plans' ? '明日计划' : kind === 'review' ? '昨日计划完成情况' : '今日反思', kind === 'plans' ? `${fullDate(day)} 制定 → ${fullDate(addDays(day, 1))} 执行` : kind === 'review' ? `${fullDate(planningDay)} 制定 → ${fullDate(day)} 执行` : fullDate(day), `${body}${dailySaveFooter()}<div class="form-actions"><button class="primary-button" data-action="close-modal">完成</button></div>`, { kind, day, planningDay, className: 'daily-modal', pendingChanges: new Map() });
}

function queueDailySave(el) {
  const context = modalContext;
  if (!['plans', 'review', 'reflection'].includes(context?.kind)) return;
  // Keep failed patches until a successful retry; never replace a whole day's
  // data with a stale modal snapshot from another open tab.
  if (el?.matches('[data-plan-field], [data-reflection]')) {
    const key = el.dataset.reflection || `${el.closest('[data-plan]').dataset.plan}:${el.dataset.planField}`;
    context.pendingChanges.set(key, { id: el.closest('[data-plan]')?.dataset.plan, field: el.dataset.reflection || el.dataset.planField, value: el.value });
  }
  const changes = new Map(context.pendingChanges);
  if (!changes.size) return;
  const sequence = ++noteSequence;
  $('#save-status').textContent = '正在保存…';
  noteWrites = noteWrites.catch(() => {}).then(async () => {
    try {
      await mutate(current => {
        for (const { id, field, value } of changes.values()) {
          if (context.kind === 'reflection') saveReflection(current, context.day, field, value);
          else updatePlan(current, context.planningDay, id, { [field]: value });
        }
        return current;
      });
      for (const [key, patch] of changes) if (context.pendingChanges.get(key) === patch) context.pendingChanges.delete(key);
      if (sequence === noteSequence && modalContext === context) {
        context.saveFailed = false; $('#save-status').textContent = '已保存在本机'; $('#retry-daily').hidden = true;
      }
    } catch {
      if (sequence === noteSequence && modalContext === context) {
        context.saveFailed = true; $('#save-status').textContent = '保存失败，请重试或复制文字'; $('#retry-daily').hidden = false;
      }
    }
  });
}

function calendarPage() {
  const first = `${calendarMonth}-01`;
  const start = addDays(first, -((new Date(`${first}T12:00:00`).getDay() + 6) % 7));
  const label = new Date(`${first}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long' });
  const now = Date.now();
  const cacheKey = `${calendarMonth}-${Math.floor(now / 60000)}`;
  if (!monthCache || monthCache.key !== cacheKey) {
    monthCache = { key: cacheKey, days: Array.from({ length: 42 }, (_, i) => {
      const day = addDays(start, i);
      return { day, total: totalFor(day, now), completed: completion(state, day, now) };
    }) };
  }
  const completed = completion(state, selectedDay, now);
  return `<section class="page" data-page="calendar">
    <p class="eyebrow">EVERY DAY LEAVES A TRACE</p><h1 class="page-heading">日子，都有迹可循。</h1><p class="page-subtitle">翻一页日历，回到那天的自己。</p>
    <div class="calendar-card"><div class="heading-row" style="align-items:center;margin-bottom:17px"><div class="month-switch"><button data-action="month-prev" aria-label="上个月">${icon('left', 15)}</button><strong>${label}</strong><button data-action="month-next" aria-label="下个月">${icon('right', 15)}</button></div><button class="today-chip" data-action="calendar-today">今天</button></div>
      <div class="calendar-grid" aria-label="${label}">
        ${['一','二','三','四','五','六','日'].map(w => `<div class="weekday">${w}</div>`).join('')}
        ${monthCache.days.map(({ day, total, completed: c }) => `<button class="calendar-day ${!day.startsWith(calendarMonth) ? 'is-muted' : ''} ${day === selectedDay ? 'is-selected' : ''} ${day === dateKey() ? 'is-today' : ''}" data-action="pick-day" data-day="${day}" aria-label="${fullDate(day)}，${total ? formatDuration(total) : '暂无记录'}${c.count ? `，目标${c.completed}/${c.count}完成` : ''}" aria-pressed="${day === selectedDay}"><span class="calendar-day-number">${Number(day.slice(-2))}</span><span class="calendar-day-total">${shortDuration(total)}</span>${c.count && c.completed === c.count ? '<span class="calendar-day-mark"></span>' : ''}</button>`).join('')}
      </div><div class="calendar-legend"><span>日期下方为当日累计时长</span><span class="legend-item"><span class="legend-dot"></span>当日目标全部完成</span></div>
    </div>
    <div class="calendar-detail"><div class="calendar-detail-top"><h2>${dateTitle(selectedDay)}</h2><span>${completed.count ? `目标 ${completed.completed}/${completed.count} · ${Math.floor(completed.progress * 100)}%` : '未设置目标'}</span></div>
      <div class="section-heading" style="margin:0 0 11px"><p>已记录 ${formatDuration(totalFor(selectedDay))}</p><button class="text-action" data-action="open-day">查看当天详情 →</button></div>
      ${categoryCards(selectedDay, { timers: false })}
    </div>
  </section>`;
}

function settingsPage() {
  return `<section class="page" data-page="settings"><p class="eyebrow">A SPACE THAT IS ONLY YOURS</p><h1 class="page-heading">按你的方式，记录。</h1><p class="page-subtitle">简单一点，让习惯慢慢发生。</p>
    <div class="settings-list">
      <section class="soft-card setting-card"><h2>默认类别</h2><p>默认类别每天显示。临时类别只在添加当天或已有记录的日期出现；取消默认不会删除过去。</p>
        <div class="category-setting-list">${state.categories.map(c => `<div class="category-setting-row"><span class="timeline-dot" style="--category:${c.color}"></span><span class="category-setting-name">${esc(c.name)}</span>${c.core ? '<span class="field-note">基础类别</span>' : `<button class="default-switch ${isOngoingDefault(c) ? 'is-on' : ''}" data-action="toggle-default" data-id="${c.id}">${isOngoingDefault(c) ? '✓ 已设为默认' : '设为默认'}</button>`}</div>`).join('')}</div>
      </section>
      <section class="soft-card setting-card"><h2>备份你的时光</h2><p>计时、目标、备忘录、计划和反思全部存在当前浏览器。清除网站数据、卸载主屏幕应用或换手机可能导致丢失，请定期导出。</p><div class="setting-actions"><button class="primary-button" data-action="export">导出备份</button><button class="secondary-button" data-action="restore">恢复备份</button>${recoveryAvailable ? '<button class="secondary-button" data-action="export-recovery">下载恢复前备份</button>' : ''}</div><p id="backup-info">${state.sessions.length} 段计时 · ${Object.values(state.notes).reduce((n, notes) => n + Object.values(notes).filter(v => v.text).length, 0)} 篇记录 · ${dailyBackupSummary(state)}</p></section>
      <section class="soft-card setting-card"><h2>添加到 iPhone 主屏幕</h2><p>在 Safari 打开本站，点击「分享」，选择「添加到主屏幕」。建议从主屏幕入口开始正式记录，避免切换入口后找不到原来的数据。</p><div class="setting-actions">${installPrompt ? '<button class="secondary-button" data-action="install">安装时光簿</button>' : ''}<button class="secondary-button" data-action="storage-persist">申请持久保存</button></div><p id="offline-status">${'serviceWorker' in navigator && window.isSecureContext ? '离线缓存准备中…' : '当前地址无法启用离线缓存，正式使用请部署到 HTTPS。'}</p></section>
    </div>
    <div class="privacy-note"><strong>只属于你的本机空间</strong><br>无账号、无广告、无分析追踪，不上传计时、备忘录、计划或反思。网页托管服务只提供应用文件。备份文件包含明文记录，请保存在你信任的位置。<br><br>时光簿 v1.1 · 温柔地记录，认真地生活。</div>
  </section>`;
}

function render() {
  if (!state) return;
  app.innerHTML = tab === 'today' ? dayPage() : tab === 'calendar' ? calendarPage() : settingsPage();
  document.querySelectorAll('.nav-item').forEach(b => { b.classList.toggle('is-active', b.dataset.tab === tab); b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'); });
  if (tab === 'settings') updateOfflineStatus();
}

function showModal(title, subtitle, body, { kind, className = '', ...context } = {}) {
  modalContext = { kind, ...context, previousFocus: document.activeElement };
  modalRoot.innerHTML = `<div class="modal-backdrop"><section class="modal ${className}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-top"><div><h2 id="modal-title">${esc(title)}</h2>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div><button class="modal-close" data-action="close-modal" aria-label="关闭">${icon('close', 15)}</button></div>${body}</section></div>`;
  document.body.style.overflow = 'hidden';
  setTimeout(() => $('.modal input:not([type="checkbox"]), .modal textarea, .modal select, .modal-close')?.focus(), 80);
}

async function closeModal() {
  if (['memo', 'plans', 'review', 'reflection'].includes(modalContext?.kind)) {
    await noteWrites;
    if (modalContext?.saveFailed) { toast('记录尚未保存成功，请先重试保存'); return; }
  }
  const previous = modalContext?.previousFocus;
  if (modalContext?.downloadUrl) URL.revokeObjectURL(modalContext.downloadUrl);
  modalContext = null;
  modalRoot.innerHTML = '';
  document.body.style.overflow = '';
  render();
  if (previous?.isConnected) previous.focus();
}

function showCategoryForm() {
  showModal('添加一个新类别', `添加到 ${fullDate(selectedDay)}`, `<form id="category-form" class="form-grid"><label class="field"><span>类别名称</span><input name="name" maxlength="40" placeholder="例如：运动、阅读、创作" required autocomplete="off" /></label><label class="field"><span>标记颜色</span><input type="color" name="color" value="${PALETTE[state.categories.length % PALETTE.length]}" /></label><label class="field"><span>图标</span><select name="icon"><option value="activity">活动</option><option value="book">书本</option><option value="sparkles">灵感</option><option value="music">音乐</option><option value="coffee">休闲</option><option value="moon">睡眠</option></select></label><label class="check-row"><input type="checkbox" name="default" />设为默认，从今天起每天显示</label><p class="field-note">不勾选时，仅在添加当天或有计时、目标、文字记录的日期显示。</p><p class="form-error" id="form-error" role="alert"></p><div class="form-actions"><button type="button" class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" type="submit">添加类别</button></div></form>`, { kind: 'category', day: selectedDay });
}

function showGoal(id, day) {
  const goal = state.goals[day]?.[id] || 0;
  showModal(`${category(id).name} · 当日目标`, `${fullDate(day)}，只对这一天生效`, `<form id="goal-form" class="form-grid"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label class="field"><span>小时</span><input type="number" name="hours" min="0" max="24" step="1" inputmode="numeric" value="${Math.floor(goal / 3600000)}" required /></label><label class="field"><span>分钟</span><input type="number" name="minutes" min="0" max="59" step="1" inputmode="numeric" value="${Math.floor(goal % 3600000 / 60000)}" required /></label></div><p class="field-note">单个目标最多24小时。设为0可移除目标，不影响已经记录的时间。</p><p class="form-error" id="form-error" role="alert"></p><div class="form-actions">${goal ? '<button type="button" class="secondary-button" data-action="remove-goal">移除目标</button>' : ''}<button class="primary-button" type="submit">保存目标</button></div></form>`, { kind: 'goal', id, day });
}

function showMemo(id, day) {
  const note = state.notes[day]?.[id];
  showModal(`${category(id).name} · 记录`, fullDate(day), `<div class="memo-header"><span class="autosave-status" id="save-status">${note ? '已保存在本机' : '输入即自动保存'}</span></div><label class="field"><textarea id="memo-text" maxlength="200000" placeholder="在这里自由写下想记录的内容…\n\n一点收获、一些想法，或是今天发生的小事。" aria-label="${esc(category(id).name)}备忘录">${esc(note?.text || '')}</textarea></label><p class="field-note">此页内容只属于 ${fullDate(day)} 的${esc(category(id).name)}，以后修改也不会改变归属日期。</p><div class="form-actions"><button class="secondary-button" data-action="retry-note" id="retry-note" hidden>重试保存</button><button class="primary-button" data-action="close-modal">完成</button></div>`, { kind: 'memo', className: 'memo-modal', id, day });
}

function queueNoteSave() {
  const context = modalContext;
  if (context?.kind !== 'memo') return;
  const text = $('#memo-text').value;
  const sequence = ++noteSequence;
  $('#save-status').textContent = '正在保存…';
  context.saveFailed = false;
  noteWrites = noteWrites.catch(() => {}).then(async () => {
    try {
      await mutate(current => {
        current.notes[context.day] ||= {};
        current.notes[context.day][context.id] = { text, updatedAt: new Date().toISOString() };
        touchCategory(current, context.day, context.id);
        return current;
      });
      if (sequence === noteSequence && modalContext === context) {
        $('#save-status').textContent = '已保存在本机';
        $('#retry-note').hidden = true;
        context.saveFailed = false;
      }
    } catch (e) {
      if (sequence === noteSequence && modalContext === context) {
        context.saveFailed = true;
        $('#save-status').textContent = '保存失败，请重试或复制文字';
        $('#retry-note').hidden = false;
        toast('无法保存，请检查浏览器存储空间');
      }
    }
  });
}

function showSessionForm(id) {
  const existing = id ? state.sessions.find(s => s.id === id) : null;
  if (id && !existing) { toast('这段记录已被修改或删除'); return; }
  const now = Date.now();
  const isToday = selectedDay === dateKey(now);
  const defaultEnd = isToday ? now : new Date(`${selectedDay}T18:00:00`).getTime();
  const end = existing?.end || defaultEnd;
  const start = existing?.start || Math.max(dayBounds(selectedDay)[0], end - 3600000);
  showModal(existing ? '修改时间片段' : '补记一段时间', existing ? '跨日片段在这里修改完整起止时间。' : '忘记计时也没关系，把这段时间补回来。', `<form id="session-form" class="form-grid"><label class="field"><span>类别</span><select name="categoryId">${visibleCategories(state, selectedDay).map(c => `<option value="${c.id}" ${existing?.categoryId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field"><span>开始时间</span><input type="datetime-local" name="start" value="${localDateTime(start)}" max="${localDateTime(now)}" required /></label><label class="field"><span>结束时间</span><input type="datetime-local" name="end" value="${localDateTime(end)}" max="${localDateTime(now)}" required /></label><p class="field-note">可以跨午夜，系统会分配到实际日期；不能补记未来时间。</p><p class="form-error" id="form-error" role="alert"></p><div id="conflict-container"></div><div class="form-actions">${existing ? '<button type="button" class="secondary-button danger-button" data-action="delete-session">删除片段</button>' : ''}<button class="primary-button" id="session-save" type="submit">保存片段</button></div></form>`, { kind: 'session', id: existing?.id || null, originalStart: existing?.start, originalEnd: existing?.end });
}

async function submitSession(form, replace = false) {
  const fd = new FormData(form);
  let start = new Date(fd.get('start')).getTime();
  let end = new Date(fd.get('end')).getTime();
  // Preserve seconds when an existing endpoint has not actually been edited.
  if (modalContext.originalStart && localDateTime(modalContext.originalStart) === fd.get('start')) start = modalContext.originalStart;
  if (modalContext.originalEnd && localDateTime(modalContext.originalEnd) === fd.get('end')) end = modalContext.originalEnd;
  const session = { id: modalContext.id, categoryId: fd.get('categoryId'), start, end };
  try {
    await mutate(current => { saveSession(current, session, replace); return current; });
    await closeModal(); toast('时间片段已保存');
  } catch (e) {
    $('#form-error').textContent = e.message;
    if (e.conflicts) {
      $('#conflict-container').innerHTML = `<div class="conflict-list"><strong>重叠的记录</strong>${e.conflicts.map(s => `<span>${esc(category(s.categoryId).name)} · ${dateKey(s.start)} ${clock(s.start)} — ${dateKey(s.end)} ${clock(s.end)}</span>`).join('')}<span>替换仅覆盖重叠部分，其余时间会保留。</span></div><button type="button" class="secondary-button danger-button" data-action="replace-overlap">替换重叠时段并保存</button>`;
    }
  }
}

async function exportBackup(recovery = false) {
  await noteWrites;
  const value = recovery ? await readState('beforeRestore') : makeBackup(await readState());
  if (!value) { toast('没有恢复前备份'); return; }
  const name = `时光簿-${recovery ? '恢复前备份-' : '备份-'}${dateKey()}-${Date.now()}.json`;
  const downloadUrl = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  showModal('备份已准备好', '点击下方按钮，将 JSON 文件保存在你选择的位置。', `<p class="field-note">包含计时、目标、类别、备忘录、计划完成情况和反思。${dailyBackupSummary(value.data)}。备份为明文，请妥善保存。<br>iPhone 若打开了文件预览，可通过「分享」选择「存储到文件」。</p><div class="form-actions"><button class="secondary-button" data-action="close-modal">完成</button><a class="primary-button backup-download" href="${esc(downloadUrl)}" download="${esc(name)}">保存备份文件</a></div>`, { kind: 'export', downloadUrl });
}

async function previewRestore(file) {
  if (!file) return;
  if (file.size > 15 * 1024 * 1024) throw new Error('备份文件过大，最大支持15MB');
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch { throw new Error('无法读取备份，请选择有效的 JSON 文件'); }
  const restored = validateBackup(parsed);
  const noteCount = Object.values(restored.notes).reduce((n, entries) => n + Object.values(entries).filter(v => v.text).length, 0);
  showModal('恢复并替换本机数据？', '请先确认备份内容，恢复将覆盖当前全部记录。', `<p class="field-note">文件：${esc(file.name)}<br>包含 ${restored.categories.length} 个类别、${restored.sessions.length} 段计时、${noteCount} 篇文字记录、${dailyBackupSummary(restored)}。${parsed.formatVersion === 1 ? '<br>这是旧版备份，不含新版计划和反思；恢复后这些内容将被清空。' : ''}${restored.active ? '<br>备份包含进行中的计时，恢复后将从原开始时间继续累计。' : ''}${state.active ? '<br>本机正在计时，恢复后该计时会被替换。' : ''}<br><br>系统会将当前数据自动保存为一份恢复前备份，可在设置页下载。</p><p class="form-error" id="form-error" role="alert"></p><div class="form-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-restore">确认替换</button></div>`, { kind: 'restore', restored });
}

function shiftMonth(count) {
  const date = new Date(`${calendarMonth}-01T12:00:00`);
  date.setMonth(date.getMonth() + count);
  calendarMonth = dateKey(date).slice(0, 7); monthCache = null;
}

async function action(name, button) {
  const { id, day } = button?.dataset || {};
  switch (name) {
    case 'open-settings': tab = 'settings'; render(); break;
    case 'day-prev': selectedDay = addDays(selectedDay, -1); render(); break;
    case 'day-next': selectedDay = addDays(selectedDay, 1); render(); break;
    case 'go-today': tab = 'today'; selectedDay = dateKey(); render(); break;
    case 'add-category': showCategoryForm(); break;
    case 'goal': showGoal(id, day); break;
    case 'memo': showMemo(id, day); break;
    case 'daily-module': showDailyModule(button.dataset.kind, day); break;
    case 'retry-daily': queueDailySave(); break;
    case 'delete-plan': {
      await noteWrites;
      if (modalContext.saveFailed) throw new Error('请先重试保存');
      const context = modalContext;
      showModal('删除这项计划？', '该事项及次日对应的完成情况、说明会一并删除。', `<div class="form-actions"><button class="secondary-button" data-action="cancel-delete-plan">取消</button><button class="primary-button" data-action="confirm-delete-plan">确认删除</button></div>`, { kind: 'delete-plan', day: context.day, planningDay: context.planningDay, id });
      break;
    }
    case 'cancel-delete-plan': showDailyModule('plans', modalContext.day); break;
    case 'confirm-delete-plan': {
      const context = modalContext;
      await mutate(current => { deletePlan(current, context.planningDay, context.id); return current; });
      showDailyModule('plans', context.day); toast('计划已删除'); break;
    }
    case 'close-modal': await closeModal(); break;
    case 'retry-note': queueNoteSave(); break;
    case 'start': await mutate(current => { startTimer(current, id); return current; }); render(); toast('开始记录，锁屏也会继续累计'); break;
    case 'stop': await mutate(current => { stopTimer(current); return current; }); render(); toast('本段已保存，再次开始会继续累加'); break;
    case 'manual': showSessionForm(); break;
    case 'edit-session': showSessionForm(id); break;
    case 'remove-goal': await mutate(current => { delete current.goals[modalContext.day]?.[modalContext.id]; return current; }); await closeModal(); toast('已移除当天目标'); break;
    case 'replace-overlap': await submitSession($('#session-form'), true); break;
    case 'delete-session': {
      const sessionId = modalContext.id;
      showModal('删除这段计时？', '仅删除这段时长，不影响类别、目标和文字记录。', `<div class="form-actions"><button class="secondary-button" data-action="close-modal">取消</button><button class="primary-button" data-action="confirm-delete-session">确认删除</button></div>`, { kind: 'delete-session', sessionId });
      break;
    }
    case 'confirm-delete-session': await mutate(current => { current.sessions = current.sessions.filter(s => s.id !== modalContext.sessionId); return current; }); await closeModal(); toast('已删除计时片段'); break;
    case 'month-prev': shiftMonth(-1); render(); break;
    case 'month-next': shiftMonth(1); render(); break;
    case 'calendar-today': selectedDay = dateKey(); calendarMonth = selectedDay.slice(0, 7); monthCache = null; render(); break;
    case 'pick-day': selectedDay = day; render(); break;
    case 'open-day': tab = 'today'; render(); window.scrollTo({ top: 0, behavior: 'smooth' }); break;
    case 'toggle-default': await mutate(current => { const c = current.categories.find(c => c.id === id); setDefault(current, id, !isOngoingDefault(c)); return current; }); render(); toast('默认类别已更新，历史记录保留'); break;
    case 'export': await exportBackup(); break;
    case 'export-recovery': await exportBackup(true); break;
    case 'restore': $('#restore-input').click(); break;
    case 'confirm-restore': {
      const restored = modalContext.restored;
      await mutate(() => restored, { recovery: true }); recoveryAvailable = true;
      selectedDay = dateKey(); calendarMonth = selectedDay.slice(0, 7);
      await closeModal(); toast('已恢复，原数据可从恢复前备份下载'); break;
    }
    case 'storage-persist': {
      const persistent = await navigator.storage?.persist?.();
      toast(persistent ? '已获得持久存储许可，仍建议定期备份' : '浏览器未授予持久存储，请定期导出备份'); break;
    }
    case 'install': if (installPrompt) { await installPrompt.prompt(); installPrompt = null; render(); } break;
    case 'reload': window.location.reload(); break;
  }
}

document.addEventListener('click', async event => {
  const nav = event.target.closest('[data-tab]');
  if (nav && state && !busy) { tab = nav.dataset.tab; if (tab === 'today') selectedDay = dateKey(); render(); window.scrollTo({ top: 0, behavior: 'smooth' }); return; }
  const button = event.target.closest('[data-action]');
  if (!button || busy || button.disabled) return;
  busy = true;
  try { await action(button.dataset.action, button); }
  catch (e) { toast(e.message || '操作失败，请重试'); if ($('#form-error')) $('#form-error').textContent = e.message; }
  finally { busy = false; }
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  busy = true;
  const form = event.target;
  const fd = new FormData(form);
  try {
    if (form.id === 'category-form') {
      const name = fd.get('name').trim();
      if (!name) throw new Error('请填写类别名称');
      const context = modalContext;
      await mutate(current => {
        if (current.categories.some(c => c.name === name)) throw new Error('已有同名类别，请使用不同名称');
        if (current.categories.length >= 300) throw new Error('最多支持300个类别');
        const id = uid();
        current.categories.push({ id, name, color: fd.get('color'), icon: fd.get('icon'), core: false, defaults: fd.has('default') ? [{ from: dateKey(), to: null }] : [] });
        touchCategory(current, context.day, id);
        return current;
      });
      await closeModal(); toast('新类别已添加');
    } else if (form.id === 'goal-form') {
      const h = Number(fd.get('hours')), m = Number(fd.get('minutes'));
      if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || m < 0 || m > 59 || h * 60 + m > 1440) throw new Error('请输入0至24小时内的目标');
      const context = modalContext;
      await mutate(current => {
        current.goals[context.day] ||= {};
        const goal = (h * 60 + m) * 60000;
        if (goal) current.goals[context.day][context.id] = goal; else delete current.goals[context.day][context.id];
        touchCategory(current, context.day, context.id);
        return current;
      });
      await closeModal(); toast('当天目标已保存');
    } else if (form.id === 'plan-form') {
      await noteWrites;
      if (modalContext.saveFailed) throw new Error('请先重试保存');
      const context = modalContext;
      await mutate(current => { addPlan(current, context.day, fd.get('text')); return current; });
      showDailyModule('plans', context.day);
      $('#plan-form textarea').focus();
    } else if (form.id === 'session-form') await submitSession(form);
  } catch (e) { if ($('#form-error')) $('#form-error').textContent = e.message; else toast(e.message); }
  finally { busy = false; }
});

document.addEventListener('input', event => {
  if (event.target.id === 'memo-text') queueNoteSave();
  if (event.target.matches('[data-plan-field], [data-reflection]')) queueDailySave(event.target);
  if (event.target.closest('#session-form')) { $('#conflict-container').innerHTML = ''; $('#form-error').textContent = ''; }
});
document.addEventListener('change', event => {
  if (event.target.matches('select[data-plan-field]')) queueDailySave(event.target);
});

document.addEventListener('keydown', event => {
  if (!modalContext) return;
  if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
  if (event.key === 'Tab') {
    const focusables = [...modalRoot.querySelectorAll('button:not(:disabled):not([hidden]), input, textarea, select, a[href]')];
    const first = focusables[0], last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
});

$('#restore-input').addEventListener('change', async event => {
  try { await previewRestore(event.target.files[0]); } catch (e) { toast(e.message); }
  event.target.value = '';
});

function tick() {
  if (!state) return;
  const today = dateKey();
  if (today !== lastToday) {
    if (selectedDay === lastToday) selectedDay = today;
    if (calendarMonth === lastToday.slice(0, 7)) calendarMonth = today.slice(0, 7);
    lastToday = today; monthCache = null;
    if (!modalContext) render();
    return;
  }
  if (tab !== 'today' || !state.active) return;
  const total = totalFor(selectedDay);
  const totals = totalsForDay(state, selectedDay);
  const dailyTotal = $('#daily-total');
  if (dailyTotal) dailyTotal.textContent = formatDuration(total, true);
  const [start, end] = dayBounds(selectedDay);
  const pct = Math.min(100, total / (end - start) * 100);
  $('#day-progress')?.style.setProperty('--day-progress', `${pct}%`);
  if ($('#day-percentage')) $('#day-percentage').textContent = `${Math.floor(pct)}%`;
  for (const c of visibleCategories(state, selectedDay)) {
    const card = document.querySelector(`[data-category="${c.id}"]`);
    if (!card) continue;
    $('[data-duration]', card).textContent = formatDuration(totals[c.id] || 0, true);
    const goal = state.goals[selectedDay]?.[c.id];
    if (goal) {
      $('[data-goal-status]', card).textContent = `${Math.floor((totals[c.id] || 0) / goal * 100)}% 已完成`;
      const progress = $('.category-progress', card);
      progress?.style.setProperty('--progress', `${Math.min(100, (totals[c.id] || 0) / goal * 100)}%`);
      progress?.setAttribute('aria-valuenow', Math.floor(Math.min(100, (totals[c.id] || 0) / goal * 100)));
    }
  }
  const activeSegment = daySegments(state, selectedDay).find(s => s.running);
  if ($('[data-active-duration]') && activeSegment) $('[data-active-duration]').textContent = shortDuration(activeSegment.duration);
  const c = completion(state, selectedDay);
  if ($('#overview-foot') && c.count) $('#overview-foot').textContent = `${c.completed} / ${c.count} 个目标已完成 · 不必着急，慢慢来`;
}

async function updateOfflineStatus() {
  const label = $('#offline-status');
  if (!label || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (label.isConnected) label.textContent = registration?.active ? '离线缓存已就绪；更新应用时需要联网。' : '正在缓存应用，首次请保持联网。';
  } catch { if (label.isConnected) label.textContent = '离线缓存暂不可用，请保持联网并重试。'; }
}

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installPrompt = e; });
window.addEventListener('pageshow', async () => { if (state) { state = await readState(); monthCache = null; tick(); if (!modalContext) render(); } });
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && state) { state = await readState(); monthCache = null; tick(); if (!modalContext) render(); }
});

async function init() {
  document.querySelectorAll('[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); });
  try {
    state = await openStorage();
    recoveryAvailable = Boolean(await readState('beforeRestore'));
    render();
    onExternalChange(async () => { state = await readState(); monthCache = null; if (!modalContext) render(); });
    setInterval(tick, 1000);
  } catch (e) {
    app.innerHTML = `<section class="page"><h1 class="page-heading">暂时无法打开本机存储</h1><p class="page-subtitle">请使用普通 Safari 窗口，检查可用存储空间后重试。现有数据不会被主动清空。</p><p class="form-error">${esc(e.message)}</p><div class="setting-actions"><button class="primary-button" data-action="reload">重新打开</button></div></section>`;
  }
  if ('serviceWorker' in navigator && window.isSecureContext) {
    try { await navigator.serviceWorker.register('./sw.js'); await navigator.serviceWorker.ready; updateOfflineStatus(); }
    catch { if ($('#offline-status')) $('#offline-status').textContent = '离线缓存失败，请联网重新打开后重试。'; }
  }
}
init();
