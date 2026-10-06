# Master Support

Master Support é a futura plataforma inteligente de helpdesk e administração tecnológica da Master Health. Seu princípio central é conduzir diagnósticos verificáveis, não apenas executar comandos.

## Estado atual

O repositório contém a **FOUNDATION-004**: contratos JSON Schema, Control Plane TypeScript, Agent C#, Support Session temporária e uma solicitação operacional estritamente somente leitura com cancelamento, reconciliação, limites e telemetria sanitizada. Ela endurece o caminho Server → Agent → Evidence → Observation; não constitui um produto operacional.

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
- [Spike de proxy WebSocket](docs/spikes/SPIKE-003-local-websocket-proxy.md)

## O que existe

- `apps/server`: Fastify com health/version, adapter WebSocket experimental, reconciliação e stores de Session/Observation/Audit em memória, métricas e endpoints `/dev` sanitizados somente em loopback.
- `apps/agent`: console application temporário com modo explícito `connect-dev`, registry limitado de operações ativas, cancelamento e o único handler nativo `system.runtime.summary@1.0` R0/ReadOnly/non-admin.
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

O `POST` retorna `202` com a request criada; consulte `GET /dev/sessions/:sessionId/observations` para acompanhar `created`, `accepted`, `executing`, `completed`, `failed`, `timed_out`, `cancelled` ou `abandoned`. A consulta apresenta Observation e metadados de Evidence, mas nunca seu payload RAW. Timeout padrão é 5 segundos, cada request possui deadline e o payload operacional é limitado a 16 KiB, sem streaming.

Cancelamento explícito usa `POST /dev/sessions/:sessionId/observations/:requestId/cancel`. `GET /dev/metrics` e `GET /dev/audit` expõem somente métricas e eventos sanitizados em memória. Por padrão há no máximo 2 Observations ativas por Session e Agent, 1 por capability e 5 disparos por Session/capability a cada 10 segundos. Revogar, fechar ou expirar a Session cancela sua autoridade; disconnect cancela o trabalho local, marca requests aceitas/em execução como `abandoned` com outcome desconhecido e resume nunca as reenvia.

## Regra de evolução

Cada etapa deve ter escopo explícito, rastreabilidade entre requisitos, ADRs e implementação, verificação proporcional ao risco e relatório de encerramento. A próxima etapa recomendada é `FOUNDATION-005 — Durable Observation State & Restart Reconciliation`: persistir somente o estado e a auditoria necessários, recuperar requests sem reexecução automática e provar restart transacional antes de ampliar capabilities. Ela não faz parte desta entrega.
