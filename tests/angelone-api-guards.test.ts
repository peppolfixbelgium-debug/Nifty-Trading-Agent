import test from "node:test";
import assert from "node:assert/strict";
import handler from "../api/angelone-option-chain.js";
import type { ApiRequest, ApiResponse } from "../src/lib/api-types.js";

const envKeys = [
  "ANGELONE_API_KEY",
  "ANGELONE_JWT_TOKEN",
  "ANGELONE_CLIENT_LOCAL_IP",
  "ANGELONE_CLIENT_PUBLIC_IP",
  "ANGELONE_MAC_ADDRESS"
] as const;

function mockRequest(method: string, query: Record<string, string> = {}): ApiRequest {
  return { method, query } as unknown as ApiRequest;
}

function mockResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    }
  };
  return response as typeof response & ApiResponse;
}

test("Angel One chain API fails closed without credentials and rejects unsupported underlyings", async () => {
  const original = new Map(envKeys.map((key) => [key, process.env[key]]));
  try {
    for (const key of envKeys) delete process.env[key];

    const methodResponse = mockResponse();
    await handler(mockRequest("POST"), methodResponse);
    assert.equal(methodResponse.statusCode, 405);
    assert.equal(methodResponse.headers.Allow, "GET");

    const missingConfigResponse = mockResponse();
    await handler(mockRequest("GET"), missingConfigResponse);
    assert.equal(missingConfigResponse.statusCode, 503);
    assert.equal((missingConfigResponse.body as { configured?: boolean }).configured, false);
    assert.match((missingConfigResponse.body as { error?: string }).error ?? "", /not connected/i);

    for (const key of envKeys) process.env[key] = "test-only-placeholder";
    const unsupportedResponse = mockResponse();
    await handler(mockRequest("GET", { underlying: "SENSEX" }), unsupportedResponse);
    assert.equal(unsupportedResponse.statusCode, 400);
    assert.match((unsupportedResponse.body as { error?: string }).error ?? "", /SENSEX is not mapped/i);
  } finally {
    for (const key of envKeys) {
      const value = original.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
