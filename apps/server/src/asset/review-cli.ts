import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { AssetRegistryRepository } from "./repository.js";
import { AssetReviewService } from "./service.js";
import { systemClock } from "../session/clock.js";

const databaseUrl=process.env["MASTER_SUPPORT_DATABASE_URL"];
if(!databaseUrl)throw new Error("MASTER_SUPPORT_DATABASE_URL is required");
const repository=await AssetRegistryRepository.start(databaseUrl);const service=new AssetReviewService(repository,systemClock);
const prompt=createInterface({input:stdin,output:stdout});
try{
  stdout.write("MASTER SUPPORT - ASSET REVIEW\nHumanReview actor: local_operator (local, not corporately authenticated)\n\n");
  while(true){
    const pending=await service.listUnreviewed();if(pending.length===0){stdout.write("No unreviewed ObservedEndpoints.\n");break;}
    pending.forEach((endpoint,index)=>stdout.write(`${index+1}. ${safe(endpoint.observedEndpointId)} | ${safe(endpoint.observedMachineName??"(unknown)")} | ${safe(endpoint.platform)} | last ${endpoint.lastObservedAt.toISOString()}\n`));
    const selected=await prompt.question("Select endpoint number, or q to quit: ");if(selected.trim().toLowerCase()==="q")break;
    const endpoint=pending[Number(selected)-1];if(!endpoint){stdout.write("Invalid selection.\n");continue;}
    showSummary(endpoint.latestPreflight?.factsByCapability??{});
    const action=(await prompt.question("[1] Create Asset  [2] Link existing  [3] Leave pending  [4] Exit: ")).trim();
    if(action==="4")break;if(action==="3")continue;
    if(action==="1"){
      const displayName=await prompt.question("DisplayName: ");const external=await prompt.question("ExternalInventoryId (optional): ");
      if(!await confirmed(prompt,`Create WindowsEndpoint Asset '${safe(displayName)}' and link the selected endpoint?`))continue;
      const result=await service.createAssetFromObservedEndpoint({observedEndpointId:endpoint.observedEndpointId,displayName,
        ...(external.trim()?{externalInventoryId:external}:{}),review:AssetReviewService.localReview()});stdout.write(`Created Asset ${result.asset.assetId}.\n`);
    }else if(action==="2"){
      const assets=(await service.listAssets()).filter(asset=>asset.status==="Active");
      assets.forEach((asset,index)=>stdout.write(`${index+1}. ${asset.assetId} | ${safe(asset.displayName)} | ${safe(asset.externalInventoryId??"-")} | ${asset.status}\n`));
      const chosen=assets[Number(await prompt.question("Select Asset number: "))-1];if(!chosen){stdout.write("Invalid selection.\n");continue;}
      if(!await confirmed(prompt,`Link selected endpoint to Asset '${safe(chosen.displayName)}'?`))continue;
      await service.linkObservedEndpoint({assetId:chosen.assetId,observedEndpointId:endpoint.observedEndpointId,review:AssetReviewService.localReview()});stdout.write("Endpoint linked.\n");
    }else stdout.write("Invalid action.\n");
  }
}finally{prompt.close();await repository.close();}

async function confirmed(rl:ReturnType<typeof createInterface>,message:string):Promise<boolean>{return (await rl.question(`${message} Type YES to confirm HumanReview: `)).trim()==="YES";}
function safe(value:string):string{return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu," ").slice(0,200);}
function showSummary(facts:Readonly<Record<string,unknown>>):void{stdout.write("Latest safe Preflight summary (MINIMIZED/INTERNAL; never RAW):\n");
  for(const [capability,value] of Object.entries(facts))stdout.write(`  ${safe(capability)}: ${safe(JSON.stringify(value))}\n`);}
