# ADR-017 — Safe Action Orchestration

Status: Aceito — CORE-003

## Contexto

A console autenticada precisava provar o ciclo de uma ação sem introduzir execução Windows, comando livre ou automação autônoma. A separação entre intenção, política, aprovação, tentativa, verificação e histórico precisa sobreviver a concorrência e restart.

## Decisão

O Control Plane oferece somente `control-plane.simulation.set-marker@1.0`, alvo `ControlPlaneSimulation`, risco `R1`, entrada `{ marker }` estrita e aprovação explícita. A feature é desabilitada por padrão e só inicia habilitada em modo development no bind literal `127.0.0.1`.

`ActionRequest`, `Job`, snapshots de `PolicyEvaluation`, `ApprovalRequest/Decision`, `ExecutionAttempt`, `VerificationAttempt`, `JobEvent` e eventos de segurança são duráveis. A política `core-003-policy-v1` é determinística e default-deny. O payload aprovado é imutável; a chave de idempotência é persistida somente como SHA-256 e possui unicidade por operador.

O papel `OperatorTechnician` recebe `console.read`, `action.request` e `action.approve`; `OperatorReader` conserva somente leitura. Self-approval é tolerada apenas nesta simulação R1 e fica registrada. R2–R4, ação/versão/alvo desconhecido, simulação desligada, modo não-development e bind não-loopback são negados.

O modelo de risco é: R0 somente leitura; R1 alteração limitada, previsível e normalmente reversível; R2 impacto moderado em usuário/serviço; R3 alto impacto operacional ou de segurança; R4 crítico, destrutivo ou irreversível. A ActionDefinition fornece baseline e policy pode elevar, nunca reduzir silenciosamente. CORE-003 nega R2–R4.

`ActionExecutor` e `ActionVerifier` são portas distintas. O executor permitido altera somente um adapter em memória; o verificador lê esse adapter independentemente. `Succeeded` exige execução bem-sucedida e Verification `Passed`. Não há retry automático. Após restart, `Executing`/`Verifying` tornam-se `OutcomeUnknown`; `Ready` é reavaliado antes de um único claim; aprovação expirada termina em `Expired`.

## Consequências

A arquitetura prova autorização, idempotência, transações, aprovação, execução simulada e verificação sem capacidade de alterar Windows. O protocolo Agent permanece read-only. Adicionar qualquer Action real, alvo Windows, risco superior, rollback, segregação de funções ou retry exige nova etapa e decisão explícita.
