import { useEffect, useState, type ReactNode } from "react";
import { api } from "./api.js";
import { AppShell, ErrorState, LoadingState } from "./components.js";
import type { AssetDetail, AssetSummary, Page, PreflightSummary, SessionSummary, TimelineEvent, UnreviewedEndpoint } from "./types.js";
import { AssetDetailView, AssetsView, SessionsLanding, SessionView, UnreviewedView } from "./views.js";

export function App(){const path=globalThis.location?.pathname??"/assets";return <AppShell path={path}><Route path={path}/></AppShell>}
function Route({path}:{path:string}){const asset=path.match(/^\/assets\/([0-9a-f-]{36})$/i);const session=path.match(/^\/sessions\/([0-9a-f-]{36})$/i);
  if(asset)return <AssetPage id={asset[1]!}/>;if(session)return <SessionPage id={session[1]!}/>;if(path==="/endpoints/unreviewed")return <UnreviewedPage/>;if(path==="/sessions")return <SessionsLanding/>;return <AssetsPage/>;}
function AssetsPage(){const query=new URLSearchParams(globalThis.location?.search??"");const page=query.get("page")??"1",search=query.get("search")??"";
  return <Remote load={signal=>api<Page<AssetSummary>>(`/api/assets?page=${encodeURIComponent(page)}&pageSize=20&search=${encodeURIComponent(search)}`,signal)} render={data=><AssetsView data={data} search={search}/>}/>}
function AssetPage({id}:{id:string}){const query=new URLSearchParams(globalThis.location?.search??""),preflightPage=query.get("preflightPage")??"1",timelinePage=query.get("timelinePage")??"1";
  return <Remote load={async signal=>{const [detail,preflights,timeline]=await Promise.all([api<AssetDetail>(`/api/assets/${id}`,signal),
    api<Page<PreflightSummary>>(`/api/assets/${id}/preflights?page=${encodeURIComponent(preflightPage)}&pageSize=10`,signal),api<Page<TimelineEvent>>(`/api/assets/${id}/timeline?page=${encodeURIComponent(timelinePage)}&pageSize=20`,signal)]);return {detail,preflights,timeline};}}
    render={data=><AssetDetailView {...data} preflightPage={Number(preflightPage)} timelinePage={Number(timelinePage)}/>}/>
}
function SessionPage({id}:{id:string}){return <Remote load={signal=>api<SessionSummary>(`/api/sessions/${id}`,signal)} render={session=><SessionView session={session}/>}/>}
function UnreviewedPage(){return <Remote load={signal=>api<Page<UnreviewedEndpoint>>("/api/unreviewed-endpoints?page=1&pageSize=20",signal)} render={data=><UnreviewedView data={data}/>}/>}
export function Remote<T>({load,render}:{load:(signal:AbortSignal)=>Promise<T>;render:(data:T)=>ReactNode}){const [state,setState]=useState<{data?:T;error?:string}>({});
  useEffect(()=>{const controller=new AbortController();void load(controller.signal).then(data=>setState({data})).catch(error=>{if(!controller.signal.aborted)setState({error:error instanceof Error?error.message:"Falha inesperada."});});return()=>controller.abort();},[]);
  if(state.error)return <ErrorState message={state.error}/>;if(state.data===undefined)return <LoadingState/>;return <>{render(state.data)}</>}
