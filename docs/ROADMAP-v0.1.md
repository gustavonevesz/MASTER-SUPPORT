# Roadmap v0.1

Cada etapa exige revisão e autorização explícita; itens posteriores são direção, não compromisso de escopo.

## ETAPA 0 — Fundação (esta entrega)

Especificação, arquitetura conceitual, domínio, threat model, ADRs, dúvidas e roadmap. Sem produto funcional.

## FOUNDATION-001 — Contracts + Server Skeleton + Agent Skeleton

Status: concluída no commit `6d8f3a1`. Objetivo: provar compilação e limites, não o fluxo completo.

- versões LTS fixadas;
- estrutura interna mínima materializada;
- envelopes Hello e erros definidos sem Session/Job operacional;
- contratos validados em TypeScript e C# com fixtures;
- servidor e console agent sem execução privilegiada;
- testes, CI e round-trip cross-language;
- spikes documentais de transporte e PowerShell.

Critério de saída: builds reproduzíveis, contrato round-trip e nenhum comando real/remoto. A conclusão depende do gate após verificação automatizada.

## FOUNDATION-002 — Session Backbone

Status: concluída no commit `94b9ca1`. Lifecycle temporário, WebSocket Trial em loopback, handshake, heartbeat/lease, resume efêmero, deduplicação limitada e encerramento/revogação em memória. Apenas desenvolvimento; sem identidade confiável.

## FOUNDATION-003 — Read-only Observation Backbone

Status: concluída no commit `e545199`. Inclui revogação proativa do canal, registry fechado no Agent, negociação e execução de `system.runtime.summary@1.0`, lifecycle de solicitação, Evidence RAW e Observation factual distintas, timeout de 5 segundos, limite de 16 KiB, deduplicação operacional e stores somente em memória. Não inclui Job, Preflight, persistência, autenticação de produção ou ação mutável.

## FOUNDATION-004 — Observation Hardening & Reconciliation

Status: implementada, aguardando gate de revisão. Consolidou a espinha de observação com cancelamento por autoridade, registry ativo limitado, estados terminais imutáveis, resultado tardio sem RAW, outcome desconhecido após queda, deadline, quotas, rate limit, backpressure, métricas/auditoria sanitizadas e spike de proxy local. WebSocket permanece Trial e todo estado continua volátil.

## FOUNDATION-005 — Durable Observation State & Restart Reconciliation

Próxima etapa recomendada: persistir de forma transacional o mínimo de Session/Observation/Audit, definir migrations e retenção, e reconciliar restart sem reenviar automaticamente requests cujo outcome seja desconhecido. Deve provar crash/restart e idempotência entre store e transporte, sem nova capability, PowerShell, ação mutável, Job completo, Preflight, IA ou UI.

## VERTICAL-001 — Read-only Preflight

Uma capability Windows somente leitura, inventário mínimo, Evidence estruturada, painel mínimo e timeline. Sem ação mutável e sem IA autônoma.

## VERTICAL-002 — Safe Job + Verification

Uma ação segura/reversível, policy/approval mínima, timeout/cancelamento, estado antes/depois e Verification explícita. Exercitar falha e resultado parcial.

## HARDENING-001 — Pilot readiness

Threat model atualizado, bootstrap/identidade robustos, secrets/redaction, quotas, auditoria, observabilidade, distribuição assinada quando aplicável, testes de abuso e runbooks.

## FUTURE — somente após evidência

Mais capabilities Windows; terminal assistido controlado; memória de incidentes; Support Brain/LLM com contexto redigido; shadow mode; Managed Endpoint; novas classes de ativo; ML sobre dados confiáveis. Cada entrada exige ADR e etapa própria.
