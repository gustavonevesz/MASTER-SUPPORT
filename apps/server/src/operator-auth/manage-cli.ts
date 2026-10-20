import { OperatorAuthRepository } from "./repository.js";
import { OperatorAuthService } from "./service.js";
import { systemClock } from "../session/clock.js";

const databaseUrl=process.env["MASTER_SUPPORT_DATABASE_URL"];if(!databaseUrl)throw new Error("MASTER_SUPPORT_DATABASE_URL is required");const repository=await OperatorAuthRepository.start(databaseUrl);const service=new OperatorAuthService(repository,systemClock);
try{const [command,...args]=process.argv.slice(2);if(command==="list"){process.stdout.write(`${JSON.stringify(await service.list(),null,2)}\n`);}
  else if(command==="provision"){const [provider,subject,...name]=args;if(!provider||!subject||!name.length)usage();const value=await service.provision({provider,providerSubject:subject,displayName:name.join(" ")});process.stdout.write(`Provisioned ${value.operatorId}\n`);}
  else if(command==="provision-technician"){const [provider,subject,...name]=args;if(!provider||!subject||!name.length)usage();const value=await service.provision({provider,providerSubject:subject,displayName:name.join(" ")},"OperatorTechnician");process.stdout.write(`Provisioned Technician ${value.operatorId}\n`);}
  else if(command==="disable"||command==="enable"){const id=args[0];if(!id)usage();if(!await service.setStatus(id,command==="disable"?"Disabled":"Active"))throw new Error("operator_not_found");process.stdout.write(`${command}d ${id}\n`);}else usage();
}finally{await repository.close();}
function usage():never{throw new Error("usage: operator:manage -- list | provision <provider> <subject> <display name> | provision-technician <provider> <subject> <display name> | disable <operator-id> | enable <operator-id>");}
