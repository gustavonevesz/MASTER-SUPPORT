import { Ajv2020 } from "ajv/dist/2020.js";
import { simulationAction,type ActionInput,type ActionRequestCommand } from "./models.js";

const ajv=new Ajv2020({allErrors:true,strict:true});
const validateInput=ajv.compile({type:"object",additionalProperties:false,required:["marker"],properties:{marker:{type:"string",minLength:1,maxLength:64,pattern:"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$"}}});
export function resolveAction(command:ActionRequestCommand):typeof simulationAction|undefined{return command.actionId===simulationAction.id&&command.actionVersion===simulationAction.version&&command.targetKind===simulationAction.targetKind?simulationAction:undefined;}
export function parseActionInput(value:unknown):ActionInput|undefined{return validateInput(value)?value as ActionInput:undefined;}
export function requireBoundedRequest(command:ActionRequestCommand):void{const encoded=JSON.stringify(command);if(!encoded||Buffer.byteLength(encoded,"utf8")>2048)throw new Error("action_request_too_large");}
