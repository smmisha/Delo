export function notificationFor(before, after, commands, {notifyOverdue=false}={}) {
  const added = after.events.slice(before.events.length);
  if (commands.some(command=>command.type==='complete') && added.some(event=>event.kind==='complete')) return 'complete';
  if (notifyOverdue && commands.some(command=>command.type==='tick') && added.some(event=>event.kind==='first'||event.kind==='week')) return 'overdue';
  return null;
}
