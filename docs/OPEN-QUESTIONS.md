# Questões abertas relevantes

Estas questões podem alterar segurança, protocolo ou modelo; não devem ser resolvidas por conveniência silenciosa.

| ID | Questão | Por que importa | Momento de decisão |
|---|---|---|---|
| OQ-001 | Qual é o bootstrap de confiança da sessão e como o técnico transfere autorização ao endpoint sem expor token reutilizável? | identidade/replay/usabilidade | antes do primeiro handshake real |
| OQ-002 | Qual prova define identidade do endpoint temporário sem confundi-la com identidade persistente do Asset? | impersonação e deduplicação | contracts/skeleton |
| OQ-003 | WebSocket, candidato após análise documental, atende proxies corporativos, retomada, backpressure e cancelamento em experimento real? | transporte e operação | spike de rede FOUNDATION-002 |
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
| OQ-015 | Em que nível de complexidade o validador mínimo C# deve ser substituído por biblioteca JSON Schema completa ou geração de código? | evitar interpretação parcial/divergente | antes de adicionar keywords além do subconjunto testado |
