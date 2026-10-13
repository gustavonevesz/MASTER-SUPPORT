import { defineConfig } from "vite";

const host=process.env["MASTER_SUPPORT_WEB_HOST"]??"127.0.0.1";
if(host!=="127.0.0.1")throw new Error("operator_console_requires_127.0.0.1");
const apiOrigin=new URL(process.env["MASTER_SUPPORT_API_ORIGIN"]??"http://127.0.0.1:3000");
if(apiOrigin.hostname!=="127.0.0.1"||!["http:","https:"].includes(apiOrigin.protocol))throw new Error("operator_console_api_requires_loopback");
const headers={"Content-Security-Policy":"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer","X-Frame-Options":"DENY","Cache-Control":"no-store"};
export default defineConfig({server:{host:"127.0.0.1",port:4173,strictPort:true,headers,proxy:{"/api":{target:apiOrigin.origin,changeOrigin:false}}},
  preview:{host:"127.0.0.1",port:4173,strictPort:true,headers,proxy:{"/api":{target:apiOrigin.origin,changeOrigin:false}}},build:{outDir:"dist",sourcemap:false}});
