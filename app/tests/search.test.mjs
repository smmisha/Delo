import test from 'node:test';
import assert from 'node:assert/strict';
import {searchTerms,matchesSearch} from '../core/search.mjs';
const find=(titles,query)=>titles.filter(title=>matchesSearch(title,searchTerms(query)));
const titles=['Отчёт за август','Подготовить отчет за сентябрь','Оплатити інтернет',"Зустріч у п’ятницю",'Call the bank'];
test('V24 part of a title finds it in any case, ё and е alike',()=>{
  assert.deepEqual(find(titles,'отчёт'),['Отчёт за август','Подготовить отчет за сентябрь']);
  assert.deepEqual(find(titles,'ОТЧЕТ авг'),['Отчёт за август']);
  assert.deepEqual(find(titles,'  сент  отч '),['Подготовить отчет за сентябрь']);
  assert.deepEqual(find(titles,"п'ятн"),["Зустріч у п’ятницю"]);
  assert.deepEqual(find(titles,'BANK'),['Call the bank']);
});
test('V24 an empty query shows everything, a missing word shows nothing',()=>{
  assert.deepEqual(find(titles,''),titles);
  assert.deepEqual(find(titles,'   '),titles);
  assert.deepEqual(find(titles,'отчёт банк'),[]);
  assert.deepEqual(searchTerms(null),[]);
});
