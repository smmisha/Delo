// A05: title search in the archive and trash. Every word of the query has to occur in
// the title, in any order and case; ё/е and the apostrophe variants count as the same.
const fold=value=>value.normalize('NFC').toLocaleLowerCase().replace(/ё/g,'е').replace(/[’ʼ`]/g,"'");
export function searchTerms(query){return typeof query==='string'?fold(query).split(/\s+/).filter(Boolean):[];}
export function matchesSearch(title,terms){if(!terms.length)return true;const value=fold(title);return terms.every(term=>value.includes(term));}
