export function requireLoopbackOperatorConsole(enabled:boolean,host:string):void{
  if(enabled&&host!=="127.0.0.1")throw new Error("operator_console_requires_127.0.0.1");
}
