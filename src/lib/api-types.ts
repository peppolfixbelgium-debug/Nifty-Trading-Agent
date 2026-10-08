import type { IncomingMessage, ServerResponse } from "node:http";
import type { ParsedUrlQuery } from "node:querystring";

// Minimal structural types for Vercel's Node function request/response objects.
// Avoids requiring the bundled @vercel/node dependency just for type-checking.
export type ApiRequest = IncomingMessage & {
  query: ParsedUrlQuery;
};

export type ApiResponse = ServerResponse & {
  status(code: number): ApiResponse;
  json(body: unknown): ApiResponse;
};
