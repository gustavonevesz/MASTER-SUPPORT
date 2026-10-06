# SPIKE-001 — Transporte realtime

Status: análise documental; decisão permanece aberta.

| Opção | Bidirecionalidade / outbound | Reconexão e queda | Operação e ecossistema |
|---|---|---|---|
| WebSocket | canal bidirecional natural iniciado pelo Agent; adequado a mensagens Server → Agent | heartbeat, resume, ack e deduplicação precisam do protocolo | suporte maduro em Node/.NET e normalmente compatível com proxies/Cloudflare; conexões longas exigem observabilidade/backpressure |
| SSE + HTTP | Agent abre SSE de saída e usa HTTP separado para resultados | reconexão SSE simples, mas duas vias/ordenação ficam mais complexas | fácil inspeção e HTTP convencional; SSE é unidirecional |
| Long-lived HTTP/streaming | pode carregar stream, mas full duplex e proxy behavior variam | exige framing, keepalive e retomada próprios | menos uniforme entre infraestrutura; risco de reinventar WebSocket/gRPC |
| gRPC streaming | streaming bidirecional e contratos fortes | lifecycle e backpressure maduros, ainda exige semântica de replay | bom suporte Node/.NET; HTTP/2 e proxies/túneis demandam validação adicional |

## Resultado

WebSocket continua o candidato mais simples para a primeira conexão outbound bidirecional, mas não foi escolhido definitivamente. FOUNDATION-002 deve executar um spike de rede local com reconexão, heartbeat, proxy corporativo/Cloudflare apenas como compatibilidade de transporte e comportamento de mensagem incerta. Ack, deduplicação, TTL e compatibilidade continuam no protocolo, não no socket.

Nenhum experimento de rede foi integrado nesta etapa porque não acrescentaria evidência suficiente sem modelar lifecycle de sessão, que pertence à FOUNDATION-002.
