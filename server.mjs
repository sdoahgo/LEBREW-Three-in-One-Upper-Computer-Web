import http from'node:http';import{readFile}from'node:fs/promises';import path from'node:path';import{fileURLToPath}from'node:url';import{FusionBridge}from'./fusion_bridge.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)),port=Number(process.env.FUSION_WEB_PORT||8770),bridge=new FusionBridge(),streams=new Set();
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.txt':'text/plain; charset=utf-8','.md':'text/plain; charset=utf-8','.json':'application/json','.bin':'application/octet-stream'};
const broadcast=(event,data)=>{for(const res of streams)res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);};
bridge.on('devices',d=>broadcast('devices',d));bridge.on('bytes',d=>broadcast('bytes',d));bridge.on('bridgeError',e=>broadcast('bridgeError',{error:e.message}));
http.createServer(async(req,res)=>{const json=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try{const url=new URL(req.url,'http://localhost');
    if(url.pathname.startsWith('/bridge/')){
      if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`){json({error:'Invalid host'},403);return;}
      if(req.headers.origin&&!new Set([`http://127.0.0.1:${port}`,`http://localhost:${port}`]).has(req.headers.origin)){json({error:'Invalid origin'},403);return;}
      if(req.method==='GET'&&url.pathname==='/bridge/events'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store','Connection':'keep-alive'});res.write(`event: devices\ndata: ${JSON.stringify(bridge.list())}\n\n`);streams.add(res);const timer=setInterval(()=>res.write(':keepalive\n\n'),15000);req.on('close',()=>{clearInterval(timer);streams.delete(res);});return;}
      if(req.method!=='POST'){json({error:'POST required'},405);return;}let body='';for await(const chunk of req){body+=chunk;if(body.length>7000){json({error:'Request too large'},413);return;}}const data=body?JSON.parse(body):{};
      if(url.pathname==='/bridge/start')json({devices:await bridge.start()});
      else if(url.pathname==='/bridge/stop'){await bridge.stop();json({ok:true});}
      else if(url.pathname==='/bridge/write'){bridge.write(String(data.id),Buffer.from(data.data??'','base64'));json({ok:true});}
      else json({error:'Unknown operation'},404);return;
    }
    const name=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname),target=path.resolve(root,'.'+name);
    if(!target.startsWith(root+path.sep)||name.includes('backups')||name.endsWith('.log')||!['GET','HEAD'].includes(req.method)){res.writeHead(403);res.end();return;}
    const data=await readFile(target);res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){if(req.url.startsWith('/bridge/'))json({error:e.message},400);else{res.writeHead(404);res.end('Not found');}}
}).listen(port,'127.0.0.1',()=>console.log(`Fusion web upper: http://127.0.0.1:${port}/index.html`));
