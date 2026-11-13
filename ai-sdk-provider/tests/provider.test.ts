import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { experimental_generateVideo as generateVideo } from 'ai';
import { createDetailX } from '../src/index.js';

test('real AI SDK 7 orchestrates V4 start/status and downloads one result',async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),'detailx-provider-'));
  const bodies: Record<string,unknown>[]=[];
  let polls=0;
  try {
    const provider=createDetailX({apiKey:'dxk_test',stateDir,minRequestIntervalMs:0,fetch:async(input,init)=>{
      if(String(input).endsWith('generation-estimates')) return Response.json({credits:10,pricing_revision_id:1,duration:2});
      if(init?.method==='POST') {bodies.push(JSON.parse(String(init.body)));return Response.json({id:'gen-one',status:'queued',results:[]},{status:202});}
      polls++;
      return Response.json({id:'gen-one',status:polls===1?'processing':'completed',credits:10,results:polls===1?[]:[{id:'result-one',url:'https://media.example.com/output.mp4',width:3840,height:2160,duration:2}]});
    }});
    const result=await generateVideo({model:provider.video(),prompt:'',providerOptions:{detailx:{uploadId:'asset-one',resolution:'4K',requestId:'app-order-1',maxPrechargeCredits:10}},poll:{intervalMs:1,timeoutMs:1000},maxRetries:0,
      download:async({url})=>{expect(url.href).toBe('https://media.example.com/output.mp4');return {data:new Uint8Array([0,1,2,3]),mediaType:'video/mp4'};}});
    expect(result.videos).toHaveLength(1);
    expect(bodies).toHaveLength(1);expect(bodies[0]).toMatchObject({upload_id:'asset-one',fps:-1,expected_credits:10});
    expect(bodies[0]).not.toHaveProperty('prompt');expect(bodies[0]).not.toHaveProperty('video_url');
    expect(polls).toBe(2);
  } finally {await rm(stateDir,{recursive:true,force:true});}
});

test('unsupported sources and settings fail before quoting',async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),'detailx-provider-'));
  let calls=0;
  try {
    const provider=createDetailX({apiKey:'dxk_test',stateDir,fetch:async()=>{calls++;throw new Error('unexpected');}});
    await expect(generateVideo({model:provider.video(),prompt:'invent a new scene',providerOptions:{detailx:{uploadId:'a',requestId:'x',maxPrechargeCredits:10}},maxRetries:0})).rejects.toThrow('Prompt');
    expect(calls).toBe(0);
  } finally {await rm(stateDir,{recursive:true,force:true});}
});

test('multiple videos are rejected before AI SDK fan-out can submit a paid request',async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),'detailx-provider-'));
  let calls=0;
  try {
    const provider=createDetailX({apiKey:'dxk_test',stateDir,fetch:async()=>{calls++;throw new Error('unexpected');}});
    await expect(generateVideo({model:provider.video(),n:2,prompt:'',providerOptions:{detailx:{uploadId:'a',requestId:'one-order',maxPrechargeCredits:10}},maxRetries:0})).rejects.toThrow('one source-video');
    expect(calls).toBe(0);
  } finally {await rm(stateDir,{recursive:true,force:true});}
});

test('the provider downloader refreshes results and tries the backup after a primary failure',async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),'detailx-provider-'));
  const downloads:string[]=[];
  let statusCalls=0;
  try {
    const provider=createDetailX({apiKey:'dxk_test',stateDir,minRequestIntervalMs:0,fetch:async(input,init)=>{
      if(String(input).endsWith('generation-estimates'))return Response.json({credits:1,pricing_revision_id:1,duration:1});
      if(init?.method==='POST')return Response.json({id:'gen-one',status:'queued',results:[]},{status:202});
      statusCalls++;
      return Response.json({id:'gen-one',status:'completed',results:[{id:'result-one',url:'https://media.example.com/primary.mp4',fallback_url:'https://media.example.com/backup.mp4',width:1280,height:720,duration:1}]});
    },download:async({url})=>{
      downloads.push(url.href);
      if(url.pathname==='/primary.mp4')throw new Error('primary unavailable');
      return {data:new Uint8Array([1,2,3]),mediaType:'video/mp4'};
    }});
    const result=await generateVideo({model:provider.video(),prompt:'',providerOptions:{detailx:{uploadId:'a',requestId:'fallback-order',maxPrechargeCredits:1}},download:provider.download,poll:{intervalMs:1,timeoutMs:1000},maxRetries:0});
    expect(result.video.uint8Array).toEqual(new Uint8Array([1,2,3]));
    expect(downloads).toEqual(['https://media.example.com/primary.mp4','https://media.example.com/backup.mp4']);
    expect(statusCalls).toBe(2);
  } finally {await rm(stateDir,{recursive:true,force:true});}
});

test('an aborted download does not start fallback requests',async()=>{
  const stateDir=await mkdtemp(join(tmpdir(),'detailx-provider-'));
  let calls=0;
  const controller=new AbortController();
  try {
    const provider=createDetailX({apiKey:'dxk_test',stateDir,minRequestIntervalMs:0,fetch:async()=>{
      calls++;
      return Response.json({id:'gen-one',status:'completed',results:[{id:'result-one',url:'https://media.example.com/primary.mp4',fallback_url:'https://media.example.com/backup.mp4',width:1280,height:720,duration:1}]});
    },download:async()=>{controller.abort();throw new Error('download interrupted');}});
    await provider.video().doStatus({operation:{generationId:'gen-one',scope:provider.client.scope}});
    await expect(provider.download({url:new URL('https://media.example.com/primary.mp4'),abortSignal:controller.signal})).rejects.toMatchObject({name:'AbortError'});
    expect(calls).toBe(1);
  } finally {await rm(stateDir,{recursive:true,force:true});}
});
