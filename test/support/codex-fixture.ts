// Harmloser echter RPC-Kindprozess; Testseams sind keine CLI-Atteste.
import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
// @ts-expect-error: Node-Skripte ohne Declaration.
import * as raw from "../../scripts/codex-prozess-lib.mjs";
export type Profil = { root: string; env: Record<string, string>; entfernen: () => void };
export type Rpc = (method: string, params: unknown) => Promise<Record<string, unknown>>;
export type Inventar = (codex: string, p: Profil, fn: (rpc: Rpc, init: { userAgent: string }) => Promise<unknown>) => Promise<unknown>;
type Optionen = { start: (file: string, args: string[], options: SpawnOptions) => ChildProcess; timeoutMs: number };
const c = raw as unknown as { mitInventar: (s: string, p: Profil, fn: (rpc: Rpc, init: { userAgent: string }) => Promise<unknown>, o: Optionen) => Promise<unknown> };
export function fakeInventar(mode: string, antworten: Record<string, unknown> = {}, zustand: { root?: string; child?: ChildProcess } = {}): Inventar {
  return (_codex, p, fn) => {
    zustand.root = p.root;
    const script = `const antworten=${JSON.stringify(antworten)},mode=${JSON.stringify(mode)};require('readline').createInterface({input:process.stdin}).on('line',l=>{
      const m=JSON.parse(l);if(!m.id)return;
      if(mode==='close'){process.exit();return;}
      if(mode==='hang'||mode==='signal')return;
      if(mode==='json'){console.log('{');return;}
      if(mode==='size'){console.log('x'.repeat(1000001));return;}
      if(mode==='rpc'||(mode==='trust'&&m.method==='config/value/write')){console.log(JSON.stringify({id:m.id,error:{code:-32603,message:'fixture'}}));return;}
      console.log(JSON.stringify({id:999,result:{ignored:true}}));
      const r=antworten[m.method];console.log(JSON.stringify({id:m.id,result:m.method==='initialize'?{userAgent:mode==='version'?'fixture/0.165.0 (fixture)':'fixture/0.164.0 (fixture)'}:Array.isArray(r)?r.shift():r}));
      if(mode==='pipe'){process.stdin.destroy();setTimeout(()=>process.exit(),20);}
    });`;
    return c.mitInventar("fixture", p, fn, { timeoutMs: mode === "hang" ? 100 : 3000, start: (_file, _args, options) => {
      const child = spawn(process.execPath, ["-e", script], options); zustand.child = child;
      if (mode === "signal") child.once("spawn", () => setTimeout(() => child.kill("SIGKILL"), 100));
      return child;
    } });
  };
}
