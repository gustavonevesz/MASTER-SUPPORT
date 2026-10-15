import { useEffect, useState, type ReactNode } from "react";
import { api, loadOperatorSession, logout, type BrowserOperatorSession } from "./api.js";
import { AppShell, ErrorState, LoadingState } from "./components.js";
import type { AssetDetail, AssetSummary, Page, PreflightSummary, SessionSummary, TimelineEvent, UnreviewedEndpoint } from "./types.js";
import { AssetDetailView, AssetsView, SessionsLanding, SessionView, UnreviewedView } from "./views.js";

export function App(){const path=globalThis.location?.pathname??"/assets";const [auth,setAuth]=useState<{session?:BrowserOperatorSession;loaded:boolean;error?:string}>({loaded:false});
  useEffect(()=>{const controller=new AbortController();void loadOperatorSession(controller.signal).then(session=>setAuth({loaded:true,...(session?{session}:{})})).catch(error=>{if(!controller.signal.aborted)setAuth({loaded:true,error:error instanceof Error?error.message:"Falha de autenticação."});});return()=>controller.abort();},[]);
  if(!auth.loaded)return <LoadingState/>;if(auth.error)return <ErrorState message={auth.error}/>;if(!auth.session)return <LoginView returnUrl={path}/>;
  const doLogout=async()=>{await logout(auth.session!.csrfToken);setAuth({loaded:true});globalThis.location?.assign("/");};
  return <AppShell path={path} operator={auth.session.operator} onLogout={doLogout}><Route path={path}/></AppShell>}
export function LoginView({returnUrl="/assets"}:{returnUrl?:string}){return <main className="login"><section><div className="brand-mark">MS</div><span className="eyebrow">MASTER SUPPORT</span><h1>Acesso do operador</h1><p>Autentique sua identidade para consultar a console operacional read-only.</p><a className="login-button" href={`/auth/login?returnUrl=${encodeURIComponent(returnUrl)}`}>Entrar</a><small>Acesso local protegido · somente 127.0.0.1</small></section></main>}
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
