# SPEC-001 — Fundação e visão do Master Support

FOUNDATION-006 acrescenta trust bootstrap operacional sem criar identidade permanente de Asset: TLS validado, SupportInvitation de uso único, ConnectionTicket/ResumeTicket opacos e rotativos, revogação, TTL e rejeição de replay. O histórico PostgreSQL não restaura autoridade após restart. `system.runtime.summary@1.0` permanece a única capability.

- Status: Baseline aceita na GATE-000
- Versão: 0.1
- Escopo desta versão: arquitetura e requisitos; sem implementação funcional

## 1. Propósito e limites

Master Support será um especialista operacional para diagnóstico e suporte tecnológico da Master Health. O primeiro recorte é Windows Endpoint, operado por sessões temporárias iniciadas por técnico. Esta especificação normaliza a visão do produto e cria rastreabilidade para decisões futuras.

Fora desta etapa: IA/ML, agente executável, serviço Windows, terminal remoto, transporte Cloudflare, autenticação completa, persistência física, SSH/SNMP, controle visual e demais classes de ativo.

## 2. Atores

- **Técnico:** abre atendimento, observa evidências, propõe/autoriza ações conforme política e encerra a sessão.
- **Endpoint/Agent:** representa o endpoint e executa capacidades autorizadas em ambiente local.
- **Control Plane:** coordena sessões, jobs, política, estado e auditoria.
- **Support Brain futuro:** auxilia interpretação e planejamento, sem autoridade implícita para executar.
- **Revisor/auditor:** reconstrói quem fez o quê, por quê e com qual resultado.

## 3. Requisitos funcionais

| ID | Requisito | Prioridade inicial | Evidência futura |
|---|---|---:|---|
| FR-001 | Criar uma Support Session temporária, identificável e encerrável. | Must | teste de ciclo da sessão |
| FR-002 | Registrar o Windows Endpoint e associá-lo à sessão. | Must | endpoint visível e correlacionado |
| FR-003 | Executar Preflight apropriado, somente leitura, antes de intervenção. | Must | observações/evidências registradas |
| FR-004 | Coletar inventário e estado ao vivo como conceitos distintos. | Must | payloads e timestamps separados |
| FR-005 | Criar e despachar Jobs tipados para um agente conectado. | Must | contrato e transições de estado |
| FR-006 | Preferir Capabilities estruturadas, versionadas e validáveis. | Must | catálogo/handler correspondente |
| FR-007 | Capturar início/fim, saída, erro, exit code, timeout, cancelamento e metadados da execução. | Must | CommandExecution estruturado |
| FR-008 | Registrar estado/evidência antes e depois de intervenção relevante. | Must | pares de evidência correlacionados |
| FR-009 | Verificar o efeito real esperado, separadamente do sucesso técnico do comando. | Must | Verification explícita |
| FR-010 | Manter timeline/auditoria imutável das decisões, aprovações, ações e resultados. | Must | AuditEvents ordenados |
| FR-011 | Encerrar a sessão e invalidar seu acesso/canal. | Must | credenciais/canal inutilizáveis |
| FR-012 | Representar Asset, inclusive tipo inicialmente desconhecido. | Should | Asset com classificação evolutiva |
| FR-013 | Registrar incidentes com sintomas, contexto, evidências, hipóteses, ações, efeitos colaterais, resolução e confiança. | Should | Incident estruturado |
| FR-014 | Suportar Approval vinculada à ação, ao risco, ao escopo, ao aprovador e ao prazo. | Must | autorização verificável |
| FR-015 | Oferecer no futuro terminal assistido controlado como exceção auditada, nunca execução livre silenciosa. | Later | ADR e controles implementados |
| FR-016 | Exibir painel do ativo, atendimento, execuções, informação operacional explicável e histórico. | Should | UI da fatia vertical |

## 4. Requisitos não funcionais

