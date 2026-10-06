# Índice de decisões

| ADR | Decisão resumida | Status |
|---|---|---|
| [ADR-001](adr/ADR-001-language-and-runtime-strategy.md) | TypeScript/Node no Control Plane/Web; C#/.NET no Runtime; Python futuro | Aceito |
| [ADR-002](adr/ADR-002-repository-structure.md) | Monorepo poliglota, monólito modular inicial | Aceito |
| [ADR-003](adr/ADR-003-agent-session-model.md) | Support Session temporária, outbound e credenciais curtas | Aceito |
| [ADR-004](adr/ADR-004-command-execution-model.md) | Capabilities primeiro; terminal controlado futuro | Aceito |
| [ADR-005](adr/ADR-005-transport-abstraction.md) | Protocolo independente; túnel substituível; WebSocket não decidido | Aceito |
| [ADR-006](adr/ADR-006-data-storage-strategy.md) | PostgreSQL primário; estado e histórico distintos | Aceito |
| [ADR-007](adr/ADR-007-contract-definition-strategy.md) | JSON Schema 2020-12 como fonte neutra de contratos | Aceito |
| [ADR-008](adr/ADR-008-control-plane-http-framework.md) | Fastify como borda HTTP do Control Plane | Aceito |
| [ADR-009](adr/ADR-009-experimental-realtime-transport.md) | WebSocket atrás de adapter, somente em Trial | Trial |

Status permitidos: `Proposto`, `Trial`, `Aceito`, `Rejeitado`, `Substituído`. Os seis ADRs iniciais foram aceitos na GATE-000; ADR-007 e ADR-008 foram aceitos na FOUNDATION-001; ADR-009 permanece em Trial. Alterações materiais serão feitas por novo ADR ou revisão explicitamente versionada, preservando histórico no Git.
