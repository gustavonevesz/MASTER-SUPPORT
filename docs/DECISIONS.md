# Índice de decisões

ADR-016 seleciona OIDC Authorization Code + PKCE como provider de produção, com preprovisionamento, sessão BFF opaca e provider dev/test pelo mesmo contrato.

ADR-015 aceita a Operator Console como React SPA estritamente local e read-only. A identidade operacional continua dependendo de `HumanReview` explícito conforme ADR-014.

| ADR | Decisão resumida | Status |
|---|---|---|
| [ADR-017](adr/ADR-017-safe-action-orchestration.md) | Job durável, política default-deny, aprovação e verificação para uma única Action R1 simulada | Aceito |
| [ADR-016](adr/ADR-016-operator-authentication-strategy.md) | OIDC + PKCE, preprovisionamento, OperatorSession BFF e `console.read` | Aceito |
| [ADR-001](adr/ADR-001-language-and-runtime-strategy.md) | TypeScript/Node no Control Plane/Web; C#/.NET no Runtime; Python futuro | Aceito |
| [ADR-002](adr/ADR-002-repository-structure.md) | Monorepo poliglota, monólito modular inicial | Aceito |
| [ADR-003](adr/ADR-003-agent-session-model.md) | Support Session temporária, outbound e credenciais curtas | Aceito |
| [ADR-004](adr/ADR-004-command-execution-model.md) | Capabilities primeiro; terminal controlado futuro | Aceito |
| [ADR-005](adr/ADR-005-transport-abstraction.md) | Protocolo independente; túnel substituível; WebSocket não decidido | Aceito |
| [ADR-006](adr/ADR-006-data-storage-strategy.md) | PostgreSQL primário; estado e histórico distintos | Aceito |
| [ADR-007](adr/ADR-007-contract-definition-strategy.md) | JSON Schema 2020-12 como fonte neutra de contratos | Aceito |
| [ADR-008](adr/ADR-008-control-plane-http-framework.md) | Fastify como borda HTTP do Control Plane | Aceito |
| [ADR-009](adr/ADR-009-experimental-realtime-transport.md) | WebSocket atrás de adapter, somente em Trial | Trial |
| [ADR-010](adr/ADR-010-observation-reconciliation.md) | Resultado recebido exige reconciliação; terminais não reabrem nem provocam reexecução | Aceito |
| [ADR-011](adr/ADR-011-durable-observation-persistence.md) | Driver PostgreSQL direto, migrations SQL e separação entre histórico durável e autoridade viva | Aceito |
| [ADR-012](adr/ADR-012-secure-session-trust-bootstrap.md) | TLS + SupportInvitation single-use + tickets opacos single-use e rotativos | Aceito |
| [ADR-013](adr/ADR-013-windows-read-only-preflight.md) | Preflight composto, sequencial e durável; ObservedEndpoint por Session não é Asset | Aceito |
| [ADR-014](adr/ADR-014-human-confirmed-asset-identity.md) | Asset e vínculo nascem somente por HumanReview explícito | Aceito |
| [ADR-015](adr/ADR-015-local-react-operator-console.md) | React SPA local, read-only e loopback-only; Browser acessa apenas DTOs do Control Plane | Aceito |

Status permitidos: `Proposto`, `Trial`, `Aceito`, `Rejeitado`, `Substituído`. Os seis ADRs iniciais foram aceitos na GATE-000; ADR-007 e ADR-008 foram aceitos na FOUNDATION-001; ADR-009 permanece em Trial. Alterações materiais serão feitas por novo ADR ou revisão explicitamente versionada, preservando histórico no Git.

A FOUNDATION-003 concretizou a ADR-004 com registry local explícita e uma coleta R0/ReadOnly em C#. A FOUNDATION-004 aceitou a ADR-010 para separar execution outcome de reconciled outcome. A FOUNDATION-005 aceitou a ADR-011 e concretizou a ADR-006 para esse histórico mínimo. ObservationRequest não foi promovida a Job. A ADR-009 continua Trial e a ADR-007 continua exigindo substituição do validador antes de qualquer keyword fora do subconjunto aceito.
