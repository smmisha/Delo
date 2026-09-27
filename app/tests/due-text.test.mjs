import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDueText} from '../core/due-text.mjs';
import {makeDeadline} from '../core/model.mjs';
// Saturday 26 September 2026, 12:00 in Kyiv.
const zone='Europe/Kyiv',now=Date.parse('2026-09-26T09:00:00Z');
const parse=(text,at=now)=>parseDueText(text,{now:at,timeZone:zone});
const due=(text,title,date,time='')=>{const result=parse(text);assert.ok(result,`${text} is recognized`);assert.deepEqual([result.title,result.date,result.time],[title,date,time],text);assert.deepEqual(result.due,makeDeadline(date,time,zone));};
const plain=text=>assert.equal(parse(text),null,`${text} stays text`);

test('V23 relative days in RU, UK and EN',()=>{
  due('Позвонить в сервис завтра в 15:00','Позвонить в сервис','2026-09-27','15:00');
  due('Купить хлеб сегодня','Купить хлеб','2026-09-26');
  due('Купити хліб сьогодні','Купити хліб','2026-09-26');
  due('Оплатить интернет послезавтра','Оплатить интернет','2026-09-28');
  due('Оплатити інтернет післязавтра о 9:30','Оплатити інтернет','2026-09-28','09:30');
  due('Call the bank tomorrow at 3pm','Call the bank','2026-09-27','15:00');
  due('Call the bank today 12am','Call the bank','2026-09-26','00:00');
  due('Отчёт в 15:00 завтра','Отчёт','2026-09-27','15:00');
});

test('V23 weekdays pick the nearest one, today included until its time has passed',()=>{
  due('Встреча в пятницу 15:00','Встреча','2026-10-02','15:00');
  due('Зустріч у п’ятницю','Зустріч','2026-10-02');
  due("Зустріч в п'ятницю о 10:00",'Зустріч','2026-10-02','10:00');
  due('Review on Monday','Review','2026-09-28');
  due('Уборка в субботу','Уборка','2026-09-26');
  due('Уборка в субботу в 18:00','Уборка','2026-09-26','18:00');
  due('Уборка в субботу в 9:00','Уборка','2026-10-03','09:00');
  due('Сдать отчёт до пятницы вечером в среду','Сдать отчёт до пятницы вечером','2026-09-30');
});

test('V23 explicit dates, including the next year when the date has passed',()=>{
  due('Продлить домен 15.10','Продлить домен','2026-10-15');
  due('Продлить домен 15.10.2027','Продлить домен','2027-10-15');
  due('Продлить домен 1.3.27','Продлить домен','2027-03-01');
  due('Продлить домен 20.09','Продлить домен','2027-09-20');
  due('Податок 15 жовтня','Податок','2026-10-15');
  due('Налог 3 декабря 2026 в 10:00','Налог','2026-12-03','10:00');
  due('Renew passport October 15th, 2027','Renew passport','2027-10-15');
  due('Renew passport 15 Oct','Renew passport','2026-10-15');
  due('Deploy 2026-11-01 at 09:15','Deploy','2026-11-01','09:15');
});

test('V23 a bare time needs a preposition, and the next occurrence is used',()=>{
  due('Созвон в 15:00','Созвон','2026-09-26','15:00');
  due('Созвон в 9:00','Созвон','2026-09-27','09:00');
  due('Сдать до 18:00','Сдать','2026-09-26','18:00');
  due('Сделать до завтра','Сделать','2026-09-27');
  due('Finish it by Friday','Finish it','2026-10-02');
  due('Написать маме, завтра','Написать маме','2026-09-27');
  plain('Встреча 15:00');
});

test('V23 ambiguous or impossible text stays text',()=>{
  for(const text of ['завтра','в пятницу 15:00','Отпуск после завтра','Работать с 15:00','Смена с 9:00 завтра','Купить 2 пачки','Читать 5/10','Прочитать главу 3.14.15','Созвон в 25:00','Налог 31.02','Налог 30 февраля','Call at 13pm','Заметки о завтрашнем','Послать завтрак','Встреча в пятницу утром','Tomorrowland tickets'])plain(text);
  assert.equal(parseDueText(42),null);
});

test('V23 the recognized tail is exact and case or trailing space do not matter',()=>{
  const result=parse('Позвонить ЗАВТРА   ');
  assert.equal(result.title,'Позвонить');assert.equal(result.start,'Позвонить'.length);assert.equal(result.date,'2026-09-27');
  // Late on the last day of a month the next day is in the next month, in the task's zone.
  const late=Date.parse('2026-09-30T21:30:00Z');
  assert.equal(parseDueText('Отчёт завтра',{now:late,timeZone:zone}).date,'2026-10-02');
  assert.equal(parseDueText('Отчёт завтра',{now:late,timeZone:'UTC'}).date,'2026-10-01');
});
