# ADR-004 — Modelo de execução de comandos

## Decisão recomendada

Adotar o modelo **C híbrido: capabilities estruturadas primeiro; terminal assistido controlado como escape hatch futuro**. A hipótese é validada com uma ressalva: terminal livre não entra na primeira fatia e jamais contorna Policy/Approval/Runtime guards.

## Status

Aceito na GATE-000.

## Contexto

Diagnósticos exigem adaptabilidade, mas execução privilegiada recebe entrada potencialmente maliciosa de pessoas, integrações e futura IA. O protocolo precisa comunicar intenção verificável, não apenas texto executável.

## Alternativas

### A — IA gera PowerShell livremente

Flexível e rápida para casos novos, porém difícil de validar, autorizar semanticamente, tornar idempotente, testar e verificar. Amplifica prompt injection e command injection. **Rejeitada como caminho normal.**

### B — Somente capabilities estruturadas

Máxima previsibilidade, schemas, testes e políticas claras. Falha diante de incidentes inéditos e cria pressão para capabilities excessivamente genéricas. **Insuficiente isoladamente.**

### C — Híbrido

Capabilities versionadas cobrem o caminho normal; terminal assistido é modo explícito, humano, auditado, de risco elevado e com controles próprios. **Escolhido**, preservando capacidade operacional sem converter exceção em backdoor.

## Contrato mínimo conceitual

Uma Capability declara ID/versão, schemas, plataformas, privilégios, risco-base, precondições, efeitos esperados, idempotência, timeout/limites e estratégia de verificação. Job carrega alvo, sessão, parâmetros, prazo, correlação, política e aprovação. CommandExecution registra tentativa e resultado técnico; Evidence e Verification são objetos separados.

## Guardrails

- Allowlist e validação também no agente; servidor comprometido não recebe confiança ilimitada.
- Argumentos tipados e APIs nativas preferidos; sem concatenação de shell.
- PowerShell, quando usado, deve ser artefato versionado/assinado ou composição controlada.
- Retry somente quando semântica permitir.
- Saída tem tamanho, redaction e classificação.
- Terminal futuro exige modo/indicador inequívoco, aprovação específica, duração curta e auditoria completa; IA não o opera autonomamente.

## Idempotência e incerteza

Toda capability deverá declarar se é segura para retry, idempotente, não idempotente ou destrutiva; uma operação pode exigir mais de uma dessas propriedades para decisão de política. Retry automático é proibido por padrão. Quando a conexão cair após possível execução e antes do resultado, a tentativa fica com resultado desconhecido até reconciliação por evidência/consulta ou decisão humana. O servidor não pode converter ausência de resposta em falha e repetir silenciosamente.

## Consequências e trade-offs

Há custo inicial para criar handlers e verificadores, compensado por segurança, testes e aprendizado confiável. Casos novos podem exigir escalonamento humano. Success técnico, outcome e resolução permanecem separados.

## Concretização read-only na FOUNDATION-003

A primeira execução real é deliberadamente uma `ObservationRequest`, não Job/CommandExecution: `system.runtime.summary@1.0` apenas coleta dados por APIs nativas do runtime. O Agent usa registry explícita com ID, versão, R0, `ReadOnly`, `RequiresAdmin=false` e referência direta ao handler; não aceita nome de método, tipo, assembly, comando ou script do Server. Evidence RAW e Observation factual são resultados distintos.

Essa forma não cria um orquestrador paralelo. Um Job futuro poderá selecionar uma Capability para realizar uma Action sob policy/approval, reutilizando catálogo, negociação, limites e dispatch local. Evidence/Observation continuarão representando conhecimento produzido, enquanto Job/CommandExecution representarão intenção/tentativa quando existirem.

## Risco de lock-in

Moderado no catálogo próprio. Mitigar com schemas neutros, capabilities pequenas orientadas à intenção e adapters por plataforma; evitar DSL proprietária abrangente.

## Condições para revisar

Cobertura incapaz de acompanhar casos reais; controles de terminal inviabilizam suporte; nova tecnologia oferece execução verificável com segurança equivalente; ou dados mostram capabilities mal dimensionadas.
