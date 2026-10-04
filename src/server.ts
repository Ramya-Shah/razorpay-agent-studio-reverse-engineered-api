import Fastify, { type FastifyInstance } from "fastify";
import { NotFoundError, RateLimitedError, StructureChangedError, UpstreamError, ValidationError } from "./errors.js";
import { UpiStatsService } from "./service.js";

type Query = Record<string, string | undefined>;

export function buildServer(service: UpiStatsService): FastifyInstance {
  const app = Fastify();

  app.setErrorHandler((err: Error, _req, reply) => {
    const body = (code: string) => ({ error: { code, message: err.message } });
    if (err instanceof ValidationError) return reply.code(400).send(body("invalid_input"));
    if (err instanceof NotFoundError) return reply.code(404).send(body("not_found"));
    if (err instanceof RateLimitedError) return reply.code(429).send(body("upstream_rate_limited"));
    if (err instanceof StructureChangedError) return reply.code(502).send(body("upstream_structure_changed"));
    if (err instanceof UpstreamError) return reply.code(502).send(body("upstream_error"));
    return reply.code(500).send(body("internal_error"));
  });

  const need = (q: Query, key: string): string => {
    const v = q[key];
    if (!v) throw new ValidationError(`Missing query parameter: ${key}`);
    return v;
  };
  const list = (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean);

  app.get("/banks", async (req) => {
    const q = req.query as Query;
    return service.listBanks(need(q, "month"), q.side);
  });
  app.get("/bank-stats", async (req) => {
    const q = req.query as Query;
    return service.getBankStats(need(q, "bank"), need(q, "month"), q.side);
  });
  app.get("/compare", async (req) => {
    const q = req.query as Query;
    return service.compareBanks(list(need(q, "banks")), need(q, "month"), q.side);
  });
  app.get("/worst-by-td", async (req) => {
    const q = req.query as Query;
    return service.worstBanksByTd(need(q, "month"), q.n === undefined ? 5 : Number(q.n), q.side);
  });
  app.get("/trend", async (req) => {
    const q = req.query as Query;
    return service.monthlyTrend(need(q, "bank"), need(q, "metric"), list(need(q, "months")), q.side);
  });
  app.get("/uptime", async (req) => service.getUptime(need(req.query as Query, "month")));

  return app;
}
