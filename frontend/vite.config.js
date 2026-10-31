import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
for(const relative of ['../../restore-assets.cjs','../../LOCAL_TEST/restore-assets.cjs']){const restore=path.resolve(path.dirname(fileURLToPath(import.meta.url)),relative);if(fs.existsSync(restore)){createRequire(import.meta.url)(restore)();break;}}

const publicDir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'public');
const versionPublicAssets={
  name:'cc906-public-asset-versions',
  transformIndexHtml:{order:'pre',handler(html){
    return html.replace(/\b(src|href)=(['"])(\/assets\/[^'"\s]+)\2/g,(original,attribute,quote,value)=>{
      const url=new URL(value,'http://cc906.local');
      if(!/\.(?:js|css)$/i.test(url.pathname))return original;
      const file=path.resolve(publicDir,'.'+decodeURIComponent(url.pathname));
      if(!file.startsWith(publicDir+path.sep)||!fs.existsSync(file))return original;
      const hash=createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0,12);
      url.searchParams.set('v','CC911_'+hash);
      return attribute+'='+quote+url.pathname+url.search+quote;
    });
  }}
};

const localHealth = {
  name: 'career-crox-cc474-local-health',
  configureServer(server) {
    server.middlewares.use('/__cc474_local_health', (req, res) => {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end(JSON.stringify({ ok: true, service: 'career-crox-vite', version: 'CC26_474' }));
    });
  },
};


// CC863: unpack the original ten login slides and two import templates only at
// build/dev time. File bytes and public URLs are unchanged.
const assetFile=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../backend/assets/cc863-static-assets.json');
const readAssets=()=>JSON.parse(fs.readFileSync(assetFile,'utf8'));
const originalLoginSlides={
 name:'cc863-static-assets',
 configureServer(server){const assets=readAssets();server.middlewares.use((req,res,next)=>{const key=decodeURIComponent(String(req.url||'').split('?')[0]).replace(/^\//,'');if(!Object.hasOwn(assets,key))return next();res.setHeader('Content-Type',key.endsWith('.webp')?'image/webp':key.endsWith('.svg')?'image/svg+xml':key.endsWith('.png')?'image/png':key.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv; charset=utf-8');res.end(Buffer.from(assets[key],'base64'));});},
 generateBundle(){for(const[fileName,encoded]of Object.entries(readAssets()))this.emitFile({type:'asset',fileName,source:Buffer.from(encoded,'base64')});}
};

// Give every JSX table the shared manager column controls, even when the table
// is rendered by a nested component rather than directly in a page's Layout.
function sharedTableColumns({types:t}){
 return {name:'cc929-shared-table-columns',visitor:{
  Program:{enter(p,state){state.cc929Table=p.scope.generateUidIdentifier('workspaceTable');state.cc929Used=false;},exit(p,state){if(state.cc929Used)p.unshiftContainer('body',t.importDeclaration([t.importSpecifier(state.cc929Table,t.identifier('ManagedWorkspaceTable'))],t.stringLiteral('/src/components/WorkspaceAppearance.jsx')));}},
  JSXElement(p,state){const opening=p.node.openingElement;if(!t.isJSXIdentifier(opening.name,{name:'table'}))return;state.cc929Used=true;opening.name=t.jsxIdentifier(state.cc929Table.name);if(p.node.closingElement)p.node.closingElement.name=t.jsxIdentifier(state.cc929Table.name);if(!opening.attributes.some(a=>t.isJSXAttribute(a)&&a.name.name==='data-table-key')){const file=String(state.filename||'table').split(/[\\/]/).slice(-2).join('-');opening.attributes.push(t.jsxAttribute(t.jsxIdentifier('data-table-key'),t.stringLiteral(file+':'+(opening.loc?.start.line||0))));}}
 }};
}
export default defineConfig({
  plugins: [react({babel:{plugins:[sharedTableColumns]}}), localHealth, originalLoginSlides, versionPublicAssets],
  build: {
    target: 'es2020',
    manifest: true,
    rollupOptions: { output: { manualChunks(id) {
      if (id.includes('/node_modules/')) return 'vendor';
      if (id.includes('/src/lib/') || id.includes('/src/components/')) {
        return 'shared';
      }
      if (id.includes('/src/pages/')) {
        if (/CandidateDetailPage|CandidatesPage/.test(id)) return 'profiles';
        return 'page-'+path.basename(id,'.jsx').replace(/Page$/,'').replace(/([a-z0-9])([A-Z])/g,'$1-$2').toLowerCase();
      }
    } } },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8787',
      '/generated': 'http://127.0.0.1:8787'
    }
  }
});
