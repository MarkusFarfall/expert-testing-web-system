import { handleRequest } from "./lib/router.ts";
Deno.serve({ port: 8787, hostname: "0.0.0.0" }, handleRequest);
