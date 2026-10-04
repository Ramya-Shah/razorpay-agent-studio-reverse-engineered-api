import { NpciClient } from "./client.js";
import { buildServer } from "./server.js";
import { UpiStatsService } from "./service.js";

const app = buildServer(new UpiStatsService(new NpciClient()));
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "127.0.0.1" });
console.log(`Listening on http://127.0.0.1:${port}`);
