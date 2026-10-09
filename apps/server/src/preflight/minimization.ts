const sources: Record<string, string> = { "system.runtime.summary": "agent.dotnet.runtime", "windows.os.summary": "agent.dotnet.runtime",
  "windows.memory.summary": "agent.win32.globalmemorystatusex", "windows.storage.summary": "agent.dotnet.driveinfo",
  "windows.execution-context.summary": "agent.windows.security-context" };
export const maxPreflightVolumes = 32;
export function expectedSource(capabilityId: string): string | undefined { return sources[capabilityId]; }
export function minimizeCapabilityFacts(capabilityId: string, value: unknown): Record<string, unknown> {
  const raw = object(value);
  if (capabilityId === "system.runtime.summary") return strings(raw, ["osPlatform","osDescription","osArchitecture","processArchitecture","dotnetRuntime","agentVersion","productVersion","protocolVersion","supportSessionMode"]);
  if (capabilityId === "windows.os.summary") return { ...strings(raw, ["machineName","osDescription","osVersion","windowsBuild","osArchitecture","processArchitecture"], { machineName: "INTERNAL" }),
    uptimeMilliseconds: nonNegative(raw["uptimeMilliseconds"]), fieldClassifications: classifications(["osDescription","osVersion","windowsBuild","osArchitecture","processArchitecture","uptimeMilliseconds"], { machineName: "INTERNAL" }) };
  if (capabilityId === "windows.memory.summary") { const total=nonNegative(raw["totalPhysicalMemoryBytes"]), available=nonNegative(raw["availablePhysicalMemoryBytes"]), used=nonNegative(raw["usedPhysicalMemoryBytes"]);
    if (available>total || used!==total-available) throw new Error("invalid_memory_values"); return { totalPhysicalMemoryBytes:total, availablePhysicalMemoryBytes:available, usedPhysicalMemoryBytes:used,
      fieldClassifications: classifications(["totalPhysicalMemoryBytes","availablePhysicalMemoryBytes","usedPhysicalMemoryBytes"]) }; }
  if (capabilityId === "windows.storage.summary") { if (!Array.isArray(raw["volumes"]) || raw["volumes"].length>maxPreflightVolumes) throw new Error("invalid_storage_volumes");
    const volumes=raw["volumes"].map(item=>{const volume=object(item), total=nonNegative(volume["totalBytes"]), free=nonNegative(volume["freeBytes"]), available=nonNegative(volume["availableBytes"]);
      if(free>total||available>total) throw new Error("invalid_storage_values"); return {root:text(volume["root"],16),driveType:exact(volume["driveType"],"fixed"),fileSystem:text(volume["fileSystem"],32),totalBytes:total,freeBytes:free,availableBytes:available};});
    return {volumes,fieldClassifications:classifications(["driveType","fileSystem","totalBytes","freeBytes","availableBytes"],{root:"INTERNAL"})}; }
  if (capabilityId === "windows.execution-context.summary") return {isElevated:bool(raw["isElevated"]),is64BitProcess:bool(raw["is64BitProcess"]),is64BitOperatingSystem:bool(raw["is64BitOperatingSystem"]),
    executionMode:exact(raw["executionMode"],"SupportSession"),privilegeLevel:oneOf(raw["privilegeLevel"],["standard-user","elevated"]),
    fieldClassifications:classifications(["is64BitProcess","is64BitOperatingSystem"],{isElevated:"INTERNAL",executionMode:"INTERNAL",privilegeLevel:"INTERNAL"})};
  throw new Error("unsupported_capability");
}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=="object"||Array.isArray(value))throw new Error("invalid_object");return value as Record<string,unknown>;}
function text(value:unknown,max=512):string{if(typeof value!=="string"||value.length<1||value.length>max)throw new Error("invalid_string");return value;}
function nonNegative(value:unknown):number{if(typeof value!=="number"||!Number.isSafeInteger(value)||value<0)throw new Error("invalid_number");return value;}
function bool(value:unknown):boolean{if(typeof value!=="boolean")throw new Error("invalid_boolean");return value;}
function exact(value:unknown,expected:string):string{if(value!==expected)throw new Error("invalid_value");return expected;}
function oneOf(value:unknown,expected:readonly string[]):string{const result=text(value,32);if(!expected.includes(result))throw new Error("invalid_value");return result;}
function classifications(keys:readonly string[],overrides:Record<string,string>={}):Record<string,string>{const result={...overrides};for(const key of keys)if(!(key in result))result[key]="MINIMIZED";return result;}
function strings(raw:Record<string,unknown>,keys:readonly string[],overrides:Record<string,string>={}):Record<string,unknown>{const result:Record<string,unknown>={};for(const key of keys)result[key]=text(raw[key]);result["fieldClassifications"]=classifications(keys,overrides);return result;}
