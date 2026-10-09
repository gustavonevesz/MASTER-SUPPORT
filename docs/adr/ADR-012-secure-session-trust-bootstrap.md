# ADR-012 - Secure Support Session trust bootstrap

Status: Aceito (FOUNDATION-006)

## Contexto e ameaças

Uma autorização temporária precisa chegar a um Agent ainda não gerenciado sem transformar AgentInstance em identidade de Asset. O desenho trata roubo, força bruta e replay do convite; vazamento em argumentos, URL, logs e crash dumps; MITM, certificado/servidor ou Agent impostor; hijacking/fixation; replay de connection/resume; corrida de consumo; uso após revogação/expiração/restart; comprometimento do banco, clock skew, downgrade TLS e modo dev exposto em LAN.

## Alternativas

- A: TLS + convite single-use + bearer reutilizável é simples, mas amplia replay e janela de roubo.
- B: TLS + convite single-use + tickets opacos single-use e rotativos reduz replay, preserva temporariedade e usa APIs maduras em Node/.NET com custo operacional aceitável.
- C: mTLS temporário oferece prova criptográfica forte, mas exige emissão, proteção, rotação e revogação de chaves/certificados no Agent; é complexidade desproporcional para atendimento temporário e uma equipe pequena.
- D: tokens assinados autocontidos foram rejeitados porque revogação e single-use ainda exigiriam estado, sem vantagem sobre tickets opacos.

## Decisão

Adotar B. HTTPS/WSS usam validação TLS integral. Uma `SupportInvitation` PostgreSQL contém somente SHA-256 com separação de domínio de um segredo aleatório de 256 bits, metadados, TTL de 10 minutos e estado. SHA-256 é adequado porque a entrada já tem alta entropia; password hashing caro não melhora resistência prática e aumenta custo de abuso. Consumo usa lock transacional e somente uma corrida vence.

O bootstrap emite `ConnectionTicket` aleatório de 256 bits, válido por 60 segundos, single-use e vinculado a AgentInstance/capabilities. WSS o envia em `Authorization: Bearer`, nunca na URL. Após a Session autenticada, um `ResumeTicket` em memória, single-use, vinculado a Session/AgentInstance e válido por 5 minutos é emitido; consumo gera outro. Somente hashes dos tickets ficam em memória. Revogação remove tickets da Session. Restart elimina toda autoridade operacional e não restaura Session. Convite ativo não usado permanece válido no PostgreSQL até seu TTL.

O segredo é lido pelo Agent sem eco e nunca por argumento. A exceção de CA customizada existe somente no harness via `MASTER_SUPPORT_TEST_CA_CERT_PATH`; ela valida hostname, validade e uma raiz explícita, sem trust-all. Produção usa o trust store do sistema.

Modo `secure` exige certificado/chave externos e bootstrap. Modo `development` é explícito, em loopback e emite warning. Não há fallback nem downgrade. Bind não-loopback com development falha fechado.

## Consequências e invariantes

`SupportInvitation` autentica autorização para iniciar um atendimento; não prova que o host é um Asset específico. Asset, Endpoint, AgentInstance, SupportInvitation, Session e ServerInstance permanecem conceitos distintos. Persistência é histórico, não autoridade. A única capability continua `system.runtime.summary@1.0`. mTLS pode ser reavaliado para Managed Endpoint, fora desta Foundation.
