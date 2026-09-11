import { dateKey, offsetDate, validDate, createTask, elapsed, start, pause, stop, workWithoutTimer, toggleDone, groupFor, formatElapsed } from './task-model.mjs';
import { animate, captureLayout, moveLayout, leaveRow } from './motion.mjs';
import { UNDO_WINDOW, advanceDeletions, countdown } from './deletion-window.mjs';

// Demo data stays in memory. Keep the optical renderer independent of task state.
const tasks = [
  createTask('documents', 'Отправить документы', offsetDate(-1)),
  createTask('catalog', 'Проверить каталог', dateKey()),
  createTask('sketches', 'Подготовить эскизы', dateKey()),
  createTask('ideas', 'Разобрать идеи для проекта'),
  createTask('supplier', 'Ответить поставщику', dateKey())
];
tasks[4].state = 'done'; tasks[4].award = 5;
let reputation = 125, editing = null, editorReturn = null, menuTask = null, menuTrigger = null;
const removed = [], trash = [], nodes = new Map(), list = document.querySelector('#task-scroll');
const contextMenu = document.querySelector('#task-menu'), dialog = document.querySelector('#capture');
const groups = new Map();
for (const [id, label] of [['late','Просрочено'],['today','Сегодня'],['upcoming','Ближайшие'],['any','Без срока'],['done','Выполнено сегодня']]) {
  const group = document.createElement('section'); group.className = 'task-group'; group.dataset.group = id;
  const heading = document.createElement('h3'); heading.className = `${id}-label`; heading.append(document.createTextNode(label + ' '), document.createElement('span'));
  group.append(heading); list.append(group); groups.set(id, group);
}
document.querySelector('.subhead > span').textContent = new Intl.DateTimeFormat('ru', { weekday:'long', day:'numeric', month:'long' }).format(new Date());
const icon = name => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
const titleOf = node => node.querySelector('.task-title');
const setLabel = (button, label) => { button.setAttribute('aria-label', label); button.title = label; };
function deadlineText(task) {
  if (!task.due) return 'Без срока';
  const today = dateKey();
  if (task.due === today) return 'Сегодня, до конца дня';
  const [y,m,d] = task.due.split('-').map(Number);
  const date = new Intl.DateTimeFormat('ru', { day:'numeric', month:'long', ...(y!==new Date().getFullYear()?{year:'numeric'}:{}) }).format(new Date(y,m-1,d));
  return `${task.due < today ? 'Просрочено · ' : ''}${date}`;
}
function makeNode(task) {
  const node = document.createElement('div'); node.className = 'task'; node.dataset.id = task.id;
  node.innerHTML = `<button class="complete"><span class="circle">${icon('check')}</span></button><div class="task-copy"><button class="task-title"></button><button class="deadline"></button></div><div class="task-actions"><button class="timer">${icon('play')}</button><button class="task-more" aria-haspopup="menu" aria-expanded="false">${icon('more')}</button></div><div class="work-strip"><span class="work-status"></span><span class="elapsed"></span><button class="stop-work">${icon('stop')}</button></div>`;
  const complete = node.querySelector('.complete'), timer = node.querySelector('.timer'), more = node.querySelector('.task-more');
  complete.onclick = () => {
    const done = task.state !== 'done'; reputation += toggleDone(task, performance.now()); render(complete);
    animate(complete.querySelector('.circle'), [{scale:'.75'}, {scale:'1.1',offset:.65}, {scale:'1'}], 280);
    if (done) { toast(`Выполнено · +${task.award} к репутации (пример)`); chime(); }
    else toast('Задача восстановлена · награда отменена');
  };
  titleOf(node).onclick = () => openEditor(task, false, titleOf(node));
  node.querySelector('.deadline').onclick = () => openEditor(task, true, node.querySelector('.deadline'));
  timer.onclick = () => { if (task.state === 'running') pause(task, performance.now()); else start(task, tasks, performance.now()); render(timer); };
  node.querySelector('.stop-work').onclick = () => { stop(task, performance.now()); render(timer); toast('Подход завершён. Накопленное время сохранено.'); };
  // Native invoker association prevents light-dismiss before this button's click.
  // The controller handles switching between tasks sharing the same popover.
  more.popoverTargetElement = contextMenu;
  more.onclick = event => { event.preventDefault(); openMenu(task, more); };
  nodes.set(task.id, node); return node;
}
function updateNode(task, node) {
  const done = task.state === 'done', inWork = ['running','paused','working'].includes(task.state), isLate = task.due && task.due < dateKey() && !done;
  node.classList.toggle('done', done); node.classList.toggle('in-work', inWork); node.classList.toggle('late', Boolean(isLate));
  const complete = node.querySelector('.complete'); setLabel(complete, `${done?'Восстановить':'Выполнить'}: ${task.title}`); complete.setAttribute('aria-pressed', String(done));
  const title = titleOf(node); title.textContent = task.title; setLabel(title, `Редактировать: ${task.title}`);
  const date = node.querySelector('.deadline'); date.textContent = done ? 'Готово' : deadlineText(task); setLabel(date, `Срок задачи «${task.title}»: ${deadlineText(task)}`);
  const timer = node.querySelector('.timer'); timer.hidden = done; timer.setAttribute('aria-pressed', String(task.state === 'running'));
  setLabel(timer, `${task.state==='running'?'Пауза':task.state==='paused'?'Продолжить':'Начать'}: ${task.title}`); timer.querySelector('use').setAttribute('href', `#i-${task.state==='running'?'pause':'play'}`);
  setLabel(node.querySelector('.task-more'), `Действия: ${task.title}`);
  const strip = node.querySelector('.work-strip'); strip.hidden = !(inWork || task.elapsed > 0 || task.stopped);
  node.querySelector('.work-status').textContent = task.state === 'running' ? 'В работе' : task.state === 'paused' ? 'На паузе' : task.state === 'working' ? 'В работе без таймера' : done ? 'Затрачено' : 'Остановлено';
  const time = node.querySelector('.elapsed'); time.textContent = formatElapsed(elapsed(task, performance.now())); time.hidden = task.state === 'working' && task.elapsed === 0;
  const stopButton = node.querySelector('.stop-work'); stopButton.hidden = !inWork; setLabel(stopButton, `Стоп: ${task.title}`);
}
function render(focusTarget, before = captureLayout(list)) {
  const scroll = list.scrollTop;
  for (const task of tasks) { const node = nodes.get(task.id) || makeNode(task); updateNode(task, node); groups.get(groupFor(task)).append(node); }
  for (const group of groups.values()) group.querySelector('h3 span').textContent = group.querySelectorAll('.task').length;
  document.querySelector('#score').textContent = reputation;
  if (focusTarget?.isConnected && !focusTarget.hidden) focusTarget.focus({preventScroll:true}); list.scrollTop = scroll;
  moveLayout(list, before);
}
setInterval(() => {
  for (const task of tasks) if (task.state === 'running') nodes.get(task.id).querySelector('.elapsed').textContent = formatElapsed(elapsed(task, performance.now()));
}, 1000);

