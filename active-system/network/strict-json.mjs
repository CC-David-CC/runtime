/** Bounded JSON parser. Duplicate names are rejected after escape decoding.
 * JSON.parse is used only for individual string/number tokens, never objects.
 */
export function strictJson(text,{maxBytes=262144,maxDepth=24,maxValues=4096}={}){
  if(typeof text!=='string'||new TextEncoder().encode(text).length>maxBytes)throw Error('JSON size limit');
  let i=0,values=0;
  const fail=()=>{throw Error('Invalid or ambiguous JSON');};
  const space=()=>{while(i<text.length&&/[\x20\t\n\r]/.test(text[i]))i++;};
  function string(){
    const start=i++;let escaped=false;
    while(i<text.length){const c=text[i++];if(!escaped&&c==='"'){
      const value=JSON.parse(text.slice(start,i));
      for(let k=0;k<value.length;k++){const u=value.charCodeAt(k);if(u>=0xd800&&u<=0xdbff){const v=value.charCodeAt(++k);if(!(v>=0xdc00&&v<=0xdfff))fail();}else if(u>=0xdc00&&u<=0xdfff)fail();}
      return value;
    }if(!escaped&&c==='\\')escaped=true;else escaped=false;}
    fail();
  }
  function value(depth){
    if(depth>maxDepth||++values>maxValues)throw Error('JSON complexity limit');
    space();const c=text[i];
    if(c==='"')return string();
    if(c==='{'){
      i++;space();const obj=Object.create(null),seen=new Set();
      if(text[i]==='}'){i++;return obj;}
      for(;;){space();if(text[i]!=='"')fail();const key=string();if(seen.has(key))throw Error('Duplicate JSON key');seen.add(key);space();if(text[i++]!==':')fail();obj[key]=value(depth+1);space();const end=text[i++];if(end==='}')return obj;if(end!==',')fail();}
    }
    if(c==='['){
      i++;space();const array=[];if(text[i]===']'){i++;return array;}
      for(;;){array.push(value(depth+1));space();const end=text[i++];if(end===']')return array;if(end!==',')fail();}
    }
    const match=/^(?:true|false|null|-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/.exec(text.slice(i));
    if(!match)fail();i+=match[0].length;const result=JSON.parse(match[0]);if(typeof result==='number'&&!Number.isFinite(result))fail();return result;
  }
  const result=value(0);space();if(i!==text.length)fail();return result;
}
