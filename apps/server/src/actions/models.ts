export const actionRequestPermission="action.request" as const;
export const actionApprovePermission="action.approve" as const;
export const simulationAction=Object.freeze({id:"control-plane.simulation.set-marker",version:"1.0",displayName:"Set simulation marker",description:"Sets one bounded marker in the in-memory Control Plane simulation adapter.",targetKind:"ControlPlaneSimulation",risk:"R1" as const,requiredPermission:actionRequestPermission,approvalPolicy:"ExplicitSingleDecision",verificationStrategy:"ReadMarkerFromIndependentPort",inputSchemaId:"control-plane.simulation.set-marker.input@1.0",requiresApproval:true});
export type Risk="R0"|"R1"|"R2"|"R3"|"R4";
export type JobStatus="Requested"|"AwaitingApproval"|"Ready"|"Executing"|"Verifying"|"Succeeded"|"Failed"|"Denied"|"Cancelled"|"Expired"|"OutcomeUnknown";
export type PolicyDecision="Allow"|"RequireApproval"|"Deny";
export type ActionInput=Readonly<{marker:string}>;
export type ActionRequestCommand=Readonly<{actionId:string;actionVersion:string;targetKind:string;input:unknown}>;
export type PolicyResult=Readonly<{policyVersion:string;decision:PolicyDecision;risk:Risk;reasonCodes:readonly string[]}>;
export type JobSummary=Readonly<{jobId:string;status:JobStatus;risk:Risk;actionId:string;actionVersion:string;targetKind:string;requestedBy:string;createdAt:string;updatedAt:string;approvalExpiresAt?:string}>;
export type JobDetail=JobSummary&Readonly<{input:ActionInput;policyEvaluations:readonly unknown[];approval?:unknown;executionAttempts:readonly unknown[];verificationAttempts:readonly unknown[];events:readonly unknown[]}>;

const transitions:Readonly<Record<JobStatus,readonly JobStatus[]>>={
  Requested:["AwaitingApproval","Ready","Denied","Cancelled"],AwaitingApproval:["Ready","Denied","Cancelled","Expired"],Ready:["Executing","Denied","Cancelled","Expired"],
  Executing:["Verifying","Failed","OutcomeUnknown"],Verifying:["Succeeded","Failed","OutcomeUnknown"],Succeeded:[],Failed:[],Denied:[],Cancelled:[],Expired:[],OutcomeUnknown:[]};
export function canTransition(from:JobStatus,to:JobStatus):boolean{return transitions[from].includes(to);}
export function requireTransition(from:JobStatus,to:JobStatus):void{if(!canTransition(from,to))throw new Error(`invalid_job_transition:${from}:${to}`);}
export function isTerminal(status:JobStatus):boolean{return transitions[status].length===0;}