function hideMenu(returnFocus = false) {
  if (contextMenu.matches(':popover-open')) contextMenu.hidePopover();
  menuTrigger?.setAttribute('aria-expanded','false');
  if (returnFocus) menuTrigger?.focus({preventScroll:true});
}
function openMenu(task, trigger) {
  if (contextMenu.matches(':popover-open') && menuTask === task) { hideMenu(true); return; }
  hideMenu(); menuTask = task; menuTrigger = trigger;
  contextMenu.querySelector('[data-action="work"]').disabled = task.state === 'done';
  // Keep the invoker inside native light-dismiss handling so a second click closes.
  contextMenu.showPopover({source: trigger}); trigger.setAttribute('aria-expanded','true');
  const r = trigger.getBoundingClientRect(), width = contextMenu.offsetWidth, height = contextMenu.offsetHeight;
  contextMenu.style.left = `${Math.max(8, Math.min(r.right-width, innerWidth-width-8))}px`;
  contextMenu.style.top = `${Math.max(8, Math.min(r.bottom+6, innerHeight-height-8))}px`;
  contextMenu.querySelector('button').focus();
}
contextMenu.addEventListener('toggle', event => { if(event.newState==='closed') menuTrigger?.setAttribute('aria-expanded','false'); });
contextMenu.addEventListener('keydown', event => {
  const items = [...contextMenu.querySelectorAll('button:not(:disabled)')];
  if (event.key === 'Escape') { event.preventDefault(); hideMenu(true); }
  if (['ArrowDown','ArrowUp','Home','End'].includes(event.key)) {
    event.preventDefault(); let index = items.indexOf(document.activeElement);
    index = event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:-1)+items.length)%items.length; items[index].focus();
  }
});
// Fixed top-layer coordinates become stale when any ancestor scrolls, including
// the page. Capture non-bubbling scroll events; allow scrolling inside the menu.
document.addEventListener('scroll', event => {
  if (contextMenu.matches(':popover-open') && !contextMenu.contains(event.target)) {
    hideMenu(contextMenu.contains(document.activeElement));
  }
}, {capture:true, passive:true});
window.addEventListener('resize', () => hideMenu());
contextMenu.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]'); if (!button || button.disabled || !menuTask) return;
  const task = menuTask, trigger = menuTrigger; hideMenu();
  if (button.dataset.action === 'edit' || button.dataset.action === 'date') openEditor(task, button.dataset.action === 'date', trigger);
  if (button.dataset.action === 'work') { workWithoutTimer(task, performance.now()); render(trigger); }
  if (button.dataset.action === 'delete') removeTask(task);
});
function removeTask(task) {
  pause(task, performance.now()); const index = tasks.indexOf(task); if(index<0)return;
  const before = captureLayout(list); leaveRow(nodes.get(task.id), list);
  tasks.splice(index,1); nodes.get(task.id).remove();
  removed.push({task, index, remaining: UNDO_WINDOW});
  render(undefined, before); updateUndo(); document.querySelector('#task-input').focus();
}
// One clock drives both the ring and expiry; it runs only while Undo is available.
const undoBar = document.querySelector('#undo-bar');
const undoText = document.querySelector('#undo-text');
const undoSeconds = document.querySelector('#undo-seconds'), undoArc = document.querySelector('#undo-arc');
const undoHint = document.querySelector('#undo-hint');
let undoTicker = 0, lastTick = 0;
let undoTransition = null;
const undoBusy = () => document.hidden || undoBar.matches(':hover') || undoBar.contains(document.activeElement);
function showUndoSurface(visible) {
  undoTransition?.cancel(); undoTransition = null;
  if (visible) {
    const opening = undoBar.hidden || undoBar.inert;
    undoBar.hidden = false; undoBar.inert = false;
    if (opening) {
      const height = undoBar.offsetHeight;
      undoTransition = animate(undoBar, [{height:'0px',opacity:0,marginTop:'0px',paddingTop:'0px',paddingBottom:'0px'}, {height:`${height}px`,opacity:1,marginTop:'10px',paddingTop:'6px',paddingBottom:'6px'}], 220);
    }
  } else if (!undoBar.hidden) {
    undoBar.inert = true;
    const animation = animate(undoBar, [{height:`${undoBar.offsetHeight}px`,opacity:1}, {height:'0px',opacity:0,marginTop:'0px',paddingTop:'0px',paddingBottom:'0px'}], 160);
    undoTransition = animation;
    if (animation) animation.finished.then(() => { if (!removed.length) undoBar.hidden = true; }).catch(() => {});
    else undoBar.hidden = true;
  }
}
function updateUndo() {
  showUndoSurface(removed.length !== 0);
  if (removed.length) {
    const behind = removed.length - 1;
    const title = removed.at(-1).task.title.replace(/\s+/g, ' ');
    undoText.textContent = `Удалена: ${title}` + (behind ? ` · ещё ${behind}` : '');
    drawCountdown();
  }
  if (removed.length && !undoTicker) { lastTick = performance.now(); undoTicker = requestAnimationFrame(tickUndo); }
  if (!removed.length && undoTicker) { cancelAnimationFrame(undoTicker); undoTicker = 0; }
}
function drawCountdown() {
  const entry = removed.at(-1); if (!entry) return;
  const { seconds, fraction } = countdown(entry.remaining);
  const text = String(seconds);
  if (undoSeconds.textContent !== text) {
    undoSeconds.textContent = text;
    animate(undoSeconds, [{opacity:.2,transform:'translateY(3px)'},{opacity:1,transform:'none'}], 150);
  }
  const offset = String(100 * (1 - fraction));
  if (undoArc.style.strokeDashoffset !== offset) undoArc.style.strokeDashoffset = offset;
  const hint = undoBusy() ? 'Отсчёт на паузе' : 'Затем в корзину';
  if (undoHint.textContent !== hint) undoHint.textContent = hint;
  const counter = document.querySelector('#undo-countdown'), label = `До корзины: ${seconds} с${undoBusy() ? ', пауза' : ''}`;
  if (counter.getAttribute('aria-label') !== label) counter.setAttribute('aria-label', label);
}
function tickUndo() {
  const now = performance.now(), delta = now - lastTick; lastTick = now;
  const expired = advanceDeletions(removed, delta, undoBusy());
  if (expired.length) { trash.push(...expired); renderTrash(); updateUndo(); }
  if (removed.length) { drawCountdown(); undoTicker = requestAnimationFrame(tickUndo); }
  else undoTicker = 0;
}
// Hidden tabs suspend rAF. Exclude that time when the user returns.
document.addEventListener('visibilitychange', () => { lastTick = performance.now(); });
document.querySelector('#undo-delete').onclick = () => {
  const entry = removed.pop(); if (!entry) return;
  tasks.splice(Math.min(entry.index,tasks.length),0,entry.task); render(nodes.get(entry.task.id).querySelector('.task-more')); updateUndo(); toast('Задача восстановлена');
};

