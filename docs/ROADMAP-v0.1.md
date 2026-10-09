# Roadmap v0.1

FOUNDATION-007 concluída: Preflight Windows real, composto por cinco capabilities R0, com minimização, provenance, lifecycle durável, snapshot por referências e ObservedEndpoint por Session. Asset permanente, correlação automática, diagnóstico, IA e ações mutáveis continuam fora do escopo.

FOUNDATION-006 concluída: bootstrap HTTPS, WSS autenticado, SupportInvitation durável single-use, tickets efêmeros single-use/rotativos, validação TLS real, replay/revogação/TTL e separação segura entre modo operacional e dev. Nenhuma capability, identidade de Asset, UI ou ação mutável foi adicionada. A próxima etapa deve ser definida em gate próprio; não está iniciada aqui.

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

Status: concluída no commit `49a33e7`. Consolidou a espinha de observação com cancelamento por autoridade, registry ativo limitado, estados terminais imutáveis, resultado tardio sem RAW, outcome desconhecido após queda, deadline, quotas, rate limit, backpressure, métricas/auditoria sanitizadas e spike de proxy local. WebSocket permanece Trial.

## FOUNDATION-005 — Durable Observation State & Restart Reconciliation

Status: implementada, aguardando gate de revisão. PostgreSQL real guarda ServerInstance, SessionRecord, ObservationRequest, Observation minimizada, EvidenceMetadata e AuditEvent. Migrations SQL são explícitas; startup e novas operações falham fechados sem durabilidade. Restart normal/crash preserva histórico, encerra autoridade antiga e reconcilia requests incertas como `abandoned/outcomeUnknown`, sem redispatch. Retenção permanece aberta e Evidence RAW não é persistida.

## FOUNDATION-006 — Production Session Trust Bootstrap

Status: concluída. Bootstrap autenticado de Support Session, credenciais curtas e revogáveis, TLS validado, proteção contra replay e vínculo explícito entre Session e AgentInstance.

## FOUNDATION-007 — Windows Read-only Preflight

Status: concluída. Cinco capabilities R0, PreflightRun/Snapshot duráveis, ObservedEndpoint por Session, minimização e teste real Windows/PostgreSQL/TLS.

## FOUNDATION-008 — recomendação

Definir revisão humana e confirmação explícita antes de criar Asset Registry. Deve preservar ObservedEndpoint como observação, proibir correlação automática por hostname/fingerprint e continuar sem ação mutável até um gate próprio.

## VERTICAL-001 — Read-only Preflight

Uma capability Windows somente leitura, inventário mínimo, Evidence estruturada, painel mínimo e timeline. Sem ação mutável e sem IA autônoma.

## VERTICAL-002 — Safe Job + Verification

Uma ação segura/reversível, policy/approval mínima, timeout/cancelamento, estado antes/depois e Verification explícita. Exercitar falha e resultado parcial.

## HARDENING-001 — Pilot readiness

Threat model atualizado, bootstrap/identidade robustos, secrets/redaction, quotas, auditoria, observabilidade, distribuição assinada quando aplicável, testes de abuso e runbooks.

## FUTURE — somente após evidência

Mais capabilities Windows; terminal assistido controlado; memória de incidentes; Support Brain/LLM com contexto redigido; shadow mode; Managed Endpoint; novas classes de ativo; ML sobre dados confiáveis. Cada entrada exige ADR e etapa própria.
