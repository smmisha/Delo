import test from 'node:test';
import assert from 'node:assert/strict';
import {notificationFor} from '../ui/notification-policy.mjs';

const state = events => ({events});

test('completion emits one completion notification for its new ledger event',()=>{
  const before=state([]),after=state([{kind:'complete'}]);
  assert.equal(notificationFor(before,after,[{type:'complete'}]),'complete');
});

test('live overdue tick emits one notification for one or several new penalties',()=>{
  const before=state([]),after=state([{kind:'first'},{kind:'week'}]);
  assert.equal(notificationFor(before,after,[{type:'tick'}],{notifyOverdue:true}),'overdue');
});

test('startup recovery and unchanged ticks stay quiet',()=>{
  const before=state([]),after=state([{kind:'first'}]);
  assert.equal(notificationFor(before,after,[{type:'tick'}]),null);
  assert.equal(notificationFor(after,after,[{type:'tick'}],{notifyOverdue:true}),null);
});

test('editing an already overdue deadline does not masquerade as a live transition',()=>{
  const before=state([]),after=state([{kind:'first'}]);
  assert.equal(notificationFor(before,after,[{type:'deadline'}],{notifyOverdue:true}),null);
});
