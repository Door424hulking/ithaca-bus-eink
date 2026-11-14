import test from 'node:test';
import assert from 'node:assert/strict';
import { runProcess } from '../Cloud_Update.mjs';

test('cloud runner preserves job failure so the host records a failed run',async()=>{
  assert.equal(await runProcess(['-e','process.exit(7)'],{stdio:'ignore'}),7);
});
test('cloud runner terminates a stuck job instead of billing indefinitely',async()=>{
  assert.equal(await runProcess(['-e','setInterval(()=>{},1000)'],{timeoutMs:200,stdio:'ignore'}),124);
});
test('cloud runner records a completed job as successful',async()=>{
  assert.equal(await runProcess(['-e','process.exit(0)'],{stdio:'ignore'}),0);
});
