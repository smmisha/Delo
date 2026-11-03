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

import {matchingIds,filterGroups} from '../core/search.mjs';
test('A06 filterGroups keeps order, drops empty groups and snapshots matches',()=>{
  const groups=[{key:'today',tasks:[{id:'1',title:'Купить молоко'},{id:'2',title:'Позвонить'}]},{key:'later',tasks:[{id:'3',title:'Молоко для кота'}]},{key:'done',tasks:[{id:'4',title:'Налог'}]}];
  const ids=matchingIds(groups,searchTerms('МОЛОКО'));
  assert.deepEqual(filterGroups(groups,ids).map(g=>[g.key,g.tasks.map(t=>t.id)]),[['today',['1']],['later',['3']]]);
  groups[0].tasks[0].title='Купить хлеб';
  assert.deepEqual(filterGroups(groups,ids).map(g=>g.tasks.map(t=>t.id)),[['1'],['3']],'an edited task stays until the query changes');
  assert.equal(filterGroups(groups,matchingIds(groups,searchTerms(''))).length,3);
  assert.equal(filterGroups(groups,matchingIds(groups,searchTerms('zzz'))).length,0);
});
