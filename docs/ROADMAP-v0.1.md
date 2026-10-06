# Roadmap v0.1

Cada etapa exige revisão e autorização explícita; itens posteriores são direção, não compromisso de escopo.

## ETAPA 0 — Fundação (esta entrega)

Especificação, arquitetura conceitual, domínio, threat model, ADRs, dúvidas e roadmap. Sem produto funcional.

## FOUNDATION-001 — Contracts + Server Skeleton + Agent Skeleton

Status: implementada, aguardando gate de revisão. Objetivo: provar compilação e limites, não o fluxo completo.

- versões LTS fixadas;
- estrutura interna mínima materializada;
- envelopes Hello e erros definidos sem Session/Job operacional;
- contratos validados em TypeScript e C# com fixtures;
- servidor e console agent sem execução privilegiada;
- testes, CI e round-trip cross-language;
- spikes documentais de transporte e PowerShell.

Critério de saída: builds reproduzíveis, contrato round-trip e nenhum comando real/remoto. A conclusão depende do gate após verificação automatizada.

## FOUNDATION-002 — Session Backbone

Lifecycle temporário, handshake experimental, heartbeat/lease, conexão de saída e encerramento/revogação. Apenas ambiente de desenvolvimento e identidade provisória documentada.

## VERTICAL-001 — Read-only Preflight

Uma capability Windows somente leitura, inventário mínimo, Evidence estruturada, painel mínimo e timeline. Sem ação mutável e sem IA autônoma.

## VERTICAL-002 — Safe Job + Verification

Uma ação segura/reversível, policy/approval mínima, timeout/cancelamento, estado antes/depois e Verification explícita. Exercitar falha e resultado parcial.

## HARDENING-001 — Pilot readiness

Threat model atualizado, bootstrap/identidade robustos, secrets/redaction, quotas, auditoria, observabilidade, distribuição assinada quando aplicável, testes de abuso e runbooks.

## FUTURE — somente após evidência

Mais capabilities Windows; terminal assistido controlado; memória de incidentes; Support Brain/LLM com contexto redigido; shadow mode; Managed Endpoint; novas classes de ativo; ML sobre dados confiáveis. Cada entrada exige ADR e etapa própria.
