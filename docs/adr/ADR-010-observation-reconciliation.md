# ADR-010 — Reconciliação do resultado de Observation

## Decisão

Separar o desfecho que o Agent produziu (`execution outcome`) do desfecho que o Control Plane aceitou (`reconciled outcome`). Receber uma mensagem não lhe confere autoridade: o Server valida request, Session, correlação, capability, estado e deadline antes de decidir `accept`, `reject`, `late` ou `duplicate`.

O lifecycle em memória é pequeno: `created → accepted → executing → completed|failed|timed_out|cancelled|abandoned`. Estados terminais nunca reabrem. `outcomeUnknown` é um atributo de `abandoned`, não outro estado.

## Status

Aceito na FOUNDATION-004.

## Semântica de perda de autoridade

- `Revoked`, `Closed` e `Expired` enviam cancelamento quando possível e tornam requests não terminais `cancelled`.
- Disconnect cancela imediatamente operações locais do Agent. No Server, requests já aceitas/em execução tornam-se `abandoned` com `outcomeUnknown=true`, pois execução e entrega podem ter cruzado a queda.
- Resume não reenvia nem reexecuta requests antigas. Um resultado que ainda chegue é reconciliado, nunca anexado silenciosamente.
- Resultado/falha após timeout, cancelamento, abandono, revogação ou deadline é tardio. Preservam-se somente IDs, tipo, instante e motivo; Evidence RAW tardia é descartada.
- Cancelamento é explícito e idempotente. Cancelar um terminal não o reabre.

## Limites operacionais

Os defaults são configuráveis: 2 Observations ativas por Session, 2 por Agent, 1 por capability e 5 inícios por Session/capability em janela deslizante de 10 segundos. Não existe fila operacional ilimitada. O WebSocket limita mensagens a 64 KiB; a capability limita seu payload a 16 KiB antes de armazenamento. Server e Agent encerram explicitamente a conexão quando o buffer bounded não comporta a mensagem.

O Server é a autoridade para deadline. O Agent também recusa iniciar trabalho já expirado, mas diferenças de relógio podem provocar rejeição conservadora; não há sincronização distribuída nesta etapa.

## Consequências

O modelo evita sucesso fictício, reabertura de terminal e retry implícito. Em contrapartida, uma queda pode deixar outcome desconhecido e exigir intervenção/reconciliação futura. Stores, métricas, auditoria, rate limit e caches são voláteis; restart perde o estado e não oferece recuperação durável. Reconciliation não verifica se o objetivo operacional foi atingido — essa responsabilidade pertence a Verification futura.
