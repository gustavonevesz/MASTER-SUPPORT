# Questões abertas relevantes

Estas questões podem alterar segurança, protocolo ou modelo; não devem ser resolvidas por conveniência silenciosa.

| ID | Questão | Por que importa | Momento de decisão |
|---|---|---|---|
| OQ-001 | Qual é o bootstrap de confiança da sessão e como o técnico transfere autorização ao endpoint sem expor token reutilizável? | identidade/replay/usabilidade | antes do primeiro handshake real |
| OQ-002 | Qual prova define identidade do endpoint temporário sem confundi-la com identidade persistente do Asset? | impersonação e deduplicação | contracts/skeleton |
| OQ-003 | WebSocket atende proxies corporativos, retomada, backpressure e cancelamento, ou gRPC/polling é preferível? | transporte e operação | spike FOUNDATION-001 |
| OQ-004 | Qual política exata governa Job em execução quando sessão expira/fecha ou conectividade cai? | efeitos parciais e segurança | antes do executor mutável |
| OQ-005 | Quais capabilities compõem o Preflight mínimo sem coletar dados pessoais/segredos em excesso? | privacidade e diagnóstico | primeira fatia |
| OQ-006 | Como verificar evidência produzida por endpoint potencialmente comprometido? | confiança do diagnóstico | antes de endpoints gerenciados; baseline agora |
| OQ-007 | Quem pode aprovar R2/R3/R4, quando há segregação de funções e qual step-up é exigido? | modelo de autoridade | antes de ações mutáveis |
| OQ-008 | Qual classificação, retenção, redaction e residência de evidências/stdout/auditoria? | segurança, LGPD e custo | antes de persistir dados reais |
| OQ-009 | Qual semântica de compatibilidade e janela mínima entre servidor, protocolo e agentes antigos? | rollout seguro | contracts/skeleton |
| OQ-010 | A primeira fatia deve hospedar PowerShell in-process ou chamar processo isolado para cada capability? | segurança, timeout e estabilidade | spike do agente |
| OQ-011 | Como armazenar auditoria com resistência proporcional a administrador/servidor comprometido? | não repúdio e investigação | desenho de persistência |
| OQ-012 | Qual critério permite promover informação `Inferred` para `Confirmed` e quem é a autoridade? | qualidade da memória | domínio do incidente |
| OQ-013 | Qual será a estratégia de atualização, assinatura e revogação do Runtime antes de qualquer modo persistente? | supply chain | antes de Managed Endpoint |
| OQ-014 | Qual conjunto de dados pode chegar a um LLM e qual serviço fará minimização/redaction? | secrets/prompt injection | antes de IA |
