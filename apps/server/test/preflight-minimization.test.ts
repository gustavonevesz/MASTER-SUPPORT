import assert from "node:assert/strict";
import { test } from "node:test";
import { maxPreflightVolumes, minimizeCapabilityFacts } from "../src/preflight/minimization.js";

const forbidden = new Set(["username","sid","domain","mac","ip","serialnumber","email","processlist","filename","credentials","tokens",
  "supportinvitation","connectionticket","resumeticket"]);
function keys(value:unknown,result:string[]=[]):string[]{if(Array.isArray(value))for(const item of value)keys(item,result);else if(value&&typeof value==="object")for(const [key,item] of Object.entries(value)){result.push(key.toLowerCase().replaceAll(/[^a-z]/g,""));keys(item,result);}return result;}

test("deterministic minimizers structurally discard identity, secret, process, and file fields",()=>{const poison={username:"u",sid:"s",domain:"d",mac:"m",ip:"i",serialNumber:"n",email:"e",
  processList:["p"],fileName:"f",credentials:"c",tokens:"t",supportInvitation:"secret",connectionTicket:"secret",resumeTicket:"secret"};
  const inputs:Record<string,Record<string,unknown>>={
    "system.runtime.summary":{...poison,osPlatform:"Windows",osDescription:"Windows",osArchitecture:"x64",processArchitecture:"x64",dotnetRuntime:".NET 10",agentVersion:"1",productVersion:"1",protocolVersion:"1.0",supportSessionMode:"authenticated"},
    "windows.os.summary":{...poison,machineName:"HOST",osDescription:"Windows",osVersion:"10",windowsBuild:"1",osArchitecture:"x64",processArchitecture:"x64",uptimeMilliseconds:1},
    "windows.memory.summary":{...poison,totalPhysicalMemoryBytes:10,availablePhysicalMemoryBytes:4,usedPhysicalMemoryBytes:6},
    "windows.storage.summary":{...poison,volumes:[{...poison,root:"C:\\",driveType:"fixed",fileSystem:"NTFS",totalBytes:10,freeBytes:4,availableBytes:4}]},
    "windows.execution-context.summary":{...poison,isElevated:false,is64BitProcess:true,is64BitOperatingSystem:true,executionMode:"SupportSession",privilegeLevel:"standard-user"}};
  for(const [capability,input] of Object.entries(inputs)){const found=keys(minimizeCapabilityFacts(capability,input));assert.deepEqual(found.filter(key=>forbidden.has(key)),[]);}
});

test("storage cardinality and numeric coherence are bounded",()=>{const volume={root:"C:\\",driveType:"fixed",fileSystem:"NTFS",totalBytes:10,freeBytes:4,availableBytes:4};
  assert.throws(()=>minimizeCapabilityFacts("windows.storage.summary",{volumes:Array.from({length:maxPreflightVolumes+1},()=>volume)}),/invalid_storage_volumes/);
  assert.throws(()=>minimizeCapabilityFacts("windows.memory.summary",{totalPhysicalMemoryBytes:10,availablePhysicalMemoryBytes:8,usedPhysicalMemoryBytes:3}),/invalid_memory_values/);
});
