# ADR-005 — Abstração de transporte

## Decisão recomendada

Definir protocolo de aplicação versionado e um `Transport Adapter`; agente inicia conexão de saída. WebSocket é candidato para a primeira fatia, a validar por spike. Cloudflare Tunnel pode transportar o canal, mas não aparece em domínio, envelopes ou lifecycle.

## Status

Aceito na GATE-000 quanto à abstração. WebSocket está em Trial experimental pela ADR-009; não é transporte definitivo.

## Contexto e alternativas

Jobs precisam de entrega bidirecional, heartbeat, cancelamento e resultados. WebSocket favorece simplicidade web e conexão longa; polling/long polling simplifica infraestrutura mas aumenta latência/estado; gRPC streaming oferece contratos/streaming fortes, com maior fricção em proxies/browser. Fila/broker adiciona operação prematura.

## Fronteira

Os nomes exatos permanecem abertos. O envelope deve representar versão do protocolo, ID único da mensagem, tipo, sessão, correlação quando aplicável, timestamp, expiração/TTL quando aplicável e payload validado. Deve haver deduplicação, rejeição de incompatibilidade e distinção entre comando recebido, acknowledgement, execução e resultado. Semântica de ack, deduplicação e retomada pertence ao protocolo/orchestrator; socket e túnel apenas carregam bytes.

O handshake deve permitir informar versão do Agent, versões do protocolo e capabilities suportadas. O servidor aceita ou rejeita a combinação, negocia capabilities e não despacha operação ausente/incompatível. Compatibilidade deve admitir janela entre versões; upgrade simultâneo não pode ser pressuposto.

## Consequências e trade-offs

- Cloudflare pode ser trocado por reverse proxy, VPN ou conexão direta.
- Uma abstração fina evita “transport agnostic” fictício; adapters não escondem capacidades essenciais.
- TLS não substitui autenticação de agente/sessão nem proteção contra replay.
- O servidor não exige porta de entrada no endpoint.

## Risco de lock-in

Baixo para fornecedor; moderado se semântica depender de WebSocket. Testes de contrato devem rodar contra adapter in-memory e adapter real.

## Condições para revisar

Restrições corporativas de proxy, escala de conexões, necessidade de streaming binário, entrega offline durável ou evidência operacional favorável a gRPC/broker/polling.
