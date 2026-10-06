import assert from "node:assert/strict";
import { test } from "node:test";
import WebSocket from "ws";
import { WebSocketServerTransport } from "../src/transport/websocket-transport.js";

test("slow consumer hits bounded server buffer and connection closes explicitly", () => {
  const fake = { readyState: WebSocket.OPEN, bufferedAmount: 1024, sent: 0, closeCode: 0,
    send() { this.sent++; }, close(code: number) { this.closeCode = code; } };
  const transport = new WebSocketServerTransport(fake as unknown as WebSocket, 1024);
  assert.throws(() => transport.send({ message: "bounded" }), /backpressure_limit/);
  assert.equal(fake.sent, 0); assert.equal(fake.closeCode, 1013);
});
