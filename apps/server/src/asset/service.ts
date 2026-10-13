import type { Clock } from "../session/clock.js";
import type { MetricsRegistry } from "../observation/metrics.js";
import { localHumanReview, type HumanReview } from "./models.js";
import { AssetRegistryRepository } from "./repository.js";

export class AssetReviewService {
  public constructor(private readonly repository:AssetRegistryRepository,private readonly clock:Clock,private readonly metrics?:MetricsRegistry){}
  public async listUnreviewed(){const rows=await this.repository.listUnreviewed();this.metrics?.setGauge("unreviewed_endpoints",rows.length);return rows;}
  public async createAssetFromObservedEndpoint(input:{observedEndpointId:string;displayName:string;externalInventoryId?:string;review:HumanReview}){
    requireReview(input.review);const displayName=clean(input.displayName,"display_name",200);const externalInventoryId=optionalClean(input.externalInventoryId,"external_inventory_id",100);
    const value=await this.repository.createAndLink({observedEndpointId:input.observedEndpointId,displayName,...(externalInventoryId?{externalInventoryId}:{}),now:this.clock.now()});
    this.metrics?.increment("assets_created");this.metrics?.increment("asset_links_created");await this.refreshGauge();return value;}
  public async linkObservedEndpoint(input:{assetId:string;observedEndpointId:string;review:HumanReview}){requireReview(input.review);const value=await this.repository.link({assetId:input.assetId,
    observedEndpointId:input.observedEndpointId,now:this.clock.now()});this.metrics?.increment("asset_links_created");await this.refreshGauge();return value;}
  public async correctLink(input:{observedEndpointId:string;newAssetId:string;reason:string;review:HumanReview}){requireReview(input.review);const reason=clean(input.reason,"correction_reason",500);
    const value=await this.repository.correct({observedEndpointId:input.observedEndpointId,newAssetId:input.newAssetId,reason,now:this.clock.now()});
    this.metrics?.increment("asset_links_corrected");await this.refreshGauge();return value;}
  public async retireAsset(input:{assetId:string;reason:string;review:HumanReview}){requireReview(input.review);const value=await this.repository.retire(input.assetId,clean(input.reason,"retirement_reason",500),this.clock.now());
    this.metrics?.increment("assets_retired");return value;}
  public listAssets(){return this.repository.listAssets();}
  public currentView(assetId:string){return this.repository.currentView(assetId);}
  public history(assetId:string){return this.repository.history(assetId);}
  public static localReview():HumanReview{return localHumanReview;}
  private async refreshGauge(){this.metrics?.setGauge("unreviewed_endpoints",(await this.repository.listUnreviewed()).length);}
}

function requireReview(review:HumanReview):void{if(review.actorType!=="local_operator"||review.confirmationMethod!=="HumanReview")throw new Error("explicit_human_review_required");}
function clean(value:string,field:string,max:number):string{const result=value.trim();if(!result||result.length>max||/[\u0000-\u001f\u007f]/u.test(result))throw new Error(`invalid_${field}`);return result;}
function optionalClean(value:string|undefined,field:string,max:number):string|undefined{return value===undefined||value.trim()===""?undefined:clean(value,field,max);}
