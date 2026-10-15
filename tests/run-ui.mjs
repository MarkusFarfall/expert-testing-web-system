import {spawn} from 'node:child_process';
const port=Number(process.env.UI_TEST_PORT||4310);
const server=spawn(process.execPath,['tests/preview-server.mjs'],{env:{...process.env,PORT:String(port)},stdio:['ignore','pipe','pipe']});
const stop=()=>server.kill('SIGTERM');
process.once('SIGINT',stop);process.once('SIGTERM',stop);
try{
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Preview startup timeout')),10000);
  server.stdout.on('data',chunk=>{if(chunk.toString().includes('Isolated KTPP preview')){clearTimeout(timer);resolve();}});
  server.once('error',e=>{clearTimeout(timer);reject(e);});
  server.once('exit',code=>{clearTimeout(timer);reject(Error('Preview exited: '+code));});
  server.stderr.on('data',chunk=>process.stderr.write(chunk));
 });
 const child=spawn(process.execPath,['tests/ui-smoke.mjs'],{env:{...process.env,TEST_BASE_URL:`http://127.0.0.1:${port}`},stdio:'inherit'});
 process.exitCode=await new Promise(resolve=>{child.once('exit',code=>resolve(code??1));child.once('error',()=>resolve(1));});
}finally{stop();}
