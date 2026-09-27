// T08: a due date written at the end of the task text. Dependency-free like model.mjs.
// Only the tail of the input is read, in RU/UK/EN regardless of the interface language.
// Anything that could mean something else stays text: a bare time needs a preposition,
// slash dates are refused (D/M or M/D), and a date after "после/після/after/from" is not
// a deadline. The result is a proposal the UI previews; nothing is saved from here.
import {dateKey,validDate,makeDeadline,DAY} from './model.mjs';

const RELATIVE={'сегодня':0,'сьогодні':0,'today':0,'завтра':1,'tomorrow':1,'послезавтра':2,'післязавтра':2};
const WEEKDAYS=[
  ['воскресенье','неділю','неділя','sunday'],
  ['понедельник','понеділок','monday'],
  ['вторник','вівторок','tuesday'],
  ['среду','среда','середу','середа','wednesday'],
  ['четверг','четвер','thursday'],
  ['пятницу','пятница',"п'ятницю","п'ятниця",'friday'],
  ['субботу','суббота','суботу','субота','saturday']];
const MONTHS=[
  ['января','січня','january','jan'],['февраля','лютого','february','feb'],['марта','березня','march','mar'],
  ['апреля','квітня','april','apr'],['мая','травня','may'],['июня','червня','june','jun'],
  ['июля','липня','july','jul'],['августа','серпня','august','aug'],['сентября','вересня','september','sept','sep'],
  ['октября','жовтня','october','oct'],['ноября','листопада','november','nov'],['декабря','грудня','december','dec']];
const weekday=new Map(WEEKDAYS.flatMap((names,day)=>names.map(name=>[name,day])));
const month=new Map(MONTHS.flatMap((names,index)=>names.map(name=>[name,index+1])));
const alternatives=names=>[...names].sort((a,b)=>b.length-a.length).join('|');
const START='(?<=^|\\s)', END='\\s*$';
const TIME_24=new RegExp(`${START}(?:(?<prep>во|в|у|о|об|at)\\s+)?(?<h>\\d{1,2}):(?<m>\\d{2})${END}`);
const TIME_12=new RegExp(`${START}(?:(?<prep>at)\\s+)?(?<h>\\d{1,2})(?::(?<m>\\d{2}))?\\s*(?<ampm>am|pm)${END}`);
const DATE=new RegExp(`${START}(?:(?<rel>${alternatives(Object.keys(RELATIVE))})|(?:(?:во|в|у|on)\\s+)?(?<wd>${alternatives(weekday.keys())})|(?<iy>\\d{4})-(?<im>\\d{2})-(?<id>\\d{2})|(?<nd>\\d{1,2})\\.(?<nm>\\d{1,2})(?:\\.(?<ny>\\d{4}|\\d{2}))?|(?<md>\\d{1,2})\\s+(?<mn>${alternatives(month.keys())})(?:\\s+(?<my>\\d{4}))?|(?<em>${alternatives(month.keys())})\\s+(?<ed>\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(?<ey>\\d{4}))?)${END}`);
// "до завтра" / "by friday" is still the deadline; the preposition goes with the date.
const BY=new Set(['до','by']);
// A date after these words starts or bounds something else, not a deadline.
const BLOCKED=new Set(['после','після','after','from','с','со','з','із','від','от','since','until','till','з-за','між','между','between']);
const pad=n=>String(n).padStart(2,'0');
const addDays=(date,days)=>new Date(Date.parse(`${date}T00:00:00Z`)+days*DAY).toISOString().slice(0,10);

function time(text){
  const found=TIME_24.exec(text)||TIME_12.exec(text);if(!found)return null;
  let hour=Number(found.groups.h);const minute=Number(found.groups.m??0),ampm=found.groups.ampm;
  if(ampm){if(hour<1||hour>12)return {invalid:true};hour=hour%12+(ampm==='pm'?12:0);}
  if(hour>23||minute>59)return {invalid:true};
  return {value:`${pad(hour)}:${pad(minute)}`,index:found.index,prep:!!found.groups.prep||!!ampm};
}
function date(text,today){
  const found=DATE.exec(text);if(!found)return null;const g=found.groups;
  const year=Number(today.slice(0,4));let result,explicitYear=false;
  if(g.rel)result={date:addDays(today,RELATIVE[g.rel]),relative:RELATIVE[g.rel]};
  else if(g.wd){const now=new Date(`${today}T00:00:00Z`).getUTCDay();result={date:addDays(today,(weekday.get(g.wd)-now+7)%7),weekday:true};}
  else{
    let y,m,d;
    if(g.iy){[y,m,d]=[g.iy,g.im,g.id].map(Number);explicitYear=true;}
    else if(g.nd){[d,m]=[g.nd,g.nm].map(Number);y=g.ny?Number(g.ny.length===2?`20${g.ny}`:g.ny):year;explicitYear=!!g.ny;}
    else if(g.md){d=Number(g.md);m=month.get(g.mn);y=g.my?Number(g.my):year;explicitYear=!!g.my;}
    else{d=Number(g.ed);m=month.get(g.em);y=g.ey?Number(g.ey):year;explicitYear=!!g.ey;}
    let value=`${y}-${pad(m)}-${pad(d)}`;if(!validDate(value))return {invalid:true};
    if(!explicitYear&&value<today){value=`${y+1}-${pad(m)}-${pad(d)}`;if(!validDate(value))return {invalid:true};}
    result={date:value};
  }
  return {...result,index:found.index};
}
function lastWord(text){const found=/(?<=^|\s)(\S+)\s*$/.exec(text);return found?{word:found[1],index:found.index}:null;}

// parseDueText(text,{now,timeZone}) -> null or {title,date,time,due,start}. `start` is the
// index in the original text where the recognized tail begins; `due` is makeDeadline().
export function parseDueText(text,{now=Date.now(),timeZone='UTC'}={}){
  if(typeof text!=='string')return null;
  const source=text.replace(/[’ʼ`]/g,"'").toLowerCase();
  if(source.length!==text.length)return null;
  const today=dateKey(now,timeZone);
  let rest=source.replace(/\s+$/,''),found=null,day=null;
  const cut=index=>{rest=rest.slice(0,index).replace(/\s+$/,'');};
  found=time(rest);if(found?.invalid)return null;if(found)cut(found.index);
  day=date(rest,today);if(day?.invalid)return null;if(day)cut(day.index);
  if(day&&!found){found=time(rest);if(found?.invalid)return null;if(found)cut(found.index);}
  if(!day&&!found)return null;
  const before=lastWord(rest),by=!!before&&BY.has(before.word);
  if(by)cut(before.index);
  else if(before&&BLOCKED.has(before.word))return null;
  // A lone time like "встреча 15:00" may be part of the title; "в 15:00" is a deadline.
  if(!day&&!found.prep&&!by)return null;
  const title=text.slice(0,rest.length).replace(/[\s,;:–—-]+$/u,'');
  if(!title.trim())return null;
  let target=day?.date??today;const clock=found?.value??'';
  let due;try{due=makeDeadline(target,clock,timeZone);}catch{return null;}
  // Without a date the time is the next one to come; a weekday whose time has passed
  // today means the same weekday next week. "Today 9:00" typed at noon stays as written.
  if(clock&&due.at<=now&&(!day||day.weekday&&day.date===today)){
    target=addDays(target,day?7:1);try{due=makeDeadline(target,clock,timeZone);}catch{return null;}
  }
  return {title,date:target,time:clock,due,start:rest.length};
}
