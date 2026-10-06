# ADR-006 — Estratégia de armazenamento

## Decisão recomendada

Usar **PostgreSQL como banco primário transacional e system of record**. Modelar estado atual e histórico/auditoria como representações relacionadas, porém distintas. Não adotar vector DB ou graph DB agora; arquivos grandes/object storage e mecanismos analíticos entram somente com necessidade comprovada.

## Status

Aceito na GATE-000.

## Contexto e alternativas

Assets, Sessions, Jobs, Approvals e transições exigem consistência, consultas relacionais e auditoria. PostgreSQL oferece transações, constraints, JSONB para bordas evolutivas, índices e operação conhecida. Document DB facilitaria payload variável, mas enfraquece relações/invariantes; event sourcing integral traz reconstrução poderosa com custo excessivo; SQLite não atende naturalmente o Control Plane multiusuário futuro.

## Modelo lógico inicial

- Tabelas normalizadas para identidades e lifecycles centrais: assets, sessions, incidents, jobs, executions, approvals.
- Observations/Evidence com metadados estruturados e referência a payload; blobs grandes ficam fora do banco quando justificado.
- AuditEvent append-only conceitual, separado de logs técnicos e com integridade/retention.
- Estado atual como projeção/registro otimizado, sempre com `observed_at`, fonte e vínculo ao histórico.
- Timeline construída por eventos de domínio/auditoria correlacionados; não usar logs de texto como banco de fatos.

## Trade-offs e consequências

PostgreSQL concentra backup, segurança e operação no início, mas exige disciplina contra JSONB indiscriminado e tabela universal. Auditoria “append-only” no banco da aplicação é uma regra de escrita, não prova de inviolabilidade criptográfica. Controles de acesso, exportação/WORM, assinatura ou encadeamento criptográfico serão avaliados conforme risco.

Busca vetorial poderá usar extensão PostgreSQL antes de serviço separado, somente após corpus e caso de uso. Grafo pode ser derivado/consultado relacionalmente até métricas provarem necessidade.

## Risco de lock-in

Baixo/moderado: SQL padrão e migrations reduzem; JSONB/extensões específicas aumentam. Isolar persistência por repositórios/ports sem esconder capacidades úteis do PostgreSQL.

## Condições para revisar

Volume/latência medidos incompatíveis, exigência regulatória de ledger imutável, busca semântica validada, relações de grafo dominantes ou payloads binários tornando object storage obrigatório.
