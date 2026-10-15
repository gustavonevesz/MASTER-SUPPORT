# Questões abertas relevantes

CORE-002 resolveu a autenticação da console local: OIDC é o provider de produção e Operator preprovisionado recebe somente `console.read`. Permanecem abertas a configuração concreta do IdP, sincronização de revogação/logout do IdP, RBAC futuro e qualquer exposição remota — que continua proibida.

CORE-001 resolveu a projeção read-only; CORE-002 resolveu a identidade e autorização local com OIDC configurável, preprovisionamento e `console.read`. RAW Evidence, secrets e payloads internos continuam proibidos. Permanecem abertas a configuração do IdP corporativo real, RBAC mutável futuro, retenção, publicação segura e a fonte confiável de presença `ONLINE NOW`.

OQ-002 foi resolvida para o inventário operacional pela ADR-014: somente `HumanReview` explícito cria o vínculo, sem prova automática por hostname ou fingerprint. A estratégia de autenticação do operador foi resolvida pela ADR-016, embora a configuração do IdP corporativo real permaneça aberta. A prova criptográfica futura do equipamento continua aberta; `local_operator` é atribuição histórica honesta, não identidade verificável.

OQ-001 foi resolvida pela ADR-012 para Support Session temporária: TLS + convite single-use + tickets opacos rotativos. Permanecem abertas identidade permanente de Asset/Managed Endpoint, distribuição operacional do código, PKI/certificados de produção, tolerância formal de clock, auditoria resistente a adulteração e rate limiting distribuído.

OQ-005 foi resolvida para a primeira fatia pela ADR-013: runtime, OS, memória física, volumes fixos locais e contexto mínimo de execução. Expansão desse catálogo exige finalidade e política próprias. OQ-002 possui resolução operacional limitada pela ADR-014; identidade corporativa e atestação continuam abertas.

Estas questões podem alterar segurança, protocolo ou modelo; não devem ser resolvidas por conveniência silenciosa.

| ID | Questão | Por que importa | Momento de decisão |
|---|---|---|---|
| OQ-001 | Qual é o bootstrap de confiança de produção e como o técnico transfere autorização sem depender do resume token dev-only? | identidade/replay/usabilidade | antes de sair de loopback |
| OQ-002 | HumanReview define a associação operacional; qual atestação futura prova o equipamento e qual identidade corporativa prova o revisor? | impersonação e deduplicação | antes do piloto/Managed Endpoint |
| OQ-003 | WebSocket em Trial atende proxies corporativos, TLS, backpressure e redes reais antes de promoção? | transporte e operação | antes do piloto |
| OQ-004 | Qual política exata governa Job em execução quando sessão expira/fecha ou conectividade cai? | efeitos parciais e segurança | antes do executor mutável |
| OQ-005 | Quais capabilities compõem o Preflight mínimo sem coletar dados pessoais/segredos em excesso? | privacidade e diagnóstico | primeira fatia |
| OQ-006 | Como verificar evidência produzida por endpoint potencialmente comprometido? | confiança do diagnóstico | antes de endpoints gerenciados; baseline agora |
| OQ-007 | Quem pode aprovar R2/R3/R4, quando há segregação de funções e qual step-up é exigido? | modelo de autoridade | antes de ações mutáveis |
| OQ-008 | Qual retenção, expurgo, arquivamento, residência e acesso definitivos para Observation minimizada, EvidenceMetadata e auditoria? Evidence RAW continua fora do banco. | segurança, LGPD e custo | antes do piloto |
| OQ-009 | Qual janela mínima de versões compatíveis deve ser suportada além da regra additive-first do protocolo 1.0? | rollout seguro | antes do primeiro rollout de Agent |
| OQ-010 | O processo PowerShell separado, hipótese inicial do spike documental, atende cancelamento, encoding, módulos e custo de startup medidos? | segurança, timeout e estabilidade | spike executável antes da primeira capability |
| OQ-011 | Como armazenar auditoria com resistência proporcional a administrador/servidor comprometido? | não repúdio e investigação | desenho de persistência |
| OQ-012 | Qual critério permite promover informação `Inferred` para `Confirmed` e quem é a autoridade? | qualidade da memória | domínio do incidente |
| OQ-013 | Qual será a estratégia de atualização, assinatura e revogação do Runtime antes de qualquer modo persistente? | supply chain | antes de Managed Endpoint |
| OQ-014 | Qual conjunto de dados pode chegar a um LLM e qual serviço fará minimização/redaction? | secrets/prompt injection | antes de IA |
| OQ-015 | Qual biblioteca JSON Schema C# madura substituirá o validador mínimo quando surgir `$ref`, composição, condicional ou formato customizado? | evitar interpretação parcial/divergente | obrigatoriamente antes da primeira keyword fora do subconjunto ADR-007 |
| OQ-016 | Resolvida na ADR-010: disconnect abandona requests aceitas/em execução com outcome desconhecido; terminais não reabrem e resume não reexecuta. | evita estado falso e reexecução acidental | FOUNDATION-004 |
| OQ-017 | Resolvida para o runtime único: 2 ativas por Session/Agent, 1 por capability e 5 disparos por Session/capability em 10 s, todos configuráveis. Limites distribuídos continuam pendentes. | servidor abusivo e resource exhaustion | FOUNDATION-004 |
| OQ-018 | Qual parte de uma Observation factual pode ser exposta além do endpoint dev-only sem revelar Evidence RAW? | minimização, acesso e futura UI | antes de qualquer UI/persistência |
| OQ-019 | Resolvida na ADR-011: transações locais no PostgreSQL, persist-before-dispatch e restart conservador sem restaurar autoridade/reexecutar. A janela PostgreSQL↔WebSocket permanece explicitamente at-least-uncertain. | consistência, replay e recuperação | FOUNDATION-005 |
| OQ-020 | Qual tolerância de clock e fonte de tempo serão exigidas fora do ambiente local? | deadline e rejeição tardia entre hosts | antes do piloto |
| OQ-021 | Qual política operacional de backup/restore, rotação de credenciais, TLS do PostgreSQL, HA e recovery point/time será exigida? | disponibilidade e confidencialidade do System of Record | antes do piloto |
| OQ-022 | Como tornar auditoria resistente a adulteração além do append-only comportamental da aplicação? | investigação e não repúdio | antes de requisitos regulatórios/piloto |
