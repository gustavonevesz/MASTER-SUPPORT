# Questões abertas relevantes

Estas questões podem alterar segurança, protocolo ou modelo; não devem ser resolvidas por conveniência silenciosa.

| ID | Questão | Por que importa | Momento de decisão |
|---|---|---|---|
| OQ-001 | Qual é o bootstrap de confiança de produção e como o técnico transfere autorização sem depender do resume token dev-only? | identidade/replay/usabilidade | antes de sair de loopback |
| OQ-002 | Qual prova define identidade do endpoint temporário sem confundi-la com identidade persistente do Asset? | impersonação e deduplicação | contracts/skeleton |
| OQ-003 | WebSocket em Trial atende proxies corporativos, TLS, backpressure e redes reais antes de promoção? | transporte e operação | antes do piloto |
| OQ-004 | Qual política exata governa Job em execução quando sessão expira/fecha ou conectividade cai? | efeitos parciais e segurança | antes do executor mutável |
| OQ-005 | Quais capabilities compõem o Preflight mínimo sem coletar dados pessoais/segredos em excesso? | privacidade e diagnóstico | primeira fatia |
| OQ-006 | Como verificar evidência produzida por endpoint potencialmente comprometido? | confiança do diagnóstico | antes de endpoints gerenciados; baseline agora |
| OQ-007 | Quem pode aprovar R2/R3/R4, quando há segregação de funções e qual step-up é exigido? | modelo de autoridade | antes de ações mutáveis |
| OQ-008 | Qual classificação, retenção, redaction e residência de evidências/stdout/auditoria? | segurança, LGPD e custo | antes de persistir dados reais |
| OQ-009 | Qual janela mínima de versões compatíveis deve ser suportada além da regra additive-first do protocolo 1.0? | rollout seguro | antes do primeiro rollout de Agent |
| OQ-010 | O processo PowerShell separado, hipótese inicial do spike documental, atende cancelamento, encoding, módulos e custo de startup medidos? | segurança, timeout e estabilidade | spike executável antes da primeira capability |
| OQ-011 | Como armazenar auditoria com resistência proporcional a administrador/servidor comprometido? | não repúdio e investigação | desenho de persistência |
| OQ-012 | Qual critério permite promover informação `Inferred` para `Confirmed` e quem é a autoridade? | qualidade da memória | domínio do incidente |
| OQ-013 | Qual será a estratégia de atualização, assinatura e revogação do Runtime antes de qualquer modo persistente? | supply chain | antes de Managed Endpoint |
| OQ-014 | Qual conjunto de dados pode chegar a um LLM e qual serviço fará minimização/redaction? | secrets/prompt injection | antes de IA |
| OQ-015 | Qual biblioteca JSON Schema C# madura substituirá o validador mínimo quando surgir `$ref`, composição, condicional ou formato customizado? | evitar interpretação parcial/divergente | obrigatoriamente antes da primeira keyword fora do subconjunto ADR-007 |
| OQ-016 | Como reconciliar Observation aceita/em execução quando o canal cai ou a Session é revogada, incluindo resultado tardio? | evitar estado falso e reexecução acidental | FOUNDATION-004 |
| OQ-017 | Quais quotas de concorrência e frequência devem limitar solicitações R0 por Session e Agent? | servidor abusivo e resource exhaustion | FOUNDATION-004 |
| OQ-018 | Qual parte de uma Observation factual pode ser exposta além do endpoint dev-only sem revelar Evidence RAW? | minimização, acesso e futura UI | antes de qualquer UI/persistência |
