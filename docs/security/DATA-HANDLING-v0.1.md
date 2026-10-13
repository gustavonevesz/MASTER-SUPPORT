# Tratamento de dados v0.1

## Operator Console

O Browser recebe apenas DTOs de leitura com identidade de Asset, metadados de endpoint/session, resumo de Preflight e eventos humanos de timeline. `factsByCapability` é reprojetado por allowlist própria da console; campos desconhecidos são descartados mesmo quando presentes numa Observation minimizada. Evidence RAW, payload interno, SupportInvitation, hashes, ConnectionTicket e ResumeTicket nunca são serializados. A SPA não usa `localStorage` ou `sessionStorage`, não envia dados a IA e não promove nenhum valor a `AI-SAFE`.

## Asset Registry

`AssetId`, `ExternalInventoryId`, `DisplayName`, `ObservedMachineName` e decisões de `HumanReview` são `INTERNAL`. A lista de revisão usa somente metadados do endpoint e fatos já minimizados do último Preflight; não copia Evidence RAW. Assets, links e AuditEvents não possuem campos para payload, segredo, ticket, username, SID ou e-mail. Nenhum desses dados vira automaticamente `AI-SAFE`, e confirmação do Asset não muda a classificação ou provenance das Observations.

## Classificação do Preflight

OS/build/arquiteturas, uptime, capacidade de RAM e capacidade de storage são dados operacionais `MINIMIZED`. `ObservedMachineName`, raiz do volume, `isElevated`, modo e nível de privilégio são `INTERNAL`. Nenhum campo é automaticamente `AI-SAFE`. Evidence chega como RAW efêmera; uma allowlist estrutural valida coerência e produz a Observation persistida. Username, SID, domínio, rede, serial, processos, nomes de arquivos, credenciais e tickets são excluídos.

## Credenciais de bootstrap

InvitationSecret, ConnectionTicket e ResumeTicket são `SECRET`. Não entram em argumentos, URLs, logs, AuditEvent, métricas, Observation, Evidence ou fixtures. O banco recebe somente SHA-256 com separação de domínio do segredo aleatório do convite; tickets guardam somente hash em memória. A chave TLS é externa, nunca logada nem versionada. InvitationId, timestamps, issuer transitório, estado e vínculos são metadados operacionais; acesso continua restrito.

Status: baseline arquitetural aceita na GATE-000; classificação organizacional e política LGPD definitivas permanecem abertas.

## Princípio

Dados coletados de um endpoint são potencialmente sensíveis e não confiáveis. `stdout` e `stderr` não são automaticamente seguros para armazenamento permanente, auditoria, suporte externo ou contexto de IA. Coletar, transportar, persistir e revelar são decisões distintas, cada uma sujeita a minimização e autorização.

## Classes de processamento

- **RAW DATA:** conteúdo original, possivelmente contendo segredo, dado pessoal ou informação interna. Acesso estrito, retenção mínima e nenhum envio direto a LLM.
- **REDACTED DATA:** dado transformado por regras declaradas para remover/mascarar categorias sensíveis. Deve registrar que houve transformação e não pressupõe segurança para IA.
- **AI-SAFE DATA:** subconjunto minimizado e aprovado para o caso de uso de IA, após classificação/redaction e controles de acesso. É contextual e revogável; não significa público ou livre de risco.

O sistema deverá possuir uma fronteira de classificação/redaction antes de logs permanentes ou contexto de IA quando aplicável. A implementação e eficácia dessa camada serão tratadas em etapa posterior.

## Categorias iniciais