const trashDialog = document.querySelector('#trash-dialog');
function renderTrash() {
  document.querySelector('#trash-count').textContent = String(trash.length);
  const container = document.querySelector('#trash-list'); container.replaceChildren();
  document.querySelector('#trash-empty').hidden = trash.length !== 0;
  for (const entry of [...trash].reverse()) {
    const row = document.createElement('div'); row.className = 'trash-row';
    const title = document.createElement('span'); title.textContent = entry.task.title;
    const restore = document.createElement('button'); restore.textContent = 'Восстановить';
    setLabel(restore, `Восстановить из корзины: ${entry.task.title}`);
    restore.onclick = () => {
      trash.splice(trash.indexOf(entry), 1);
      tasks.splice(Math.min(entry.index,tasks.length),0,entry.task);
      render(); renderTrash(); document.querySelector('#close-trash').focus(); toast('Задача восстановлена из корзины');
    };
    row.append(title, restore); container.append(row);
  }
}
document.querySelector('#open-trash').onclick = () => { closeSettings(); renderTrash(); trashDialog.showModal(); };
document.querySelector('#close-trash').onclick = () => trashDialog.close();
trashDialog.addEventListener('close', () => document.querySelector('#menu').focus());

function openEditor(task = null, focusDate = false, returnTo = document.activeElement) {
  editing = task; editorReturn = returnTo;
  document.querySelector('#editor-label').textContent = task ? 'Изменить задачу' : 'Новая задача';
  document.querySelector('#save-label').textContent = task ? 'Сохранить' : 'Добавить';
  document.querySelector('#capture-input').value = task ? task.title : document.querySelector('#task-input').value;
  document.querySelector('#capture-input').setCustomValidity(''); document.querySelector('#due-input').value = task ? task.due : '';
  document.querySelector('#due-input').setCustomValidity('');
  syncPresets();
  dialog.showModal(); fitCapture(); (focusDate ? document.querySelector('#due-input') : document.querySelector('#capture-input')).focus(); renderCapture();
}
document.querySelector('#launch').onclick = () => openEditor(null, false, document.querySelector('#launch'));
document.querySelector('#new-with-date').onclick = () => openEditor(null, true, document.querySelector('#new-with-date'));
dialog.addEventListener('close', () => { if(editorReturn?.isConnected) editorReturn.focus({preventScroll:true}); });
// The presets are toggles that report the current deadline, not fire-and-forget
// buttons: whichever one matches the date field reads as pressed, and picking a date
// in the calendar releases all three.
const datePresets = [...document.querySelectorAll('.date-presets button')];
const presetDate = button => button.dataset.days === undefined ? '' : offsetDate(Number(button.dataset.days));
function syncPresets() {
  const value = document.querySelector('#due-input').value;
  for (const button of datePresets) button.setAttribute('aria-pressed', String(value === presetDate(button)));
}
datePresets.forEach(button => button.onclick = () => {
  const due = document.querySelector('#due-input');
  due.value = presetDate(button); due.setCustomValidity(''); syncPresets();
});
document.querySelector('#capture-input').oninput = event => event.target.setCustomValidity('');
document.querySelector('#due-input').oninput = event => { event.target.setCustomValidity(''); syncPresets(); };
document.querySelector('#capture-form').onsubmit = event => {
  event.preventDefault(); const input = document.querySelector('#capture-input'), date = document.querySelector('#due-input');
  if (!input.value.trim()) { input.setCustomValidity('Введите текст задачи'); input.reportValidity(); return; }
  if (!validDate(date.value)) { date.setCustomValidity('Укажите существующую дату'); date.reportValidity(); return; }
  if (editing) { editing.title = input.value.trim(); editing.due = date.value; render(); toast('Изменения сохранены'); }
  else { addTask(input.value, date.value); document.querySelector('#task-input').value = ''; syncSend(); fitEntry(); }
  dialog.close();
};
function addTask(value, due = '') {
  const title = value.trim(); if (!title) return false;
  tasks.push(createTask(crypto.randomUUID(),title,due)); render(); toast('Задача добавлена в макет'); return true;
}
// Both fields are textareas so Shift+Enter can break the line. A textarea never
// submits its form on its own, so plain Enter is wired up by hand; isComposing keeps
// Enter out of the way while an IME candidate is open.
function submitOnEnter(field, form) {
  field.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
    event.preventDefault(); form.requestSubmit();
  });
}
// onResize fires only when the height actually changes: the capture capsule has to
// re-render its lens when the surface grows, and that pass regenerates the whole
// wallpaper texture, so it must not run on every keystroke.
function autoGrow(field, onResize) {
  const fit = () => {
    const before = field.style.height;
    field.style.height = 'auto'; field.style.height = field.scrollHeight + 'px';
    if (onResize && field.style.height !== before) onResize();
  };
  field.addEventListener('input', fit); fit(); return fit;
}
const entryForm = document.querySelector('#entry');
const taskInput = document.querySelector('#task-input');
const sendButton = document.querySelector('#add-task');
const fitEntry = autoGrow(taskInput);
const syncSend = () => { sendButton.disabled = !taskInput.value.trim(); };
taskInput.addEventListener('input', syncSend);
submitOnEnter(taskInput, entryForm);
entryForm.onsubmit = event => {
  event.preventDefault();
  if (addTask(taskInput.value)) { taskInput.value = ''; fitEntry(); }
  syncSend(); taskInput.focus();
};
syncSend();
const fitCapture = autoGrow(document.querySelector('#capture-input'), () => renderCapture());
submitOnEnter(document.querySelector('#capture-input'), document.querySelector('#capture-form'));
render();
