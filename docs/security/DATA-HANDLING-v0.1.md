# Tratamento de dados v0.1

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
| `system.runtime.summary` | Evidence `RAW` mesmo contendo somente plataforma/runtime; store efêmero em memória, máximo 16 KiB, sem IA e sem payload em logs/consulta sanitizada |
| Resultado tardio | descartar o payload/Evidence RAW; manter no máximo IDs, tipo, instante, tamanho e motivo sanitizados em memória |
| Métricas e AuditEvents da Observation | somente contagens, estado, IDs técnicos, capability, duração, tamanho e motivo; nunca payload, hostname, usuário, token ou Evidence RAW |

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

## Decisões organizacionais pendentes

Permanecem abertas: controlador/operador e bases legais aplicáveis; taxonomia corporativa; prazos de retenção; residência; perfis de acesso; fluxo de titular/incidente; quais provedores/modelos de IA são permitidos; critérios de anonimização/pseudonimização; e exceções para investigação. Este documento não substitui avaliação jurídica ou política interna da Master Health.
