# Master Support

Master Support é a futura plataforma inteligente de helpdesk e administração tecnológica da Master Health. Seu princípio central é conduzir diagnósticos verificáveis, não apenas executar comandos.

## Estado atual

O repositório contém a **FOUNDATION-003**: contratos JSON Schema, Control Plane TypeScript, Agent C#, Support Session temporária e a primeira solicitação operacional estritamente somente leitura. Ela prova o caminho real Server → Agent → Evidence → Observation; não constitui um produto operacional.

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
- [Baseline de desenvolvimento](docs/architecture/DEVELOPMENT-BASELINE-v0.1.md)
- [Spike de transporte](docs/spikes/SPIKE-001-realtime-transport.md)
- [Spike de PowerShell](docs/spikes/SPIKE-002-powershell-hosting.md)

## O que existe

- `apps/server`: Fastify com health/version, adapter WebSocket experimental, stores de Session/Observation em memória e endpoints `/dev` sanitizados somente em loopback.
- `apps/agent`: console application temporário com modo explícito `connect-dev`, registry local fechado e o handler nativo `system.runtime.summary@1.0` R0/ReadOnly/non-admin.
- `packages/contracts`: JSON Schema 2020-12 para Hello, envelope, capability descriptor e erro.
- fixtures e testes TypeScript, .NET e round-trip cross-language por arquivos temporários.
- CI mínimo e `scripts/verify.ps1`.

Não existem comando remoto, Job, PowerShell/shell no Agent, autenticação de produção, autorização, persistência, banco, Web UI, IA ou privilégio administrativo. O resume token é exclusivamente dev-only e não representa identidade confiável. O WebSocket continua Trial e o validador JSON Schema C# continua limitado ao subconjunto da ADR-007.

## Requisitos de desenvolvimento

- Windows x64;
- Node.js 24 LTS e npm 11;
- .NET SDK 10 LTS;
- PowerShell 5.1 ou superior para o script local;
- Git.

Instale dependências declaradas com `npm ci` e `dotnet restore apps/agent/test/MasterSupport.Agent.Tests.csproj`. Nenhuma ferramenta precisa ser instalada globalmente pelo projeto.

## Verificar

```powershell
.\scripts\verify.ps1
```

O script restaura dependências, compila, executa testes .NET/TypeScript, valida o round-trip e roda `git diff --check`.

## Executar os skeletons

Servidor:

```powershell
npm ci
npm run build
npm run start --workspace @master-support/server
```

Por padrão escuta somente em `127.0.0.1:3000`. Para desenvolvimento, `MASTER_SUPPORT_HOST` e `MASTER_SUPPORT_PORT` podem alterar o bind.

Agent:

```powershell
dotnet run --project apps/agent/src/MasterSupport.Agent.csproj
```

O Agent apenas apresenta seu estado local e encerra; não conecta nem executa comandos.

Sessão local de desenvolvimento, com o Server já iniciado:

```powershell
dotnet run --project apps/agent/src/MasterSupport.Agent.csproj -- connect-dev
```

O Agent conecta explicitamente a `ws://127.0.0.1:3000/session`, anuncia `system.runtime.summary@1.0`, faz handshake/heartbeat e tenta `SessionClose` no Ctrl+C. Não use esse canal fora de ambiente local: ele não possui autenticação de produção.

Com uma Session ativa, o único disparo operacional permitido é:

```powershell
$sessionId = '<session-id exibido pelo Agent>'
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/dev/sessions/$sessionId/observations" -ContentType 'application/json' -Body '{"capabilityId":"system.runtime.summary"}'
```

`GET /dev/sessions/:sessionId/observations` apresenta lifecycle, Observation e metadados de Evidence, mas nunca seu payload RAW. Timeout padrão é 5 segundos e o payload operacional é limitado a 16 KiB, sem streaming. Revogar uma Session fecha proativamente sua conexão ativa.

## Regra de evolução

Cada etapa deve ter escopo explícito, rastreabilidade entre requisitos, ADRs e implementação, verificação proporcional ao risco e relatório de encerramento. A próxima etapa recomendada é `FOUNDATION-004 — Observation Hardening & Reconciliation`: endurecer cancelamento/reconciliação, quotas e testes de transporte da observação sem criar ação mutável, Job completo ou Preflight. Ela não faz parte desta entrega.
