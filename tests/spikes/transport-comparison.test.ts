import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";

test("SSE plus HTTP alternative requires separate downstream and upstream requests", async () => {
  let upstreamMessage = "";
  const server = createServer((request, response) => {
    if (request.method === "GET" && request.url === "/events") {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end("event: server-message\ndata: heartbeat\n\n");
      return;
    }
    if (request.method === "POST" && request.url === "/agent-message") {
      request.setEncoding("utf8");
      request.on("data", chunk => { upstreamMessage += chunk; });
      request.on("end", () => { response.writeHead(204); response.end(); });
      return;
    }
    response.writeHead(404); response.end();
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Dynamic port unavailable.");
    const base = `http://127.0.0.1:${address.port}`;
    const downstream = await fetch(`${base}/events`);
    assert.match(await downstream.text(), /heartbeat/);
    const upstream = await fetch(`${base}/agent-message`, { method: "POST", body: "heartbeat.ack" });
    assert.equal(upstream.status, 204);
    assert.equal(upstreamMessage, "heartbeat.ack");
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
