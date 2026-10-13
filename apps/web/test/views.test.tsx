import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ErrorState, LoadingState } from "../src/components.js";
import { AssetDetailView, AssetsView, PreflightHistory, TimelineView, UnreviewedView } from "../src/views.js";
import type { AssetDetail, Page, PreflightSummary, TimelineEvent } from "../src/types.js";

const empty=<T,>():Page<T>=>({items:[],page:1,pageSize:20,total:0,totalPages:0});
const preflight:PreflightSummary={preflightRunId:"pf",sessionId:"session",observedEndpointId:"endpoint",capturedAt:"2026-10-13T12:00:00Z",status:"completed",completenessPercent:100,
  observationCount:5,factsByCapability:{"windows.os.summary":{osDescription:"Windows 11 Pro",windowsBuild:"26100",osArchitecture:"x64"},"windows.memory.summary":{totalPhysicalMemoryBytes:17179869184},
    "windows.storage.summary":{volumes:[{root:"C:\\",freeBytes:195421011968}]},"windows.execution-context.summary":{privilegeLevel:"standard-user"}}};
const detail:AssetDetail={asset:{assetId:"asset",displayName:"Administração",externalInventoryId:"PC000049",assetType:"WindowsEndpoint",status:"Active",lastObservedAt:"2026-10-13T12:00:00Z"},
  identity:{state:"Confirmed Asset",method:"HumanReview"},latestObservedEndpoint:{observedEndpointId:"endpoint",observedMachineName:"PC-DEMO",platform:"Windows",firstObservedAt:"2026-10-13T11:00:00Z",lastObservedAt:"2026-10-13T12:00:00Z",linkStatus:"Active",confirmationMethod:"HumanReview",sessionId:"session"},latestPreflight:preflight,endpoints:[]};

test("Assets page renders operational rows and empty state",()=>{const populated=renderToStaticMarkup(<AssetsView data={{items:[detail.asset],page:1,pageSize:20,total:1,totalPages:1}}/>);
  assert.match(populated,/Administração/);assert.match(populated,/PC000049/);assert.match(renderToStaticMarkup(<AssetsView data={empty()}/>),/Nenhum Asset encontrado/);});
test("Asset Detail separates confirmed identity, observed hostname and latest minimized facts",()=>{const html=renderToStaticMarkup(<AssetDetailView detail={detail} preflights={{items:[preflight],page:1,pageSize:10,total:1,totalPages:1}} timeline={empty()}/>);
  assert.match(html,/Confirmed Asset/);assert.match(html,/PC-DEMO/);assert.match(html,/Windows 11 Pro/);assert.match(html,/16.0 GB/);assert.doesNotMatch(html,/RAW_SECRET/);});
test("Preflight history and Timeline render concise operator views",()=>{const timeline:Page<TimelineEvent>={items:[{eventId:"event",occurredAt:"2026-10-13T12:01:00Z",kind:"preflight.completed",title:"Preflight completed"}],page:1,pageSize:20,total:1,totalPages:1};
  assert.match(renderToStaticMarkup(<PreflightHistory data={{items:[preflight],page:1,pageSize:10,total:1,totalPages:1}}/>),/5 Observations/);assert.match(renderToStaticMarkup(<TimelineView data={timeline}/>),/Preflight completed/);});
test("Unreviewed endpoints remain visibly pending without review controls",()=>{const html=renderToStaticMarkup(<UnreviewedView data={{items:[{observedEndpointId:"endpoint",observedMachineName:"PC-DEMO",platform:"Windows",firstObservedAt:"2026-10-13T11:00:00Z",lastObservedAt:"2026-10-13T12:00:00Z",reviewState:"Pending human review",latestPreflight:preflight}],page:1,pageSize:20,total:1,totalPages:1}}/>);
  assert.match(html,/Pending human review/);assert.doesNotMatch(html,/<button/);});
test("loading and API failure states are understandable and contain no stack trace",()=>{const loading=renderToStaticMarkup(<LoadingState/>),failure=renderToStaticMarkup(<ErrorState message="Control Plane indisponível."/>);
  assert.match(loading,/Carregando dados operacionais/);assert.match(failure,/Control Plane indisponível/);assert.doesNotMatch(failure,/at Object\.|node_modules/);});
