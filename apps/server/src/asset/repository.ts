import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { validateCurrentSchema } from "../persistence/migrations.js";
import type { Asset, AssetEndpointLink, UnreviewedObservedEndpoint } from "./models.js";

type AssetRow = { asset_id:string; asset_type:"WindowsEndpoint"; display_name:string; external_inventory_id:string|null;
  status:"Active"|"Retired"; created_at:Date; updated_at:Date };
type LinkRow = { link_id:string; asset_id:string; observed_endpoint_id:string; confirmed_at:Date; confirmed_by:"local_operator";
  confirmation_method:"HumanReview"; status:"Active"|"Revoked"; revoked_at:Date|null; revoked_by:"local_operator"|null; revocation_reason:string|null };

export class AssetRegistryConflict extends Error {
  public constructor(public readonly code: "observed_endpoint_already_linked" | "external_inventory_id_conflict" | "asset_retired" | "link_not_found" | "same_asset") { super(code); }
}

export class AssetRegistryRepository {
  private constructor(private readonly pool:Pool) {}
  public static async start(databaseUrl:string):Promise<AssetRegistryRepository>{
    const pool=new Pool({connectionString:databaseUrl,max:5,connectionTimeoutMillis:3_000});
    try{await validateCurrentSchema(pool);return new AssetRegistryRepository(pool);}catch(error){await pool.end().catch(()=>undefined);throw error;}
  }

  public async listUnreviewed():Promise<readonly UnreviewedObservedEndpoint[]>{
    const result=await this.pool.query<Record<string,unknown>>(`SELECT e.observed_endpoint_id,e.observed_machine_name,e.platform,e.first_observed_at,e.last_observed_at,
      latest.preflight_run_id,latest.completed_at,latest.status,latest.completeness_percent,latest.facts_by_capability
      FROM observed_endpoints e
      LEFT JOIN asset_endpoint_links active ON active.observed_endpoint_id=e.observed_endpoint_id AND active.status='Active'
      LEFT JOIN LATERAL (
        SELECT p.preflight_run_id,p.completed_at,p.status,s.completeness_percent,
          COALESCE((SELECT jsonb_object_agg(po.capability_id,o.facts) FROM preflight_observations po
            JOIN observations o ON o.observation_request_id=po.observation_request_id WHERE po.preflight_run_id=p.preflight_run_id),'{}'::jsonb) facts_by_capability
        FROM preflight_runs p LEFT JOIN preflight_snapshots s USING(preflight_run_id)
        WHERE p.observed_endpoint_id=e.observed_endpoint_id AND p.status IN ('completed','partial')
        ORDER BY p.completed_at DESC NULLS LAST LIMIT 1
      ) latest ON true WHERE active.link_id IS NULL ORDER BY e.first_observed_at,e.observed_endpoint_id`);
    return result.rows.map(row=>({observedEndpointId:String(row["observed_endpoint_id"]),
      ...(row["observed_machine_name"]===null?{}:{observedMachineName:String(row["observed_machine_name"])}),platform:String(row["platform"]),
      firstObservedAt:row["first_observed_at"] as Date,lastObservedAt:row["last_observed_at"] as Date,
      ...(row["preflight_run_id"]===null?{}:{latestPreflight:{preflightRunId:String(row["preflight_run_id"]),completedAt:row["completed_at"] as Date,
        status:String(row["status"]),...(row["completeness_percent"]===null?{}:{completenessPercent:Number(row["completeness_percent"])}),
        factsByCapability:(row["facts_by_capability"]??{}) as Record<string,unknown>}})}));
  }

  public async createAndLink(input:{observedEndpointId:string;displayName:string;externalInventoryId?:string;now:Date}):Promise<{asset:Asset;link:AssetEndpointLink}>{
    return this.transaction(async client=>{
      const assetId=randomUUID(),linkId=randomUUID();
      try{
        const created=await client.query<AssetRow>(`INSERT INTO assets(asset_id,asset_type,display_name,external_inventory_id,status,created_at,updated_at)
          VALUES($1,'WindowsEndpoint',$2,$3,'Active',$4,$4) RETURNING *`,[assetId,input.displayName,input.externalInventoryId??null,input.now]);
        await this.assertEndpointExists(client,input.observedEndpointId);
        const linked=await client.query<LinkRow>(`INSERT INTO asset_endpoint_links(link_id,asset_id,observed_endpoint_id,confirmed_at,confirmed_by,confirmation_method,status)
          VALUES($1,$2,$3,$4,'local_operator','HumanReview','Active') RETURNING *`,[linkId,assetId,input.observedEndpointId,input.now]);
        await this.audit(client,"asset.created",input.now,assetId,null,linkId,"created",null);
        await this.audit(client,"asset.endpoint_linked",input.now,assetId,input.observedEndpointId,linkId,"Active",null);
        return {asset:mapAsset(created.rows[0]!),link:mapLink(linked.rows[0]!)};
      }catch(error){throw mapConflict(error);}
    });
  }

