# Master Support

Master Support é a futura plataforma inteligente de helpdesk e administração tecnológica da Master Health. Seu princípio central é conduzir diagnósticos verificáveis, não apenas executar comandos.

## Estado atual

O repositório está na **Etapa 0 — Fundação**. Há somente documentação arquitetural e diretórios reservados. Não existem aplicações, agente, infraestrutura, dependências ou funcionalidades implementadas.

O primeiro alvo é **Windows Endpoint em Support Session temporária**. Servidores, Linux, impressoras, scanners, gerenciamento persistente, IA autônoma e ML permanecem fora do primeiro incremento.

## Princípios

- Problema → observação → evidências → hipóteses → plano → ação → resultado → verificação → adaptação → resolução → documentação → aprendizado.
- `ExitCode 0` prova execução, não resolução.
- Fatos, interpretações, hipóteses, decisões e ações são distintos.
- Ações relevantes exigem verificação posterior e auditoria.
- Capacidade técnica e autorização são preocupações separadas.
- Segredos não entram em logs nem em prompts de IA.
- Transporte é substituível e não define o domínio.

## Mapa da documentação

- [Especificação](docs/SPEC-001.md)
- [Arquitetura conceitual](docs/architecture/ARCHITECTURE-CONCEPTUAL-v0.1.md)
- [Modelo de domínio](docs/domain/DOMAIN-MODEL-v0.1.md)
- [Threat model](docs/security/THREAT-MODEL-v0.1.md)
- [Tratamento de dados](docs/security/DATA-HANDLING-v0.1.md)
- [Índice de decisões](docs/DECISIONS.md)
- [Questões abertas](docs/OPEN-QUESTIONS.md)
- [Roadmap](docs/ROADMAP-v0.1.md)

## Estrutura reservada

`apps/`, `packages/` e `tests/` reservam limites futuros; sua decomposição interna será criada apenas na FOUNDATION-001, após autorização explícita dessa etapa.

## Regra de evolução

Cada etapa deve ter escopo explícito, rastreabilidade entre requisitos, ADRs e implementação, verificação proporcional ao risco e relatório de encerramento. A próxima etapa proposta é `FOUNDATION-001 — Contracts + Server Skeleton + Agent Skeleton`; ela não faz parte desta entrega.
