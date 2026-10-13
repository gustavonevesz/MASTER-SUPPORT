# Master Support

## Asset Registry confirmado por humano (FOUNDATION-008)

`ObservedEndpoint` continua sendo apenas uma observação por Support Session. Um `Asset` `WindowsEndpoint` só nasce, ou recebe novo vínculo, depois de `HumanReview` explícito pelo ator honesto `local_operator`. Hostname, OS, RAM, storage, arquitetura, runtime, IP, MAC, fingerprint e similaridade nunca fazem correlação automática. `AssetEndpointLink` mantém um único vínculo ativo por endpoint e preserva correções como revogação + novo vínculo auditado.

Com PostgreSQL migrado e `MASTER_SUPPORT_DATABASE_URL` definido, use `npm run asset:review`. A CLI local lista endpoints não revisados e um resumo minimizado do último Preflight, permite criar Asset ou selecionar um existente e exige `YES` antes da transação final. `ExternalInventoryId` é opcional e único sem distinguir maiúsculas; Asset aposentado permanece consultável e rejeita novos vínculos. Essa identidade operacional não amplia autoridade da Session nem torna Evidence confiável ou `AI-SAFE`.

## Preflight Windows read-only (FOUNDATION-007)

Uma Support Session autenticada e ativa pode executar um Preflight composto, sequencial e exclusivamente R0 com cinco capabilities: `system.runtime.summary@1.0`, `windows.os.summary@1.0`, `windows.memory.summary@1.0`, `windows.storage.summary@1.0` e `windows.execution-context.summary@1.0`. Os handlers C# usam APIs .NET e a chamada Win32 específica `GlobalMemoryStatusEx`; não usam shell, PowerShell, WMI, CIM, Registry ou processo externo.

O Server persiste `PreflightRun`, referências de `PreflightSnapshot` e um `ObservedEndpoint` restrito à Session. `ObservedMachineName` é um identificador interno mutável, não prova identidade, não correlaciona Sessions e nunca cria um Asset. Evidence RAW permanece efêmera; Observations persistidas passam por allowlist determinística. O trigger `/dev` só é habilitado explicitamente em modo seguro para testes locais e exige uma Session autenticada existente.

## Bootstrap seguro (FOUNDATION-006)

O modo operacional é explícito (`MASTER_SUPPORT_MODE=secure`) e exige PostgreSQL migrado, certificado/chave externos, HTTPS e WSS. Crie um convite local com `npm run support:invite`; o código é mostrado uma vez. No Agent, execute `dotnet run --project apps/agent/src/MasterSupport.Agent.csproj -- connect https://servidor:porta/` e informe o código no prompt sem eco. O convite autentica autorização temporária, não identidade de Asset.

Defaults: convite 10 minutos, ConnectionTicket 60 segundos, ResumeTicket 5 minutos e lease 15 segundos. Tickets são opacos, single-use, vinculados e apenas hashes vivem em memória; restart invalida autoridade de Session/tickets, mas convite ativo não usado permanece até expirar. Revogue convite com `npm run support:revoke-invite -- <id>`. `development` precisa ser escolhido explicitamente, aceita somente loopback e nunca faz fallback a partir do modo seguro.

O harness de TLS gera CA/chaves efêmeras fora do Git. `MASTER_SUPPORT_TEST_CA_CERT_PATH` é exclusivamente uma raiz explícita de teste e preserva validação de hostname, validade e cadeia. Produção usa o trust store do sistema. O catálogo contém somente as cinco capabilities R0 do Preflight; não existe shell, PowerShell ou execução arbitrária.

Master Support é a futura plataforma inteligente de helpdesk e administração tecnológica da Master Health. Seu princípio central é conduzir diagnósticos verificáveis, não apenas executar comandos.

## Estado atual

O repositório contém a **FOUNDATION-008**: contratos JSON Schema, Control Plane TypeScript, Agent C#, Support Session autenticada, Preflight Windows read-only e Asset Registry confirmado por humano, duráveis em PostgreSQL. Requests e revisões são gravadas transacionalmente; restart preserva o histórico sem restaurar autoridade nem reexecutar requests. Ainda não constitui um produto operacional.

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

