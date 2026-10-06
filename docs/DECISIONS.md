# Índice de decisões

| ADR | Decisão resumida | Status |
|---|---|---|
| [ADR-001](adr/ADR-001-language-and-runtime-strategy.md) | TypeScript/Node no Control Plane/Web; C#/.NET no Runtime; Python futuro | Aceito |
| [ADR-002](adr/ADR-002-repository-structure.md) | Monorepo poliglota, monólito modular inicial | Aceito |
| [ADR-003](adr/ADR-003-agent-session-model.md) | Support Session temporária, outbound e credenciais curtas | Aceito |
| [ADR-004](adr/ADR-004-command-execution-model.md) | Capabilities primeiro; terminal controlado futuro | Aceito |
| [ADR-005](adr/ADR-005-transport-abstraction.md) | Protocolo independente; túnel substituível; WebSocket não decidido | Aceito |
| [ADR-006](adr/ADR-006-data-storage-strategy.md) | PostgreSQL primário; estado e histórico distintos | Aceito |

Status permitidos: `Proposto`, `Aceito`, `Rejeitado`, `Substituído`. Os seis ADRs iniciais foram aceitos na GATE-000. Alterações materiais serão feitas por novo ADR ou revisão explicitamente versionada, preservando histórico no Git.