| ID | Requisito |
|---|---|
| NFR-001 | Arquitetura modular, testável, observável e evolutiva, adequada a equipe pequena. |
| NFR-002 | Contratos devem ser independentes de linguagem e transporte, versionados e compatíveis de forma explícita. |
| NFR-003 | Jobs devem possuir timeout, cancelamento, limites de recursos e semântica explícita de retry/idempotência. |
| NFR-004 | Toda correlação distribuída deve usar identificadores estáveis e timestamps UTC. |
| NFR-005 | Falhas devem preservar evidência e permitir adaptação do plano; não podem ser reduzidas a sucesso/falha binários. |
| NFR-006 | O agente deve iniciar conexão de saída e operar com privilégio mínimo. |
| NFR-007 | O sistema deve tolerar evolução de agentes e contratos sem upgrade simultâneo obrigatório, dentro de janela definida. |
| NFR-008 | O núcleo inicial deve ser um monólito modular implantável, evitando microserviços prematuros. |
| NFR-009 | Dados operacionais devem ter retenção, minimização e classificação definidas antes de produção. |
| NFR-010 | Observabilidade deve separar telemetria operacional de auditoria de segurança. |

## 5. Requisitos de segurança

| ID | Requisito |
|---|---|
| SEC-001 | Deny by default e least privilege em toda capacidade. |
| SEC-002 | Autenticar técnico, servidor, agente, sessão e mensagens relevantes. |
| SEC-003 | Autorizar ação por política, contexto, risco e aprovação; possuir capacidade não concede autoridade. |
| SEC-004 | Impedir replay com validade, nonce/identificador, estado e proteção criptográfica do canal. |
| SEC-005 | Validar payloads por esquema e limites; nunca interpolar entrada não confiável em comandos. |
| SEC-006 | Proibir segredos em prompts, stdout persistido e logs; redigir dados sensíveis antes de persistir/usar IA. |
| SEC-007 | Produzir trilha de auditoria resistente a adulteração e correlacionada ponta a ponta. |
| SEC-008 | Exigir aprovação explícita e recuperação planejada para ações destrutivas/críticas. |
| SEC-009 | Revogar credenciais e acesso ao encerrar/expirar uma Support Session. |
| SEC-010 | Verificar integridade, procedência e versão do agente e, futuramente, assinatura de artefatos. |
| SEC-011 | Conter agente comprometido, limitando escopo, duração, rede e capacidades. |
| SEC-012 | Tratar conteúdo de endpoint e saída de ferramentas como não confiável diante de LLM/prompt injection. |

## 6. Regras de domínio invariantes

- BR-001: execução bem-sucedida não implica resolução.
- BR-002: toda Action gera resultado e Evidence; intervenção relevante requer Verification.
- BR-003: Observation é fato registrado; Hypothesis é interpretação testável.
- BR-004: falha atualiza estado/plano e permanece na timeline.
- BR-005: informação de Asset declara procedência e nível `Discovered`, `Inferred` ou `Confirmed`.
- BR-006: Approval é específica e expira; não é autorização geral.
- BR-007: modelos de IA podem propor, nunca ampliar autoridade.
- BR-008: mudança aprendida de comportamento exige avaliação e promoção explícita; shadow mode é o caminho preferencial.

## 7. Modelo conceitual de risco (não definitivo)

R0 leitura/diagnóstico; R1 mudança pequena e reversível; R2 alteração administrativa relevante; R3 impacto operacional significativo e aprovação explícita; R4 destrutiva/crítica, com contexto, confirmação forte e recuperação quando possível. A calibração e matriz exata permanecem abertas.

## 8. Critérios da primeira fatia vertical futura

Uma demonstração válida deverá provar FR-001 a FR-011 em um fluxo Windows temporário, com um Preflight somente leitura e um Job seguro, sem IA autônoma. Ela deve mostrar inventário, resultado estruturado, timeline e revogação após encerramento.

## 9. Rastreabilidade

| Tema | Requisitos | Decisão/documento |
|---|---|---|
| Linguagens/runtimes | NFR-001, NFR-002, NFR-006 | ADR-001 |
| Repositório | NFR-001, NFR-008 | ADR-002 |
| Sessão temporária | FR-001–FR-004, FR-011, SEC-002, SEC-009 | ADR-003 |
| Execução | FR-005–FR-009, FR-014–FR-015, SEC-003–SEC-008 | ADR-004 |
| Transporte | NFR-002, NFR-006, SEC-002, SEC-004 | ADR-005 |
| Dados | FR-010, FR-012–FR-013, NFR-009–NFR-010, SEC-006–SEC-007 | ADR-006 e DATA-HANDLING-v0.1 |
| Interface operacional | FR-016 | Arquitetura conceitual; detalhamento futuro de UI |

## 10. Aceite da Etapa 0

Etapa aceita quando os documentos listados no README estiverem revisáveis, decisões tiverem status explícito, dúvidas não resolvidas estiverem registradas e nenhum produto funcional tiver sido antecipado.