  public async link(input:{assetId:string;observedEndpointId:string;now:Date}):Promise<AssetEndpointLink>{
    return this.transaction(async client=>{
      try{await this.assertActiveAsset(client,input.assetId);await this.assertEndpointExists(client,input.observedEndpointId);const linkId=randomUUID();
        const result=await client.query<LinkRow>(`INSERT INTO asset_endpoint_links(link_id,asset_id,observed_endpoint_id,confirmed_at,confirmed_by,confirmation_method,status)
          VALUES($1,$2,$3,$4,'local_operator','HumanReview','Active') RETURNING *`,[linkId,input.assetId,input.observedEndpointId,input.now]);
        await this.audit(client,"asset.endpoint_linked",input.now,input.assetId,input.observedEndpointId,linkId,"Active",null);return mapLink(result.rows[0]!);
      }catch(error){throw mapConflict(error);}
    });
  }

  public async correct(input:{observedEndpointId:string;newAssetId:string;reason:string;now:Date}):Promise<{revoked:AssetEndpointLink;linked:AssetEndpointLink}>{
    return this.transaction(async client=>{
      const selected=await client.query<LinkRow>(`SELECT * FROM asset_endpoint_links WHERE observed_endpoint_id=$1 AND status='Active' FOR UPDATE`,[input.observedEndpointId]);
      const old=selected.rows[0];if(!old)throw new AssetRegistryConflict("link_not_found");if(old.asset_id===input.newAssetId)throw new AssetRegistryConflict("same_asset");
      await this.assertActiveAsset(client,input.newAssetId);const revokedResult=await client.query<LinkRow>(`UPDATE asset_endpoint_links SET status='Revoked',revoked_at=$2,
        revoked_by='local_operator',revocation_reason=$3 WHERE link_id=$1 RETURNING *`,[old.link_id,input.now,input.reason]);
      const linkId=randomUUID();const linkedResult=await client.query<LinkRow>(`INSERT INTO asset_endpoint_links(link_id,asset_id,observed_endpoint_id,confirmed_at,confirmed_by,confirmation_method,status)
        VALUES($1,$2,$3,$4,'local_operator','HumanReview','Active') RETURNING *`,[linkId,input.newAssetId,input.observedEndpointId,input.now]);
      await this.audit(client,"asset.endpoint_link_revoked",input.now,old.asset_id,input.observedEndpointId,old.link_id,"Revoked",input.reason);
      await this.audit(client,"asset.endpoint_relinked",input.now,input.newAssetId,input.observedEndpointId,linkId,"Active",input.reason);
      return {revoked:mapLink(revokedResult.rows[0]!),linked:mapLink(linkedResult.rows[0]!)};
    });
  }

  public async retire(assetId:string,reason:string,now:Date):Promise<Asset>{return this.transaction(async client=>{
    const result=await client.query<AssetRow>(`UPDATE assets SET status='Retired',updated_at=$2 WHERE asset_id=$1 AND status='Active' RETURNING *`,[assetId,now]);
    if(!result.rows[0]){const known=await client.query("SELECT 1 FROM assets WHERE asset_id=$1",[assetId]);if(known.rowCount)throw new AssetRegistryConflict("asset_retired");throw new Error("asset_not_found");}
    await this.audit(client,"asset.retired",now,assetId,null,null,"Retired",reason);return mapAsset(result.rows[0]);});}

