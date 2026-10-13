// The page's own calculation code, taken out of page/live.html, so the tests check exactly what runs in the browser.
// grab(name) finds `function name(` or `const name=` and grows the slice to the first end that parses.
import fs from 'node:fs';
export const PAGE=fs.readFileSync(new URL('../page/live.html',import.meta.url),'utf8');
export function grab(name){
  const m=new RegExp(`(?:^|\\n)[ \\t]*((?:function ${name}\\()|(?:const ${name}=))`).exec(PAGE); if(!m)throw new Error('not in the page: '+name);
  const i=m.index+m[0].indexOf(m[1]);
  for(let j=i;j<PAGE.length&&j<i+100000;j++){const c=PAGE[j]; if(c!=='}'&&c!==';')continue;
    const src=PAGE.slice(i,j+1); try{new Function(src)}catch(e){continue}
    // `const a={}, b=...;` parses already after `{}`: go on while the statement goes on
    const rest=PAGE.slice(j+1).match(/^\s*(\S\S?)/); if(c==='}'&&rest&&/^[,.?:&|+\-*\/(\[]/.test(rest[1])&&!/^\/[\/*]/.test(rest[1]))continue;
    return src}
  throw new Error('no end found for '+name);
}
// load(['model','feesOf'], G, ['allBuy']): the functions run with G as their globals (P, Q, HS, ...), which a test can change
export function load(names,G,more=[]){
  const src=names.map(grab).join('\n');
  return new Function('G',`with(G){${src}\nreturn {${[...names,...more].join(',')}}}`)(G);
}