- `apps/server`: Fastify com health/version, adapter WebSocket experimental, autoridade viva em memória e histórico mínimo de ServerInstance/Session/Observation/Audit em PostgreSQL, com métricas e endpoints `/dev` sanitizados somente em loopback.
- `apps/agent`: console application temporário com registry limitado, cancelamento e cinco handlers nativos R0/ReadOnly/non-admin para runtime e Preflight Windows.
- `packages/contracts`: JSON Schema 2020-12 para Hello, envelope, capability descriptor e erro.
- fixtures e testes TypeScript, .NET e round-trip cross-language por arquivos temporários.
- CI mínimo e `scripts/verify.ps1`.

Não existem comando remoto, Job, PowerShell/shell no Agent, autenticação de produção, autorização de produção, Web UI, IA ou privilégio administrativo. O resume token é exclusivamente dev-only, não é persistido e não representa identidade confiável. O WebSocket continua Trial e o validador JSON Schema C# continua limitado ao subconjunto da ADR-007.

## Requisitos de desenvolvimento

- Windows x64;
- Node.js 24 LTS e npm 11;
- .NET SDK 10 LTS;
- PowerShell 5.1 ou superior para o script local;
- PostgreSQL 17, com databases isoladas de desenvolvimento e teste;
- Git.

Instale dependências declaradas com `npm ci` e `dotnet restore apps/agent/test/MasterSupport.Agent.Tests.csproj`. Nenhuma ferramenta precisa ser instalada globalmente pelo projeto.

## Verificar

```powershell
.\scripts\verify.ps1
```

Copie apenas localmente os valores fictícios de `.env.example` para sua configuração e defina `MASTER_SUPPORT_DATABASE_URL` e `MASTER_SUPPORT_TEST_DATABASE_URL`. O database de teste deve se chamar exatamente `master_support_test` e estar em PostgreSQL local; a proteção recusa outros alvos. Aplique migrations explicitamente com `npm run db:migrate`. O script restaura dependências, valida o banco de teste, aplica migrations, compila, executa testes .NET/TypeScript/PostgreSQL, valida o round-trip e roda `git diff --check`.

## Executar os skeletons

Servidor:

```powershell
npm ci
npm run db:migrate
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

Com uma Session local de desenvolvimento ativa, uma Observation individual de runtime pode ser disparada por:

```powershell
$sessionId = '<session-id exibido pelo Agent>'
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/dev/sessions/$sessionId/observations" -ContentType 'application/json' -Body '{"capabilityId":"system.runtime.summary"}'
```

O `POST` retorna `202` com a request criada; consulte `GET /dev/sessions/:sessionId/observations` para acompanhar `created`, `accepted`, `executing`, `completed`, `failed`, `timed_out`, `cancelled` ou `abandoned`. `GET /dev/history/sessions/:id` e `GET /dev/history/observations/:id` consultam histórico sanitizado no PostgreSQL. A consulta apresenta Observation minimizada e metadados de Evidence, mas nunca seu payload RAW. Timeout padrão é 5 segundos, cada request possui deadline e o payload operacional é limitado a 16 KiB, sem streaming.

Cancelamento explícito usa `POST /dev/sessions/:sessionId/observations/:requestId/cancel`. `GET /dev/metrics` e `GET /dev/audit` expõem somente métricas e eventos sanitizados. Por padrão há no máximo 2 Observations ativas por Session e Agent, 1 por capability e 5 disparos por Session/capability a cada 10 segundos. Revogar, fechar ou expirar a Session cancela sua autoridade; disconnect cancela o trabalho local, marca requests aceitas/em execução como `abandoned` com outcome desconhecido e resume nunca as reenvia. Se PostgreSQL estiver indisponível, o Server falha no startup e uma nova Observation falha antes do dispatch.

## Regra de evolução

Cada etapa deve ter escopo explícito, rastreabilidade entre requisitos, ADRs e implementação, verificação proporcional ao risco e relatório de encerramento. A FOUNDATION-008 conclui a fase Foundation. CORE-001 permanece apenas recomendado no roadmap e exige novo gate; não foi iniciado.
