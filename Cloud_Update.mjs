import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root=path.dirname(fileURLToPath(import.meta.url));

// Each cloud invocation must finish. Do not use --watch in a paid cron job.
export function runProcess(args,{cwd=root,timeoutMs=90000,env=process.env,stdio='inherit'}={}) {
  return new Promise(resolve=>{
    let timedOut=false,settled=false,forceTimer;
    const child=spawn(process.execPath,args,{cwd,env,stdio,windowsHide:true});
    const stop=()=>{
      child.kill('SIGTERM');
      forceTimer=setTimeout(()=>child.kill('SIGKILL'),3000);
      forceTimer.unref();
    };
    const timer=setTimeout(()=>{timedOut=true;console.error(`Cloud update exceeded its ${timeoutMs} ms execution limit.`);stop();},timeoutMs);
    const shutdown=()=>{timedOut=true;stop();};
    process.once('SIGTERM',shutdown);
    process.once('SIGINT',shutdown);
    const finish=code=>{
      if(settled)return;
      settled=true;clearTimeout(timer);clearTimeout(forceTimer);
      process.removeListener('SIGTERM',shutdown);process.removeListener('SIGINT',shutdown);
      resolve(timedOut?124:code);
    };
    child.once('error',()=>{console.error('Unable to start cloud update.');finish(1);});
    child.once('close',code=>finish(Number.isInteger(code)?code:1));
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const dryRun=process.argv.includes('--dry-run');
  const args=[path.join(root,'app.mjs'),...(dryRun?[]:['--push'])];
  console.log(`Cloud update started ${new Date().toISOString()}; mode=${dryRun?'preview':'push'}`);
  const code=await runProcess(args);
  console.log(`Cloud update finished ${new Date().toISOString()}; exit=${code}`);
  process.exitCode=code;
}
