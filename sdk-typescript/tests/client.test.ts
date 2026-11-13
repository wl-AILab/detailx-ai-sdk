import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { DetailXClient, generationParams } from '../src/index.js';

const directories: string[] = [];
async function directory() { const dir = await mkdtemp(join(tmpdir(),'detailx-ts-')); directories.push(dir); return dir; }
afterEach(async()=>{ await Promise.all(directories.splice(0).map(d=>rm(d,{recursive:true,force:true}))); });

test('lost acceptance response reuses durable request and exact idempotency key',async()=>{
  const requests: {body:string;key:string}[] = [];
  let quotes=0;
  const remote: typeof fetch = async (input,init)=>{
    const path = String(input);
    if(path.endsWith('generation-estimates')) {quotes++;return Response.json({credits:10,duration:2,pricing_revision_id:3});}
    if(init?.method==='POST') {
      requests.push({body:String(init.body),key:new Headers(init.headers).get('Idempotency-Key')!});
      if(requests.length===1) throw new TypeError('response lost');
      return Response.json({id:'gen-1',status:'queued',results:[]},{status:202});
    }
    return Response.json({id:'gen-1',status:'completed',results:[]});
  };
  const stateDir = await directory();
  const first=new DetailXClient({apiKey:'dxk_test',stateDir,fetch:remote,retries:0,minRequestIntervalMs:0});
  const prepared=await first.prepareGeneration({uploadId:'asset-1'},{},{requestId:'order-1',maxPrechargeCredits:10});
  await expect(first.submit(prepared)).rejects.toMatchObject({code:'transport_error'});
  const restored=new DetailXClient({apiKey:'dxk_test',stateDir,fetch:remote,minRequestIntervalMs:0});
  const second=await restored.prepareGeneration({uploadId:'asset-1'},{},{requestId:'order-1',maxPrechargeCredits:10});
  expect(second).toEqual(prepared);
  expect((await restored.submit(second)).id).toBe('gen-1');
  await restored.submit(second);
  expect(quotes).toBe(1);expect(requests).toHaveLength(2);expect(requests[0]).toEqual(requests[1]);
  expect(JSON.parse(requests[0].body)).toMatchObject({upload_id:'asset-1',fps:-1,expected_credits:10,pricing_revision_id:3});
  await expect(restored.prepareGeneration({uploadId:'other'},{},{requestId:'order-1',maxPrechargeCredits:10})).rejects.toMatchObject({code:'request_conflict'});
});

test('budget and price change stop paid actions',async()=>{
  let submissions=0;
  const client=new DetailXClient({apiKey:'dxk_test',stateDir:await directory(),minRequestIntervalMs:0,fetch:async(_,init)=>{
    if(init?.headers && new Headers(init.headers).has('Idempotency-Key')) {submissions++;return Response.json({detail:{code:'price_changed'}},{status:409});}
    return Response.json({credits:11,pricing_revision_id:2,duration:1});
  }});
  await expect(client.prepareGeneration({sourceResultId:'result-1'},{},{requestId:'x',maxPrechargeCredits:10})).rejects.toMatchObject({code:'budget_exceeded'});
  expect(submissions).toBe(0);
  const prepared=await client.prepareGeneration({sourceResultId:'result-1'},{},{requestId:'x',maxPrechargeCredits:11});
  await expect(client.submit(prepared)).rejects.toMatchObject({code:'price_changed'});
  expect(submissions).toBe(1);
});

test('invalid API options fail before network access',()=>{
  expect(()=>generationParams({uploadId:'x',sourceResultId:'y'} as never)).toThrow('Exactly one');
  expect(()=>generationParams({uploadId:'x'},{detail:2} as never)).toThrow('string');
  expect(()=>generationParams({uploadId:'x'},{fps:'60'} as never)).toThrow('fps');
});
