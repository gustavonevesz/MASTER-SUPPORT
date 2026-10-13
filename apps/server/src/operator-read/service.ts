import type { OperatorReadRepository } from "./repository.js";

export class OperatorReadService {
  public constructor(private readonly repository:OperatorReadRepository){}
  public listAssets(input:{page:number;pageSize:number;search:string}){return this.repository.listAssets(input);}
  public assetDetail(assetId:string){return this.repository.assetDetail(assetId);}
  public preflights(assetId:string,input:{page:number;pageSize:number}){return this.repository.preflights(assetId,input);}
  public timeline(assetId:string,input:{page:number;pageSize:number}){return this.repository.timeline(assetId,input);}
  public session(sessionId:string){return this.repository.session(sessionId);}
  public unreviewed(input:{page:number;pageSize:number}){return this.repository.unreviewed(input);}
}
