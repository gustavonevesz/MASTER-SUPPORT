# ADR-009 — Adapter realtime experimental

## Decisão

Usar WebSocket como adapter **Trial/Experimental** na FOUNDATION-002, atrás de abstrações de transporte nos dois runtimes. Não é uma escolha permanente do protocolo nem do domínio.

## Status

Trial na FOUNDATION-002.

## Evidência

Um teste real Node↔.NET comprovou canal bidirecional, handshake, heartbeat correlacionado, fechamento, disconnect e nova conexão. Um harness real SSE+HTTP comprovou que a alternativa exige um stream Server→Agent e requests Agent→Server separados, elevando coordenação e observabilidade para este caso bidirecional.

## Limites

- bind padrão `127.0.0.1`; override é explícito e produz alerta;
- `/dev/sessions` não é registrado quando o processo é configurado fora de loopback;
- mensagens limitadas a 64 KiB;
- WebSocket move mensagens; Session e protocolo permanecem fora do adapter;
- não há TLS ou autenticação de produção nesta etapa;
- Cloudflare não aparece nos contratos ou domínio.

## Condições para promover ou substituir

Antes de produção, medir proxy corporativo, TLS, backpressure, volume, reconexão em redes reais e compatibilidade com a infraestrutura escolhida. Promover por novo gate/ADR; substituir se gRPC/HTTP oferecer benefício mensurável sem acoplar o domínio.
