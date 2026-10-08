# Threat model v0.1

Status: baseline arquitetural; não é avaliação de produção.

## Método e escopo

Usamos **STRIDE** (Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, Elevation of Privilege) por fronteira de confiança, complementado por abuso operacional e supply chain. Escopo: navegador/técnico, Control Plane, storage, canal e Runtime Windows em Support Session. Probabilidade e impacto são qualitativos até existirem implantação e dados reais.

## Ativos e fronteiras de confiança

Ativos críticos: autoridade de execução, credenciais de sessão, identidades, approvals, artefatos do agente, evidências, auditoria, dados do endpoint e disponibilidade. Fronteiras: técnico↔UI, UI↔Control Plane, módulos↔storage, Control Plane↔AI futura, Internet/túnel↔agente e Runtime privilegiado↔Windows.

## Registro inicial de ameaças

| ID | Cenário / STRIDE | Impacto | Controles arquiteturais iniciais |
|---|---|---|---|
| T-001 | Agente comprometido falsifica evidência ou pivota lateralmente (S/T/E) | alto | identidade por instalação/sessão, escopo curto, egress limitado, servidor não confiar em alegação isolada, detecção/revogação |
| T-002 | Servidor comprometido envia ações abusivas (T/E) | crítico | defesa local no Runtime, allowlist de capabilities, limites rígidos, approvals verificáveis, blast radius e rotação |
| T-003 | Conta/dispositivo do técnico comprometido aprova ação (S/E/R) | crítico | MFA forte futuro, RBAC/ABAC, step-up para alto risco, aprovação específica, registro e alertas |
| T-004 | Comando/payload malicioso ou command injection (T/E) | crítico | schemas estritos, argumentos tipados, APIs nativas, sem concatenação/interpolação, allowlist, sandbox/limites quando viável |
| T-005 | LLM propõe comando perigoso/alucinado (T/E) | crítico | proposta não é autorização, policy determinística, humano conforme risco, verificação e AI fora do executor |
| T-006 | Prompt injection em logs, nomes ou páginas do endpoint (T/I/E) | alto | tratar conteúdo como dados não confiáveis, delimitação, redução de ferramentas, redaction e decisões fora do LLM |
| T-007 | Segredo exposto em prompt/log/stdout (I) | alto | coleta mínima, secret broker futuro, filtros antes de persistir/IA, classificação e acesso restrito |
| T-008 | Replay de job/approval/mensagem (S/T) | alto | ID único, nonce, expiração, contador/estado, assinatura/MAC do envelope, idempotency key |
| T-009 | Impersonação de endpoint (S) | alto | bootstrap limitado, credencial curta, vínculo sessão-endpoint, autenticação mútua apropriada e rotação |
| T-010 | MITM/altere canal (S/T/I) | crítico | TLS validado, autenticação de mensagem/peer, proteção contra downgrade, pinning avaliado com estratégia de rotação |
| T-011 | Escalada de privilégio pelo Runtime (E) | crítico | serviço/processo com mínimo privilégio, separação de broker privilegiado futura, capability declara privilégio e política local |
| T-012 | Execução arbitrária via terminal assistido (E) | crítico | desabilitado inicialmente; modo explícito, aprovação, sessão reforçada, input/output auditado e limites |
| T-013 | Exfiltração por output, upload ou rede (I) | crítico | limite/tipo/tamanho, destinations allowlist, DLP/redaction, autorização específica e monitoração |
| T-014 | Auditoria contém dados sensíveis ou é adulterada (I/T/R) | alto | separar payload de metadado, append-only, integridade, acesso/retention, redaction com indicação |
| T-015 | Supply chain/artefato adulterado (T/E) | crítico | lockfiles/SBOM/scan futuro, origem verificável, builds reproduzíveis quando viável, assinatura e rollback |
| T-016 | Agente antigo explora incompatibilidade/vulnerabilidade (T/E/D) | alto | handshake de versão/capabilities, versão mínima revogável, janela de suporte e atualização assinada futura |
| T-017 | Conexão abandonada/sessão esquecida mantém acesso (S/E) | crítico | TTL, heartbeat/lease, expiração server e agent-side, encerramento idempotente, painel/alerta de sessões órfãs |
| T-018 | Ação destrutiva no alvo errado (T/E) | crítico | confirmação forte do alvo/efeito, risk R4, approval específica, dry-run/backup/rollback quando possível |
| T-019 | Movimento lateral usando endpoint (E) | crítico | proibir credenciais reutilizáveis, segmentar, limitar destinos, sem listener público, escopo de sessão |
| T-020 | Flood/jobs/saídas esgotam recursos (D) | alto | quotas, backpressure, concorrência/tamanho/tempo limitados, circuit breaker e cancelamento |
| T-021 | Endpoint WebSocket dev-only exposto fora de loopback permite sessões não autenticadas (S/E) | crítico | loopback por padrão, override explícito com alerta, sem `/dev/sessions` fora de loopback; proibir uso produtivo |
| T-022 | Resume token dev-only capturado retoma autoridade ainda válida (S) | alto | 256 bits aleatórios, memória apenas, comparação constante, vínculo a Session+AgentInstance, TTL e nunca logar |
| T-023 | IDs duplicados ou cache sem limite causam replay/DoS (T/D) | alto | deduplicação por sessão com capacidade limitada; sem promessa exactly-once |
| T-024 | Servidor comprometido solicita capability read-only abusivamente (T/D) | alto | catálogo negociado, registry local R0/ReadOnly, timeout/tamanho, Session ativa, quotas por Session/Agent/capability e rate limit |
| T-025 | Registry/handler local adulterado falsifica descriptor ou amplia efeito (T/E) | crítico | mapeamento explícito sem reflection/string executável, testes de descriptor, integridade/assinatura do Agent futura |
| T-026 | Evidence maliciosa explora consumidor ou vira instrução (T/I) | alto | schema estrito, tratar payload como RAW não confiável, sem IA e sem interpolação em executor |
| T-027 | Resultado excessivo ou repetição de request esgota recursos (D) | alto | limite próprio de 16 KiB, timeout de 5 s, cache de requestId limitado e sem streaming; quotas futuras |
| T-028 | Spoofing de capability/versão contorna negociação (S/T) | alto | interseção exata ID+versão no handshake e validação local da registry antes do handler |
| T-029 | Replay do mesmo `requestId` executa handler novamente (T/D) | médio | resultado/falha final em cache limitado; duplicata concluída não reexecuta e duplicata em curso falha deterministicamente |
| T-030 | Evidence RAW vaza por log ou endpoint de desenvolvimento (I) | alto | logging por metadados, consulta omite payload, teste com marcador RAW e endpoints somente loopback |
| T-031 | Resultado tardio/replay tenta reabrir terminal ou anexar Evidence após revogação (T/R) | alto | reconciliation antes de aceite, terminais imutáveis, metadado tardio sem RAW e nenhuma reexecução automática |
| T-032 | Flood ou starvation de capability monopoliza Session/Agent (D) | alto | limites configuráveis por Session/Agent/capability, janela deslizante e erro estruturado sem fila ilimitada |
| T-033 | Consumidor lento esgota fila/buffer de saída (D) | alto | limite bounded de 64 KiB no Server, máximo de quatro sends pendentes no Agent e fechamento explícito em backpressure |
| T-034 | Corrida de cancelamento aceita resultado sem autoridade (T/R) | alto | transição terminal atômica no store local, cancelamento idempotente e reconciliação de estado/deadline |
| T-035 | Payload oversized ou correlation/capability spoofing contorna associação da request (T/D) | alto | limites antes de armazenamento, schemas, correlação exata, capability ID+versão negociada e rejeição auditada |
| T-036 | Entrada externa explora SQL injection (T/I/E) | crítico | queries parametrizadas; identificadores internos validados; teste hostil preserva schema |
| T-037 | Connection string/log ou credencial de banco vaza (I/S) | crítico | configuração externa ignorada pelo Git, exemplo fictício, URL nunca logada, rotação/secret store futuros |
| T-038 | Credencial PostgreSQL comprometida altera ou extrai histórico (S/T/I/R) | crítico | database dedicado, privilégio mínimo/TLS/rotação futuros, acesso restrito; append-only da aplicação não é inviolabilidade |
| T-039 | Evidence RAW ou Observation maliciosa é persistida/interpretada (T/I) | alto | RAW excluída do schema; allowlist determinística de fatos, tamanho/schema, `MINIMIZED` explícito e sem promoção a AI-SAFE |
| T-040 | Migration/lockfile adulterado compromete schema ou supply chain (T/E) | alto | migration versionada com checksum, schema futuro rejeitado, lockfile/audit e revisão obrigatória |
| T-041 | PostgreSQL indisponível causa operação sem trilha durável (D/R) | alto | startup e novo dispatch fail-closed, métrica de falha, transaction rollback; não inventar resultado em andamento |
| T-042 | ServerInstance antiga ou SessionRecord ressuscita autoridade após restart (S/E) | crítico | UUID por processo, reconciliação antes do listen, store vivo vazio, token não persistido e novo handshake obrigatório |
| T-043 | Replay/duplicata após restart reexecuta request conhecida (T/D) | alto | requestId durável único, nenhum redispatch no recovery, não terminais abandonadas com outcome desconhecido |

