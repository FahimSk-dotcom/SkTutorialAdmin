import { NextResponse } from "next/server";
import { isAllowedParentOrigin } from "./parent-cors-policy";
export { isAllowedParentOrigin } from "./parent-cors-policy";

const ALLOWED_METHODS = "GET, POST, OPTIONS";
const ALLOWED_HEADERS = "Authorization, Content-Type";

export function applyParentCors(
  request: Request,
  response: NextResponse
): NextResponse {
  const origin = request.headers.get("origin");

  response.headers.set("Vary", "Origin");
  if (isAllowedParentOrigin(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  return response;
}

export function parentJson<T>(
  request: Request,
  body: T,
  status = 200
): NextResponse {
  return applyParentCors(request, NextResponse.json(body, { status }));
}

export function parentBinary(
  request: Request,
  body: BodyInit,
  headers: Record<string, string>,
  status = 200
): NextResponse {
  return applyParentCors(
    request,
    new NextResponse(body, {
      status,
      headers: {
        ...headers,
        "Access-Control-Expose-Headers": "Content-Disposition, Content-Length",
      },
    })
  );
}

export function parentOptions(request: Request): NextResponse {
  const origin = request.headers.get("origin");
  if (!isAllowedParentOrigin(origin)) {
    return new NextResponse(null, { status: 403, headers: { Vary: "Origin" } });
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      "Access-Control-Max-Age": "600",
      Vary: "Origin",
    },
  });
}
