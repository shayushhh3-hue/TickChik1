// How a page document is stored in Firestore.
// The page keeps JSON documents (nested arrays, keys with dots, deep nesting); Firestore forbids arrays inside arrays
// and treats dots in update paths specially. So every document is stored as: its top-level scalar fields as real
// Firestore fields (they can be sorted and filtered on: createdAt, updatedAt, kind...), and everything structured
// (objects and arrays) as one JSON string in the field `_j`. encodeDoc/decodeDoc are the only two functions that
// know this; the page, the jobs and the server functions all go through them.
export const JKEY='_j';

export function encodeDoc(obj){
  const out={}, rest={}; let any=false;
  for(const [k,v] of Object.entries(obj||{})){
    if(v===undefined||k===JKEY)continue;
    if(v===null||typeof v!=='object'){out[k]=typeof v==='number'&&!Number.isFinite(v)?null:v}
    else{rest[k]=v;any=true}
  }
  if(any)out[JKEY]=JSON.stringify(rest);
  return out;
}

export function decodeDoc(fields){
  if(!fields||typeof fields!=='object')return fields;
  const out={};
  for(const [k,v] of Object.entries(fields)){if(k!==JKEY)out[k]=v}
  if(typeof fields[JKEY]==='string'){try{Object.assign(out,JSON.parse(fields[JKEY]))}catch(e){}}
  return out;
}
