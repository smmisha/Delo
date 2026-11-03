// A05: title search in the archive and trash. Every word of the query has to occur in
// the title, in any order and case; ё/е and the apostrophe variants count as the same.
const fold=value=>value.normalize('NFC').toLocaleLowerCase().replace(/ё/g,'е').replace(/[’ʼ`]/g,"'");
export function searchTerms(query){return typeof query==='string'?fold(query).split(/\s+/).filter(Boolean):[];}
export function matchesSearch(title,terms){if(!terms.length)return true;const value=fold(title);return terms.every(term=>value.includes(term));}

// A06: the main list filter. `matchingIds` snapshots the tasks that match when the query changes;
// `filterGroups` then keeps only those ids, so a task edited out of the match stays in place until
// the query changes again. Groups without a match disappear; order is untouched.
export function matchingIds(groups,terms){const ids=new Set();for(const group of groups)for(const task of group.tasks)if(matchesSearch(task.title,terms))ids.add(task.id);return ids;}
export function filterGroups(groups,ids){return groups.map(group=>({...group,tasks:group.tasks.filter(task=>ids.has(task.id))})).filter(group=>group.tasks.length);}
