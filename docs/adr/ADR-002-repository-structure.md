# ADR-002 — Estrutura do repositório

## Decisão recomendada

Usar monorepo poliglota, inicialmente com `apps/web`, `apps/server`, `apps/agent`, `packages/contracts`, `packages/domain`, `packages/policy`, `packages/shared` e documentação central. Nesta Etapa 0, manter apenas diretórios-raiz vazios para não fingir módulos ainda inexistentes.

## Status

Aceito na GATE-000.

## Contexto e alternativas

Repos separados isolariam toolchains, mas dificultariam mudança atômica de protocolo, fixtures e revisão numa equipe pequena. Um único aplicativo misturaria fronteiras de confiança. Monorepo com módulos claros permite coordenação sem exigir microserviços.

## Trade-offs e consequências

- Mudanças de contrato, servidor e agente podem ser revisadas juntas.
- CI deve detectar áreas afetadas; ferramentas JS não devem governar projetos .NET.
- `packages/shared` aceitará apenas utilidades realmente transversais; vira risco de acoplamento se usado como gaveta.
- `packages/contracts` conterá schemas neutros, exemplos e compatibilidade; clientes gerados ficam próximos dos consumidores.
- Módulos lógicos do servidor permanecem num deploy inicial.

## Risco de lock-in

Baixo. Evitar dependência de um orquestrador de monorepo até necessidade mensurável. Git é a unidade de versionamento inicial.

## Condições para revisar

Equipes independentes com cadências incompatíveis, requisitos de acesso distintos, crescimento que torne CI impraticável ou lifecycle de releases comprovadamente desacoplado.