| Categoria | Tratamento arquitetural inicial |
|---|---|
| Senhas, chaves, tokens, cookies e credenciais | segredo; não persistir em texto, não registrar e nunca enviar ao LLM; entrada futura por mecanismo dedicado |
| Resume token dev-only | segredo efêmero em memória; transmitir somente no canal de desenvolvimento, nunca logar, persistir ou exibir em `/dev/sessions` |
| stdout/stderr | RAW por padrão; limitar tamanho, acesso e retenção; classificar/redigir antes de persistência prolongada ou IA |
| Logs de aplicação/agente | metadados mínimos; proibir segredo; payload sensível separado; redaction não deve apagar rastreabilidade da transformação |
| Windows Event Log | potencialmente contém usuário, caminho, hostname, conteúdo de aplicação e tokens; coleta seletiva por finalidade e janela |
| Caminhos de arquivos | podem revelar nomes, clientes, usuários e estrutura interna; minimizar ou pseudonimizar quando o caminho integral não for necessário |
| Nomes de usuário | dado pessoal/identificador; controle de acesso, finalidade e mascaramento conforme uso |
| Endereços IP/MAC/hostnames | dados operacionais potencialmente identificáveis e internos; acesso e retenção proporcionais |
| Conteúdo e metadados de e-mail | altamente sensíveis; não coletar por padrão; conteúdo exige caso, autoridade e controles específicos |
| Dados pessoais | minimizar, registrar finalidade, restringir acesso e aplicar decisões organizacionais/LGPD futuras |
| Dados internos da Master Health | classificar conforme política corporativa ainda a definir; deny by default para exportação e IA |
| `system.runtime.summary` | Evidence `RAW` efêmera, máximo 16 KiB; PostgreSQL recebe só EvidenceMetadata e nove fatos allowlisted na Observation `MINIMIZED`; sem IA e sem RAW em logs/consulta |
| Resultado tardio | descartar o payload/Evidence RAW; persistir no máximo AuditEvent com IDs, tipo, instante, tamanho e motivo sanitizados |
| Métricas e AuditEvents da Observation | somente contagens, estado, IDs técnicos, capability, duração, tamanho e motivo; AuditEvent durável nunca contém payload, hostname, usuário, token ou Evidence RAW |

## Regras iniciais

1. Telemetria, auditoria e evidência possuem finalidades diferentes; copiar payload integral entre elas é proibido por padrão.
2. Redaction ocorre o mais cedo possível, preservando RAW somente quando necessário e autorizado.
3. Resultado redigido deve indicar categorias removidas, regra/versão aplicada e vínculo controlado ao original quando este existir.
4. Falha ou incerteza na classificação bloqueia envio a IA; não deve resultar em liberação automática.
5. Limites de tamanho, tempo de retenção, criptografia, acesso e descarte serão definidos por categoria.
6. Conteúdo do endpoint é dado não confiável também contra prompt injection; AI-SAFE exige sanitização semântica além de mascaramento de segredos.
7. AuditEvent deve preferir metadados e referências; append-only não justifica registrar segredo.
8. Logs de Observation usam somente `sessionId`, `requestId`, capability, estado, duração, IDs e `payloadSize`; o conteúdo RAW permanece separado.
9. Reconciliation valida metadados antes de qualquer armazenamento do payload; resultado tardio ou rejeitado não cria Evidence.
10. Limites são aplicados antes de armazenamento e logging. Payload excessivo é rejeitado, nunca truncado e apresentado como completo.
11. `MINIMIZED` descreve redução determinística para persistência; não equivale a `REDACTED` nem `AI-SAFE` e não autoriza envio futuro a LLM.
12. Connection strings e credenciais PostgreSQL são configuração externa secreta: não entram em repositório, logs ou AuditEvents.
13. Nenhum purge automático existe nesta etapa. Retenção, expurgo, arquivamento, backup e residência dependem de política organizacional explícita.

## Decisões organizacionais pendentes

Permanecem abertas: controlador/operador e bases legais aplicáveis; taxonomia corporativa; prazos de retenção; residência; perfis de acesso; fluxo de titular/incidente; quais provedores/modelos de IA são permitidos; critérios de anonimização/pseudonimização; e exceções para investigação. Este documento não substitui avaliação jurídica ou política interna da Master Health.
