# SPIKE-001 — Transporte realtime

Status: análise documental complementada por experimento real na FOUNDATION-002.

| Opção | Bidirecionalidade / outbound | Reconexão e queda | Operação e ecossistema |
|---|---|---|---|
| WebSocket | canal bidirecional natural iniciado pelo Agent; adequado a mensagens Server → Agent | heartbeat, resume, ack e deduplicação precisam do protocolo | suporte maduro em Node/.NET e normalmente compatível com proxies/Cloudflare; conexões longas exigem observabilidade/backpressure |
| SSE + HTTP | Agent abre SSE de saída e usa HTTP separado para resultados | reconexão SSE simples, mas duas vias/ordenação ficam mais complexas | fácil inspeção e HTTP convencional; SSE é unidirecional |
| Long-lived HTTP/streaming | pode carregar stream, mas full duplex e proxy behavior variam | exige framing, keepalive e retomada próprios | menos uniforme entre infraestrutura; risco de reinventar WebSocket/gRPC |
| gRPC streaming | streaming bidirecional e contratos fortes | lifecycle e backpressure maduros, ainda exige semântica de replay | bom suporte Node/.NET; HTTP/2 e proxies/túneis demandam validação adicional |

## Experimento FOUNDATION-002

- WebSocket: Fastify/Node e `ClientWebSocket`/.NET trocaram mensagens bidirecionais reais em loopback, com handshake, heartbeat, correlação, fechamento e detecção de queda.
- SSE + HTTP: harness isolado real comprovou downstream por EventSource e upstream por POST separado. Funciona, mas exige dois canais, correlação entre requests e mais estados operacionais.
- Todos os testes usaram portas dinâmicas; nenhum adapter alternativo foi incorporado ao produto.

## Resultado

WebSocket foi promovido somente a **Trial/Experimental** para o adapter da FOUNDATION-002. Ainda faltam proxy corporativo, TLS, backpressure e rede não local antes de qualquer promoção. Ack, deduplicação, TTL e compatibilidade continuam no protocolo, não no socket.