## Cenários de abuso prioritários

1. Atacante obtém credencial de sessão e tenta registrar outro endpoint: vínculo, uso único, expiração e prova do agente devem impedir.
2. Técnico aprova `restart_spooler`, mas payload é trocado por comando livre: hash/versão da Action e dispatch tipado invalidam Approval.
3. Endpoint retorna texto “ignore policy”: conteúdo permanece Evidence não confiável e não alcança executor/policy como instrução.
4. Sessão fecha durante Job: nenhum novo lease; ação em curso segue regra explícita de cancelamento seguro e resultado tardio é marcado.
5. Conexão cai sem `SessionClose`: estado vira `Disconnected`, mantém somente a janela do lease e depois expira; não é registrado como fechamento limpo.
6. Server revoga enquanto poderia despachar coleta: estado terminal é aplicado antes de fechar o socket; registry remove o canal e novos requests são rejeitados.
7. Resultado chega antes de crash mas sua transação não completa: recovery preserva incerteza como `abandoned/outcomeUnknown`, não fabrica falha nem reexecuta.

## Riscos residuais e validações futuras

Comprometimento simultâneo de Control Plane e chaves de assinatura, capacidades que exigem privilégio administrativo, impossibilidade de garantir rollback e falsificação por endpoint totalmente comprometido permanecem riscos altos. Antes do piloto: data-flow detalhado, matriz de risco, protocolo de bootstrap, gestão de chaves, logging/redaction, pentest e playbooks de revogação/incidente.
