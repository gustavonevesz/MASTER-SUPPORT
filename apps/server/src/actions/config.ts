export type SimulationConfig=Readonly<{enabled:boolean;mode:"development"|"secure";host:string;scenario?:"success"|"execution-fail"|"verification-fail"|"inconclusive"}>;
export function requireSafeSimulationConfiguration(config:SimulationConfig):void{
  if(!config.enabled)return;
  if(config.mode!=="development")throw new Error("simulated_actions_require_development_mode");
  if(config.host!=="127.0.0.1")throw new Error("simulated_actions_require_127.0.0.1");
}
