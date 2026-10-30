/** Bundle trusted first-party apps. Never copy a source directory wholesale. */
import {build} from 'esbuild';
import {readFile, writeFile, mkdir, lstat, realpath, readdir, rename, rm, mkdtemp} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const defaults=path.resolve(here,'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const ids=['calculator','files','help','browser','terminal','text','image-editor','document-editor','pdf-viewer','spreadsheet','data-explorer','ffmpeg','wavesurfer','tone','audio-editor','zip','gcode-preview','grid-tools','mermaid','echarts','plotly','pdfme','maplibre','transformers','replicad','diagrams-net','notebook','excalidraw','svg-editor','personal-template'];
const safeFile=/^(?:[a-zA-Z0-9_@+-][a-zA-Z0-9_@+.-]*\/)*[a-zA-Z0-9_@+-][a-zA-Z0-9_@+.-]*$/;
const publicExtensions=new Set(['.mjs','.js','.css','.html','.json','.xml','.txt','.stl','.wasm','.data','.svg','.png','.jpg','.jpeg','.webp','.gif','.ico','.woff','.woff2','.ttf','.eot','.zip','.whl','.ipynb','.webmanifest','.ogg','.wav','.mp3']);
const options=JSON.parse(await readFile(process.argv[2],'utf8'));
const source=path.resolve(options.source??path.join(defaults,'../apps'));
const output=path.resolve(options.output??path.join(defaults,'assets/desktop'));
const selected=options.apps??ids;
if(!Array.isArray(selected)||!selected.length||selected.length>32||new Set(selected).size!==selected.length||selected.some(id=>!(/^[a-z][a-z0-9-]{0,31}$/).test(id)))throw Error('Invalid explicit app selection');
const sourceEntries=options.entries??{};
if(!sourceEntries||Array.isArray(sourceEntries)||typeof sourceEntries!=='object'||Object.entries(sourceEntries).some(([id,file])=>!selected.includes(id)||typeof file!=='string'||!safeFile.test(file)||!/[.](?:mjs|js)$/.test(file)))throw Error('Invalid explicit source entries');
const under=(file,root)=>file===root||file.startsWith(root+path.sep);
// Operator-declared shared modules are exact files, never extra directory roots.
const declaredInputs=options.publicInputs??[];
if(!Array.isArray(declaredInputs)||declaredInputs.length>64||declaredInputs.some(file=>typeof file!=='string'||!path.isAbsolute(file)||!/[.](?:mjs|js)$/.test(file)))throw Error('Invalid explicit public module inputs');
const publicInputs=new Set(declaredInputs.map(file=>path.resolve(file)));
async function regular(file,roots,allowDeclared=false){
  const absolute=path.resolve(file);
  if(!roots.some(root=>under(absolute,root))&&!(allowDeclared&&publicInputs.has(absolute)))throw Error('Dependency outside declared public source/package roots: '+absolute);
  // Inspect ancestors as well as the leaf: symlinked source trees are forbidden.
  for(let current=absolute;;current=path.dirname(current)){
    if((await lstat(current)).isSymbolicLink())throw Error('Symlinked app input: '+current);
    if(path.dirname(current)===current)break;
  }
  if(!(await lstat(absolute)).isFile())throw Error('Regular app input required: '+absolute);
  return absolute;
}
const dependencies=path.join(here,'node_modules');
for(const input of publicInputs)await regular(input,[],true);
await mkdir(output,{recursive:true});
if(await realpath(output)!==output)throw Error('Symlinked output directory');
const records=[];
for(const id of selected){
  const entry=path.join(source,sourceEntries[id]??path.join(id,'index.mjs')),appRoot=path.dirname(entry);
  const dependencyRoots=[path.join(appRoot,'node_modules'),dependencies];
  await regular(entry,[source]);
  let manifest={};
  try{await regular(path.join(appRoot,'app.json'),[appRoot]);manifest=JSON.parse(await readFile(path.join(appRoot,'app.json'),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!manifest||Array.isArray(manifest)||Object.keys(manifest).some(key=>!['assets','workers','inject','patches'].includes(key)))throw Error('Invalid app.json fields');
  if(manifest.workers!==undefined&&(!manifest.workers||typeof manifest.workers!=='object'||Array.isArray(manifest.workers)))throw Error('Invalid worker map');
  if(!Array.isArray(manifest.inject??[])||(manifest.inject??[]).length>8)throw Error('Invalid inject list');
  const inject=[];for(const file of manifest.inject??[]){if(typeof file!=='string'||!safeFile.test(file)||!/[.](?:mjs|js)$/.test(file))throw Error('Invalid injected source');inject.push(await regular(path.resolve(appRoot,file),[appRoot]));}
  const patches=new Map();
  if(!Array.isArray(manifest.patches??[])||(manifest.patches??[]).length>8)throw Error('Invalid dependency patch list');
  for(const patch of manifest.patches??[]){
    if(!patch||Object.keys(patch).sort().join(',')!=='find,path,replace,sha256'||typeof patch.path!=='string'||!safeFile.test(patch.path)||!patch.path.startsWith('node_modules/')||!/^([a-f0-9]{64})$/.test(patch.sha256)||typeof patch.find!=='string'||!patch.find||patch.find.length>4096||typeof patch.replace!=='string'||patch.replace.length>4096)throw Error('Invalid dependency patch');
    const file=await regular(path.resolve(appRoot,patch.path),[dependencyRoots[0]]);const group=patches.get(file)??[];if(group.some(item=>item.sha256!==patch.sha256))throw Error('Conflicting dependency patch hashes');group.push(patch);patches.set(file,group);
  }
  const entries={index:entry};
  for(const [name,file] of Object.entries(manifest.workers??{})){
    if(!/^[a-z][a-z0-9-]{0,31}$/.test(name)||typeof file!=='string'||!safeFile.test(file))throw Error('Invalid worker declaration');
    entries['workers/'+name]=await regular(path.resolve(appRoot,file),[appRoot]);
  }
  const scratch=await mkdtemp(path.join(output,'.app-build-'));
  try{
    const importedAssets=new Map();
    const result=await build({absWorkingDir:source,inject,entryPoints:entries,outdir:scratch,bundle:true,splitting:true,format:'esm',platform:'browser',target:['es2022'],write:false,metafile:true,
      outExtension:{'.js':'.mjs'},entryNames:'[dir]/[name]',chunkNames:'chunks/[name]-[hash]',assetNames:'media/[name]-[hash]',nodePaths:dependencyRoots,legalComments:'external',charset:'utf8',sourcemap:false,
      loader:{'.wasm':'file','.svg':'file','.png':'file','.jpg':'file','.jpeg':'file','.webp':'file','.gif':'file','.ico':'file','.woff':'file','.woff2':'file','.ttf':'file','.ogg':'file','.wav':'file','.mp3':'file'},
      logOverride:{'unsupported-dynamic-import':'error'},plugins:[{name:'public-input-boundary',setup(api){
        api.onResolve({filter:/\.(wasm|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|ogg|wav|mp3)$/},async args=>{
          if(!['import-statement','dynamic-import','require-call'].includes(args.kind))return undefined;
          const resolved=await api.resolve(args.path,{resolveDir:args.resolveDir,kind:'url-token'});
          if(resolved.errors.length)return {errors:resolved.errors};
          const file=await regular(resolved.path,[source,...dependencyRoots]);return {path:file,namespace:'codi-asset-url'};
        });
        api.onLoad({filter:/.*/,namespace:'codi-asset-url'},async args=>{
          const bytes=await readFile(args.path),digest=hash(bytes),name='media/'+digest+path.extname(args.path);
          const marker='__CODI_ASSET_'+digest+'__';importedAssets.set(marker,{name,bytes});
          return {contents:'export default new URL('+JSON.stringify(marker)+',import.meta.url).href;',loader:'js'};
        });
        api.onLoad({filter:/.*/,namespace:'file'},async args=>{await regular(args.path,[source,...dependencyRoots],true);const group=patches.get(args.path);if(!group)return undefined;const raw=await readFile(args.path);if(hash(raw)!==group[0].sha256)throw Error('Dependency patch hash mismatch: '+group[0].path);let contents=raw.toString('utf8');for(const patch of group){if(contents.split(patch.find).length!==2)throw Error('Dependency patch must match exactly once: '+patch.path);contents=contents.replace(patch.find,patch.replace);}return {contents,loader:'js',resolveDir:path.dirname(args.path)};});
      }}]});
    for(const [file,metadata] of Object.entries(result.metafile.outputs)){
      if(metadata.imports.some(item=>item.external&&!(item.kind==='url-token'&&/^data:image\/(?:png;base64|svg\+xml(?:;charset=utf-8)?(?:;base64)?),/i.test(item.path)&&item.path.length<16384)))throw Error('Unbundled external import in '+file+': '+JSON.stringify(metadata.imports.filter(item=>item.external).map(item=>({kind:item.kind,path:item.path.slice(0,120)}))));
    }
    const files=new Map();
    const put=(name,bytes)=>{
      if(!safeFile.test(name)||!publicExtensions.has(path.extname(name).toLowerCase()))throw Error('Invalid public output: '+name);
      const value=Buffer.from(bytes);if(files.has(name)){if(!files.get(name).equals(value))throw Error('Conflicting public output: '+name);return;}
      files.set(name,value);
    };
    const usedAssets=new Set();
    for(const file of result.outputFiles){
      const name=path.relative(scratch,file.path).split(path.sep).join('/');let bytes=file.contents;
      if(name.endsWith('.mjs')){
        let code=Buffer.from(bytes).toString('utf8');
        for(const [marker,asset] of importedAssets)if(code.includes(marker)){
          let relative=path.posix.relative(path.posix.dirname(name),asset.name);if(!relative.startsWith('.'))relative='./'+relative;
          code=code.replaceAll(marker,relative);usedAssets.add(marker);
        }
        bytes=Buffer.from(code);
      }
      put(name,bytes);
    }
    for(const marker of usedAssets){const {name,bytes}=importedAssets.get(marker);if(!files.has(name))put(name,bytes);}
    if(!Array.isArray(manifest.assets??[])||(manifest.assets??[]).length>4096)throw Error('Invalid explicit asset list');
    for(const name of manifest.assets??[]){
      if(typeof name!=='string'||!safeFile.test(name))throw Error('Invalid explicit asset');
      put(name,await readFile(await regular(path.resolve(appRoot,name),[appRoot])));
    }
    // Retain notices for every imported npm package, including nested packages.
    const packages=new Map();
    for(const input of Object.keys(result.metafile.inputs)){
      const absolute=path.resolve(source,input),dependencyRoot=dependencyRoots.find(root=>under(absolute,root));if(!dependencyRoot)continue;
      let dir=path.dirname(absolute);
      while(under(dir,dependencyRoot)&&dir!==dependencyRoot){
        try{const file=await regular(path.join(dir,'package.json'),[dependencyRoot]);const pkg=JSON.parse(await readFile(file,'utf8'));if(pkg.name&&pkg.version){packages.set(dir,pkg);break;}}catch(error){if(error.code!=='ENOENT')throw error;}
        dir=path.dirname(dir);
      }
    }
    for(const [dir,pkg] of packages){
      const notices=(await readdir(dir)).filter(name=>/^(licen[cs]e|copying|notice)([.-].*)?$/i.test(name));
      const label=pkg.name.replaceAll('/','-')+'-'+pkg.version;
      if(!notices.length){
        // Some npm tarballs omit their upstream LICENSE. Only a reviewed,
        // exact-version/hash notice can supplement that package; never fetch
        // arbitrary license URLs or silently omit attribution during a build.
        const supplements=JSON.parse(await readFile(await regular(path.join(here,'dependency-notices.json'),[here]),'utf8'));
        const entry=supplements[pkg.name+'@'+pkg.version];
        if(!entry||entry.license!==pkg.license||!safeFile.test(entry.path)||!entry.path.startsWith('notices/'))throw Error('Missing dependency license notice: '+pkg.name);
        const raw=await readFile(await regular(path.resolve(here,entry.path),[path.join(here,'notices')]));
        if(hash(raw)!==entry.sha256)throw Error('Changed dependency license supplement: '+pkg.name);
        put('licenses/'+label+'/LICENSE.txt',raw);
        put('licenses/'+label+'/provenance.json',Buffer.from(JSON.stringify(entry,null,2)+'\n'));
      }
      for(const name of notices)put('licenses/'+label+'/'+name+'.txt',await readFile(await regular(path.join(dir,name),dependencyRoots)));
    }
    const descriptions=Object.fromEntries([...files].sort(([a],[b])=>a.localeCompare(b,'en')).map(([name,bytes])=>[name,{sha256:hash(bytes),bytes:bytes.length}]));
    if(files.size>4096||[...files.values()].some(b=>b.length>256*1024*1024)||[...files.values()].reduce((sum,b)=>sum+b.length,0)>320*1024*1024)throw Error('App bundle exceeds file/size limits: '+files.size+' files, '+[...files.values()].reduce((sum,b)=>sum+b.length,0)+' bytes');
    if(!files.has('index.mjs'))throw Error('Missing bundled app entrypoint');
    const bundleSHA=hash(JSON.stringify(descriptions));
    const destination=path.join(output,'apps',id,bundleSHA);
    await mkdir(path.dirname(destination),{recursive:true});
    if(await realpath(path.dirname(destination))!==path.dirname(destination))throw Error('Symlinked app output parent');
    try{if((await lstat(destination)).isSymbolicLink())throw Error('Linked immutable app directory');}catch(error){if(error.code!=='ENOENT')throw error;}
    for(const [name,bytes] of files){const file=path.join(scratch,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes,{mode:0o644});}
    try{await rename(scratch,destination);}catch(error){
      if(!['EEXIST','ENOTEMPTY'].includes(error.code))throw error;
      const existing=[];
      async function walk(dir){for(const name of await readdir(dir)){const file=path.join(dir,name),st=await lstat(file);if(st.isSymbolicLink())throw Error('Linked immutable output');if(st.isDirectory())await walk(file);else existing.push(path.relative(destination,file));}}
      await walk(destination);
      if(existing.length!==files.size)throw Error('Immutable output file set changed');
      for(const [name,bytes] of files)if(!(await readFile(await regular(path.join(destination,name),[destination]))).equals(bytes))throw Error('Immutable app object changed');
    }
    records.push({id,kind:'browser',path:'assets/desktop/apps/'+id+'/'+bundleSHA+'/index.mjs',sha256:descriptions['index.mjs'].sha256,bundleSHA256:bundleSHA,bytes:descriptions['index.mjs'].bytes,styles:files.has('index.css')?['index.css']:[],files:descriptions});
  }finally{await rm(scratch,{recursive:true,force:true});}
}
const catalog={version:'codi-public-apps/2',hostAPI:2,apps:records};
const staged=path.join(output,'.apps-'+process.pid+'.json');await writeFile(staged,JSON.stringify(catalog,null,2)+'\n',{mode:0o644});await rename(staged,path.join(output,'apps.json'));
console.log(JSON.stringify({version:catalog.version,hostAPI:2,apps:records.length,files:records.reduce((n,a)=>n+Object.keys(a.files).length,0),output}));
