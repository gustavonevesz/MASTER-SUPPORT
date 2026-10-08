# ADR-011 — Persistência durável do backbone de Observation

## Status

Aceito na FOUNDATION-005.

## Decisão

Usar o driver `pg` diretamente, migrations SQL versionadas e uma porta pequena de persistência para concretizar a ADR-006. PostgreSQL é o System of Record do histórico operacional mínimo; autoridade de Session, socket, lease e resume token continuam exclusivamente no runtime.

O operador aplica schema pelo comando explícito `db:migrate`. O processo valida a configuração, conecta, confirma que o schema está exatamente na versão suportada, cria uma nova `ServerInstance` e reconcilia registros da instância anterior antes de escutar. Banco indisponível, schema ausente ou versão incompatível fazem o Server falhar fechado.

## Consistência

Não existe transação distribuída entre PostgreSQL e WebSocket. A ordem é persistir a intenção antes do dispatch e, depois, persistir estado/resultados aceitos. `ObservationRequest + AuditEvent` inicial e `resultado + EvidenceMetadata + Observation + AuditEvent` final formam transações locais. Se a execução pode ter acontecido sem commit final, restart produz `abandoned` com `outcomeUnknown=true`; nunca presume “não executou” e nunca reexecuta automaticamente.

`SessionRecord` é histórico e não concede autoridade. Não contém resume token e nunca é carregada como `Session` viva. AuditEvents são append-only pelo comportamento da aplicação, não um ledger criptograficamente imutável.

## Dados e schema

Campos de identidade, lifecycle e correlação são colunas relacionais. JSONB é limitado a capabilities negociadas e aos fatos allowlisted da Observation minimizada de `system.runtime.summary`. Evidence RAW não é persistida; apenas seus metadados. `MINIMIZED` não equivale a `AI-SAFE`.

## Consequências

A solução mantém SQL e limites transacionais visíveis, reduz lock-in e evita uma camada ORM cerimonial. Em contrapartida, a equipe mantém migrations e mapeamentos explícitos. Migrations aplicadas são verificadas por checksum; mudança exige nova migration. Retenção, backup, credenciais de produção, acesso e proteção antitamper permanecem decisões futuras.
