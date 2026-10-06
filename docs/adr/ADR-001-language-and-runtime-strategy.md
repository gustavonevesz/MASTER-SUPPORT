# ADR-001 — Estratégia de linguagens e runtimes

## Decisão recomendada

**TypeScript/Node.js para Control Plane e Web; C#/.NET LTS para Windows Execution Runtime; Python adiado até existir caso concreto de ML/análise.** Compartilhar contratos por especificações neutras e testes, não por biblioteca de domínio comum.

## Status

Aceito na GATE-000.

## Contexto

O Control Plane precisa iterar rapidamente em API, realtime, integrações e UI, mantendo tipagem e operação simples para equipe pequena. O Runtime exige integração profunda e estável com Windows, PowerShell, Services, Event Log, Registry, CIM/WMI e PnP, além de distribuição self-contained.

## Alternativas analisadas

### Control Plane

| Opção | Forças | Limitações |
|---|---|---|
| TypeScript/Node | tipagem ponta a ponta na Web, ecossistema de API/realtime/LLM, produtividade, testes e observabilidade maduros | CPU-bound requer worker/outro runtime; disciplina necessária para runtime validation e domínio |
| C#/.NET | excelente desempenho/tipagem, observabilidade e possibilidade de stack única com agente | menor sinergia direta com frontend e ecossistema web/LLM JS; não elimina contratos entre processos |
| Python | melhor ecossistema futuro de ML, FastAPI produtivo | tipagem/runtime menos rígidos para protocolo crítico; empacotamento/operação e compartilhamento com UI menos favoráveis |

### Windows Agent

| Opção | Avaliação |
|---|---|
| C#/.NET | melhor equilíbrio: APIs Windows e PowerShell SDK, Windows Service, async/telemetria/testes, self-contained/single-file; escolhido |
| Rust | segurança de memória e binário enxuto, mas FFI/Windows/PowerShell e velocidade de desenvolvimento elevam complexidade |
| Go | binário/distribuição simples e boa concorrência; integração Windows/PowerShell menos natural e tipagem de domínio mais limitada |
| Python | ótimo para protótipo/diagnóstico, fraco para distribuição, proteção de dependências e serviço privilegiado durável |
| TypeScript/Node | compartilharia linguagem, porém runtime/distribuição e APIs profundas do Windows são inferiores a .NET |

## Trade-offs

Duas linguagens aumentam toolchains e duplicam modelos, mas tornam explícita a fronteira de confiança e escolhem o runtime adequado para cada problema. Evitaremos duplicação semântica com JSON Schema/OpenAPI, fixtures canônicas e contract tests. C# também pode hospedar PowerShell via SDK quando isso for mais seguro que processo externo; a decisão por capability definirá a estratégia.

## Consequências

- Monorepo poliglota, CI e versionamento coordenados.
- Node não será usado para computação ML pesada; Python entra como componente isolado apenas com justificativa.
- Contratos externos exigem validação runtime em ambos os lados.
- .NET LTS e Node LTS serão fixados somente na próxima etapa.

## Risco de lock-in

Moderado no Runtime por APIs Windows, inerente ao alvo inicial; baixo/moderado em Node/.NET. Reduzido por contratos neutros, domínio sem dependência de Cloudflare e adapters. Não tentar abstrair o próprio Windows prematuramente.

## Condições para revisar

Equipe predominantemente .NET; exigência forte de stack única; métricas de escala/latência incompatíveis; restrição severa de footprint; SDK Windows crítico indisponível; ou surgimento de carga ML no caminho principal. Revisar com benchmark/protótipo, não preferência.