  public async listAssets():Promise<readonly Asset[]>{const result=await this.pool.query<AssetRow>("SELECT * FROM assets ORDER BY created_at,asset_id");return result.rows.map(mapAsset);}
  public async currentView(assetId:string):Promise<Record<string,unknown>|undefined>{const result=await this.pool.query<Record<string,unknown>>(`SELECT a.asset_id,a.asset_type,a.display_name,a.external_inventory_id,a.status,a.created_at,a.updated_at,
      current.observed_endpoint_id,current.observed_machine_name,current.platform,current.last_observed_at,current.preflight_run_id,current.preflight_completed_at,current.preflight_status,current.completeness_percent
      FROM assets a LEFT JOIN LATERAL (SELECT e.observed_endpoint_id,e.observed_machine_name,e.platform,e.last_observed_at,p.preflight_run_id,
        p.completed_at preflight_completed_at,p.status preflight_status,s.completeness_percent FROM asset_endpoint_links l JOIN observed_endpoints e USING(observed_endpoint_id)
        LEFT JOIN LATERAL (SELECT * FROM preflight_runs pr WHERE pr.observed_endpoint_id=e.observed_endpoint_id AND pr.status IN ('completed','partial') ORDER BY pr.completed_at DESC NULLS LAST LIMIT 1) p ON true
        LEFT JOIN preflight_snapshots s ON s.preflight_run_id=p.preflight_run_id WHERE l.asset_id=a.asset_id AND l.status='Active' ORDER BY e.last_observed_at DESC LIMIT 1) current ON true
      WHERE a.asset_id=$1`,[assetId]);return result.rows[0];}
  public async history(assetId:string):Promise<readonly Record<string,unknown>[]>{const result=await this.pool.query<Record<string,unknown>>(`SELECT l.link_id,l.status link_status,l.confirmed_at,l.revoked_at,l.revocation_reason,
      e.observed_endpoint_id,e.session_id,e.first_observed_at,e.last_observed_at,p.preflight_run_id,p.status preflight_status,p.created_at preflight_created_at,
      po.capability_id,o.observation_id,o.observed_at,o.data_handling_state,o.facts
      FROM asset_endpoint_links l JOIN observed_endpoints e USING(observed_endpoint_id) LEFT JOIN preflight_runs p USING(observed_endpoint_id)
      LEFT JOIN preflight_observations po USING(preflight_run_id) LEFT JOIN observations o ON o.observation_request_id=po.observation_request_id
      WHERE l.asset_id=$1 ORDER BY l.confirmed_at,p.created_at,po.capability_id`,[assetId]);return result.rows;}
  public async auditEvents(assetId:string):Promise<readonly Record<string,unknown>[]>{const result=await this.pool.query<Record<string,unknown>>(`SELECT event_type,occurred_at,asset_id,
    observed_endpoint_id,asset_endpoint_link_id,actor_type,status,reason FROM audit_events WHERE asset_id=$1 ORDER BY occurred_at,event_type`,[assetId]);return result.rows;}
  public async close():Promise<void>{await this.pool.end();}

  private async assertActiveAsset(client:PoolClient,assetId:string):Promise<void>{const result=await client.query<{status:string}>("SELECT status FROM assets WHERE asset_id=$1 FOR UPDATE",[assetId]);
    if(!result.rows[0])throw new Error("asset_not_found");if(result.rows[0].status!=="Active")throw new AssetRegistryConflict("asset_retired");}
  private async assertEndpointExists(client:PoolClient,id:string):Promise<void>{const result=await client.query("SELECT 1 FROM observed_endpoints WHERE observed_endpoint_id=$1",[id]);if(!result.rowCount)throw new Error("observed_endpoint_not_found");}
  private audit(client:PoolClient,eventType:string,at:Date,assetId:string,endpointId:string|null,linkId:string|null,status:string,reason:string|null):Promise<unknown>{return client.query(`INSERT INTO audit_events(
    event_id,occurred_at,event_type,asset_id,observed_endpoint_id,asset_endpoint_link_id,actor_type,status,reason) VALUES($1,$2,$3,$4,$5,$6,'local_operator',$7,$8)`,
    [randomUUID(),at,eventType,assetId,endpointId,linkId,status,reason]);}
  private async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{const client=await this.pool.connect();try{await client.query("BEGIN");const value=await work(client);await client.query("COMMIT");return value;}
    catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}
}

function mapAsset(row:AssetRow):Asset{return {assetId:row.asset_id,assetType:row.asset_type,displayName:row.display_name,
  ...(row.external_inventory_id===null?{}:{externalInventoryId:row.external_inventory_id}),status:row.status,createdAt:row.created_at,updatedAt:row.updated_at};}
function mapLink(row:LinkRow):AssetEndpointLink{return {linkId:row.link_id,assetId:row.asset_id,observedEndpointId:row.observed_endpoint_id,confirmedAt:row.confirmed_at,
  confirmedBy:row.confirmed_by,confirmationMethod:row.confirmation_method,status:row.status,...(row.revoked_at===null?{}:{revokedAt:row.revoked_at}),
  ...(row.revoked_by===null?{}:{revokedBy:row.revoked_by}),...(row.revocation_reason===null?{}:{revocationReason:row.revocation_reason})};}
function mapConflict(error:unknown):unknown{if(error instanceof AssetRegistryConflict)return error;if(typeof error==="object"&&error!==null&&"code" in error&&error.code==="23505"){
  const constraint="constraint" in error?String(error.constraint):"";return new AssetRegistryConflict(constraint.includes("external_inventory")?"external_inventory_id_conflict":"observed_endpoint_already_linked");}return error;}
