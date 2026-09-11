// Small, interruptible native animations; the optical shell stays stationary.
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const active = new Set();
export const reducedMotion = () => preference.matches || document.body.classList.contains('reduced');
export function animate(node, frames, duration = 260) {
  if (reducedMotion()) return null;
  const animation = node.animate(frames, { duration, easing: 'cubic-bezier(.2,.8,.2,1)' });
  active.add(animation);
  animation.finished.catch(() => {}).finally(() => active.delete(animation));
  return animation;
}
const stopMotion = () => { if (reducedMotion()) for (const animation of active) animation.finish(); };
preference.addEventListener('change', stopMotion);
document.querySelector('#reduced').addEventListener('change', stopMotion);

export function captureLayout(list) {
  const positions = new Map();
  for (const node of list.querySelectorAll('.task-group > .task, .task-group > h3')) {
    if (node.getClientRects().length) positions.set(node, node.getBoundingClientRect());
    for (const animation of node.getAnimations()) animation.cancel();
  }
  return positions;
}
export function moveLayout(list, before) {
  if (reducedMotion()) return;
  for (const node of list.querySelectorAll('.task-group > .task, .task-group > h3')) {
    if (!node.getClientRects().length) continue;
    const previous = before.get(node), next = node.getBoundingClientRect();
    if (!previous) {
      animate(node, [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }]);
    } else {
      const delta = Math.max(-64, Math.min(64, previous.top - next.top));
      if (Math.abs(delta) > .5) animate(node, [{ transform: `translateY(${delta}px)` }, { transform: 'none' }], 300);
    }
  }
}
export function leaveRow(node, list) {
  if (reducedMotion()) return;
  const rect = node.getBoundingClientRect(), container = list.getBoundingClientRect();
  const ghost = node.cloneNode(true);
  ghost.removeAttribute('data-id'); ghost.classList.add('task-exit');
  ghost.setAttribute('aria-hidden', 'true'); ghost.inert = true;
  Object.assign(ghost.style, { left: `${rect.left-container.left}px`, top: `${rect.top-container.top+list.scrollTop}px`, width: `${rect.width}px` });
  list.append(ghost);
  const animation = animate(ghost, [{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateX(18px) scale(.97)' }], 180);
  if (animation) animation.finished.catch(() => {}).finally(() => ghost.remove());
  else ghost.remove();
}
