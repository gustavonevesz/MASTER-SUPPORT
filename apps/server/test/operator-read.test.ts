import assert from "node:assert/strict";
import { test } from "node:test";
import { requireLoopbackOperatorConsole } from "../src/operator-read/config.js";

test("operator console accepts only the literal IPv4 loopback host",()=>{
  assert.doesNotThrow(()=>requireLoopbackOperatorConsole(true,"127.0.0.1"));
  assert.doesNotThrow(()=>requireLoopbackOperatorConsole(false,"0.0.0.0"));
  for(const host of ["0.0.0.0","localhost","::1","192.168.1.10"]){
    assert.throws(()=>requireLoopbackOperatorConsole(true,host),/operator_console_requires_127\.0\.0\.1/);
  }
});
