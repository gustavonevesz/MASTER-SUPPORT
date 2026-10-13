# ADR-014 — Human-confirmed Asset identity

- Status: Aceito
- Data: 2026-10-13

## Contexto

`ObservedEndpoint` prova apenas que um endpoint foi visto em uma Support Session. Hostname e fatos de Preflight são mutáveis, falsificáveis e insuficientes para identidade permanente. Ainda não existe identidade corporativa do operador nem atestado criptográfico do equipamento.

## Decisão

Um `Asset` `WindowsEndpoint` só é criado ou associado a um ObservedEndpoint após decisão explícita `HumanReview` pelo ator honestamente denominado `local_operator`. `AssetId` é UUID aleatório e imutável. `ExternalInventoryId` é opcional, informado pelo operador e único sem distinção de caixa.

`AssetEndpointLink` preserva a decisão e permite um vínculo ativo por ObservedEndpoint e vários endpoints por Asset. Correção revoga o vínculo anterior e cria outro transacionalmente, com auditoria. Retired preserva consulta e bloqueia novos vínculos. Current view é derivada, não cópia da Evidence.

Nenhum algoritmo correlaciona hostname, OS, RAM, storage, arquitetura, runtime, rede, serial, fingerprint ou similaridade. A confirmação não concede autoridade à Session e não torna Evidence verdadeira ou AI-SAFE.

## Consequências

O operador assume uma decisão falível, mitigada por confirmação final, constraints, transações, correção explícita e histórico. Duas Sessions aparentemente idênticas continuam pendentes separadamente. A futura UI pode reutilizar `AssetReviewService`, mas precisará autenticação, autorização e output encoding. Identidade corporativa e atestação permanecem abertas.
